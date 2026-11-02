// 公開データ（株数）から「効く確率」を決める。変換ルールは data/rules.json の susceptibility。
import { bacteriumOf, drugOf } from "./data.ts";
import type { Counts, GameData, ResistanceTable } from "./types.ts";

export type SusceptibilityBasis = "intrinsic" | "data" | "proxy" | "fixed" | "missing";

export interface SusceptibilityValue {
  /** 効く確率（0〜1） */
  p: number;
  basis: SusceptibilityBasis;
  /** 値のもとになった株数（data・proxy のとき） */
  n?: number;
  /** 代用・固定のときの説明 */
  note?: string;
}

function fromCounts(data: GameData, c: Counts): number {
  const total = c.total ?? 0;
  if (total <= 0) return 0;
  const s = c.S ?? 0;
  switch (data.rules.susceptibility.conversion) {
    case "S_ONLY":
      return s / total;
    case "S_PLUS_HALF_SORI":
      return (s + (c.SorI ?? 0) / 2) / total;
  }
}

export function hasRegion(data: GameData, region: string): boolean {
  return data.janis.regions.includes(region);
}

/** 地域・菌・薬について、効く確率とその根拠を返す */
export function susceptibility(data: GameData, region: string, speciesId: string, drugId: string): SusceptibilityValue {
  const species = bacteriumOf(data, speciesId);
  const drug = drugOf(data, drugId);
  if (species.intrinsicResistance.includes(drugId)) return { p: 0, basis: "intrinsic" };

  const table = data.janis.susceptibility[region]?.[speciesId] ?? {};
  const proxy = data.rules.susceptibility.proxies.find((p) => p.drug === drugId && p.bacteria.includes(speciesId));
  if (proxy?.fixedSusceptible !== undefined) return { p: proxy.fixedSusceptible, basis: "fixed", note: proxy.note };
  if (proxy?.useJanis) {
    const c = table[proxy.useJanis];
    if (c?.total) return { p: fromCounts(data, c), basis: "proxy", n: c.total, note: proxy.note };
  }
  if (drug.janis) {
    const c = table[drug.janis];
    if (c?.total) return { p: fromCounts(data, c), basis: "data", n: c.total };
  }
  return { p: 0, basis: "missing" };
}

/** 地域の「効かない確率」の表を作る（ゲーム開始時の耐性率） */
export function resistanceTableFor(data: GameData, region: string): ResistanceTable {
  if (!hasRegion(data, region)) throw new Error(`地域 ${region} のデータがない`);
  const table: ResistanceTable = {};
  for (const b of data.bacteria) {
    const row: Record<string, number> = {};
    for (const d of data.drugs) row[d.id] = 1 - susceptibility(data, region, b.id, d.id).p;
    table[b.id] = row;
  }
  return applyLinkageFloor(data, table);
}

/** 菌ごとの連動の木。薬 → その薬に耐性の個体を必ず耐性にさせる薬（親）と、親が先に来る薬の順 */
export interface LinkPlan {
  parent: Map<string, string>;
  order: string[];
}

const linkPlanCache = new WeakMap<GameData, Map<string, LinkPlan>>();

/**
 * rules.linkedResistance を菌ごとの木にする。例（腸内細菌目）：MEPM → CTRX → ABPC。
 * 1つの薬の親は1つだけ（2つあると全体の耐性率を保てないので、読み込み時に止める）。
 */
export function linkPlanFor(data: GameData, speciesId: string): LinkPlan {
  let cache = linkPlanCache.get(data);
  if (!cache) {
    cache = new Map();
    linkPlanCache.set(data, cache);
  }
  const hit = cache.get(speciesId);
  if (hit) return hit;
  const parent = new Map<string, string>();
  for (const link of data.rules.linkedResistance) {
    if (!link.bacteria.includes(speciesId)) continue;
    for (const d of link.alsoResistant) {
      const prev = parent.get(d);
      if (prev && prev !== link.trigger) throw new Error(`連動：${speciesId} の ${d} に親が2つある（${prev} と ${link.trigger}）`);
      parent.set(d, link.trigger);
    }
  }
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (d: string) => {
    const st = state.get(d);
    if (st === "done") return;
    if (st === "visiting") throw new Error(`連動：${speciesId} で ${d} が輪になっている`);
    state.set(d, "visiting");
    const p = parent.get(d);
    if (p) visit(p);
    state.set(d, "done");
    order.push(d);
  };
  for (const d of data.drugs) visit(d.id);
  const plan = { parent, order };
  cache.set(speciesId, plan);
  return plan;
}

/**
 * 耐性の連動（rules.linkedResistance）と表を矛盾させない。
 * 親に耐性の個体は子にも耐性なので、子の耐性率は親の耐性率を下回れない（木の上から順にかける）。
 * 例：経口第3世代セフェムの耐性率は CTRX 以上。CTRX・CMZ・TAZ/PIPC の耐性率は MEPM 以上。表を書き換えて返す。
 */
export function applyLinkageFloor(data: GameData, table: ResistanceTable): ResistanceTable {
  for (const [sp, row] of Object.entries(table)) {
    if (!data.bacteriumById.has(sp)) continue;
    const { parent, order } = linkPlanFor(data, sp);
    for (const d of order) {
      const p = parent.get(d);
      if (p !== undefined) row[d] = Math.max(row[d] ?? 0, row[p] ?? 0);
    }
  }
  return table;
}

/** 尿から分離される割合（この5菌の中で割り直す）。敵の出現比率に使う */
export function urineWeights(data: GameData, region: string): { species: string[]; weights: number[] } {
  const iso = data.janis.urineIsolation[region] ?? {};
  const species = data.bacteria.map((b) => b.id).filter((id) => (iso[id] ?? 0) > 0);
  if (species.length === 0) throw new Error(`地域 ${region} の尿の分離菌データがない`);
  return { species, weights: species.map((id) => iso[id] ?? 0) };
}

export function cloneTable(t: ResistanceTable): ResistanceTable {
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { ...v }]));
}
