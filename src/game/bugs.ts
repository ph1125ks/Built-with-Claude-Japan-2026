// 細菌の絵（すべてコードで描く）。グラム染色の見た目：陽性＝紫（クリスタルバイオレット）、陰性＝ピンク〜赤（サフラニン）。
// 色だけに頼らず、形（桿菌・細長い桿菌・連鎖した球菌）と大きさ、莢膜の白い縁でも見分けられるようにする。
import type Phaser from "phaser";
import type { BacteriumDef } from "../engine/index.ts";

export const GRAM_COLORS = {
  negative: { fill: 0xe0528a, stroke: 0x9d1f52, light: 0xf3a5c3 },
  positive: { fill: 0x5b2ca0, stroke: 0x2e1260, light: 0x9b7bd0 },
} as const;

/** 細菌の大きさ（ピクセル）。size はカタログの見た目の倍率 */
export function bugExtent(def: BacteriumDef): { w: number; h: number } {
  const s = def.look.size;
  switch (def.look.shape) {
    case "rod":
      return { w: 30 * s, h: 13 * s };
    case "slender-rod":
      return { w: 38 * s, h: 8 * s };
    case "coccus":
      return { w: 52 * s, h: 13 * s };
  }
}

/**
 * 細菌を1匹描く（原点が中心、左向きに進む）。
 * showFlagella：べん毛はグラム染色では見えないので、菌名が分かってから描く（動きの速さは最初から見える）
 */
export function drawBug(g: Phaser.GameObjects.Graphics, def: BacteriumDef, showFlagella: boolean): void {
  g.clear();
  const c = GRAM_COLORS[def.gram];
  const { w, h } = bugExtent(def);

  if (showFlagella && def.look.flagella) drawFlagella(g, def, w, h, c.stroke);

  if (def.look.capsule) {
    // 莢膜：菌の周りの白く抜けた縁
    g.fillStyle(0xffffff, 0.95);
    g.fillRoundedRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12, (h + 12) / 2);
    g.lineStyle(1, 0xd9c2cc, 1);
    g.strokeRoundedRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12, (h + 12) / 2);
  }

  if (def.look.shape === "coccus") {
    // 2個並び〜短い連鎖（4個）。対になった球菌の間を少し空ける
    const r = h / 2;
    const xs = [-w / 2 + r, -w / 2 + 3 * r - 1, w / 2 - 3 * r + 1, w / 2 - r];
    for (const x of xs) {
      g.fillStyle(c.fill, 1);
      g.fillEllipse(x, 0, r * 2.1, r * 1.9);
      g.lineStyle(1.2, c.stroke, 1);
      g.strokeEllipse(x, 0, r * 2.1, r * 1.9);
      g.fillStyle(c.light, 0.55);
      g.fillCircle(x - r * 0.3, -r * 0.3, r * 0.35);
    }
    return;
  }

  g.fillStyle(c.fill, 1);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  g.lineStyle(1.4, c.stroke, 1);
  g.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  // つや
  g.fillStyle(c.light, 0.5);
  g.fillRoundedRect(-w / 2 + h / 3, -h / 2 + 2, w - (2 * h) / 3, Math.max(2, h / 4), Math.max(1, h / 8));
}

function wavy(g: Phaser.GameObjects.Graphics, x0: number, y0: number, angle: number, length: number, amp: number): void {
  const pts: { x: number; y: number }[] = [];
  const n = 14;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * length;
    const off = Math.sin((i / n) * Math.PI * 3) * amp;
    pts.push({ x: x0 + cos * t - sin * off, y: y0 + sin * t + cos * off });
  }
  g.strokePoints(pts, false);
}

function drawFlagella(g: Phaser.GameObjects.Graphics, def: BacteriumDef, w: number, h: number, color: number): void {
  g.lineStyle(1.2, color, 0.75);
  if (def.look.shape === "slender-rod") {
    // 緑膿菌：極に1本（後ろ＝右）
    wavy(g, w / 2 - 1, 0, 0, 22, 3);
    return;
  }
  // プロテウス：周毛性（周りに何本も）
  const spots = [-0.35, 0, 0.35];
  for (const f of spots) {
    wavy(g, f * w, -h / 2, -Math.PI / 2 + 0.5, 12, 2.2);
    wavy(g, f * w, h / 2, Math.PI / 2 - 0.5, 12, 2.2);
  }
  wavy(g, w / 2, 0, 0.2, 12, 2.2);
}
