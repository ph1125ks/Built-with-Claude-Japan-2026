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
  costSpent: number;
  summons: Record<string, number>;
  /** 薬ごとの使用日数（1回の召喚で投与間隔の長さ。レーンごとに足す。DOT にならった数え方で、吸収率や効いたかどうかは問わない） */
  activeDays: Record<string, number>;
  /** DOT・DASC・DASC/DOT（ASP ガイダンス2024 表4） */
  spectrum: SpectrumUse;
  /** 系統ごとの使用割合（activeDays をもとに、合計 1） */
  usageByClass: Record<string, number>;
  /** 偏りの指標（仮）。系統別使用割合の均等度（0〜1、1 が均等）。作者の指定する式に差し替える（SPEC.md 4.10） */
  evennessProvisional: number | null;
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

  // 手札にある系統の数で正規化した均等度（Pielou の J）。仮の式
  const handClasses = new Set(state.stage.hand.map((h) => drugOf(data, h.drug).class));
  let evenness: number | null = null;
  if (total > 0 && handClasses.size > 1) {
    const h = -Object.values(usageByClass).reduce((s, p) => (p > 0 ? s + p * Math.log(p) : s), 0);
    evenness = h / Math.log(handClasses.size);
  }

  return {
    outcome: state.outcome,
    seconds: state.tick / data.rules.time.ticksPerSecond,
    bladderHp: state.bladderHp,
    bladderMaxHp: state.stage.bladderHp,
    budgetStart: state.stage.budget,
    costSpent: state.stats.costSpent,
    summons: { ...state.stats.summons },
    activeDays,
    spectrum: spectrumUse(data, activeDays),
    usageByClass,
    evennessProvisional: evenness,
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
