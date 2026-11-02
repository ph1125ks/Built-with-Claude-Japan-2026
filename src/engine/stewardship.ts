// 抗菌薬の「狭い順」。WHO の AWaRe 分類の群（Access → Watch → Reserve）で決め、
// 同じ群の中ではカルバペネム系を最後に回す（data/rules.json の stewardship。出典もそこに書いてある）。
import { drugOf } from "./data.ts";
import type { AwareGroup, GameData } from "./types.ts";

/** 小さいほど優先して使う（狭い）。同じ値の薬どうしの順は決めない */
export function stewardshipRank(data: GameData, drugId: string): number {
  const d = drugOf(data, drugId);
  const s = data.rules.stewardship;
  const group = s.groupOrder.indexOf(d.aware);
  if (group < 0) throw new Error(`${drugId} の AWaRe 分類 ${d.aware} が rules.stewardship.groupOrder にない`);
  return group + (s.spareLastWithinGroup.includes(d.class) ? 0.5 : 0);
}

export function awareOf(data: GameData, drugId: string): AwareGroup {
  return drugOf(data, drugId).aware;
}
