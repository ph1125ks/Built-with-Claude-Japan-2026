// 作風 C：32×32 ドット・ハイビット
// 約2.4頭身。黒い輪郭は使わず、部分ごとの暗い色で縁どる（セレクティブ・アウトライン）。
// 顔・兜・盾・脚などは段（明るさ）まで手で書き、胴や腕は「材質の文字」で書いて陰影をプログラムで付ける。
// 光は左上から。盤面は2倍（64px）。カードは上半身（20×20）を切り抜いて2倍（40px）。
const W = 32;

// ---------- 色の計算（この作風の中だけで使う） ----------
const hexToRgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (rgb) => "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
function rgbToHsl([r, g, b]) {
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
function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return t.map((v) => (v + m) * 255);
}
const toward = (h, target, amount) => {
  const d = ((target - h + 540) % 360) - 180;
  return h + Math.sign(d) * Math.min(Math.abs(d), amount);
};
const mix = (a, b, t) => rgbToHex(hexToRgb(a).map((v, i) => v + (hexToRgb(b)[i] - v) * t));
/** この作風の5段：暗い側は彩度を落として青紫へ、明るい側は黄へ。エンジンの段より影がぎらつかない */
function myRamp(hex) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  const C = (v) => Math.max(0.1, Math.min(0.95, v));
  return [
    [toward(h, 55, 16), s * 0.8, C(l + 0.27)],
    [toward(h, 55, 7), s * 0.95, C(l + 0.13)],
    [h, s, l],
    [toward(h, 268, 14), Math.max(s * 0.78, 0.16), C(l - 0.16)],
    [toward(h, 268, 26), Math.max(s * 0.6, 0.2), C(l - 0.31)],
  ].map((v) => rgbToHex(hslToRgb(v)));
}

// ---------- 材質ごとの色の段（0 ハイライト〜4 いちばん暗い） ----------
// veil・caps は仮の色。細菌の仕上げ（postBug）で、グラム染色の色から作った色に置き換える。
const PH = (i) => rgbToHex([1, 2, 40 + i]);
const RAMPS = {
  cls: ["@c0", "@c1", "@c2", "@c3", "@c4"],
  gram: ["@g0", "@g1", "@g2", "@g3", "@g4"],
  veil: [PH(0), PH(1), PH(2), PH(3), PH(4)],
  caps: [PH(5), PH(6), PH(7), PH(8), PH(9)],
  skin: ["#fff0dc", "#fbd2ad", "#eba882", "#c47766", "#8a4c5c"],
  hair: ["#c98b5c", "#9c5d40", "#713f33", "#4c2a3a", "#2f1b30"],
  steel: ["#f6f9fd", "#cfd9e8", "#9caac3", "#677593", "#404765"],
  gold: ["#fff3b4", "#ffd45c", "#e49c31", "#a85e2b", "#6b3627"],
  leather: ["#f6cc94", "#df9f5f", "#b8703f", "#80472f", "#522a29"],
  wood: ["#e6ae74", "#bc7b4a", "#8d5435", "#5f352b", "#3b2024"],
  pants: ["#b4b3d0", "#8b8ab0", "#69678f", "#4b4870", "#312e4d"],
  boot: ["#c99a7c", "#a06d58", "#784c45", "#523039", "#351f2a"],
  mechW: ["#ffffff", "#e9eef5", "#c2ccdc", "#8995b0", "#555e7c"],
  mechD: ["#9298b4", "#6a7091", "#4b5170", "#343854", "#22253a"],
  glow: ["#ffffff", "#dcfdff", "#82efff", "#30b9e8", "#2479b6"],
  cloth: ["#fffaf0", "#f3e8d6", "#dbc9b2", "#ad9583", "#735e60"],
  eye: ["#3b2440", "#2c1a30", "#2c1a30", "#2c1a30", "#1f1224"],
  white: ["#ffffff", "#f6f3fa", "#e2dcec", "#bcb2cc", "#86799c"],
  fx: ["#ffffff", "#fffdf4", "#fff3d6", "#f7e0b4", "#e9c690"],
};

// 材質と段 → パレットの1文字（使うときに割り当てる）
const POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+-/:;<=>?^_~|!,'\"()[]{}`\\";
const CH = {};
const PALETTE = {};
let poolAt = 0;
function chOf(m, s) {
  const k = m + s;
  if (!CH[k]) {
    const c = POOL[poolAt++];
    if (!c) throw new Error("パレットの文字が足りない");
    CH[k] = c;
    PALETTE[c] = RAMPS[m][s];
  }
  return CH[k];
}

// ---------- 描く仕組み ----------
// 絵は { w, h, a }。a の各ドットは { m: 材質, s: 段, nol: 仕上げの縁どりをしない, hi: 左上の縁の段 }
const LV = (() => {
  const v = [-0.55, -0.62, 0.56];
  const n = Math.hypot(...v);
  return v.map((a) => a / n);
})();
const toShade = (b) => (b >= 0.93 ? 0 : b >= 0.7 ? 1 : b >= 0.36 ? 2 : b >= 0.0 ? 3 : 4);

const newPic = (w = W, h = W) => ({ w, h, a: new Array(w * h).fill(null) });
function put(pic, x, y, cell) {
  if (x >= 0 && y >= 0 && x < pic.w && y < pic.h) pic.a[y * pic.w + x] = cell;
}
const get = (pic, x, y) => (x < 0 || y < 0 || x >= pic.w || y >= pic.h ? null : pic.a[y * pic.w + x]);
/** 1ドット置く */
function px(pic, x, y, m, s, nol = true) {
  put(pic, x, y, { m, s, nol });
}
/** 塗ってある所だけ、段（と材質）を変える */
function tint(pic, x, y, s, m) {
  const c = get(pic, x, y);
  if (c) put(pic, x, y, { ...c, s, m: m ?? c.m });
}
/** 5段の材質を、5つの文字に割り当てた対応表を作る */
const ramp5 = (m, letters) => Object.fromEntries([...letters].map((c, i) => [c, [m, i]]));

/** 段まで手で書いた部品を貼る。map：文字 → [材質, 段, 縁どりしない]。opt.hi：左上の縁の段 */
function paint(pic, ox, oy, rows, map, opt = {}) {
  rows.forEach((row, j) =>
    [...row].forEach((c, i) => {
      if (c === "." || c === " ") return;
      const v = map[c];
      if (!v) throw new Error(`部品にない文字「${c}」`);
      put(pic, ox + i, oy + j, { m: v[0], s: Math.min(4, v[1] + (opt.bias ?? 0)), nol: v[2] ?? opt.nol ?? false, hi: opt.hi });
    }),
  );
}

/**
 * 材質の文字で書いた部品を貼り、陰影と縁どりを付ける。
 * map：文字 → 材質名（自動の陰影）か [材質, 段, 縁どりしない]
 * opt.shade：'cyl'（縦の筒）/'hcyl'（横の筒）/'sph'（球）/'flat'
 * opt.ol：部品の縁を暗くする（既定 true）。左上は olHi、右下は olLo。opt.bias：全体を暗く（奥の手足）
 */
function part(pic, ox, oy, rows, map, opt = {}) {
  const cells = [];
  const set = new Set();
  rows.forEach((row, j) =>
    [...row].forEach((c, i) => {
      if (c === "." || c === " ") return;
      let spec = map[c];
      if (spec === undefined) throw new Error(`部品にない文字「${c}」`);
      if (typeof spec === "string") spec = { m: spec };
      else if (Array.isArray(spec)) spec = { m: spec[0], s: spec[1], keep: spec[2] };
      else spec = { ...spec };
      cells.push({ x: ox + i, y: oy + j, ...spec });
      set.add(ox + i + "," + (oy + j));
    }),
  );
  if (!cells.length) return;
  const has = (x, y) => set.has(x + "," + y);
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  for (const c of cells) {
    x0 = Math.min(x0, c.x);
    y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x);
    y1 = Math.max(y1, c.y);
  }
  const mode = opt.shade ?? "cyl";
  for (const c of cells) {
    if (c.s !== undefined) continue;
    if (mode === "flat") {
      c.s = opt.s ?? 2;
      continue;
    }
    let nx = 0;
    let ny = 0;
    if (mode === "cyl") {
      let a = c.x;
      let b = c.x;
      while (has(a - 1, c.y)) a--;
      while (has(b + 1, c.y)) b++;
      nx = b > a ? ((c.x - a + 0.5) / (b - a + 1)) * 2 - 1 : 0;
      ny = (((c.y - y0 + 0.5) / (y1 - y0 + 1)) * 2 - 1) * (opt.vy ?? 0.3);
    } else if (mode === "hcyl") {
      let a = c.y;
      let b = c.y;
      while (has(c.x, a - 1)) a--;
      while (has(c.x, b + 1)) b++;
      ny = b > a ? ((c.y - a + 0.5) / (b - a + 1)) * 2 - 1 : 0;
      nx = (((c.x - x0 + 0.5) / (x1 - x0 + 1)) * 2 - 1) * (opt.vx ?? 0.3);
    } else {
      const cx = opt.cx ?? (x0 + x1 + 1) / 2;
      const cy = opt.cy ?? (y0 + y1 + 1) / 2;
      const rx = opt.rx ?? (x1 - x0 + 1) / 2;
      const ry = opt.ry ?? (y1 - y0 + 1) / 2;
      nx = (c.x + 0.5 - cx) / rx;
      ny = (c.y + 0.5 - cy) / ry;
      const n = Math.hypot(nx, ny);
      if (n > 1) {
        nx /= n;
        ny /= n;
      }
    }
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    c.s = toShade(nx * LV[0] + ny * LV[1] + nz * LV[2] + (opt.lift ?? 0));
  }
  if (opt.ol !== false) {
    const olHi = opt.olHi ?? 3;
    const olLo = opt.olLo ?? 4;
    const sides = opt.sides ?? "lrtb";
    for (const c of cells) {
      if (c.keep) continue;
      const r = sides.includes("r") && !has(c.x + 1, c.y);
      const b = sides.includes("b") && !has(c.x, c.y + 1);
      const l = sides.includes("l") && !has(c.x - 1, c.y);
      const t = sides.includes("t") && !has(c.x, c.y - 1);
      if (r || b) c.s = Math.max(c.s, olLo);
      else if (l || t) c.s = Math.max(c.s, olHi);
    }
  }
  for (const c of cells) {
    const s = Math.max(0, Math.min(4, c.s + (c.keep ? 0 : opt.bias ?? 0)));
    put(pic, c.x, c.y, { m: c.m, s, nol: !!(c.keep || opt.nol), hi: opt.olHi });
  }
}

/** 仕上げ：外側の輪郭を、その部分の暗い色にする（右下は最も暗く、左上は一段明るく） */
function finish(pic) {
  const out = { ...pic, a: pic.a.map((c) => c && { ...c }) };
  const empty = (x, y) => !get(pic, x, y);
  for (let y = 0; y < pic.h; y++)
    for (let x = 0; x < pic.w; x++) {
      const c = pic.a[y * pic.w + x];
      if (!c || c.nol) continue;
      const o = out.a[y * pic.w + x];
      if (empty(x + 1, y) || empty(x, y + 1)) o.s = Math.max(c.s, 4);
      else if (empty(x - 1, y) || empty(x, y - 1)) o.s = Math.max(c.s, c.hi ?? 3);
    }
  return out;
}
function toRows(pic) {
  const rows = [];
  for (let y = 0; y < pic.h; y++) {
    let r = "";
    for (let x = 0; x < pic.w; x++) {
      const c = pic.a[y * pic.w + x];
      r += c ? chOf(c.m, c.s) : ".";
    }
    rows.push(r);
  }
  return rows;
}

/** 線（ブレゼンハム） */
function line(pic, xa, ya, xb, yb, m, s, nol = true) {
  const dx = Math.abs(xb - xa);
  const dy = -Math.abs(yb - ya);
  const sx = xa < xb ? 1 : -1;
  const sy = ya < yb ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px(pic, xa, ya, m, s, nol);
    if (xa === xb && ya === yb) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      xa += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ya += sy;
    }
  }
}

/** 曲線を1ドットの細い線で描く（角の二重ドットを取り除く）。f(t) → [x, y] */
function curve(pic, f, t0, t1, m, s, under = false) {
  const pts = [];
  for (let t = t0; t <= t1 + 1e-9; t += (t1 - t0) / 400) {
    const [x, y] = f(t);
    const p = [Math.round(x), Math.round(y)];
    const q = pts[pts.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) pts.push(p);
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = out[out.length - 1];
    const c = pts[i + 1];
    if (a && c && Math.abs(a[0] - c[0]) === 1 && Math.abs(a[1] - c[1]) === 1) continue;
    out.push(pts[i]);
  }
  for (const [x, y] of out) if (!under || !get(pic, x, y)) px(pic, x, y, m, s);
}

/**
 * 中心線（点の列）のまわりに、半径 r の丸い管を描く（桿菌・球菌）。陰影は管の丸みから。
 * 自分の縁は暗くする（重なった球菌の境目が見える）。opt.r(t)：太さの変化
 */
function tube(pic, pts, r, m, opt = {}) {
  const cells = [];
  const set = new Set();
  for (let y = 0; y < pic.h; y++)
    for (let x = 0; x < pic.w; x++) {
      // 中心線（折れ線）への最も近い点を、線分への正射影で求める（点の間隔によるむらを出さない）
      let best = null;
      const X = x + 0.5;
      const Y = y + 0.5;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[Math.min(i + 1, pts.length - 1)];
        const vx = q[0] - p[0];
        const vy = q[1] - p[1];
        const L2 = vx * vx + vy * vy;
        const u = L2 ? Math.max(0, Math.min(1, ((X - p[0]) * vx + (Y - p[1]) * vy) / L2)) : 0;
        const dx = X - (p[0] + vx * u);
        const dy = Y - (p[1] + vy * u);
        const d = Math.hypot(dx, dy);
        if (!best || d < best.d) best = { d, dx, dy, r: p[2] ?? r };
      }
      if (best.d > best.r) continue;
      const nx = best.dx / best.r;
      const ny = best.dy / best.r;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      cells.push({ x, y, s: toShade(nx * LV[0] + ny * LV[1] + nz * LV[2] + (opt.lift ?? 0)) });
      set.add(x + "," + y);
    }
  const has = (x, y) => set.has(x + "," + y);
  for (const c of cells) {
    if (!has(c.x + 1, c.y) || !has(c.x, c.y + 1)) c.s = 4;
    else if (!has(c.x - 1, c.y) || !has(c.x, c.y - 1)) c.s = Math.max(c.s, opt.hi ?? 3);
    else if (opt.rim && (!has(c.x + 2, c.y) || !has(c.x, c.y + 2)) && c.s >= 3) c.s = 2; // 照り返し
    put(pic, c.x, c.y, { m, s: c.s, nol: true });
  }
}

// ---------- 手で段まで書いた部品（右向き） ----------
// 文字の決まり：髪 A〜E、肌 0〜4、鉄 a〜e、系統の色 P〜T、金 f〜j、革 F〜J（いずれも左が明るい）、目 x
// 体の置き場所：頭 y2〜13、胴 y14〜22、脚 y23〜30（地面 y30）。体の縦は29ドット
const HAIR = ramp5("hair", "ABCDE");
const SKIN = ramp5("skin", "01234");
const STEEL = ramp5("steel", "abcde");
const CLS = ramp5("cls", "PQRST");
const GOLD = ramp5("gold", "fghij");
const LEATHER = ramp5("leather", "FGHIJ");
const PANTS = ramp5("pants", "klmno");
const BOOT = ramp5("boot", "uvwyz");

// 素顔の頭 13×12。頭の左上が (6,2)
const HEAD = [
  "....DDDDDD...",
  ".DDDCBBBBCDD.",
  "DCCBBAABBCCCD",
  "DBBBABBBCCCCD",
  "DBBBBBCCCCCDD",
  "DCCBCCCDCD2DD",
  "DCCCD32111112",
  "ECCCD31x11x13",
  "EDDCD21x11x13",
  "EDDCD21111113",
  ".EEDD3111112.",
  "..EEE3222223.",
];
const HEAD_MAP = { ...HAIR, ...SKIN, x: ["eye", 1, true] };

// 帽子形の兜（第2世代）18×7。頭の (-3,-2) に重ねる。つばが左右に張り出す
const KETTLE = [
  "......ddddddd.....",
  "....ddcbbbbbcdd...",
  "...dcbaabbbbbccd..",
  "...dbabbbbbbbccd..",
  "...dcadddadddade..",
  "dccbbbbbbbbbbbcccd",
  ".edddddddddddddde.",
];

// 顔を覆う兜（第3・第4世代）15×13。頭の (-2,-1) に重ねる。後ろの裾が張り出す形。v：のぞき穴と息穴
const HELM = [
  "......ddddd....",
  "....ddcbbbcdd..",
  "...dcbbaabbccd.",
  "..dcbabbbbbcccd",
  "..dbabbbbbbcccd",
  "..dbbbbbbbbcccd",
  "..dbbbbbbbccccd",
  "..dbbbbbbcddddd",
  "..dcbbbbbdvvvvv",
  "..dcbbbbcbbbbcd",
  "..dcbbcccccvcvd",
  ".dcccccccccccd.",
  "eddddeeeeeeee..",
];
const HELM_MAP = { ...STEEL, v: ["mechD", 4] };

// 機械兵の頭 13×12。q：枠、G/g/r：光る目
const MECH_HEAD = [
  ".ddddddddddd.",
  "dcbbbbbbbbccd",
  "dbaabbbbbbccd",
  "dbabbbbbbbccd",
  "dbbbbbbbbbccd",
  "dbbbbbqqqqqqq",
  "dbbbbbqGGgrrq",
  "dbbbbbqqqqqqq",
  "dcbbbbbbbbcce",
  "dccbbbcccccce",
  ".dccccccccce.",
  "..sssssssss..",
];
const MECH_MAP = {
  ...ramp5("mechW", "abcde"),
  q: ["mechD", 3],
  s: ["mechD", 2],
  G: ["glow", 0, true],
  g: ["glow", 1, true],
  r: ["glow", 2, true],
};

// 盾（β-ラクタマーゼ阻害薬の合剤）8×11。縁は鉄、面は系統の色
const SHIELD = [
  "bbbbbbcd",
  "bQQRRRRd",
  "bQRRRRSd",
  "bQRRRRSd",
  "bQRRRRSd",
  "cQRRRRSd",
  "cQRRRSSe",
  ".cQRRSe.",
  ".cRRRSe.",
  "..cRSe..",
  "...de...",
];

// マント（第4世代）。体の後ろ。左上が (1,14)
const CAPE = [
  "......SR",
  ".....SRQ",
  "....SRQR",
  "....SRQR",
  "...SRRQR",
  "...SRQRR",
  "..SRRQRR",
  "..SRQRRS",
  ".SRRQRRS",
  ".SRQRRS.",
  "SRRQRS..",
  "SRQRS...",
  "TSRST...",
  ".TT.....",
];

// 羽飾り（第4世代）。兜のてっぺんの金具から後ろへ流れる。左上が頭の (-4,-2)
const PLUME = ["...PPQQQRh", "..PQRRS...", ".QRRS.....", "QRS.......", "RS........", "S........."];

// 脚（前・奥は同じ形。奥は一段暗く、つま先を1ドット短く）。左上が (13,23)／(8,23)
const LEG = ["nnno..", "mlln..", "mlln..", "vuuw..", "wvvy..", "wvvy..", "wvvvyy", "zzzzzz"];
const LEG_PLATE = ["cccd..", "cbbd..", "baad..", "dddd..", "cbbd..", "cbbd..", "cbbbdd", "eeeeee"];
const LEG_MECH = ["ssss..", "bbbd..", "babd..", "dddd..", "cbbd..", "cbbd..", "cbbbdd", "eeeeee"];

// 内服の台（カプセル）26×5。左は白、右は系統の色
const CAPSULE = [
  "..vvvvvvvvvvvSSSSSSSSSSS..",
  ".vkkkkkwwwwwwSQQPPPQQQQRS.",
  "vwwwwwwwwwwwwSRRRRRRRRRRRT",
  ".vxxxwwwwwwwwSRRRRRRRRSST.",
  "..vvvvvvvvvvvTTTTTTTTTTT..",
];

// ---------- 武器 ----------

/**
 * 剣（刃は3ドットの太さ：明・中・暗）。dir：'diag'（右上へ構える）/'up'（振りかぶり）/'fwd'（前へ振り抜く）
 * hx,hy：手の位置。n：刃の長さ
 */
function sword(pic, hx, hy, dir, kind = "steel", n = 6) {
  const glow = kind === "glow";
  const blade = glow ? "glow" : "steel";
  const hilt = glow ? "mechD" : "gold";
  const grip = glow ? "mechD" : "leather";
  const [L, M, D] = glow ? [0, 2, 3] : [1, 2, 3];
  if (dir === "diag") {
    px(pic, hx - 1, hy + 1, grip, 3);
    px(pic, hx - 2, hy + 2, hilt, 2);
    px(pic, hx - 1, hy - 3, hilt, 1);
    px(pic, hx, hy - 2, hilt, 1);
    px(pic, hx + 1, hy - 1, hilt, 2);
    px(pic, hx + 2, hy, hilt, 2);
    px(pic, hx + 3, hy + 1, hilt, 3);
    for (let k = 0; k < n; k++) {
      px(pic, hx + 2 + k, hy - 2 - k, blade, L);
      px(pic, hx + 3 + k, hy - 2 - k, blade, M);
      px(pic, hx + 3 + k, hy - 1 - k, blade, D);
    }
    px(pic, hx + 2 + n, hy - 2 - n, blade, 0);
    if (!glow) px(pic, hx + 4, hy - 4, blade, 0); // 刃のきらめき
  } else if (dir === "up") {
    px(pic, hx, hy + 1, grip, 3);
    px(pic, hx, hy + 2, hilt, 2);
    for (let i = -2; i <= 2; i++) px(pic, hx + i, hy - 1, hilt, i < 0 ? 1 : i === 2 ? 3 : 2);
    for (let k = 0; k < n; k++) {
      px(pic, hx - 1, hy - 2 - k, blade, L);
      px(pic, hx, hy - 2 - k, blade, M);
      px(pic, hx + 1, hy - 2 - k, blade, D);
    }
    px(pic, hx, hy - 2 - n, blade, 0);
    if (!glow) px(pic, hx - 1, hy - 5, blade, 0);
  } else {
    px(pic, hx - 2, hy, hilt, 2);
    for (let j = -2; j <= 2; j++) px(pic, hx + 1, hy + j, hilt, j < 0 ? 1 : j === 2 ? 3 : 2);
    for (let k = 0; k < n; k++) {
      px(pic, hx + 2 + k, hy - 1, blade, L);
      px(pic, hx + 2 + k, hy, blade, M);
      px(pic, hx + 2 + k, hy + 1, blade, D);
    }
    px(pic, hx + 2 + n, hy, blade, 0);
    if (!glow) px(pic, hx + 5, hy - 1, blade, 0);
  }
}

/** 振り抜きの残像（三日月形）。中心 cx,cy、半径 r。先（右）ほど太い */
function smear(pic, cx, cy, r, mat = "fx") {
  for (let y = 0; y < pic.h; y++)
    for (let x = 0; x < pic.w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx < 0 || dy > 0) continue;
      const d = Math.hypot(dx, dy);
      const t = Math.atan2(-dy, dx) / (Math.PI / 2); // 0（右）〜1（上）
      if (t > 0.85) continue;
      const w = 0.8 + 2.6 * (1 - t);
      if (d <= r && d > r - w && !get(pic, x, y)) px(pic, x, y, mat, d > r - 1.1 ? 0 : t > 0.5 ? 3 : 2);
    }
}

// ---------- 人の組み立て ----------

// 前の腕（手の位置は 待機 (19〜20,19〜20)・振りかぶり (20〜21,12〜13)・振り抜き (20〜21,16〜17)）
const ARM = {
  idle: [15, 15, ["cccc..", "ccccc.", ".cccc.", "..ccs.", "...sss", "....ss"]],
  raise: [15, 12, [".....ss", ".....ss", "....cc.", "cccccc.", "ccccc..", ".ccc..."]],
  strike: [15, 15, ["cccc...", "cccccss", "ccccsss", ".cc...."]],
};

/**
 * look：{ armor: 0〜4, weapon, shield, band, apron, quiver }
 * pose：'idle' | 'raise' | 'strike'
 * by：上半身の上下（呼吸）、hx：頭の前後（体重移動）
 */
function human(look, pose, by = 0, hx = 0) {
  const pic = newPic();
  const t = look.armor;
  const plate = t >= 3;
  const cloth = look.apron ? "cloth" : "cls";

  // マント（後ろ）
  if (t === 4) paint(pic, 1, 14 + by, CAPE, CLS);
  // 矢筒（背中）
  if (look.quiver) {
    part(pic, 2, 12 + by, ["LLLL", "LLLL", "LLLL", "LLLL", "LLLL", "LLLL", ".LL."], { L: "leather" }, { shade: "cyl" });
    paint(pic, 2, 9 + by, ["Q.R.", "QRSR", ".RS."], CLS, { nol: true });
  }

  // 奥の腕（と奥の肩当て）
  part(pic, 5, 15 + by, [".cc", "ccc", "ccc", "ccc", "ccc", "sss", ".ss"], { c: plate ? "steel" : cloth, s: plate ? "steel" : "skin" }, { shade: "cyl", bias: 1 });
  if (t === 1) paint(pic, 3, 13 + by, [".GG.", "GGHH", "GHHI", "JIJ."], LEATHER, { bias: 1 });
  if (plate) part(pic, 3, 14 + by, [".mmm", "mmmm", ".mm."], { m: "steel" }, { shade: "sph", bias: 1 });

  // 脚（前は光の側の縁を明るめに）
  const legRows = plate ? LEG_PLATE : LEG;
  const legMap = plate ? STEEL : { ...PANTS, ...BOOT };
  paint(pic, 8, 23, legRows.map((r) => r.slice(0, 5)), legMap, { bias: 1, hi: 3 });
  paint(pic, 13, 23, legRows, legMap, { hi: 2 });
  if (t === 4) for (let x = 13; x <= 16; x++) px(pic, x, 26, "gold", x === 13 ? 1 : 2, false);

  // 胴（服。板金の系統は描かない）
  if (!plate) {
    part(
      pic,
      7,
      14 + by,
      [".cccccccnnc.", "cccccccccccc", "cccccccccccc", "cccccccccccc", "cccccccccccc", "cccccccccccc", "LLLLLLLLgLLL", "cccccccccccc", "ccccccccccccc"],
      { c: cloth, L: "leather", g: ["gold", 1], n: ["skin", 2] },
      { shade: "cyl" },
    );
    // 服のしわ
    tint(pic, 10, 22 + by, 3);
    tint(pic, 15, 21 + by, 3);
    tint(pic, 15, 22 + by, 3);
    tint(pic, 8, 16 + by, 1);
  }
  if (look.apron) {
    part(pic, 9, 16 + by, [".aaaaa.", "aaaaaaa", "aaaaaaa", "aaaaaaa", "aaaaaaa", "aaaaaaa", "aaaaaaaa", "aaaaaaaa", "aaaaaaaa"], { a: "cls" }, { shade: "cyl" });
    for (const [x, y] of [[11, 23], [11, 24], [14, 22], [14, 23], [14, 24]]) tint(pic, x, y + by, 3);
    line(pic, 10, 16 + by, 9, 14 + by, "cls", 3); // 首ひも
  }
  if (t === 1) {
    // 革の胸当て：胴をすっぽり覆い、裾は腰で広がる。胸と腹の2枚を縫い合わせた継ぎ目
    paint(pic, 6, 15 + by, [".GGGGHHHHHI..", ".GFFGHHHHHII.", ".GFGHHHHHHII.", ".IIIIIIIIIIJ.", ".GGHHHHHHHII.", ".GHHHHHHHIIJ.", "HHHHHHHHHIIJJ"], LEATHER);
    for (const x of [9, 12, 15]) px(pic, x, 18 + by, "leather", 1, false); // 縫い目
  }
  if (t === 2) {
    // 鉄の胸当て（鋲）
    part(pic, 8, 15 + by, ["mmmmmmmm.", "mmmmmmmmm", "mmmmmmmmm", "mmmmmmmmm", ".mmmmmmm."], { m: "steel" }, { shade: "cyl" });
    for (const [x, y] of [[9, 16], [9, 18]]) px(pic, x, y + by, "steel", 0);
  }
  if (plate) {
    // 板金の胴と草摺り、系統の色の前垂れ（胸から膝の上まで）
    part(
      pic,
      7,
      14 + by,
      [".mmmmmmmmmm.", "mmmmmmmmmmmm", "mmmmmmmmmmmm", "mmmmmmmmmmmm", "mmmmmmmmmmmm", "mmmmmmmmmmmm", "MMMMMMMMMMMM", "mmmmmmmmmmmm", "mmmmmmmmmmmm"],
      { m: "steel", M: ["steel", 3] },
      { shade: "cyl" },
    );
    for (let x = 7; x <= 18; x++) tint(pic, x, 22 + by, 3);
    px(pic, 9, 15 + by, "steel", 0);
    px(pic, 9, 16 + by, "steel", 0);
    paint(pic, 10, 15 + by, ["QRRRS", "QRRRS", "QRRRS", "QRRRS", "QRRRS", "jjjjj", "QRRRS", "QRRRS", "QRRSS", ".RST."], { ...CLS, ...GOLD });
    if (t === 4) {
      for (let x = 7; x <= 18; x++) tint(pic, x, 20 + by, x < 10 ? 1 : 2, "gold");
      for (let x = 10; x <= 13; x++) tint(pic, x, 23 + by, x === 10 ? 1 : 2, "gold");
    } else for (let x = 10; x <= 14; x++) tint(pic, x, 20 + by, 3, "leather");
  }

  // 頭
  const hy = 2 + by;
  const hxx = 6 + hx;
  if (plate) {
    paint(pic, hxx - 2, hy - 1, HELM, HELM_MAP);
    if (t === 4) {
      for (let x = 7; x <= 12; x++) px(pic, hxx + x, hy + 6, "gold", x === 7 ? 1 : 2, false);
      paint(pic, hxx - 4, hy - 2, PLUME, { ...CLS, ...GOLD }, { nol: true });
    }
  } else {
    paint(pic, hxx, hy, HEAD, HEAD_MAP);
    if (look.band) {
      for (let x = 1; x <= 12; x++) px(pic, hxx + x, hy + 4, "cls", x < 4 ? 1 : x < 10 ? 2 : 3, false);
      px(pic, hxx, hy + 4, "cls", 3, false);
      // 結び目の先が後ろへなびく（待機の2コマ目と振り抜きで形を変える）
      const flutter = (pose === "idle" && by === 1) || pose === "strike";
      paint(pic, hxx - 4, hy + 4, flutter ? [".QQR", "QRS.", "S..."] : ["..QR", ".QS.", "QS..", ".S.."], CLS, { nol: true });
    }
    if (t === 2) paint(pic, hxx - 3, hy - 2, KETTLE, STEEL);
  }

  // 前の腕と武器
  const sleeve = plate ? "steel" : cloth;
  const handMat = plate ? "steel" : "skin";
  const arm = (p) => {
    const [ax, ay, rows] = ARM[p];
    part(pic, ax, ay + by, rows, { c: sleeve, s: handMat }, { shade: p === "strike" ? "hcyl" : "cyl" });
  };
  if (look.weapon === "sword") {
    if (look.shield) {
      // 剣は奥の手で持つ（盾の右から出る）
      const hp = pose === "idle" ? [23, 19] : pose === "raise" ? [24, 12] : [23, 17];
      if (pose === "strike") smear(pic, 22, 18 + by, 12);
      const fore = pose === "idle" ? [[21, 18], [22, 18]] : pose === "raise" ? [[21, 15], [22, 14], [22, 13], [21, 14]] : [[21, 16], [21, 17]];
      for (const [x, y] of fore) px(pic, x, y + by, "cls", 3, false);
      sword(pic, hp[0], hp[1] + by, pose === "idle" ? "diag" : pose === "raise" ? "up" : "fwd", "steel", 5);
      part(pic, hp[0] - 1, hp[1] + by - 1, ["ss", "ss"], { s: handMat }, { shade: "sph" });
      paint(pic, 14, 14 + by + (pose === "strike" ? -1 : 0), SHIELD, { ...STEEL, ...CLS });
    } else if (pose === "idle") {
      sword(pic, 20, 20 + by, "diag");
      arm("idle");
    } else if (pose === "raise") {
      sword(pic, 21, 12 + by, "up");
      arm("raise");
    } else {
      smear(pic, 20, 18 + by, 12);
      sword(pic, 21, 17 + by, "fwd");
      arm("strike");
    }
  }
  if (look.weapon === "hammer") hammerArm(pic, pose, by, arm);
  if (look.weapon === "bow") bowArm(pic, pose, by, arm, handMat);

  // 前の肩当て（第1世代は革を外へ張り出す）
  if (t === 1) paint(pic, 14, 13 + by, [".GGGG.", "GFFGGH", "GGGHHI", "JIIIJJ"], LEATHER);
  if (t === 2) part(pic, 15, 14 + by, [".mmm.", "mmmmm", "mmmmm", ".mmm."], { m: "steel" }, { shade: "sph" });
  if (plate) {
    part(pic, 14, 13 + by, [".mmmmm.", "mmmmmmm", "mmmmmmm", "rrrrrrr", ".mmmmm."], { m: "steel", r: ["steel", 3] }, { shade: "sph" });
    if (t === 4) for (let x = 15; x <= 19; x++) px(pic, x, 13 + by, "gold", x === 15 ? 0 : 1);
  }
  return toRows(finish(pic));
}

/** 槌の頭（8×6、帯つき） */
function hammerHead(pic, x, y) {
  part(pic, x, y, ["mmmmmmmm", "mmmmmmmm", "rrrrrrrr", "mmmmmmmm", "mmmmmmmm", "mmmmmmmm"], { m: "steel", r: ["steel", 3] }, { shade: "hcyl" });
}

function hammerArm(pic, pose, by, arm) {
  const grip = (x, y0, y1) => {
    for (let y = y0; y <= y1; y++) {
      px(pic, x, y + by, "wood", y < y0 + 3 ? 1 : 2);
      px(pic, x + 1, y + by, "wood", 3);
    }
  };
  if (pose === "idle") {
    // 顔の右に槌の頭。柄は手から下へ
    grip(20, 12, 26);
    hammerHead(pic, 18, 6 + by);
    arm("idle");
  } else if (pose === "raise") {
    grip(20, 5, 14);
    hammerHead(pic, 18, 0 + by);
    arm("raise");
  } else {
    for (let x = 20; x <= 27; x++) {
      px(pic, x, 18 + by + Math.floor((x - 20) / 3), "wood", 2);
      px(pic, x, 19 + by + Math.floor((x - 20) / 3), "wood", 3);
    }
    part(pic, 26, 21 + by, ["mmmmmm", "mmmmmm", "mmmmmm", "rrrrrr", "mmmmmm", "mmmmmm", "mmmmmm", "mmmmmm", "mmmmmm"], { m: "steel", r: ["steel", 3] }, { shade: "cyl" });
    for (const [x, y] of [[24, 29], [23, 30], [25, 28], [31, 30]]) px(pic, x, y, "fx", 2);
    arm("strike");
  }
}

function bowArm(pic, pose, by, arm, handMat) {
  const drawn = pose === "raise";
  const bx = pose === "idle" ? 19 : 23;
  const cy = pose === "idle" ? 19 + by : 16 + by;
  const half = 10;
  for (let dy = -half; dy <= half; dy++) {
    const a = Math.abs(dy) / half;
    const x = bx + Math.round(3.5 * Math.sqrt(Math.max(0, 1 - a * a)));
    px(pic, x, cy + dy, "wood", dy < 0 ? 1 : 2);
    px(pic, x + 1, cy + dy, "wood", 3);
  }
  const pull = drawn ? 7 : 0;
  for (let dy = -half + 1; dy <= half - 1; dy++) {
    const x = bx - Math.round(pull * (1 - Math.abs(dy) / half));
    if (!get(pic, x, cy + dy)) px(pic, x, cy + dy, "white", 2);
  }
  if (drawn) {
    for (let x = bx - pull; x <= bx + 7; x++) px(pic, x, cy, "wood", 1);
    px(pic, bx + 8, cy, "steel", 1);
    px(pic, bx + 7, cy - 1, "steel", 2);
    px(pic, bx + 7, cy + 1, "steel", 3);
    px(pic, bx - pull - 1, cy - 1, "cls", 1);
    px(pic, bx - pull - 1, cy + 1, "cls", 2);
  }
  if (pose === "strike") for (let x = bx + 6; x <= 31; x++) if ((x - bx) % 3 !== 0) px(pic, x, cy, "fx", 2);
  if (pose === "idle") arm("idle");
  else {
    part(pic, 15, 15 + by, ["cccccc..", "cccccccs", ".cccccss", ".......s"], { c: "cls", s: handMat }, { shade: "hcyl" });
    if (drawn) part(pic, bx - pull, cy - 1, ["ss", "ss"], { s: handMat }, { shade: "sph" });
  }
}

// ---------- 機械兵（カルバペネム系） ----------
function mech(pose, by = 0, hx = 0) {
  const pic = newPic();
  const M = { w: "mechW", d: "mechD", c: "cls" };
  const MW = { ...ramp5("mechW", "abcde"), s: ["mechD", 2] };
  // 奥の腕・肩
  part(pic, 4, 16 + by, ["dd", "ww", "ww", "ww", "dd", "dd"], M, { shade: "cyl", bias: 1 });
  part(pic, 3, 14 + by, [".cc", "ccc", "cc."], M, { shade: "sph", bias: 1 });
  // 脚
  paint(pic, 8, 23, LEG_MECH.map((r) => r.slice(0, 5)), MW, { bias: 1 });
  paint(pic, 13, 23, LEG_MECH, MW, { hi: 2 });
  // 胴
  part(
    pic,
    6,
    14 + by,
    [".wwwwwwwwwww.", "wwwwwwwwwwwww", "wwwwwwwwwwwww", "wwwwwwwwwwwww", "wwwwwwwwwwwww", ".ddddddddddd.", ".dDdDdDdDdDd.", ".wwwwwwwwwww.", "..www...www.."],
    { ...M, D: ["mechD", 1] },
    { shade: "cyl" },
  );
  // 頭
  const x0 = 6 + hx;
  const y0 = 2 + by;
  px(pic, x0 + 3, y0 - 1, "mechD", 2);
  px(pic, x0 + 3, y0 - 2, "cls", 1);
  paint(pic, x0, y0, MECH_HEAD, MECH_MAP);
  for (const yy of [6, 8]) for (let xx = 1; xx <= 3; xx++) px(pic, x0 + xx, y0 + yy, "mechW", xx === 1 ? 3 : 4); // 頭の横の通気口
  // 前の腕と光る剣
  if (pose === "idle") {
    sword(pic, 20, 20 + by, "diag", "glow");
    part(pic, 16, 16 + by, ["dd...", "dww..", ".www.", "..wdd", "...dd"], M, { shade: "cyl" });
  } else if (pose === "raise") {
    sword(pic, 21, 12 + by, "up", "glow");
    part(pic, 16, 12 + by, ["....dd", "....dd", "...ww.", "..ww..", "ddd..."], M, { shade: "cyl" });
  } else {
    smear(pic, 20, 18 + by, 12, "glow");
    sword(pic, 21, 17 + by, "fwd", "glow");
    part(pic, 16, 16 + by, ["dwwwdd", "dwwwdd"], M, { shade: "hcyl" });
  }
  // 前の肩（系統の色）
  part(pic, 14, 13 + by, [".ccccc.", "ccccccc", "ccccccc", ".ccccc."], M, { shade: "sph" });
  return toRows(finish(pic));
}

// ---------- 系統ごとの姿 ----------
const LOOKS = {
  penicillin: { armor: 0, weapon: "sword", band: true },
  "bl-bli": { armor: 0, weapon: "sword", band: true, shield: true },
  ceph1: { armor: 1, weapon: "sword" },
  cephamycin: { armor: 2, weapon: "sword" },
  ceph3: { armor: 3, weapon: "sword" },
  ceph4: { armor: 4, weapon: "sword" },
  carbapenem: { mech: true },
  aminoglycoside: { armor: 0, weapon: "hammer", apron: true },
  fluoroquinolone: { armor: 0, weapon: "bow", quiver: true },
};

const soldiers = {};
for (const [id, look] of Object.entries(LOOKS)) {
  const make = look.mech ? (pose, by, hx) => mech(pose, by, hx) : (pose, by, hx) => human(look, pose, by, hx);
  const at = look.shield ? [15, 16] : [10, 15];
  soldiers[id] = {
    idle: [make("idle", 0, 0), make("idle", 1, 0)],
    attack: [make("raise", 0, -1), make("strike", 0, 1)],
    badgeAt: {
      idle: [at, [at[0], at[1] + 1]],
      attack: [at, look.shield ? [at[0], at[1] - 1] : at],
    },
  };
}

// ---------- 細菌（左へ進む。頭が左） ----------
const seg = (xa, xb, y, n = 40, f = () => 0) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const x = xa + ((xb - xa) * i) / n;
    return [x, y + f(x)];
  });

/** 桿菌の体。左上につやの筋を入れる */
function rod(pic, xa, xb, cy, r, m = "gram", f) {
  tube(pic, seg(xa, xb, cy, f ? 24 : 1, f), r, m, { rim: true });
  const y = Math.floor(cy - r * 0.5);
  for (let x = Math.ceil(xa); x <= Math.floor(xa + (xb - xa) * 0.6); x++) {
    const c = get(pic, x, y);
    if (c && c.s <= 2 && get(pic, x, y - 1) && get(pic, x - 1, y)) put(pic, x, y, { ...c, s: x < xa + 1.5 ? 1 : 0 });
  }
}

/** べん毛：根元 (ox,oy) から向き a へ、長さ len の波打つ線。ph で波をずらす。根元は濃く、先は淡く */
function flagellum(pic, ox, oy, a, len, ph, amp = 1.1, wl = 5.5, fade = 0.55) {
  const k = (2 * Math.PI) / wl;
  const f = (t) => {
    const w = Math.sin(t * k + ph) * amp * Math.min(1, t / 2.5);
    return [ox + Math.cos(a) * t - Math.sin(a) * w, oy + Math.sin(a) * t + Math.cos(a) * w];
  };
  curve(pic, f, len * fade, len, "gram", 2, true);
  curve(pic, f, 0, len * fade, "gram", 3);
}

const bacteria = {};

// 大腸菌：ふつうの桿菌（幅20ドット＝盤面で40px）。2コマで少し伸び縮みする
bacteria.ecoli = {
  frames: [0, 1].map((f) => {
    const p = newPic(24, 12);
    rod(p, f ? 5 : 4.5, f ? 18.5 : 19.3, 6, f ? 4.8 : 4.5);
    return toRows(p);
  }),
};

// 肺炎桿菌：太めの桿菌＋半透明の莢膜（莢膜はゆっくりふくらむ）
bacteria.kpneumoniae = {
  frames: [0, 1].map((f) => {
    const p = newPic(34, 20);
    const rx = 15.6 + (f ? 0.4 : 0);
    const ry = 9 - (f ? 0.4 : 0);
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const nx = (x + 0.5 - 17) / rx;
        const ny = (y + 0.5 - 10) / ry;
        const d = Math.hypot(nx, ny);
        if (d > 1) continue;
        const edge = d > 0.88;
        const lit = nx * LV[0] + ny * LV[1] > 0.35;
        px(p, x, y, "caps", edge ? (nx + ny > 0.2 ? 4 : 3) : lit && d > 0.64 ? 0 : d > 0.74 ? 2 : 1);
      }
    rod(p, 9.5, 24.5, 10, 5, "veil");
    return toRows(p);
  }),
};

// プロテウス：桿菌＋まわりにたくさんのべん毛（2コマで波の位相が反対になる）
bacteria.pmirabilis = {
  frames: [0, 1].map((f) => {
    const p = newPic(36, 26);
    const cx = 17;
    const cy = 13;
    // 根元は体のまわり。向きは後ろ（右）へなびかせる（脚に見えないように）
    const ang = [-150, -112, -75, -38, 38, 75, 112, 150];
    ang.forEach((a0, i) => {
      const a = (a0 * Math.PI) / 180;
      const dir = (a0 * (1 - 0.4) * Math.PI) / 180;
      flagellum(p, cx + Math.cos(a) * 7.6, cy + Math.sin(a) * 4, dir, 9 + (i % 2) * 2, f * Math.PI + i * 1.3, 1.3, 7.5);
    });
    rod(p, 11.5, 22.5, cy, 4.4);
    return toRows(p);
  }),
  // 菌名が分かるまでの絵（べん毛なし。グラム染色ではべん毛は見えない）。大きさは同じにして、置き場所がずれないようにする
  bare: [0, 1].map((f) => {
    const p = newPic(36, 26);
    rod(p, f ? 11.8 : 11.5, f ? 22.2 : 22.5, 13, 4.4);
    return toRows(p);
  }),
};

// 緑膿菌：細長い桿菌＋後ろに1本の長いべん毛
bacteria.paeruginosa = {
  frames: [0, 1].map((f) => {
    const p = newPic(40, 11);
    flagellum(p, 22, 5.5, 0, 17, f * Math.PI, 2, 12.5, 0.7);
    rod(p, 4, 20, 5.5, 3.5);
    return toRows(p);
  }),
  // 菌名が分かるまでの絵（べん毛なし）
  bare: [0, 1].map((f) => {
    const p = newPic(40, 11);
    rod(p, f ? 4.3 : 4, f ? 19.7 : 20, 5.5, 3.5);
    return toRows(p);
  }),
};

// 腸球菌：少し楕円の球菌が2つずつ組になり、4個つながる（陽性＝紫）
bacteria.efaecalis = {
  frames: [0, 1].map((f) => {
    const p = newPic(38, 13);
    [5.5, 13.5, 23, 31].forEach((x, i) => {
      const y = 6.5 + ((i >> 1) === f ? -0.5 : 0.5);
      tube(p, [[x - 0.6, y], [x, y], [x + 0.6, y]], 4.3, "gram", { rim: true });
    });
    return toRows(p);
  }),
};

// ---------- エンジンの色の段を、この作風の段に置き換える ----------
function remap(s, pairs) {
  const key = (p) => p[0] * 65536 + p[1] * 256 + p[2];
  const m = new Map(pairs.map(([a, b]) => [key(hexToRgb(a)), hexToRgb(b)]));
  s.px = s.px.map((p) => (p ? m.get(key(p)) ?? p : p));
  return s;
}
const zip = (a, b) => a.map((v, i) => [v, b[i]]);

export default {
  id: "c32",
  name: "C：32ドット・ハイビット",
  note: "約2.4頭身。黒い輪郭を使わず、部分ごとの暗い色で縁どり、色相をずらした5段の陰影と金属のつやで立体を出す。盤面2倍、カードは上半身を切り抜いて2倍。",
  size: W,
  laneScale: 2,
  cardScale: 2,
  // カードは頭から胸まで（紋章・鉢巻き・兜・帽子・羽飾り・アンテナ・槌の頭・弓・盾が入る範囲）
  cardCrop: { x: 5, y: 1, w: 20, h: 20 },
  outline: false,
  bugOutline: false,
  palette: PALETTE,
  soldiers,
  badge: [".kkk.", "kwwwk", "kpqrk", "kwwwk", ".kkk."],
  badgePalette: { k: "#b9aacd", w: "#ffffff", p: "@g1", q: "@g2", r: "@g3" },
  oralBase: { x: 1, y: 27, rows: CAPSULE, palette: { w: "#f6f1f9", k: "#ffffff", x: "#ddd3e6", v: "#a99bbf", P: "@c0", Q: "@c1", R: "@c2", S: "@c3", T: "@c4" } },
  bacteria,
  post: (s, drug, ctx) => remap(s, zip(ctx.classRamp, myRamp(ctx.classRamp[2]))),
  postBug: (s, bug, ctx) => {
    const g = myRamp(ctx.gramRamp[2]);
    const capsMid = mix("#ffffff", g[1], 0.18);
    const caps = ["#ffffff", mix("#ffffff", g[1], 0.1), capsMid, mix("#ffffff", g[2], 0.42), mix("#ffffff", g[3], 0.55)];
    const veil = g.map((c) => mix(c, capsMid, 0.28));
    return remap(s, [...zip(ctx.gramRamp, g), ...zip(RAMPS.veil, veil), ...zip(RAMPS.caps, caps)]);
  },
};
