// ドット絵の共通の仕組み（ブラウザでも node でも動く。DOM を使わない）。作風は styles/ に1つずつ（2026-11-04 見本帳から移した）
// 絵は「行の文字列」で書く。1文字＝1ドット。'.' と ' ' は透明。
// 色は作風ごとのパレット（文字→色）で決める。色には次の「意味の色」も使える：
//   '@c0'〜'@c4'：系統の色の段（0 ハイライト、1 明るい、2 基本、3 影、4 いちばん暗い）
//   '@g0'〜'@g4'：グラム染色の色の段（陰性＝ピンク、陽性＝紫）
//   '@a'：作風が決めた差し色（1ビットの作風などで使う。既定は系統の基本色）

// ---------- 色の計算 ----------

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
}

export function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

export function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => (v + m) * 255);
}

/** 色相を target の方へ amount 度だけ寄せる（近い回り方で） */
function hueToward(h, target, amount) {
  let d = ((target - h + 540) % 360) - 180;
  const step = Math.sign(d) * Math.min(Math.abs(d), amount);
  return h + step;
}

/**
 * 1つの色から、影の色相をずらした5段の色を作る（ドット絵でよく使う「色相をずらした陰影」）。
 * 明るい側は黄色の方へ、暗い側は青紫の方へ色相を寄せる。
 */
export function makeRamp(hex, opt = {}) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  const shift = opt.shift ?? 14;
  const L = (v) => Math.max(0.04, Math.min(0.96, v));
  const steps = [
    [hueToward(h, 60, shift * 1.4), s * 0.75, L(l + 0.3)],
    [hueToward(h, 60, shift * 0.7), s * 0.92, L(l + 0.14)],
    [h, s, l],
    [hueToward(h, 250, shift), Math.min(1, s * 1.05 + 0.05), L(l - 0.16)],
    [hueToward(h, 255, shift * 1.6), Math.min(1, s * 0.9 + 0.1), L(l - 0.33)],
  ];
  return steps.map((v) => rgbToHex(hslToRgb(v)));
}

export const GRAM_BASE = { negative: "#e0528a", positive: "#6b3bb0" };

// ---------- 絵（ドットの配列） ----------

/** 絵：{ w, h, px }。px は長さ w*h の配列で、各ドットは [r,g,b] か null（透明） */
export function blank(w, h) {
  return { w, h, px: new Array(w * h).fill(null) };
}

/** パレットの色を、意味の色（@c0 など）も含めて実際の色にする */
export function resolveColor(v, ctx) {
  if (v == null) return null;
  if (typeof v !== "string") return v;
  if (v.startsWith("@c")) return hexToRgb(ctx.classRamp[Number(v[2])]);
  if (v.startsWith("@g")) return hexToRgb(ctx.gramRamp[Number(v[2])]);
  if (v === "@a") return hexToRgb(ctx.accent ?? ctx.classRamp[2]);
  return hexToRgb(v);
}

/** 行の文字列から絵を作る。ctx は { classRamp, gramRamp, accent } */
export function fromRows(rows, palette, ctx = {}) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const s = blank(w, h);
  const cache = new Map();
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? ".";
      if (ch === "." || ch === " ") continue;
      if (!(ch in palette)) throw new Error(`パレットにない文字「${ch}」（${y}行目 ${x}列目）`);
      if (!cache.has(ch)) cache.set(ch, resolveColor(palette[ch], ctx));
      s.px[y * w + x] = cache.get(ch);
    }
  }
  return s;
}

export function clone(s) {
  return { w: s.w, h: s.h, px: s.px.map((p) => (p ? [...p] : null)) };
}

/** src を dst の (x, y) に重ねる（透明でないドットだけ） */
export function blit(dst, src, x, y) {
  for (let j = 0; j < src.h; j++) {
    for (let i = 0; i < src.w; i++) {
      const p = src.px[j * src.w + i];
      if (!p) continue;
      const X = x + i;
      const Y = y + j;
      if (X < 0 || Y < 0 || X >= dst.w || Y >= dst.h) continue;
      dst.px[Y * dst.w + X] = p;
    }
  }
  return dst;
}

/** 大きな台紙に移す（余白を足す） */
export function pad(s, w, h, x = 0, y = 0) {
  return blit(blank(w, h), s, x, y);
}

export function flipX(s) {
  const o = blank(s.w, s.h);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) o.px[y * s.w + (s.w - 1 - x)] = s.px[y * s.w + x];
  return o;
}

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * 外側に1ドットの輪郭を付ける。
 * mode：{ color: '#hex' } で単色、'darken' で隣のドットを暗くした色（色付きの輪郭）、
 *       'selout' で上と左は少し明るめ、下と右は暗め（光が左上から当たる）
 */
export function outline(s, mode = "darken") {
  const o = clone(s);
  const fixed = mode && typeof mode === "object" && mode.color ? hexToRgb(mode.color) : null;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (s.px[y * s.w + x]) continue;
      let nb = null;
      let dir = null;
      for (const [dx, dy] of N4) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= s.w || Y >= s.h) continue;
        const p = s.px[Y * s.w + X];
        if (p) {
          nb = p;
          dir = [dx, dy];
          break;
        }
      }
      if (!nb) continue;
      if (fixed) o.px[y * s.w + x] = fixed;
      else {
        const [hh, ss, ll] = rgbToHsl(nb);
        let k = 0.42;
        if (mode === "selout") k = dir[0] === 1 || dir[1] === 1 ? 0.5 : 0.3; // 左・上は明るめ
        o.px[y * s.w + x] = hslToRgb([hueToward(hh, 255, 6), Math.min(1, ss * 0.8 + 0.1), Math.max(0.07, ll * (1 - k) - 0.08)]);
      }
    }
  }
  return o;
}

// 4×4 のベイヤー行列（ディザ）
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** ディザで透かす：keep（0〜1）の割合のドットだけ残す。edgeKeep が真なら輪郭（外周）のドットは残す */
export function ditherKeep(s, keep, edgeKeep = true) {
  const o = clone(s);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const p = s.px[y * s.w + x];
      if (!p) continue;
      if (edgeKeep && isEdge(s, x, y)) continue;
      if (BAYER[y % 4][x % 4] >= keep * 16) o.px[y * s.w + x] = null;
    }
  }
  return o;
}

export function isEdge(s, x, y) {
  for (const [dx, dy] of N4) {
    const X = x + dx;
    const Y = y + dy;
    if (X < 0 || Y < 0 || X >= s.w || Y >= s.h) return true;
    if (!s.px[Y * s.w + X]) return true;
  }
  return false;
}

/** 下から frac の高さまでは色、上は輪郭だけ（中は ghost の色か透明） */
export function fillLevel(s, frac, ghost = null) {
  const o = clone(s);
  let top = s.h;
  let bottom = -1;
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++)
      if (s.px[y * s.w + x]) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  const line = bottom + 1 - Math.round((bottom + 1 - top) * frac);
  const g = ghost ? hexToRgb(ghost) : null;
  for (let y = 0; y < line; y++)
    for (let x = 0; x < s.w; x++) {
      const p = s.px[y * s.w + x];
      if (!p) continue;
      if (isEdge(s, x, y)) o.px[y * s.w + x] = darkGray(p);
      else o.px[y * s.w + x] = g;
    }
  return o;
}

function darkGray(p) {
  const l = 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2];
  const v = Math.min(120, l * 0.6);
  return [v, v, v + 10];
}

/** 色を灰色にする（使えないカードなど） */
export function grayscale(s, amount = 1) {
  const o = clone(s);
  o.px = o.px.map((p) => {
    if (!p) return p;
    const l = 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2];
    return p.map((v) => v + (l - v) * amount);
  });
  return o;
}

/** 明るさで4段に分け、指定の4色に置き換える（4階調の作風） */
export function quantize4(s, four) {
  const cols = four.map(hexToRgb);
  const o = clone(s);
  o.px = o.px.map((p) => {
    if (!p) return p;
    const l = (0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2]) / 255;
    const i = l < 0.28 ? 0 : l < 0.5 ? 1 : l < 0.74 ? 2 : 3;
    return cols[i];
  });
  return o;
}

/** 絵の中で、透明でない範囲 */
export function bounds(s) {
  let x0 = s.w;
  let y0 = s.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++)
      if (s.px[y * s.w + x]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  return { x0, y0, x1, y1 };
}

// ---------- 薬の絵を組み立てる ----------

/**
 * 作風（style）と薬（drug）から、その薬の兵士の絵を作る。
 * drug：{ id, abbr, cls, color, route, ba, pa }（color は系統の色、pa は緑膿菌の印）
 * which：'idle0' | 'idle1' | 'attack0' | 'attack1' ...（無ければ idle0）
 * opt.color で配色の元の色を差し替えられる（製品の色の案など）
 */
export function soldierSprite(style, drug, which = "idle0", opt = {}) {
  const def = style.soldiers[drug.cls] ?? style.soldiers.penicillin;
  const color = opt.color ?? drug.color;
  const ctx = { classRamp: makeRamp(color, style.rampOpt), gramRamp: makeRamp(GRAM_BASE.negative), accent: style.accentOf ? style.accentOf(color) : color };
  const [kind, idxS] = [which.replace(/\d+$/, ""), which.match(/\d+$/)?.[0] ?? "0"];
  const frames = def[kind] ?? def.idle;
  const idx = Number(idxS) % frames.length;
  let s = fromRows(frames[idx], { ...style.palette, ...(def.palette ?? {}) }, ctx);
  if (drug.pa && style.badge) {
    const at = Array.isArray(def.badgeAt?.[kind]) ? def.badgeAt[kind][idx] ?? def.badgeAt[kind][0] : def.badgeAt?.[kind] ?? def.badgeAt?.idle ?? def.badgeAt;
    const anchor = Array.isArray(at) ? at : [at?.x ?? 0, at?.y ?? 0];
    if (at) blit(s, fromRows(style.badge, style.badgePalette ?? style.palette, ctx), anchor[0], anchor[1]);
  }
  if (style.outline) s = outline(s, style.outline);
  if (drug.route === "po" && style.oralBase && !opt.noOral) {
    const base = fromRows(style.oralBase.rows, style.oralBase.palette ?? style.palette, ctx);
    const o = blank(s.w, s.h);
    blit(o, base, style.oralBase.x, style.oralBase.y);
    blit(o, s, 0, 0);
    s = o;
  }
  if (style.post) s = style.post(s, drug, ctx);
  return s;
}

/** 細菌の絵。bug：{ id, gram, shape, capsule, flagella, size }。bare は菌名が分かる前（べん毛なし） */
export function bugSprite(style, bug, frame = 0, bare = false) {
  const def = style.bacteria[bug.id] ?? style.bacteria[bug.shape];
  const ctx = { classRamp: makeRamp("#888888"), gramRamp: makeRamp(GRAM_BASE[bug.gram], style.rampOpt), accent: GRAM_BASE[bug.gram] };
  // bare：べん毛のないコマ（グラム染色ではべん毛は見えないので、菌名が分かるまではこちら。作風に無ければ同じ絵）
  const frames = bare && def.bare ? def.bare : def.frames;
  let s = fromRows(frames[frame % frames.length], { ...style.palette, ...(def.palette ?? {}) }, ctx);
  if (style.bugOutline ?? style.outline) s = outline(s, style.bugOutline ?? style.outline);
  if (style.postBug) s = style.postBug(s, bug, ctx);
  return s;
}

/** 絵の一部を切り抜く（カードの肖像など）。r：{ x, y, w, h } */
export function crop(s, r) {
  const o = blank(r.w, r.h);
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const X = r.x + x;
      const Y = r.y + y;
      if (X >= 0 && Y >= 0 && X < s.w && Y < s.h) o.px[y * r.w + x] = s.px[Y * s.w + X];
    }
  return o;
}

/** カードに出す絵（cardCrop があれば切り抜く） */
export function cardSprite(style, drug, which = "idle0", opt = {}) {
  const s = soldierSprite(style, drug, which, opt);
  return style.cardCrop ? crop(s, style.cardCrop) : s;
}
