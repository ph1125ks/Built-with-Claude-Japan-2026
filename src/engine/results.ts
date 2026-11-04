// 結果画面に出す数値。
import { drugOf } from "./data.ts";
import type { GameState } from "./game.ts";
import { cloneTable } from "./susceptibility.ts";
import type { AwareGroup, GameData, Outcome, ResistanceModelId, ResistanceTable } from "./types.ts";

/** 抗菌薬の使用日数とスペクトラムの指標（ASP ガイダンス2024 表4、p.119） */
export interface SpectrumUse {
  /** DOT：使用日数の合計（レーンごとに数える） */
  dot: number;
  /** DASC：ASC スコア × 使用日数 の合計。ASC のない薬を使ったときは null */
  dasc: number | null;
  /** DASC/DOT：使った薬の平均の ASC（抗菌スペクトラムの広さの平均）。ASC のない薬を使ったときは null */
  dascPerDot: number | null;
  /** 使ったが ASC スコアがない薬 */
  ascMissing: string[];
}

/** 薬ごとの使用日数から、DOT・DASC・DASC/DOT を出す */
export function spectrumUse(data: GameData, daysByDrug: Record<string, number>): SpectrumUse {
  let dot = 0;
  let dasc = 0;
  const ascMissing: string[] = [];
  for (const [drug, days] of Object.entries(daysByDrug)) {
    if (days <= 0) continue;
    dot += days;
    const asc = drugOf(data, drug).asc;
    if (asc === null) ascMissing.push(drug);
    else dasc += asc * days;
  }
  const ok = ascMissing.length === 0;
  return { dot, dasc: ok ? dasc : null, dascPerDot: ok && dot > 0 ? dasc / dot : null, ascMissing };
}

export interface StageResult {
  outcome: Outcome;
  seconds: number;
  bladderHp: number;
  bladderMaxHp: number;
  budgetStart: number;
  /** 時間とともに増えた医療費の合計 */
  budgetIncome: number;
  /** 医療費が手札でいちばん安い1回分に届かなかった秒数 */
  budgetShortSeconds: number;
  costSpent: number;
  summons: Record<string, number>;
  /** 薬ごとの使用日数（1回の召喚で投与間隔の長さ。レーンごとに足す。DOT にならった数え方で、吸収率や効いたかどうかは問わない） */
  activeDays: Record<string, number>;
  /** DOT・DASC・DASC/DOT（ASP ガイダンス2024 表4） */
  spectrum: SpectrumUse;
  /** 系統ごとの使用割合（activeDays をもとに、合計 1） */
  usageByClass: Record<string, number>;
  /** 偏りの指標：AHI（0〜1。手札の系統を同じ日数ずつ使うと 1、1つの系統だけだと 0）。式は作者の指定（SPEC.md 4.10）。手札の系統が1つか、使っていないときは null */
  ahi: number | null;
  /** WHO の AWaRe 分類ごとの使用割合（activeDays をもとに、合計 1）。WHO の目標は Access 60% 以上 */
  usageByAware: Record<AwareGroup, number>;
  kills: Record<string, number>;
  spawned: number;
  leaked: number;
  /** 出てきた個体のうち、手札のどの薬にも耐性だったものの割合 */
  panResistantFraction: number;
  /** 耐性モデル（none・A・B） */
  model: ResistanceModelId;
  /** 耐性ゲージ（モデル B）：系統 → たまった量 */
  gauge: Record<string, number>;
  resistanceStart: ResistanceTable;
  resistanceEnd: ResistanceTable;
}

/**
 * AHI（antibiotic heterogeneity index）。2026-11-04 作者が指定した式：
 *   AHI ＝ 1 −｛n /［2 ×（n − 1）］｝× Σ｜ai − bi｜
 *   n：比較する抗菌薬系統数（このゲームでは手札にある系統の数）、ai：均等に使った場合の比率（1/n）、bi：実際の使用比率（%DOT。使用日数の割合）
 * classes は比べる系統、usage は系統 → 使用比率（合計 1）。系統が2つ未満か、使用がないときは null
 */
export function ahi(classes: readonly string[], usage: Record<string, number>): number | null {
  const n = classes.length;
  const total = classes.reduce((s, c) => s + (usage[c] ?? 0), 0);
  if (n < 2 || total <= 0) return null;
  const sum = classes.reduce((s, c) => s + Math.abs(1 / n - (usage[c] ?? 0) / total), 0);
  // 式の上では 0〜1。計算の誤差で 0 をわずかに下回らないように収める
  return Math.min(1, Math.max(0, 1 - (n / (2 * (n - 1))) * sum));
}

export function stageResult(state: GameState): StageResult {
  const { data } = state;
  const ticksPerDay = data.rules.time.ticksPerSecond * data.rules.time.secondsPerGameDay;
  const activeDays: Record<string, number> = {};
  const byClass: Record<string, number> = {};
  const byAware: Record<AwareGroup, number> = { Access: 0, Watch: 0, Reserve: 0 };
  let total = 0;
  for (const [drug, ticks] of Object.entries(state.stats.activeTicks)) {
    const days = ticks / ticksPerDay;
    activeDays[drug] = days;
    const def = drugOf(data, drug);
    byClass[def.class] = (byClass[def.class] ?? 0) + days;
    byAware[def.aware] += days;
    total += days;
  }
  const usageByClass = Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, total > 0 ? v / total : 0]));
  const usageByAware = Object.fromEntries(
    Object.entries(byAware).map(([k, v]) => [k, total > 0 ? v / total : 0]),
  ) as Record<AwareGroup, number>;

  // 偏りの指標（AHI）。比べる系統は、手札にある系統（供給制限で使えない薬は手札から外れている）
  const handClasses = [...new Set(state.stage.hand.map((h) => drugOf(data, h.drug).class))];

  return {
    outcome: state.outcome,
    seconds: state.tick / data.rules.time.ticksPerSecond,
    bladderHp: state.bladderHp,
    bladderMaxHp: state.stage.bladderHp,
    budgetStart: state.stage.budget,
    budgetIncome: state.stats.budgetIncome,
    budgetShortSeconds: state.stats.budgetShortTicks / data.rules.time.ticksPerSecond,
    costSpent: state.stats.costSpent,
    summons: { ...state.stats.summons },
    activeDays,
    spectrum: spectrumUse(data, activeDays),
    usageByClass,
    ahi: ahi(handClasses, usageByClass),
    usageByAware,
    kills: { ...state.stats.kills },
    spawned: state.stats.spawned,
    leaked: state.stats.leaked,
    panResistantFraction: state.stats.spawned > 0 ? state.stats.panResistant / state.stats.spawned : 0,
    model: state.model.id,
    gauge: { ...state.gauge },
    resistanceStart: cloneTable(state.startResistance),
    resistanceEnd: cloneTable(state.resistance),
  };
}
