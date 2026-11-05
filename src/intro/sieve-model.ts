// 5. 選択圧の動く絵の中身（DOM を使わない。tests/intro.test.ts で確かめる）。
// 同じ種類の細菌が並び、その中に薬が効かない細菌が少しだけいる → 薬を使うと、効く細菌だけが倒れる →
// 残った細菌が増えて、空いた場所を埋める（子は親と同じく効かない）→ もう一度使っても、倒れない。
// 乱数は種を固定する（動画で毎回同じ動きにするため）。
import { createRng } from "../engine/index.ts";

export interface SieveBug {
  /** 並びの中の場所（0 から count-1） */
  slot: number;
  /** 薬が効かない（耐性）か */
  resistant: boolean;
  /** 増えて生まれた細菌の親の場所（はじめからいる細菌は undefined） */
  from?: number;
  /** 生まれる順（0 が最初。動きの遅れに使う） */
  order?: number;
}

export const SIEVE = {
  /** 並ぶ細菌の数 */
  count: 20,
  /** そのうち薬が効かない細菌の数 */
  resistant: 3,
  /** 乱数の種 */
  seed: 2050,
} as const;

/** はじめの並び。薬が効かない細菌は、互いに離れた場所に置く（見て分かるように） */
export function startPopulation(count: number = SIEVE.count, resistant: number = SIEVE.resistant, seed: number = SIEVE.seed): SieveBug[] {
  if (resistant < 1 || resistant >= count) throw new Error("効かない細菌は 1 体以上、全体より少なく");
  const rng = createRng(seed);
  const gap = Math.max(1, Math.floor(count / (resistant * 2)));
  const picked: number[] = [];
  for (let tries = 0; picked.length < resistant && tries < 1000; tries++) {
    const s = rng.int(count);
    if (picked.every((p) => Math.abs(p - s) >= gap)) picked.push(s);
  }
  // 離して置けなかったときは、端から順に足す（数は必ずそろえる）
  for (let s = 0; picked.length < resistant; s++) if (!picked.includes(s)) picked.push(s);
  return Array.from({ length: count }, (_, slot) => ({ slot, resistant: picked.includes(slot) }));
}

/** 薬を使う：効く細菌は倒れ、効かない細菌だけが残る */
export function useDrug(bugs: readonly SieveBug[]): { survivors: SieveBug[]; fallen: SieveBug[] } {
  return {
    survivors: bugs.filter((b) => b.resistant).map((b) => ({ slot: b.slot, resistant: true })),
    fallen: bugs.filter((b) => !b.resistant),
  };
}

/**
 * 増える：残った細菌が分かれて、空いた場所を埋める。子は親の性質（効かない）をそのまま受け継ぐ。
 * 親は、いちばん近い残った細菌（同じ近さなら乱数で選ぶ）。近い場所から順に生まれる
 */
export function regrow(survivors: readonly SieveBug[], count: number = SIEVE.count, seed: number = SIEVE.seed + 1): SieveBug[] {
  if (survivors.length === 0) return [];
  const rng = createRng(seed);
  const taken = new Set(survivors.map((b) => b.slot));
  const born: (SieveBug & { dist: number; tie: number })[] = [];
  for (let slot = 0; slot < count; slot++) {
    if (taken.has(slot)) continue;
    const dist = Math.min(...survivors.map((b) => Math.abs(b.slot - slot)));
    const near = survivors.filter((b) => Math.abs(b.slot - slot) === dist);
    const parent = near[rng.int(near.length)]!;
    born.push({ slot, resistant: parent.resistant, from: parent.slot, dist, tie: rng.next() });
  }
  born.sort((a, b) => a.dist - b.dist || a.tie - b.tie);
  const kids = born.map(({ dist: _d, tie: _t, ...b }, i) => ({ ...b, order: i }));
  return [...survivors.map((b) => ({ ...b })), ...kids].sort((a, b) => a.slot - b.slot);
}

/** 効く細菌と効かない細菌の数 */
export function tally(bugs: readonly SieveBug[]): { susceptible: number; resistant: number } {
  const resistant = bugs.filter((b) => b.resistant).length;
  return { susceptible: bugs.length - resistant, resistant };
}
