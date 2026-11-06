// 細菌のグラム染色の色：陽性＝紫（クリスタルバイオレット）、陰性＝ピンク〜赤（サフラニン）。遊び方の図と札で使う。
// 盤面の細菌の絵はドット絵（pixel/。2026-11-04）。色だけに頼らず、形（桿菌・細長い桿菌・連鎖した球菌）と莢膜の縁でも見分けられる。
import type { Bacterium, GameState } from "../engine/index.ts";

export const GRAM_COLORS = {
  negative: { fill: 0xe0528a, stroke: 0x9d1f52, light: 0xf3a5c3 },
  positive: { fill: 0x5b2ca0, stroke: 0x2e1260, light: 0x9b7bd0 },
} as const;

/** 札に並べる薬の数の上限（残りは「ほかN」） */
export const TAG_MAX = 4;

export interface EffectiveTag {
  /** all＝手札すべて効く、none＝手札すべて効かない、some＝一部が効く */
  kind: "all" | "none" | "some";
  /** 盤面の札の文 */
  text: string;
  /** 手札のうち、この1匹に効く薬（手札の並び順） */
  drugs: string[];
}

/**
 * 正体（感受性）が分かった細菌の札：手札のうち効く薬を、手札の並び順で出す。
 * 2026-11-06 作者の判断：前は「効かない：ABPC CTRX …」（効かない薬）だったが、次に選ぶ薬が一目で分かるよう「効く：CMZ LVFX …」にした。
 * もともと効かない（自然耐性）・効かない扱いの薬も、効く薬の側には入らないので、札はこの1枚で足りる
 */
export function effectiveTag(hand: readonly string[], resistant: ReadonlySet<string>, abbr: (drug: string) => string): EffectiveTag {
  const drugs = hand.filter((d) => !resistant.has(d));
  if (drugs.length === 0) return { kind: "none", text: "手札すべて効かない", drugs };
  if (drugs.length === hand.length) return { kind: "all", text: "手札すべて効く", drugs };
  const shown = drugs.slice(0, TAG_MAX).map(abbr).join(" ");
  return { kind: "some", text: `効く：${shown}${drugs.length > TAG_MAX ? ` ほか${drugs.length - TAG_MAX}` : ""}`, drugs };
}

/**
 * 手札の補助（「？」パネルでオンにできる）の相手：正体が分かっている細菌のうち、膀胱にいちばん近い1匹。
 * いなければ undefined（補助は何も光らせない）
 */
export function nearestRevealed(state: Pick<GameState, "bacteria">): Bacterium | undefined {
  let best: Bacterium | undefined;
  for (const b of state.bacteria) {
    if (b.level !== "susceptibility" || b.hp <= 0) continue;
    if (!best || b.x < best.x) best = b;
  }
  return best;
}
