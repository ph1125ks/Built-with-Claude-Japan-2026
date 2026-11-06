// ゲームのドット絵（src/game/pixel）を、Node で PNG の data URL にする小さな部品（動画の図で使う。2026-11-06）。
// ブラウザの canvas を使わず、PNG を自分で組み立てる（zlib は Node にある）。絵は整数倍に拡大してから PNG にする
// （ブラウザの拡大でぼけないように。ゲームの <img class="px"> と同じ考え方）。外の画像は使わない。
import { deflateSync } from "node:zlib";
import { loadGameData, type DrugDef, type GameData } from "../../src/engine/index.ts";
import { cardSprite, type RGB, type Sprite } from "../../src/game/pixel/engine.js";
import { bladderSprite, floorTile, icon, membraneStrip, shotSprite, type IconName, type ShotKind } from "../../src/game/pixel/icons.ts";
import { bugFrame, pixelDrug, soldierFrame, STYLE, type Frame } from "../../src/game/pixel/index.ts";
import { lookOf } from "../../src/game/soldiers.ts";

export const data: GameData = loadGameData();

// ---------- PNG ----------

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** 絵を z 倍に拡大した PNG（RGBA。透明はそのまま） */
export function spritePng(s: Sprite, z = 1): Buffer {
  const w = s.w * z;
  const h = s.h * z;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0; // フィルタなし
    const sy = Math.floor(y / z);
    for (let x = 0; x < w; x++) {
      const p = s.px[sy * s.w + Math.floor(x / z)];
      if (!p) continue;
      const o = row + 1 + x * 4;
      raw[o] = p[0];
      raw[o + 1] = p[1];
      raw[o + 2] = p[2];
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8 ビット
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const urlCache = new Map<string, string>();
/** 絵の data URL（同じ鍵なら作り直さない） */
export function spriteUrl(key: string, make: () => Sprite, z = 1): { url: string; w: number; h: number } {
  const k = `${key}|${z}`;
  const s = make();
  let url = urlCache.get(k);
  if (!url) {
    url = `data:image/png;base64,${spritePng(s, z).toString("base64")}`;
    urlCache.set(k, url);
  }
  return { url, w: s.w * z, h: s.h * z };
}

/** 透明でないドットをすべて1色にする（当たったときの白い光など） */
export function tint(s: Sprite, rgb: RGB): Sprite {
  return { w: s.w, h: s.h, px: s.px.map((p) => (p ? rgb : null)) };
}

// ---------- ゲームの絵 ----------

export function bugUrl(speciesId: string, frame = 0, z = 1, bare = false) {
  const def = data.bacteriumById.get(speciesId);
  if (!def) throw new Error(`細菌 ${speciesId} がカタログにない`);
  return spriteUrl(`bug|${speciesId}|${frame}|${bare}`, () => bugFrame(def, frame, bare), z);
}
/** 細菌の白い影（薬が当たった瞬間） */
export function bugFlashUrl(speciesId: string, frame = 0, z = 1) {
  const def = data.bacteriumById.get(speciesId)!;
  return spriteUrl(`bugflash|${speciesId}|${frame}`, () => tint(bugFrame(def, frame, false), [255, 255, 255]), z);
}
const drugOf = (id: string): DrugDef => {
  const d = data.drugById.get(id);
  if (!d) throw new Error(`薬 ${id} がカタログにない`);
  return d;
};
export function soldierUrl(drugId: string, frame: Frame = "idle0", z = 1) {
  return spriteUrl(`soldier|${drugId}|${frame}`, () => soldierFrame(data, drugOf(drugId), frame), z);
}
/** カードの絵（兵士の上半身） */
export function soldierHeadUrl(drugId: string, z = 1) {
  return spriteUrl(`head|${drugId}`, () => cardSprite(STYLE, pixelDrug(data, drugOf(drugId)), "idle0"), z);
}
export function iconUrl(name: IconName, z = 1) {
  return spriteUrl(`icon|${name}`, () => icon(name), z);
}
/** 兵士の弾（系統の色。剣＝斬撃、弓＝矢、槌＝玉、機械兵＝光線） */
export function shotUrl(drugId: string, z = 1) {
  const d = drugOf(drugId);
  const look = lookOf(data, d);
  const kind: ShotKind = look.body === "mech" ? "beam" : look.weapon === "bow" ? "arrow" : look.weapon === "hammer" ? "orb" : "slash";
  const color = data.classById.get(d.class)?.color ?? "#64748b";
  return spriteUrl(`shot|${drugId}`, () => shotSprite(kind, color), z);
}
/** 系統の色（#rrggbb） */
export function classColor(drugId: string): string {
  return data.classById.get(drugOf(drugId).class)?.color ?? "#64748b";
}
export function floorUrl(z = 3) {
  return spriteUrl("floor", () => floorTile(80, 40, 7), z);
}
export function membraneUrl(z = 3) {
  return spriteUrl("membrane", () => membraneStrip(48, 8), z);
}
/** 膀胱（frac は耐久の割合。右の壁に入口を1つ） */
export function bladderUrl(frac = 1, z = 3, w = 30, h = 52) {
  return spriteUrl(`bladder|${w}|${h}|${frac}`, () => bladderSprite(w, h, frac, [0.5]), z);
}

/** <img> の HTML（ドットをぼかさない） */
export function imgTag(u: { url: string; w: number; h: number }, cls = "px", style = ""): string {
  return `<img class="${cls}" src="${u.url}" width="${u.w}" height="${u.h}" alt="" style="image-rendering:pixelated;${style}">`;
}
