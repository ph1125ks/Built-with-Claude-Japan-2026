// 教員モードの Claude：地域のデータと教えたいことから、ステージを設計して、シミュレーションで確かめながら直す（SPEC.md 5）。
// Anthropic TypeScript SDK のツールランナー（beta）でツール実行の繰り返しを回し、作業の流れを画面に送る（emit）。
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Focus, ScenarioDef } from "../src/engine/index.ts";
import { catalog, MAX_SIMULATIONS, regionData, saveDraft, simulate, validate, type DraftRecord } from "./tools.ts";

export const MODEL = "claude-opus-5-5";
/** Claude Opus 5.5 の料金（1M トークンあたりの米ドル。入力・出力・キャッシュの読み出し・書き込み） */
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

export type DesignEvent =
  | { type: "status"; text: string }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "block_end" }
  | { type: "tool_call"; name: string; label: string; detail?: string }
  | { type: "tool_result"; name: string; ok: boolean; summary: string; checks?: { ok: boolean; label: string; value: string; target: string }[]; errors?: string[] }
  | { type: "draft"; id: string; record: DraftRecord }
  | { type: "usage"; input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number; seconds: number }
  | { type: "done"; draftId: string | null; stopReason: string | null }
  | { type: "error"; message: string };

export interface DesignInput {
  region: string;
  audience: string;
  goal: string;
}

// ---------- ステージの形（ツールの入力。足りない点はエンジンの検査が見つける） ----------

const Wave = z.object({
  at: z.number().min(0).describe("開始時刻（秒）"),
  lane: z.union([z.literal("random"), z.number().int().min(0).max(2)]).describe('レーン 0〜2 か "random"'),
  species: z
    .union([z.string(), z.object({ mix: z.record(z.string(), z.number().positive()) })])
    .describe('"auto"（地域の尿の分離菌の割合）か菌の id か { mix: { 菌の id: 重み } }'),
  count: z.number().int().min(1).max(20),
  spacing: z.number().min(0.3).max(6).describe("1匹ごとの間隔（秒）"),
});
const Stage = z.object({
  title: z.string(),
  briefing: z.string().describe("200字以内"),
  budget: z.number().positive(),
  budgetPerDay: z.number().min(0),
  bladderHp: z.number().positive(),
  hand: z.array(z.object({ drug: z.string() })).min(1).max(15),
  shortage: z.object({ count: z.number().int().min(0), candidates: z.array(z.string()).optional() }).optional(),
  waves: z.array(Wave).min(1).max(12),
});
const Scenario = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).describe("英小文字・数字・ハイフン"),
  title: z.string(),
  region: z.string(),
  target: z.string(),
  learningGoal: z.string(),
  debrief: z.string().describe("400字以内"),
  present: Stage,
  future: Stage.extend({ yearsLater: z.number().int().min(1).max(40) }),
});
const FocusSchema = z
  .object({ species: z.string(), resistantTo: z.array(z.string()).min(1) })
  .optional()
  .describe("教えたい場面：この菌で、これらの薬すべてに耐性の個体（例：{ species: 'ecoli', resistantTo: ['CTRX'] }）");

/** スキル stage-design の本文（教員モードの指示に同じ内容を使う） */
function skillBody(): string {
  const raw = readFileSync(".claude/skills/stage-design/SKILL.md", "utf8");
  return raw.replace(/^---[\s\S]*?---\s*/, "");
}

function systemPrompt(): string {
  return `あなたは、教育用タワーディフェンス「センタクアツ」のステージを設計する担当です。教える人（薬剤師・教員）が選んだ地域と、教えたいことをもとに、学生が遊んで体感できるステージを作ります。

進め方：
1. get_region_data と list_catalog で、その地域の公開データと、使える薬・菌を確かめる
2. 教えたいことに合う場面（例：CTRX が効かない大腸菌）を決め、見本のステージを手がかりに案を作る
3. simulate_stage で確かめ、合格の目安に届かない点を直す（1回に2〜3か所まで）。上限は ${MAX_SIMULATIONS} 回
4. 目安をすべて満たしたら submit_stage で提出する。満たせないときは、満たせない目安と理由を正直に書いて止まる

書き方：
- 画面には、ツールを呼ぶ前のあなたの短い文がそのまま作業の記録として流れます。各ツールを呼ぶ前に、何を確かめるか・何をなぜ直すかを日本語で1〜2文で書いてください。データの数値を書くときは、ツールで得た値だけを使い、作らないでください
- 感受性や薬の性質の数値は変えられません。ステージの文章には「患者」「症例」「病棟」の語、投与量の数値、診療の指示を書かないでください

以下は、ステージ設計の知識（スキル stage-design）です。

${skillBody()}`;
}

function cost(u: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  return (u.input * PRICE.input + u.output * PRICE.output + u.cacheRead * PRICE.cacheRead + u.cacheWrite * PRICE.cacheWrite) / 1e6;
}

class TruncatedToolInput extends Error {}

/**
 * ステージを設計する。作業の流れは emit で画面に送る。提出されたステージは .drafts/ に下書きとして保存する
 */
export async function designStage(input: DesignInput, emit: (e: DesignEvent) => void, signal?: AbortSignal): Promise<string | null> {
  const client = new Anthropic();
  const t0 = Date.now();
  const log: string[] = [];
  let simulations = 0;
  let draftId: string | null = null;
  let lastFocus: Focus | undefined;

  const getRegion = betaZodTool({
    name: "get_region_data",
    description: "地域の公開データ（JANIS 2025年報）を返す：尿から分離される菌の割合（%）と、菌 × 薬の感性率（%）。自然耐性・効かない扱い・代用の印つき",
    inputSchema: z.object({ region: z.string().describe("全国 か 府県名") }),
    run: async ({ region }) => {
      emit({ type: "tool_call", name: "get_region_data", label: `${region}の公開データを読む` });
      const r = regionData(region);
      emit({ type: "tool_result", name: "get_region_data", ok: !("error" in r), summary: "error" in r ? String(r.error) : `菌 ${Object.keys(r.susceptibilityPct).length} 種 × 薬 15 種の感性率と、尿の分離菌の割合` });
      return JSON.stringify(r);
    },
  });

  const listCatalog = betaZodTool({
    name: "list_catalog",
    description: "使える抗菌薬カード・細菌・ゲームのルール・合格の目安・見本のステージ（既定ステージ uti-zenkoku）を返す",
    inputSchema: z.object({}),
    run: async () => {
      emit({ type: "tool_call", name: "list_catalog", label: "使える薬と菌、見本のステージを読む" });
      const c = catalog();
      emit({ type: "tool_result", name: "list_catalog", ok: true, summary: `薬 ${c.drugs.length} 種・菌 ${c.bacteria.length} 種・見本 1 つ` });
      return JSON.stringify(c);
    },
  });

  const simulateStage = betaZodTool({
    name: "simulate_stage",
    description: `ステージ案を、適正・乱用・ランダム・何もしないの4つのボットで各60回動かし、勝率・系統の使い分け（AHI）・教えたい場面の数と、合格の目安との比較を返す。規則の検査に通らない案は動かさず、誤りを返す。上限 ${MAX_SIMULATIONS} 回`,
    inputSchema: z.object({ scenario: Scenario, focus: FocusSchema }),
    eager_input_streaming: true,
    run: async ({ scenario, focus }) => {
      simulations++;
      lastFocus = focus;
      emit({ type: "tool_call", name: "simulate_stage", label: `シミュレーション ${simulations} 回目（4つのボット × 60 回）`, detail: scenario.title });
      if (simulations > MAX_SIMULATIONS) {
        const msg = `シミュレーションの上限（${MAX_SIMULATIONS} 回）に達しました。いまの案で submit_stage するか、満たせない理由を書いて止まってください`;
        emit({ type: "tool_result", name: "simulate_stage", ok: false, summary: msg });
        return msg;
      }
      const r = simulate(scenario as ScenarioDef, focus, 60, 1);
      if ("errors" in r) {
        emit({ type: "tool_result", name: "simulate_stage", ok: false, summary: "規則の検査で止まった", errors: r.errors });
        return JSON.stringify({ errors: r.errors });
      }
      const ev = r.evaluation!;
      emit({ type: "tool_result", name: "simulate_stage", ok: ev.passed, summary: ev.passed ? "合格の目安をすべて満たした" : `満たさない目安が ${ev.checks.filter((c) => !c.ok).length} つ`, checks: ev.checks });
      return JSON.stringify(ev);
    },
  });

  const validateStage = betaZodTool({
    name: "validate_stage",
    description: "ステージ案を規則で検査する（カタログ・手札の枚数・波・文章の字数と使わない言葉・ステージ1の手札に各菌に効く薬があるか）。誤りの一覧を返す（空なら通過）",
    inputSchema: z.object({ scenario: Scenario }),
    eager_input_streaming: true,
    run: async ({ scenario }) => {
      emit({ type: "tool_call", name: "validate_stage", label: "規則で検査する" });
      const errors = validate(scenario as ScenarioDef);
      emit({ type: "tool_result", name: "validate_stage", ok: errors.length === 0, summary: errors.length ? `誤り ${errors.length} 件` : "規則の検査を通った", errors });
      return JSON.stringify({ errors });
    },
  });

  const submitStage = betaZodTool({
    name: "submit_stage",
    description: "合格の目安をすべて満たした案を提出する。提出時に、別の乱数の種で各100回のシミュレーションをし直し、満たせば下書きとして保存する（公開は教える人が確かめて承認したあと）",
    inputSchema: z.object({ scenario: Scenario, focus: FocusSchema, summary: z.string().describe("どんなステージにしたか、何を直したかの要約（日本語、200字以内）") }),
    eager_input_streaming: true,
    run: async ({ scenario, focus, summary }) => {
      emit({ type: "tool_call", name: "submit_stage", label: "提出：別の種で各100回、確かめ直す" });
      const r = simulate(scenario as ScenarioDef, focus ?? lastFocus, 100, 1001);
      if ("errors" in r) {
        emit({ type: "tool_result", name: "submit_stage", ok: false, summary: "規則の検査で止まった", errors: r.errors });
        return JSON.stringify({ accepted: false, errors: r.errors });
      }
      const ev = r.evaluation!;
      if (!ev.passed) {
        emit({ type: "tool_result", name: "submit_stage", ok: false, summary: "確かめ直しで満たさない目安があった", checks: ev.checks });
        return JSON.stringify({ accepted: false, evaluation: ev, note: "別の種では目安を満たしませんでした。直して simulate_stage で確かめてから、もう一度提出してください" });
      }
      const id = `draft-${scenario.id}`;
      const record: DraftRecord = {
        id,
        scenario: scenario as ScenarioDef,
        evaluation: ev,
        focus: focus ?? lastFocus,
        input,
        model: MODEL,
        createdAt: new Date().toISOString(),
        summary,
        log,
      };
      saveDraft(record);
      draftId = id;
      emit({ type: "tool_result", name: "submit_stage", ok: true, summary: "合格。下書きとして保存した（承認するまで公開されない）", checks: ev.checks });
      emit({ type: "draft", id, record });
      return JSON.stringify({ accepted: true, draftId: id });
    },
  });

  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const userText = `地域：${input.region}\n対象：${input.audience}\n教えたいこと：${input.goal}\n\nこの内容で、ステージを設計してください。`;

  let runner = client.beta.messages.toolRunner(
    {
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" },
      // 安全のための判定で断られたときは、サーバー側で推奨のモデルに切り替えて続ける
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
      tools: [getRegion, listCatalog, simulateStage, validateStage, submitStage],
      messages: [{ role: "user", content: userText }],
      max_iterations: 30,
      stream: true,
    },
    { signal },
  );

  emit({ type: "status", text: `Claude（${MODEL}）が設計を始めました` });
  let stopReason: string | null = null;
  let current = "";
  for (let attempt = 0; ; attempt++) {
    try {
      for await (const messageStream of runner) {
        for await (const event of messageStream) {
          if (event.type === "content_block_start") {
            current = event.content_block.type;
            if (current === "tool_use") emit({ type: "status", text: "案を書いています…" });
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "thinking_delta" && event.delta.thinking) emit({ type: "thinking", text: event.delta.thinking });
            else if (event.delta.type === "text_delta") {
              emit({ type: "text", text: event.delta.text });
            }
          } else if (event.type === "content_block_stop") {
            emit({ type: "block_end" });
          }
        }
        const message = await messageStream.finalMessage();
        attempt = 0;
        for (const b of message.content) if (b.type === "text" && b.text.trim()) log.push(b.text.trim());
        const u = message.usage;
        usage.input += u.input_tokens ?? 0;
        usage.output += u.output_tokens ?? 0;
        usage.cacheRead += u.cache_read_input_tokens ?? 0;
        usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
        stopReason = message.stop_reason;
        const hasToolUse = message.content.some((b) => b.type === "tool_use");
        if (message.stop_reason === "max_tokens" && hasToolUse) throw new TruncatedToolInput("ツールの入力が途中で切れました（max_tokens）");
        if (message.stop_reason === "refusal") {
          emit({ type: "error", message: "Claude が依頼を断りました。教えたいことの書き方を変えて、もう一度試してください" });
          break;
        }
      }
      break;
    } catch (err) {
      // やり直すのは、ストリームで届いたツールの入力が JSON として読めなかったときだけ（API のエラーや認証の誤りはそのまま知らせる）
      const unreadableJson = !(err instanceof Anthropic.APIError) && (err instanceof SyntaxError || /JSON/i.test((err as Error).message ?? ""));
      if (!unreadableJson || err instanceof TruncatedToolInput || attempt >= 2 || signal?.aborted) {
        const msg =
          err instanceof Anthropic.AuthenticationError
            ? "API キーが正しくありません（.env の ANTHROPIC_API_KEY を確かめてください）"
            : err instanceof Anthropic.RateLimitError
              ? "API の利用の上限に達しました。少し待ってから試してください"
              : err instanceof Anthropic.APIError
                ? `API のエラー（${err.status}）：${err.message}`
                : (err as Error).message;
        emit({ type: "error", message: msg });
        break;
      }
      emit({ type: "status", text: "ツールの入力を読み取れなかったので、やり直します" });
      runner = client.beta.messages.toolRunner({ ...runner.params }, { signal });
    }
  }
  const seconds = Math.round((Date.now() - t0) / 1000);
  emit({ type: "usage", ...usage, costUsd: Math.round(cost(usage) * 100) / 100, seconds });
  emit({ type: "done", draftId, stopReason });
  return draftId;
}
