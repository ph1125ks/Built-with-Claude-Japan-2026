// ステージ（シナリオ）の合格の検査（SPEC.md 5.4）。教員モードで Claude が作った案と、同梱・公開のステージの両方に使う。
// 規則の検査（文章・手札・カタログ）と、ボットのシミュレーションによる検査（勝率・偏り・教えたい場面の数）からなる。
// 感受性や薬の性質は data/ から読むだけで、ここでも Claude からも変えられない。
import { appropriateBot, broadBot, idleBot, randomBot, type Bot } from "./bots.ts";
import { createGame, step } from "./game.ts";
import { getResistanceModel } from "./resistance.ts";
import { validateScenario } from "./scenario.ts";
import { drawShortage, stageSpecies, withShortage } from "./shortage.ts";
import { runScenario } from "./simulate.ts";
import { susceptibility } from "./susceptibility.ts";
import type { GameData, ResistanceModelId, ScenarioDef } from "./types.ts";

/** 画面に出す文章に使わない言葉（SPEC.md 5.4：患者・症例。2026-11-03 作者の方針：病棟） */
export const BANNED_WORDS = ["患者", "症例", "病棟"] as const;
/** 文章の字数の上限（SPEC.md 5.2） */
export const TEXT_LIMITS = { briefing: 200, debrief: 400 } as const;
/** 手札に「効く薬」があるとみなす感性率（供給制限の keepSusceptible の既定と同じ） */
export const COVER_S = 0.8;

const chars = (s: string | undefined) => [...(s ?? "")].length;

/** 文章の決まり：字数、使わない言葉、投与量の数値、診療の指示 */
export function textProblems(s: ScenarioDef): string[] {
  const e: string[] = [];
  const texts: [string, string | undefined, number][] = [
    ["ステージ1のブリーフィング", s.present?.briefing, TEXT_LIMITS.briefing],
    ["ステージ2のブリーフィング", s.future?.briefing, TEXT_LIMITS.briefing],
    ["振り返り", s.debrief, TEXT_LIMITS.debrief],
  ];
  for (const [label, t, max] of texts) {
    if (chars(t) > max) e.push(`${label}が${max}字を超えている（${chars(t)}字）`);
    for (const w of BANNED_WORDS) if ((t ?? "").includes(w)) e.push(`${label}に使わない言葉「${w}」がある`);
    if (/\d+(\.\d+)?\s*(mg|g|mL|ml|単位)(?![a-zA-Z])/.test(t ?? "")) e.push(`${label}に投与量の数値がある`);
    if (/(投与|処方|内服|点滴)(して(ください|下さい)|しなさい|すべき|せよ)/.test(t ?? "")) e.push(`${label}に診療の指示に読める文がある`);
  }
  return e;
}

/**
 * ステージ1の手札に、出てくる各菌に効く薬（公開データの感性率 COVER_S 以上）が少なくとも1枚あるか（SPEC.md 5.4）。
 * 自然耐性・「効かない扱い」は効かないものとして数える
 */
export function coverageProblems(data: GameData, s: ScenarioDef): string[] {
  const e: string[] = [];
  const stage = s.present;
  if (!stage?.hand?.length) return e;
  for (const sp of stageSpecies(data, stage, s.region)) {
    const ok = stage.hand.some((h) => {
      const v = susceptibility(data, s.region, sp, h.drug);
      return v.basis !== "intrinsic" && v.basis !== "fixed" && v.p >= COVER_S;
    });
    if (!ok) e.push(`ステージ1の手札に、${data.bacteriumById.get(sp)?.name ?? sp}に効く薬（感性率${Math.round(COVER_S * 100)}%以上）がない`);
  }
  return e;
}

/** 規則の検査をまとめて行う（エンジンの検査 → 文章 → 手札の効き目） */
export function checkScenario(data: GameData, s: ScenarioDef): string[] {
  const base = validateScenario(data, s);
  if (base.length) return base;
  return [...textProblems(s), ...coverageProblems(data, s)];
}

/** 教えたい場面：この菌で、これらの薬すべてに耐性の個体（例：CTRX が効かない大腸菌） */
export interface Focus {
  species: string;
  resistantTo: string[];
}

export interface BotSummary {
  presentWin: number;
  futureWin: number;
  /** 2050年に出てきた個体のうち、手札のどの薬も効かない割合（平均） */
  futurePanResistant: number;
  /** ステージ1の AHI（平均。使わなかった回は除く） */
  presentAhi: number | null;
  /** ステージ1の系統ごとの使用割合（平均） */
  presentUsageByClass: Record<string, number>;
  /** ステージ1の Access 薬の割合（平均） */
  presentAccess: number;
}

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  value: string;
  target: string;
}

export interface Evaluation {
  runs: number;
  seed: number;
  model: ResistanceModelId;
  bots: Record<"appropriate" | "broad" | "random" | "idle", BotSummary>;
  /** 教えたい場面の個体が、ステージ1に平均何体出てくるか */
  focusPerStage: number | null;
  checks: Check[];
  passed: boolean;
}

/** 合格の目安（SPEC.md 5.4。AHI の下限は作者の偏りの指標にもとづく仮の値） */
export const TARGETS = {
  appropriateMin: 0.8,
  broadPresentMin: 0.8,
  broadFutureMax: 0.3,
  ahiMin: 0.3,
  focusMin: 2,
} as const;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;

function summarize(data: GameData, s: ScenarioDef, bot: () => Bot, runs: number, seed: number, model: ResistanceModelId): BotSummary {
  const m = getResistanceModel(model);
  const present: number[] = [];
  const future: number[] = [];
  const pan: number[] = [];
  const ahis: number[] = [];
  const access: number[] = [];
  const usage: Record<string, number> = {};
  for (let i = 0; i < runs; i++) {
    const r = runScenario({ data, scenario: s, seed: seed + i, bot: bot(), model: m });
    present.push(r.present.outcome === "won" ? 1 : 0);
    future.push(r.future.outcome === "won" ? 1 : 0);
    pan.push(r.future.panResistantFraction);
    if (r.present.ahi !== null) ahis.push(r.present.ahi);
    access.push(r.present.usageByAware.Access ?? 0);
    for (const [c, v] of Object.entries(r.present.usageByClass)) usage[c] = (usage[c] ?? 0) + v / runs;
  }
  return {
    presentWin: mean(present),
    futureWin: mean(future),
    futurePanResistant: mean(pan),
    presentAhi: ahis.length ? mean(ahis) : null,
    presentUsageByClass: usage,
    presentAccess: mean(access),
  };
}

/** ステージ1に、教えたい場面の個体が平均何体出てくるか（何もしないボットで全部の菌を出し切って数える） */
export function focusPerStage(data: GameData, s: ScenarioDef, focus: Focus, runs: number, seed: number): number {
  let total = 0;
  for (let i = 0; i < runs; i++) {
    const short = drawShortage(data, s.present, s.region, seed + i);
    const state = createGame({ data, stage: withShortage(s.present, short), region: s.region, seed: seed + i });
    const seen = new Set<number>();
    const maxTicks = 1200 * data.rules.time.ticksPerSecond;
    while (state.outcome === "playing" && state.tick < maxTicks) {
      step(state, []);
      for (const b of state.bacteria) {
        if (seen.has(b.uid)) continue;
        seen.add(b.uid);
        if (b.species === focus.species && focus.resistantTo.every((d) => b.resistant.has(d))) total++;
      }
      if (state.spawnIndex >= state.spawnPlan.length && state.bacteria.length === 0) break;
    }
  }
  return total / runs;
}

/**
 * ボットでシミュレーションして、合格の目安と比べる（SPEC.md 5.4）。
 * runs は各ボットの回数（種 seed から）。教員モードでは速さのため 40〜60 回、最後の確かめは多めに
 */
export function evaluateScenario(data: GameData, s: ScenarioDef, opts: { runs?: number; seed?: number; model?: ResistanceModelId; focus?: Focus } = {}): Evaluation {
  const runs = opts.runs ?? 60;
  const seed = opts.seed ?? 1;
  const model = opts.model ?? data.rules.resistance.model;
  const bots = {
    appropriate: summarize(data, s, () => appropriateBot(), runs, seed, model),
    broad: summarize(data, s, () => broadBot(), runs, seed, model),
    random: summarize(data, s, () => randomBot(seed), runs, seed, model),
    idle: summarize(data, s, () => idleBot(), Math.min(runs, 10), seed, model),
  };
  const focus = opts.focus ? focusPerStage(data, s, opts.focus, Math.min(runs, 30), seed) : null;
  const a = bots.appropriate;
  const b = bots.broad;
  const checks: Check[] = [
    { id: "appropriate", label: "適正ボットは、いまも2050年も守り切る", ok: a.presentWin >= TARGETS.appropriateMin && a.futureWin >= TARGETS.appropriateMin, value: `${pct(a.presentWin)}／${pct(a.futureWin)}`, target: `どちらも ${pct(TARGETS.appropriateMin)} 以上` },
    { id: "broadPresent", label: "乱用ボットも、いまは勝てる", ok: b.presentWin >= TARGETS.broadPresentMin, value: pct(b.presentWin), target: `${pct(TARGETS.broadPresentMin)} 以上` },
    { id: "broadFuture", label: "乱用ボットは、2050年に負ける", ok: b.futureWin <= TARGETS.broadFutureMax, value: pct(b.futureWin), target: `${pct(TARGETS.broadFutureMax)} 以下` },
    { id: "random", label: "でたらめに選ぶより、適正に選ぶほうが強い", ok: bots.random.presentWin < a.presentWin, value: `${pct(bots.random.presentWin)} < ${pct(a.presentWin)}`, target: "ランダム < 適正" },
    { id: "idle", label: "何もしなければ負ける", ok: bots.idle.presentWin === 0, value: pct(bots.idle.presentWin), target: "0%" },
    { id: "ahi", label: "適正ボットの系統の使い分け（AHI）", ok: (a.presentAhi ?? 0) >= TARGETS.ahiMin, value: a.presentAhi === null ? "—" : a.presentAhi.toFixed(2), target: `${TARGETS.ahiMin} 以上（仮）` },
  ];
  if (opts.focus && focus !== null) {
    const name = `${data.bacteriumById.get(opts.focus.species)?.name ?? opts.focus.species}（${opts.focus.resistantTo.map((d) => data.drugById.get(d)?.abbr ?? d).join("・")} 耐性）`;
    checks.push({ id: "focus", label: `教えたい場面：${name}が出てくる`, ok: focus >= TARGETS.focusMin, value: `平均 ${focus.toFixed(1)} 体`, target: `${TARGETS.focusMin} 体以上` });
  }
  return { runs, seed, model, bots, focusPerStage: focus, checks, passed: checks.every((c) => c.ok) };
}
