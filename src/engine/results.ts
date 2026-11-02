// 結果画面に出す数値。
import { drugOf } from "./data.ts";
import type { GameState } from "./game.ts";
import { cloneTable } from "./susceptibility.ts";
import type { Outcome, ResistanceTable } from "./types.ts";

export interface StageResult {
  outcome: Outcome;
  seconds: number;
  bladderHp: number;
  bladderMaxHp: number;
  budgetStart: number;
  costSpent: number;
  summons: Record<string, number>;
  /** 薬ごとの、効いていた日数の合計（レーンごとに数える。DOT に近い考え方） */
  activeDays: Record<string, number>;
  /** 系統ごとの使用割合（activeDays をもとに、合計 1） */
  usageByClass: Record<string, number>;
  /** 偏りの指標（仮）。系統別使用割合の均等度（0〜1、1 が均等）。作者の指定する式に差し替える（SPEC.md 4.10） */
  evennessProvisional: number | null;
  kills: Record<string, number>;
  spawned: number;
  leaked: number;
  resistanceStart: ResistanceTable;
  resistanceEnd: ResistanceTable;
}

export function stageResult(state: GameState): StageResult {
  const { data } = state;
  const ticksPerDay = data.rules.time.ticksPerSecond * data.rules.time.secondsPerGameDay;
  const activeDays: Record<string, number> = {};
  const byClass: Record<string, number> = {};
  let total = 0;
  for (const [drug, ticks] of Object.entries(state.stats.activeTicks)) {
    const days = ticks / ticksPerDay;
    activeDays[drug] = days;
    const cls = drugOf(data, drug).class;
    byClass[cls] = (byClass[cls] ?? 0) + days;
    total += days;
  }
  const usageByClass = Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, total > 0 ? v / total : 0]));

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
    usageByClass,
    evennessProvisional: evenness,
    kills: { ...state.stats.kills },
    spawned: state.stats.spawned,
    leaked: state.stats.leaked,
    resistanceStart: cloneTable(state.startResistance),
    resistanceEnd: cloneTable(state.resistance),
  };
}
