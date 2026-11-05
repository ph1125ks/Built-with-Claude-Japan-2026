// 「はじめての人へ」のドット絵。兵士・細菌・アイコン・膀胱はゲームの絵（src/game/pixel）をそのまま使い、
// ゲームにないもの（ウイルス・人）だけ、ここでコードで描く。外の画像は使わない。
import type { DrugDef, GameData } from "../engine/index.ts";
import { blank, cardSprite, hexToRgb, outline, type Sprite } from "../game/pixel/engine.js";
import { bladderSprite, floorTile, icon, shotSprite, type IconName, type ShotKind } from "../game/pixel/icons.ts";
import { STYLE, bugFrame, pixelDrug, soldierFrame, toCanvas } from "../game/pixel/index.ts";
import { lookOf } from "../game/soldiers.ts";

const urls = new Map<string, string>();

/** 絵を整数倍に拡大した PNG の data URL（同じ絵は作り直さない） */
export function spriteUrl(key: string, make: () => Sprite, z: number): { url: string; w: number; h: number } {
  const k = `${key}|${z}`;
  const s = make();
  let url = urls.get(k);
  if (!url) {
    url = toCanvas(s, z).toDataURL("image/png");
    urls.set(k, url);
  }
  return { url, w: s.w * z, h: s.h * z };
}

export function img(key: string, make: () => Sprite, z: number, cls = ""): string {
  const { url, w, h } = spriteUrl(key, make, z);
  return `<img class="px${cls ? ` ${cls}` : ""}" src="${url}" width="${w}" height="${h}" alt="" draggable="false">`;
}

/** 2コマの絵を重ねて、交互に見せる（CSS の .anim2） */
function twoFrames(a: string, b: string, cls: string): string {
  return `<span class="anim2 ${cls}">${a.replace('class="px', 'class="px f0')}${b.replace('class="px', 'class="px f1')}</span>`;
}

/** 細菌（2コマで揺れる）。bare は名前が分かる前の絵（べん毛なし） */
export function bugHtml(data: GameData, id: string, z: number, bare = false, cls = "bug"): string {
  const def = data.bacteriumById.get(id)!;
  const a = img(`bug|${id}|0|${bare}`, () => bugFrame(def, 0, bare), z);
  const b = img(`bug|${id}|1|${bare}`, () => bugFrame(def, 1, bare), z);
  return twoFrames(a, b, cls);
}

/** 兵士（待機か攻撃の2コマ） */
export function soldierHtml(data: GameData, drugId: string, z: number, pose: "idle" | "attack" = "idle", cls = "soldier"): string {
  const d = data.drugById.get(drugId)!;
  const f = pose === "idle" ? (["idle0", "idle1"] as const) : (["attack0", "attack1"] as const);
  const a = img(`soldier|${drugId}|${f[0]}`, () => soldierFrame(data, d, f[0]), z);
  const b = img(`soldier|${drugId}|${f[1]}`, () => soldierFrame(data, d, f[1]), z);
  return twoFrames(a, b, cls);
}

/** 兵士の待機と攻撃を重ねる（.attacking を付けると攻撃のコマになる。CSS の .poses） */
export function soldierPoses(data: GameData, drugId: string, z: number, cls = "soldier"): string {
  return `<span class="poses ${cls}">${soldierHtml(data, drugId, z, "idle", "pose-idle")}${soldierHtml(data, drugId, z, "attack", "pose-attack")}</span>`;
}

/** カードの絵（兵士の上半身） */
export function soldierHead(data: GameData, d: DrugDef, z: number): string {
  return img(`head|${d.id}`, () => cardSprite(STYLE, pixelDrug(data, d), "idle0"), z, "head");
}

export function iconHtml(name: IconName, z: number, cls = "ico"): string {
  return img(`icon|${name}`, () => icon(name), z, cls);
}

/** 膀胱（ゲームの盤面と同じ描き方。入口は gates の高さ） */
export function bladderHtml(w: number, h: number, z: number, gates: number[] = [0.55]): string {
  return img(`bladder|${w}|${h}|${gates.join(",")}`, () => bladderSprite(w, h, 1, gates), z, "bladder");
}

/** 兵士の弾（系統の色） */
export function shotHtml(data: GameData, drugId: string, z: number, cls = "shot"): string {
  const d = data.drugById.get(drugId)!;
  const look = lookOf(data, d);
  const kind: ShotKind = look.body === "mech" ? "beam" : look.weapon === "bow" ? "arrow" : look.weapon === "hammer" ? "orb" : "slash";
  const color = data.classById.get(d.class)?.color ?? "#64748b";
  return img(`shot|${drugId}`, () => shotSprite(kind, color), z, cls);
}

/** レーンの床の模様（CSS の背景に使う data URL） */
export function floorUrl(): string {
  return spriteUrl("floor", () => floorTile(80, 40, 7), 3).url;
}

// ---------- ゲームにない絵（ここで描く） ----------

type Pal = Record<string, string | null>;

function fromGrid(rows: string[], pal: Pal): Sprite {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const s = blank(w, h);
  rows.forEach((r, y) =>
    [...r].forEach((ch, x) => {
      const c = pal[ch];
      if (c) s.px[y * w + x] = hexToRgb(c);
    }),
  );
  return s;
}

/** ウイルス（丸い体に突起。細菌のピンク・紫と見分けられる色） */
export function virusSprite(): Sprite {
  const rows = [
    "......a......",
    ".a....a....a.",
    "..a.bbbbb.a..",
    "...bcccccb...",
    "..bcdcccccb..",
    "..bccccdccb..",
    "aabcccccccbaa",
    "..bccdccccb..",
    "..bcccccdcb..",
    "...bcccccb...",
    "..a.bbbbb.a..",
    ".a....a....a.",
    "......a......",
  ];
  return outline(fromGrid(rows, { a: "#8fe3c8", b: "#2f9e86", c: "#5ccfb0", d: "#b8f5e2" }), { color: "#0f3a32" });
}

/** 人（体は、薬を使っても変わらないことを見せる） */
export function personSprite(): Sprite {
  const rows = [
    "....hhhh....",
    "...hhhhhh...",
    "...hssssh...",
    "...sesses...",
    "...ssssss...",
    "....ssss....",
    "..bbbbbbbb..",
    ".bbbbbbbbbb.",
    ".bsbbbbbbsb.",
    ".bsbbbbbbsb.",
    ".ssbbbbbbss.",
    "...bbbbbb...",
    "...ll..ll...",
    "...ll..ll...",
    "...ll..ll...",
    "..kkk..kkk..",
  ];
  return outline(fromGrid(rows, { h: "#3b2a20", s: "#f2c79a", e: "#3b2a20", b: "#5ab8ff", l: "#5d4a85", k: "#2a2140" }), { color: "#0b0712" });
}

export const virusHtml = (z: number, cls = "virus") => img("virus", virusSprite, z, cls);
export const personHtml = (z: number, cls = "person") => img("person", personSprite, z, cls);
