// 種（シード）を固定できる乱数。同じ種なら必ず同じ並びになる（収録とシミュレーションの再現に使う）。

export interface Rng {
  /** 0 以上 1 未満 */
  next(): number;
  /** 0 以上 n 未満の整数 */
  int(n: number): number;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
}

/** mulberry32 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error("空の配列から選べない");
      return items[int(items.length)] as T;
    },
    weighted<T>(items: readonly T[], weights: readonly number[]): T {
      const total = weights.reduce((s, w) => s + w, 0);
      if (items.length === 0 || total <= 0) throw new Error("重みの合計が0");
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i] ?? 0;
        if (r < 0) return items[i] as T;
      }
      return items[items.length - 1] as T;
    },
  };
}
