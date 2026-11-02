// 供給制限：遊ぶたびに、手札の候補から何枚かが「今回は使えない」になる（2026-11-03 作者の希望。何度も遊びたくなるように）。
// 種（シード）で決まるので、同じ種なら毎回同じ薬が使えない（録画とシミュレーションの再現のため）。
import { createRng } from "./rng.ts";
import { resistanceTableFor, urineWeights } from "./susceptibility.ts";
import type { GameData, StageDef } from "./types.ts";

/** 画面に並べられるカードの枚数（1280px の幅に 150px のカード） */
export const MAX_CARDS = 8;

/**
 * 残す薬の条件の既定値：出てくる菌それぞれに、公開データ（ステージの地域の JANIS）で感性率がこの値以上の薬が1枚は残る。
 * 80% は作者の判断（2026-11-03：臨床では感性率 80% 未満ならエンピリックに使いにくい）
 */
export const DEFAULT_KEEP_SUSCEPTIBLE = 0.8;

/** ステージに出てくる可能性のある菌（"auto" は地域の尿の分離菌、mix はその菌） */
export function stageSpecies(data: GameData, stage: StageDef, region: string): string[] {
  const out = new Set<string>();
  for (const w of stage.waves) {
    if (w.species === "auto") for (const sp of urineWeights(data, region).species) out.add(sp);
    else if (typeof w.species === "object") for (const sp of Object.keys(w.species.mix)) out.add(sp);
    else out.add(w.species);
  }
  return [...out];
}

/** 残った手札で、出てくる菌それぞれに効く見込みの高い薬が1枚はあるか */
function keepsCoverage(data: GameData, region: string, species: string[], hand: string[], keep: number): boolean {
  const table = resistanceTableFor(data, region);
  return species.every((sp) => hand.some((d) => 1 - (table[sp]?.[d] ?? 1) >= keep));
}

/**
 * 供給制限で使えない薬を選ぶ。stage.shortage がなければ空。
 * 候補（既定は手札すべて）から count 枚を選ぶ。残りの手札で、出てくる菌それぞれに感性率が keepSusceptible 以上の薬が
 * 1枚は残る組み合わせだけを使う（見つからなければ枚数を減らす）
 */
export function drawShortage(data: GameData, stage: StageDef, region: string, seed: number): string[] {
  const def = stage.shortage;
  if (!def || def.count <= 0) return [];
  const hand = stage.hand.map((h) => h.drug);
  const candidates = (def.candidates ?? hand).filter((d) => hand.includes(d));
  const keep = def.keepSusceptible ?? DEFAULT_KEEP_SUSCEPTIBLE;
  const species = stageSpecies(data, stage, region);
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  for (let count = Math.min(def.count, candidates.length); count > 0; count--) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const pool = [...candidates];
      const short: string[] = [];
      for (let i = 0; i < count; i++) short.push(pool.splice(rng.int(pool.length), 1)[0]!);
      const left = hand.filter((d) => !short.includes(d));
      if (keepsCoverage(data, region, species, left, keep)) return hand.filter((d) => short.includes(d));
    }
  }
  return [];
}

/** 使えない薬を手札から外したステージ（供給制限はもう当てはめたので、設定は外す） */
export function withShortage(stage: StageDef, short: readonly string[]): StageDef {
  const { shortage: _applied, ...rest } = stage;
  return { ...rest, hand: stage.hand.filter((h) => !short.includes(h.drug)) };
}
