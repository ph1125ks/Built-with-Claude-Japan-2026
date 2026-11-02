// 医療費。第一案は薬価を段階化したコスト、代替案は抽象コスト（data/rules.json の cost.mode で切り替える）。
import { drugOf } from "./data.ts";
import type { GameData } from "./types.ts";

/** 代表の1日薬価（円） */
export function yenPerDay(data: GameData, drugId: string): number {
  const p = data.prices.drugs[drugId];
  if (!p) throw new Error(`${drugId} の薬価がない`);
  if (data.rules.cost.representativePrice === "BRAND" && p.yenPerDayBrand !== null) return p.yenPerDayBrand;
  return p.yenPerDayMin;
}

export function yakkaTier(data: GameData, drugId: string): number {
  const yen = yenPerDay(data, drugId);
  for (const t of data.rules.cost.yakkaTiers) if (t.maxYenPerDay === null || yen < t.maxYenPerDay) return t.tier;
  throw new Error("薬価の段階の設定に上限なしの段がない");
}

/** ゲーム内の1日あたりのコスト */
export function costPerDay(data: GameData, drugId: string): number {
  const c = data.rules.cost;
  const v = c.mode === "yakka" ? c.costPerDayByTier[String(yakkaTier(data, drugId))] : c.abstractCostPerDay[drugId];
  if (v === undefined) throw new Error(`${drugId} のコストが設定にない`);
  return v;
}

/** 1回の召喚（1回の投与）のコスト */
export function costPerDose(data: GameData, drugId: string): number {
  return costPerDay(data, drugId) / drugOf(data, drugId).dosesPerDay;
}
