// data/ の JSON を読み、エンジンが使う形にまとめる。
import bacteriaJson from "../../data/catalog/bacteria.json";
import classesJson from "../../data/catalog/classes.json";
import drugsJson from "../../data/catalog/drugs.json";
import janisJson from "../../data/generated/janis-2025.json";
import pricesJson from "../../data/generated/prices-2026-11.json";
import rulesJson from "../../data/rules.json";
import { linkPlanFor } from "./susceptibility.ts";
import type { BacteriumDef, DrugClassDef, DrugDef, GameData, JanisData, PriceData, Rules } from "./types.ts";

/** 既定のデータを読む。rules を差し替えたいとき（比較実験など）は overrides で上書きする */
export function loadGameData(overrides?: { rules?: Partial<Rules> }): GameData {
  const drugs = (drugsJson as unknown as { drugs: DrugDef[] }).drugs;
  const bacteria = (bacteriaJson as unknown as { bacteria: BacteriumDef[] }).bacteria;
  const classes = (classesJson as unknown as { classes: DrugClassDef[] }).classes;
  const rules = { ...(rulesJson as unknown as Rules), ...overrides?.rules };
  const data: GameData = {
    rules,
    drugs,
    bacteria,
    classes,
    drugById: new Map(drugs.map((d) => [d.id, d])),
    bacteriumById: new Map(bacteria.map((b) => [b.id, b])),
    classById: new Map(classes.map((c) => [c.id, c])),
    janis: janisJson as unknown as JanisData,
    prices: pricesJson as unknown as PriceData,
  };
  checkCatalog(data);
  return data;
}

/** カタログの食い違い（存在しない id の参照など）を見つけたら止める */
function checkCatalog(data: GameData): void {
  const errors: string[] = [];
  for (const d of data.drugs) {
    if (!data.classById.has(d.class)) errors.push(`${d.id}：系統 ${d.class} がない`);
    if (!data.prices.drugs[d.id]) errors.push(`${d.id}：薬価がない（npm run data:build を実行する）`);
    if (d.bioavailability !== null && (d.bioavailability <= 0 || d.bioavailability > 1)) errors.push(`${d.id}：吸収率が範囲外`);
  }
  for (const b of data.bacteria) {
    for (const id of b.intrinsicResistance) if (!data.drugById.has(id)) errors.push(`${b.id}：自然耐性の薬 ${id} がない`);
  }
  for (const d of data.drugs) {
    if (!data.rules.stewardship.groupOrder.includes(d.aware)) errors.push(`${d.id}：AWaRe 分類 ${d.aware} が rules.stewardship.groupOrder にない`);
  }
  for (const l of data.rules.linkedResistance) {
    for (const id of [l.trigger, ...l.alsoResistant]) if (!data.drugById.has(id)) errors.push(`連動：薬 ${id} がない`);
    for (const b of l.bacteria) if (!data.bacteriumById.has(b)) errors.push(`連動：菌 ${b} がない`);
  }
  if (errors.length === 0) {
    // 連動は菌ごとに木になっていること（1つの薬に親は1つ、輪がない）
    for (const b of data.bacteria) {
      try {
        linkPlanFor(data, b.id);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
  }
  const res = data.rules.resistance;
  if (!["none", "A", "B"].includes(res.model)) errors.push(`耐性モデル ${res.model} はない（none・A・B）`);
  if (!(res.exaggeration > 0)) errors.push("resistance.exaggeration は正の数");
  const spy = res.carryOver?.stagesPerYear;
  if (!spy || !(spy.A >= 0) || !(spy.B >= 0)) errors.push("resistance.carryOver.stagesPerYear は A と B の0以上の数");
  if (!Number.isInteger(res.carryOver?.dataYear)) errors.push("resistance.carryOver.dataYear は年（整数）");
  const ceil = res.carryOver?.ceiling;
  if (!ceil || !(ceil.rate > 0 && ceil.rate < 1) || !(ceil.minYears >= 0)) errors.push("resistance.carryOver.ceiling は rate（0〜1）と minYears（0以上）");
  for (const p of data.rules.susceptibility.proxies) {
    if (!data.drugById.has(p.drug)) errors.push(`代用：薬 ${p.drug} がない`);
    for (const b of p.bacteria) if (!data.bacteriumById.has(b)) errors.push(`代用：菌 ${b} がない`);
  }
  if (errors.length) throw new Error(`カタログの誤り：\n${errors.join("\n")}`);
}

export function drugOf(data: GameData, id: string): DrugDef {
  const d = data.drugById.get(id);
  if (!d) throw new Error(`薬 ${id} がない`);
  return d;
}

export function bacteriumOf(data: GameData, id: string): BacteriumDef {
  const b = data.bacteriumById.get(id);
  if (!b) throw new Error(`菌 ${id} がない`);
  return b;
}
