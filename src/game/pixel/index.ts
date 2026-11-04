// ドット絵の兵士と細菌（2026-11-04 作者の依頼：今の絵が野暮ったいので、最近のインディーゲームに多いドット絵に）。
// 5つの作風を実際のゲーム画面で見比べて、作者が作風 C（32ドット・ハイビット）を選んだ。ほかの作風は外した。
// 吸収率は「絵の面積」をやめ、兵士の濃さ（点描）で体内の薬の量を見せる（作者の判断。盤面は board.ts）。
import type { BacteriumDef, DrugDef, GameData } from "../../engine/index.ts";
import { lookOf } from "../soldiers.ts";
import { bugSprite, cardSprite, ditherKeep, soldierSprite, type PixelDrug, type PixelStyle, type Sprite } from "./engine.js";
import c32 from "./styles/c32.js";

export type { PixelStyle, Sprite } from "./engine.js";

/** ゲームで使う作風 */
export const STYLE: PixelStyle = c32;

/** 兵士のコマ：待機2コマと攻撃2コマ */
export const FRAMES = ["idle0", "idle1", "attack0", "attack1"] as const;
export type Frame = (typeof FRAMES)[number];

/** 兵士の濃さの段（体内の薬の量）。8 で満タン、1 でいちばん薄い（輪郭と少しの点） */
export const LEVELS = 8;
export function levelOf(f: number): number {
  return f <= 0 ? 0 : Math.max(1, Math.min(LEVELS, Math.ceil(f * LEVELS - 1e-9)));
}

/**
 * 体内の薬の量がこの割合を切ってから、点が抜けて薄くなる（それより多いときはくっきり。2026-11-04 作者の判断）。
 * いつも点描だと、遊んでいる間ほとんどの兵士がざらついて見えるため。吸収率25%の内服は最初から薄く出る
 */
export const SOLID_AT = 0.6;

/** 体内の薬の量（満タン＝1）から、兵士の濃さの段（1〜8）。薬が残っている限り 1 以上 */
export function levelForAmount(f: number): number {
  return Math.max(1, levelOf(Math.min(1, f / SOLID_AT)));
}

/** カタログの薬を、ドット絵のエンジンに渡す形にする（緑膿菌の紋章は soldiers.ts の決まり） */
export function pixelDrug(data: GameData, d: DrugDef): PixelDrug {
  return {
    id: d.id,
    abbr: d.abbr,
    cls: d.class,
    color: data.classById.get(d.class)?.color ?? "#64748b",
    route: d.route,
    ba: d.bioavailability ?? null,
    pa: lookOf(data, d).pseudomonas,
  };
}

/** 兵士の1コマ。level が LEVELS 未満なら、その割合だけ点を残す（輪郭は残す） */
export function soldierFrame(data: GameData, d: DrugDef, frame: Frame = "idle0", level = LEVELS, style: PixelStyle = STYLE): Sprite {
  const s = soldierSprite(style, pixelDrug(data, d), frame);
  return level >= LEVELS ? s : ditherKeep(s, level / LEVELS, true);
}

/** 細菌の1コマ。bare は菌名が分かる前（べん毛なし） */
export function bugFrame(def: BacteriumDef, frame: number, bare: boolean, style: PixelStyle = STYLE): Sprite {
  return bugSprite(style, { id: def.id, gram: def.gram, shape: def.look.shape }, frame, bare);
}

/** 盤面の兵士の大きさ（px） */
export function soldierPx(style: PixelStyle = STYLE): number {
  return style.size * style.laneScale;
}

/** 盤面の細菌の拡大の倍率 */
export function bugScale(style: PixelStyle = STYLE): number {
  return style.bugScale ?? style.laneScale;
}

/** 絵を canvas に描く（整数倍に拡大。ぼかさない） */
export function toCanvas(s: Sprite, z = 1): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = s.w * z;
  c.height = s.h * z;
  const ctx = c.getContext("2d")!;
  s.px.forEach((p, i) => {
    if (!p) return;
    ctx.fillStyle = `rgb(${p[0]},${p[1]},${p[2]})`;
    ctx.fillRect((i % s.w) * z, Math.floor(i / s.w) * z, z, z);
  });
  return c;
}

const imgCache = new Map<string, string>();

function img(key: string, make: () => Sprite, z: number): string {
  let url = imgCache.get(key);
  const s = make();
  if (!url) {
    url = toCanvas(s, z).toDataURL("image/png");
    imgCache.set(key, url);
  }
  return `<img class="px" src="${url}" width="${s.w * z}" height="${s.h * z}" alt="" draggable="false">`;
}

/**
 * DOM に出す兵士の絵（img 要素の HTML）。kind：card＝手札のカード（上半身）、chip＝ブリーフィングの札、lane＝遊び方の見本（盤面と同じ大きさ）。
 * level を渡すと、その濃さ（点描）で描く（遊び方の濃さの見本）。絵は前もって整数倍に拡大した PNG にする（ブラウザの拡大でぼけないように）
 */
export function soldierImg(data: GameData, d: DrugDef, kind: "card" | "chip" | "lane", level = LEVELS): string {
  const z = kind === "lane" ? STYLE.laneScale : kind === "card" ? STYLE.cardScale : 1;
  const make = () => (kind === "lane" ? soldierFrame(data, d, "idle0", level) : cardSprite(STYLE, pixelDrug(data, d), "idle0"));
  return img(`${STYLE.id}|${d.id}|${kind}|${level}`, make, z);
}

/** DOM に出す細菌の絵（タイトル画面など）。盤面と同じ大きさ */
export function bugImg(def: BacteriumDef, frame = 0, bare = false): string {
  return img(`${STYLE.id}|bug|${def.id}|${frame}|${bare}`, () => bugFrame(def, frame, bare), bugScale());
}
