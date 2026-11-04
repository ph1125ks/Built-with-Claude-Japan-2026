// 画面の飾りのドット絵（アイコン・弾・盤面の部品）。兵士と細菌の絵（作風 C）と同じく、すべてコードで描く。
// アイコンは 12×12 で描いて、外側に1ドットの輪郭を付ける（14×14）。DOM には整数倍の PNG（<img class="px">）で出す。
import { blank, hexToRgb, outline, type RGB, type Sprite } from "./engine.js";

/** 小さなドット絵を描く道具 */
class Painter {
  readonly s: Sprite;
  constructor(w: number, h: number) {
    this.s = blank(w, h);
  }
  set(x: number, y: number, c: string | RGB | null): this {
    const X = Math.round(x);
    const Y = Math.round(y);
    if (X < 0 || Y < 0 || X >= this.s.w || Y >= this.s.h) return this;
    this.s.px[Y * this.s.w + X] = c === null ? null : typeof c === "string" ? hexToRgb(c) : c;
    return this;
  }
  get(x: number, y: number): RGB | null {
    if (x < 0 || y < 0 || x >= this.s.w || y >= this.s.h) return null;
    return this.s.px[y * this.s.w + x] ?? null;
  }
  rect(x: number, y: number, w: number, h: number, c: string | null): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
    return this;
  }
  /** 楕円を塗る（中心 cx, cy・半径 rx, ry） */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: string | ((x: number, y: number, nx: number, ny: number) => string | null)): this {
    for (let y = 0; y < this.s.h; y++)
      for (let x = 0; x < this.s.w; x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(x, y, typeof c === "string" ? c : c(x, y, nx, ny));
      }
    return this;
  }
  line(x0: number, y0: number, x1: number, y1: number, c: string): this {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return this;
  }
  /** 行の文字列で描く（'.' は塗らない） */
  rows(x: number, y: number, rows: string[], pal: Record<string, string>): this {
    rows.forEach((r, j) => [...r].forEach((ch, i) => ch !== "." && ch !== " " && this.set(x + i, y + j, pal[ch] ?? null)));
    return this;
  }
}

const INK = "#170d22";
const finish = (p: Painter, color = INK) => outline(p.s, { color });

/** 医療費の硬貨（十字の刻印） */
function coin(): Sprite {
  const p = new Painter(12, 12);
  p.ellipse(6, 6, 6, 6, (_x, _y, nx, ny) => (nx + ny < -0.75 ? "#fff3b8" : nx + ny > 0.65 ? "#d4861a" : "#ffcf3f"));
  p.rect(5, 3, 2, 6, "#b9690f").rect(3, 5, 6, 2, "#b9690f");
  p.set(5, 3, "#fff3b8").set(3, 5, "#fff3b8");
  return finish(p, "#4a2504");
}

/** 膀胱（耐久） */
function bladder(): Sprite {
  const p = new Painter(12, 12);
  p.ellipse(6, 5.4, 5.6, 5.2, (_x, _y, nx, ny) => (nx * nx + ny * ny > 0.5 ? (nx + ny < -0.4 ? "#ff9cc2" : "#d9487f") : ny < -0.1 ? "#ffe9a0" : "#f2b632"));
  p.rect(5, 10, 2, 2, "#d9487f");
  p.set(3, 3, "#ffffff");
  return finish(p, "#3a0c22");
}

/** 砂時計（待ち時間） */
function hourglass(): Sprite {
  const p = new Painter(12, 12);
  p.rows(1, 0, ["kkkkkkkkkk", ".gwwwwwwg.", ".gssssssg.", "..gssssg..", "...gssg...", "....gg....", "....gg....", "...g..g...", "..g.ss.g..", ".g.ssss.g.", ".gssssssg.", "kkkkkkkkkk"], {
    k: "#a0663a",
    g: "#cfe9ff",
    w: "#ffffff",
    s: "#ffd36b",
  });
  return finish(p);
}

/** 顕微鏡（遠い：グラム染色） */
function microscope(): Sprite {
  const p = new Painter(12, 12);
  p.rows(0, 0, ["....aa......", "...abba.....", "...abba.....", "....aba..cc.", "....aba.cdc.", "...aaaa.cdc.", "..dddddd.cc.", "......cc.cc.", ".....ccccccc", "....ee.cc...", "...cccccccc.", "..cccccccccc"], {
    a: "#b7c6ff",
    b: "#e8eeff",
    c: "#7f8bd6",
    d: "#4b56a8",
    e: "#ff7eb0",
  });
  return finish(p);
}

/** 培地のシャーレ（中ほど：菌名が分かる） */
function dish(): Sprite {
  const p = new Painter(12, 12);
  p.ellipse(6, 6, 6, 6, (_x, _y, nx, ny) => (nx * nx + ny * ny > 0.62 ? (nx + ny < -0.3 ? "#e6fffb" : "#8fd9cf") : "#f3c06a"));
  for (const [x, y] of [[4, 4], [7, 5], [5, 7], [8, 8], [3, 6]] as const) p.set(x, y, "#ff7eb0");
  p.set(7, 4, "#fff").set(4, 8, "#c45c8a");
  return finish(p);
}

/** 薬剤感受性試験（近い：効かない薬が分かる）。シャーレに薬の円盤と、菌が育たない輪 */
function diskTest(): Sprite {
  const p = new Painter(12, 12);
  p.ellipse(6, 6, 6, 6, (_x, _y, nx, ny) => (nx * nx + ny * ny > 0.62 ? (nx + ny < -0.3 ? "#fff8e6" : "#e0b34f") : "#f6d78e"));
  for (const [x, y] of [[4, 4], [8, 5], [5, 8]] as const) {
    p.ellipse(x + 0.5, y + 0.5, 2, 2, "#fff6d6");
    p.set(x, y, "#ffffff");
  }
  p.set(8, 5, "#ff5d7a");
  return finish(p, "#3d2508");
}

function pause(): Sprite {
  return finish(new Painter(12, 12).rect(2, 1, 3, 10, "#ffffff").rect(7, 1, 3, 10, "#ffffff").rect(4, 1, 1, 10, "#cfc3dc").rect(9, 1, 1, 10, "#cfc3dc"));
}

function play(): Sprite {
  const p = new Painter(12, 12);
  for (let y = 0; y < 11; y++) {
    const w = 6 - Math.abs(5 - y);
    p.rect(3, y + 0.5, w * 1.4, 1, "#ffffff");
  }
  return finish(p);
}

function fast(): Sprite {
  const p = new Painter(12, 12);
  for (let y = 0; y < 9; y++) {
    const w = Math.round((4 - Math.abs(4 - y)) * 1.2);
    p.rect(1, y + 1.5, w, 1, "#ffffff").rect(6, y + 1.5, w, 1, "#ffffff");
  }
  return finish(p);
}

/** アンチバイオグラム（表の紙） */
function chart(): Sprite {
  const p = new Painter(12, 12);
  p.rect(1, 1, 10, 11, "#f3eefc").rect(4, 0, 4, 2, "#9a8bb8");
  p.rect(3, 4, 2, 2, "#4ade80").rect(6, 4, 2, 2, "#ffb347").rect(9, 4, 1, 2, "#4ade80");
  p.rect(3, 7, 2, 2, "#ff5d7a").rect(6, 7, 2, 2, "#4ade80").rect(9, 7, 1, 2, "#ffb347");
  p.rect(3, 10, 7, 1, "#cdbfe6");
  return finish(p);
}

/** 盾（耐性で弾いた） */
function shield(): Sprite {
  const p = new Painter(12, 12);
  p.rows(0, 0, ["aaaaaaaaaaaa", "abbbbbbbbbca", "abbbbbbbbbca", "abbbbbbbbbca", "abbbbbbbbbca", "abbbbbbbbcca", ".abbbbbbbca.", ".abbbbbbcca.", "..abbbbbca..", "...abbbca...", "....abca....", ".....aa....."], {
    a: "#5b5f78",
    b: "#d8dcf0",
    c: "#9aa0bd",
  });
  p.rect(5, 2, 2, 6, "#ff5d7a").rect(3, 4, 6, 2, "#ff5d7a");
  return finish(p);
}

function warn(): Sprite {
  const p = new Painter(12, 12);
  for (let y = 0; y < 11; y++) p.rect(6 - Math.floor((y + 1) / 2), y + 1, Math.floor((y + 1) / 2) * 2, 1, "#ffc23d");
  p.rect(5, 4, 2, 4, INK).rect(5, 9, 2, 1, INK);
  return finish(p, "#4a2504");
}

/** 耐性率が上がった（上向きの矢印） */
function up(): Sprite {
  const p = new Painter(12, 12);
  for (let y = 0; y < 6; y++) p.rect(6 - y, y, y * 2, 1, "#ff5d7a");
  p.rect(4, 6, 4, 6, "#ff5d7a").rect(4, 6, 1, 6, "#ff9db0");
  return finish(p);
}

function info(): Sprite {
  const p = new Painter(12, 12);
  p.ellipse(6, 6, 6, 6, "#5ab8ff");
  p.rect(5, 2, 2, 2, "#ffffff").rect(5, 5, 2, 5, "#ffffff");
  return finish(p);
}

function star(): Sprite {
  const p = new Painter(12, 12);
  p.rows(0, 0, [".....aa.....", ".....aa.....", "....abba....", "aaaaabbaaaaa", ".abbbbbbbba.", "..abbbbbba..", "...abbbba...", "...abbbba...", "..abbaabba..", "..aba..aba..", ".aa......aa.", "............"], {
    a: "#ffcf3f",
    b: "#fff3b8",
  });
  return finish(p, "#4a2504");
}

/** 細菌（波の数） */
function germ(): Sprite {
  const p = new Painter(12, 12);
  p.ellipse(6, 6, 5.5, 3.6, (_x, _y, nx, ny) => (nx + ny < -0.6 ? "#ffb3cf" : "#e0528a"));
  p.set(1, 3, "#e0528a").set(0, 2, "#e0528a").set(11, 9, "#e0528a").set(10, 8, "#e0528a");
  p.set(4, 5, "#3b0a24").set(7, 5, "#3b0a24");
  return finish(p, "#3b0a24");
}

/** 割れた盾（負け） */
function broken(): Sprite {
  const s = shield();
  const p = new Painter(s.w, s.h);
  p.s.px = s.px.slice();
  p.line(7, 1, 5, 5, INK).line(5, 5, 8, 8, INK).line(8, 8, 6, 12, INK);
  return p.s;
}

export const ICONS = { coin, bladder, hourglass, microscope, dish, diskTest, pause, play, fast, chart, shield, warn, up, info, star, germ, broken } as const;
export type IconName = keyof typeof ICONS;

const cache = new Map<string, Sprite>();
export function icon(name: IconName): Sprite {
  let s = cache.get(name);
  if (!s) {
    s = ICONS[name]();
    cache.set(name, s);
  }
  return s;
}

// ---------- 弾（系統の色で塗る。盤面のテクスチャ） ----------

const mixRgb = (a: RGB, b: RGB, t: number): string =>
  "#" + a.map((v, i) => Math.round(v + (b[i]! - v) * t).toString(16).padStart(2, "0")).join("");

/** 弾の形：剣＝三日月の斬撃、弓＝矢、槌＝衝撃の玉、機械兵＝光線 */
export type ShotKind = "slash" | "arrow" | "orb" | "beam";

export function shotSprite(kind: ShotKind, colorHex: string): Sprite {
  const c = hexToRgb(colorHex);
  const white: RGB = [255, 255, 255];
  const light = mixRgb(c, white, 0.55);
  const core = mixRgb(c, white, 0.85);
  const base = mixRgb(c, white, 0.15);
  switch (kind) {
    case "slash": {
      const p = new Painter(8, 14);
      p.ellipse(2, 7, 6, 7, base);
      p.ellipse(0.4, 7, 5.6, 6.4, light);
      p.ellipse(-1.2, 7, 5.6, 6.6, "#000000");
      for (let i = 0; i < p.s.px.length; i++) {
        const v = p.s.px[i];
        if (v && v[0] === 0 && v[1] === 0 && v[2] === 0) p.s.px[i] = null;
      }
      p.set(5, 7, core).set(5, 6, core).set(5, 8, core);
      return p.s;
    }
    case "arrow": {
      const p = new Painter(14, 5);
      p.rect(0, 2, 10, 1, light).rect(0, 1, 2, 1, base).rect(0, 3, 2, 1, base);
      p.rows(10, 0, ["a...", "aaa.", "aaaa", "aaa.", "a..."], { a: core });
      return p.s;
    }
    case "orb": {
      const p = new Painter(9, 9);
      p.ellipse(4.5, 4.5, 4.5, 4.5, base);
      p.ellipse(4.5, 4.5, 3, 3, light);
      p.ellipse(4, 4, 1.6, 1.6, core);
      return p.s;
    }
    case "beam": {
      const p = new Painter(16, 4);
      p.rect(0, 0, 16, 4, base).rect(1, 1, 15, 2, light).rect(4, 1, 12, 1, core);
      p.set(0, 0, null).set(0, 3, null);
      return p.s;
    }
  }
}

// ---------- 盤面の部品 ----------

/**
 * 粘膜の壁（レーンの境目）の横に並べる帯。w×h ドットで、上下にでこぼこ（ひだ）が出る。
 * 横に繰り返して使う（w の端がつながるように、ひだの周期を w の約数にする）
 */
export function membraneStrip(w = 48, h = 8): Sprite {
  const p = new Painter(w, h);
  const mid = h / 2;
  for (let x = 0; x < w; x++) {
    const bump = Math.sin((x / w) * Math.PI * 4) * 1.1 + Math.sin((x / w) * Math.PI * 12) * 0.5;
    const top = Math.round(mid - 2.2 - bump);
    const bot = Math.round(mid + 2.2 + bump * 0.7);
    for (let y = top; y <= bot; y++) {
      const t = (y - top) / Math.max(1, bot - top);
      p.set(x, y, t < 0.18 ? "#c25b8a" : t < 0.45 ? "#8f2f5f" : t < 0.8 ? "#6b1f48" : "#4a1433");
    }
    p.set(x, top - 1, "#2d0d20");
    p.set(x, bot + 1, "#1f0816");
    if (x % 12 === 3) p.set(x, top + 1, "#f08cb4");
  }
  return p.s;
}

/** レーンの床の模様（流れの中の小さな粒）。w×h ドット。横に繰り返す */
export function floorTile(w: number, h: number, seed = 7): Sprite {
  const p = new Painter(w, h);
  let r = seed;
  const rand = () => {
    r = (r * 1103515245 + 12345) & 0x7fffffff;
    return r / 0x7fffffff;
  };
  for (let i = 0; i < (w * h) / 22; i++) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * h);
    const v = rand();
    p.set(x, y, v < 0.6 ? "#2a2140" : v < 0.9 ? "#33284d" : "#45366a");
  }
  return p.s;
}

/**
 * 膀胱のドット絵（frac：耐久の割合 0〜1。減るほど壁が赤く腫れ、中の尿が濁る）。
 * w×h ドットの縦長の袋（上が丸く、下が少しすぼまって首になる）。右の壁に、3本のレーンの入口（gates の高さ、0〜1）を開ける。
 * 色は帯（段）で塗り、帯の境目だけ少しディザで混ぜる（全体にざらつかないように）
 */
export function bladderSprite(w: number, h: number, frac: number, gates: number[]): Sprite {
  const p = new Painter(w, h);
  const cx = w / 2;
  const hurt = 1 - Math.max(0, Math.min(1, frac));
  const lerp = (a: string, b: string, t: number) => mixRgb(hexToRgb(a), hexToRgb(b), t);
  // 傷むほど赤く：耐久が半分を切ると、はっきり赤みが出る（試遊の指摘：耐久 20 でも黄色のままに見えた）
  const t = Math.min(1, hurt * 1.35);
  const wall = [lerp("#ffb8d4", "#ffb0a8", t), lerp("#ef6fa2", "#f0404e", t), lerp("#c13f78", "#c01c30", t), lerp("#8a2457", "#7a0c18", t), lerp("#56123a", "#3d050c", t)];
  const urine = [lerp("#fff6c4", "#ffc8b4", t), lerp("#ffe066", "#f2765c", t), lerp("#f6bd34", "#d8452e", t), lerp("#d8921a", "#a82a1e", t), lerp("#9c620e", "#6b1410", t)];
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const neck = 5; // 下の首の高さ（ドット）
  const body = h - neck;
  // 高さごとの半分の幅：上は丸く、下へ少しすぼまる
  const half = (y: number) => {
    const t = (y + 0.5) / body; // 0 上 〜 1 下
    if (t > 1) return 0;
    const dome = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, 0.16 - t) / 0.16, 2)));
    const base = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, t - 0.86) / 0.14, 2)));
    const taper = 1 - 0.16 * Math.max(0, t - 0.45);
    return (w / 2 - 1) * dome * base * taper;
  };
  const WALL = 4;
  for (let y = 0; y < body; y++) {
    const hw = half(y);
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx;
      if (Math.abs(dx) > hw) continue;
      const th = BAYER[(y % 4) * 4 + (x % 4)]! / 16 - 0.5;
      const fromEdge = Math.min(hw - Math.abs(dx), y + 0.5 - (hw > 0 ? 0 : 0), body - y);
      const nx = dx / Math.max(1, hw);
      const ny = (y / body) * 2 - 1;
      if (fromEdge < WALL || y < WALL - 1 + (1 - Math.min(1, hw / (w / 2 - 1))) * 6) {
        // 筋肉の壁：光は左上から
        const k = -nx * 0.6 - ny * 0.25 + th * 0.12;
        p.set(x, y, k > 0.42 ? wall[0]! : k > 0.0 ? wall[1]! : k > -0.42 ? wall[2]! : wall[3]!);
      } else {
        // 中の尿：上が明るく、下と右ほど濃い
        const k = -ny * 0.7 - nx * 0.3 + th * 0.1;
        p.set(x, y, k > 0.55 ? urine[0]! : k > 0.12 ? urine[1]! : k > -0.35 ? urine[2]! : k > -0.75 ? urine[3]! : urine[4]!);
      }
    }
  }
  // 首（尿道へ）
  for (let y = body; y < h; y++) for (let x = Math.round(cx - 3); x < Math.round(cx + 3); x++) p.set(x, y, x < cx - 1 ? wall[1]! : wall[3]!);
  // 左上のつや（縦の光の筋）
  for (let y = Math.round(body * 0.14); y < Math.round(body * 0.62); y++) {
    const hw = half(y);
    const x = Math.round(cx - hw + WALL + 2);
    p.set(x, y, urine[0]!);
    if (y % 3 !== 0) p.set(x + 1, y, urine[0]!);
  }
  p.set(Math.round(cx - half(Math.round(body * 0.1)) + WALL + 2), Math.round(body * 0.1), "#ffffff");
  // 泡
  for (const [fx, fy] of [[0.62, 0.22], [0.55, 0.36], [0.68, 0.7]] as const) {
    const x = Math.round(w * fx);
    const y = Math.round(body * fy);
    p.set(x, y, urine[0]!).set(x + 1, y, urine[1]!).set(x, y + 1, urine[1]!);
  }
  // 右の壁の入口（レーンの高さ）：暗い穴と、上下の縁
  for (const g of gates) {
    const gy = Math.round(g * h);
    const hw = half(gy);
    const x0 = Math.round(cx + hw - WALL - 1);
    for (let y = gy - 3; y <= gy + 3; y++)
      for (let x = x0; x < w; x++) {
        if (!p.get(x, y)) continue;
        p.set(x, y, Math.abs(y - gy) === 3 ? wall[4]! : Math.abs(y - gy) === 2 ? "#3a0a1e" : "#1a040d");
      }
  }
  return outline(p.s, { color: "#14040c" });
}
