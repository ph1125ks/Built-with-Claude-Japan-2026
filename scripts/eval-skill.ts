// スキル stage-design の効果を比べる（2026-11-05。過去のハッカソンの受賞作 MaestrIA の「変えた条件は1つだけ、件数を書く」評価にならう）。
// 教員モードの Claude（server/agent.ts）を、指示にスキルの本文を入れる・入れないの2条件で、同じ入力から各 N 回動かし、
// 提出できたか・シミュレーションの回数・合格の目安・時間・費用を比べる。作業の記録（イベント）はすべて残す。
//   npx tsx scripts/eval-skill.ts --runs 3
//   → docs/eval/skill/summary.json と runs/<条件>-<番号>.json（作業の記録）。表を標準出力に出す
// API キーは教員モードのサーバーと同じ場所から読む（中身は表示しない）。1回 約0.5ドル・約2分
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { designStage, MODEL, type DesignEvent, type DesignInput } from "../server/agent.ts";

const ENV_FILES = [process.env.TEACHER_ENV_FILE, ".env", join(homedir(), "Claude", "Cowork", "Built with Claude Japan 2026", ".env")].filter((f): f is string => Boolean(f));
const envFile = ENV_FILES.find((f) => existsSync(f));
if (envFile) process.loadEnvFile(envFile);
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY が見つかりません");
  process.exit(1);
}

const { values } = parseArgs({ options: { runs: { type: "string", default: "3" }, out: { type: "string", default: "docs/eval/skill" } } });
const RUNS = Number(values.runs);
const OUT = values.out!;
mkdirSync(join(OUT, "runs"), { recursive: true });

/** 本番（2026-11-05、動画のシーン6）と同じ入力 */
const INPUT: DesignInput = {
  region: "大阪府",
  audience: "病院実務実習の薬学生",
  goal: "第3世代セフェムが効かない大腸菌に、カルバペネムを使わずに勝つ経験をさせたい",
};

interface LoggedEvent {
  t: number;
  e: DesignEvent;
}

interface RunResult {
  condition: "skill" | "noskill";
  n: number;
  submitted: boolean;
  stopReason: string | null;
  error: string | null;
  simulations: number;
  firstSimulationPassed: boolean | null;
  simulationsFailed: number;
  ruleErrors: number;
  submitAttempts: number;
  seconds: number;
  costUsd: number;
  finalChecks: { ok: boolean; label: string; value: string; target: string }[] | null;
  title: string | null;
}

async function runOnce(condition: "skill" | "noskill", n: number): Promise<RunResult> {
  const t0 = Date.now();
  const events: LoggedEvent[] = [];
  const push = (e: DesignEvent) => {
    const t = Math.round((Date.now() - t0) / 100) / 10;
    const last = events.at(-1);
    // 少しずつ届く文と考えの知らせは、続いているあいだ1つにまとめる（記録を小さくする）
    if (last && (e.type === "text" || e.type === "thinking") && last.e.type === e.type) {
      (last.e as { text: string }).text += e.text;
      return;
    }
    events.push({ t, e: e.type === "text" || e.type === "thinking" ? { ...e } : e });
  };
  let draftId: string | null = null;
  try {
    draftId = await designStage(INPUT, push, undefined, { skill: condition === "skill" });
  } catch (err) {
    push({ type: "error", message: (err as Error).message });
  }
  const calls = events.filter((x) => x.e.type === "tool_call").map((x) => x.e as Extract<DesignEvent, { type: "tool_call" }>);
  const results = events.filter((x) => x.e.type === "tool_result").map((x) => x.e as Extract<DesignEvent, { type: "tool_result" }>);
  const sims = results.filter((r) => r.name === "simulate_stage" && r.checks);
  const submits = results.filter((r) => r.name === "submit_stage");
  const usage = events.find((x) => x.e.type === "usage")?.e as Extract<DesignEvent, { type: "usage" }> | undefined;
  const done = events.find((x) => x.e.type === "done")?.e as Extract<DesignEvent, { type: "done" }> | undefined;
  const draft = events.find((x) => x.e.type === "draft")?.e as Extract<DesignEvent, { type: "draft" }> | undefined;
  const result: RunResult = {
    condition,
    n,
    submitted: Boolean(draftId),
    stopReason: done?.stopReason ?? null,
    error: (events.find((x) => x.e.type === "error")?.e as { message?: string } | undefined)?.message ?? null,
    simulations: calls.filter((c) => c.name === "simulate_stage").length,
    firstSimulationPassed: sims[0] ? sims[0].ok : null,
    simulationsFailed: sims.filter((r) => !r.ok).length,
    ruleErrors: results.filter((r) => (r.name === "simulate_stage" || r.name === "validate_stage") && r.errors && r.errors.length > 0).length,
    submitAttempts: submits.length,
    seconds: usage?.seconds ?? Math.round((Date.now() - t0) / 1000),
    costUsd: usage?.costUsd ?? 0,
    finalChecks: submits.find((r) => r.ok)?.checks ?? null,
    title: draft?.record.scenario.title ?? null,
  };
  writeFileSync(join(OUT, "runs", `${condition}-${n}.json`), JSON.stringify({ model: MODEL, input: INPUT, condition, n, made: new Date().toISOString(), result, events }, null, 1) + "\n");
  console.log(`${condition} ${n}：提出 ${result.submitted ? "○" : "×"}・シミュレーション ${result.simulations} 回（1回目 ${result.firstSimulationPassed === null ? "なし" : result.firstSimulationPassed ? "合格" : "不合格"}）・${result.seconds}秒・${result.costUsd}ドル${result.error ? `・エラー：${result.error}` : ""}`);
  return result;
}

const all: RunResult[] = [];
// 条件を交互に動かす（時間による違いが片方に寄らないように）
for (let n = 1; n <= RUNS; n++) {
  for (const c of ["skill", "noskill"] as const) all.push(await runOnce(c, n));
}

const summarize = (c: "skill" | "noskill") => {
  const rs = all.filter((r) => r.condition === c);
  const avg = (f: (r: RunResult) => number) => Math.round((rs.reduce((a, r) => a + f(r), 0) / rs.length) * 10) / 10;
  return {
    condition: c,
    runs: rs.length,
    submitted: rs.filter((r) => r.submitted).length,
    firstSimulationPassed: rs.filter((r) => r.firstSimulationPassed).length,
    avgSimulations: avg((r) => r.simulations),
    avgSeconds: avg((r) => r.seconds),
    avgCostUsd: Math.round((rs.reduce((a, r) => a + r.costUsd, 0) / rs.length) * 100) / 100,
    totalCostUsd: Math.round(rs.reduce((a, r) => a + r.costUsd, 0) * 100) / 100,
  };
};
const summary = { made: new Date().toISOString(), model: MODEL, input: INPUT, conditions: [summarize("skill"), summarize("noskill")], runs: all };
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log("\n| 条件 | 回数 | 提出できた | 1回目のシミュレーションで合格 | シミュレーションの回数（平均） | 時間（平均） | 費用（平均） |");
console.log("|---|---|---|---|---|---|---|");
for (const s of summary.conditions)
  console.log(`| ${s.condition === "skill" ? "スキルあり" : "スキルなし"} | ${s.runs} | ${s.submitted} | ${s.firstSimulationPassed} | ${s.avgSimulations} | ${s.avgSeconds}秒 | ${s.avgCostUsd}ドル |`);
console.log(`\n→ ${join(OUT, "summary.json")}`);
