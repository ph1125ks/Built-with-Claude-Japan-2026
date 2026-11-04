// 細菌のグラム染色の色：陽性＝紫（クリスタルバイオレット）、陰性＝ピンク〜赤（サフラニン）。遊び方の図と札で使う。
// 盤面の細菌の絵はドット絵（pixel/。2026-11-04）。色だけに頼らず、形（桿菌・細長い桿菌・連鎖した球菌）と莢膜の縁でも見分けられる。
export const GRAM_COLORS = {
  negative: { fill: 0xe0528a, stroke: 0x9d1f52, light: 0xf3a5c3 },
  positive: { fill: 0x5b2ca0, stroke: 0x2e1260, light: 0x9b7bd0 },
} as const;
