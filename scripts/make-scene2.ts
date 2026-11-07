// シーン2の動く絵（第7版、2026-11-06 作者の依頼「ゲームの細菌や抗菌薬の絵で、細菌が何年もかけて耐性を獲得していく姿をアニメーションに」）。
// 「抗菌薬を、正しく使う」の大きな字 →「でも」で盤面：抗菌薬の兵士が薬を使うたびに、効く細菌は倒れ、盾の印の効かない細菌だけが残って
// 分かれて増える。年が進む（いま → 5年後 → 10年後 → … → 何年も先）につれ、効かない細菌の割合が上がる。
// 絵はゲームのドット絵（src/game/pixel：大腸菌・セフトリアキソンの兵士・盾・斬撃・床・粘膜）をそのまま使う（scripts/lib/pixel-art.ts）。外の画像は使わない。
// 誰が倒れ、誰から生まれるかは乱数の種を固定して決め、毎回同じ動きにする（scripts/make-hook-chart.ts と同じく、1コマずつ Chrome で描いて ffmpeg でつなぐ）。
//   npx tsx scripts/make-scene2.ts [--dur 13] [--out recordings/scene2]
//   → recordings/scene2/scene2.mp4（1920×1080・30fps。絵だけで音はなし）と、最後の場面の静止画 scene2-last.png
//   npx tsx scripts/make-scene2.ts --at 1,4.8,7.5 → その時刻のコマだけ at-<秒>.png に書き出す（見た目を確かめるとき。動画は作らない）
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createRng } from "../src/engine/index.ts";
import { openChrome, sleep } from "./lib/chrome.ts";
import { bugFlashUrl, bugUrl, classColor, floorUrl, iconUrl, membraneUrl, shotUrl, soldierUrl } from "./lib/pixel-art.ts";

const { values } = parseArgs({ options: { dur: { type: "string", default: "13" }, out: { type: "string", default: "recordings/scene2" }, at: { type: "string" } } });
const W = 1920;
const H = 1080;
const FPS = 30;
const DUR = Number(values.dur);
const OUT = values.out!;
const FRAMES = join(OUT, "frames");
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

// ---------- 時刻（秒。シーンの頭から） ----------
// ナレーション「要は、抗菌薬を正しく使うこと。」（0.3〜約3.5秒）→「でも、」（4.0秒。scripts/lib/video-cues.ts の ANCHORS）
const T_BOARD = 3.9; // 盤面が下から出てくる
const T0 = 4.6; // 1回目に薬を使う
const CYC = 1.2; // 1年（薬を使う → 倒れる → 増える）
const CYCLES = 5; // 何年ぶん見せるか（5年目の印は「何年も先」）
const WAVE = 0.42; // 薬の波が盤面の左端から右端まで通る秒
const FLASH = 0.09; // 当たった細菌が白く光る秒
const FALL = 0.38; // 倒れる秒
const BIRTH_AT = 0.56; // 波のあと、増え始めるまで
const BIRTH_GAP = 0.022; // 生まれる間隔
const BIRTH_LEN = 0.32; // 親から自分の場所へ動く秒
const BLOCK = 0.32; // 盾が光る秒
const STAT_AT = 1.05; // 右の数字が変わる（増え終わったあと）
const T_END = T0 + CYCLES * CYC + 0.15; // 最後の場面（「効かない細菌が増える」）

// ---------- 細菌の並びと、誰が倒れ誰から生まれるか（乱数の種を固定） ----------
const COLS = 7;
const ROWS = 4;
const N = COLS * ROWS;
const START_RESISTANT = 2; // はじめにいる効かない細菌
const KILL = 0.6; // 薬を使うたびに倒れる、効く細菌の割合
/** 年ごとの効かない細菌の数の目標（この並びにいちばん近い種を選ぶ） */
const TARGET = [2, 4, 8, 13, 19, 24];

interface Bug {
  id: number;
  slot: number;
  resistant: boolean;
  /** 生まれた年（0 ははじめからいる） */
  born: number;
  parent: number | null;
  /** 同じ年に生まれる中での順（親に近い場所から） */
  order: number;
  /** 倒れた年（null は生きている） */
  died: number | null;
}
const colOf = (slot: number) => slot % COLS;
const rowOf = (slot: number) => Math.floor(slot / COLS);
const dist = (a: number, b: number) => Math.hypot(colOf(a) - colOf(b), rowOf(a) - rowOf(b));

function simulate(seed: number): { bugs: Bug[]; counts: number[] } {
  const rng = createRng(seed);
  // はじめの効かない細菌は、互いに離して置く（見て分かるように）
  const res: number[] = [];
  for (let tries = 0; res.length < START_RESISTANT && tries < 1000; tries++) {
    const s = rng.int(N);
    if (res.every((r) => dist(r, s) >= 3)) res.push(s);
  }
  const bugs: Bug[] = Array.from({ length: N }, (_, slot) => ({ id: slot, slot, resistant: res.includes(slot), born: 0, parent: null, order: 0, died: null }));
  const counts = [res.length];
  for (let year = 1; year <= CYCLES; year++) {
    const alive = bugs.filter((b) => b.died === null);
    const sus = alive.filter((b) => !b.resistant);
    // 効く細菌のうち KILL の割合が倒れる（どれが倒れるかは乱数）
    const order = sus.map((b) => ({ b, r: rng.next() })).sort((a, b) => a.r - b.r);
    const killed = order.slice(0, Math.round(sus.length * KILL)).map((x) => x.b);
    for (const b of killed) b.died = year;
    const survivors = alive.filter((b) => b.died === null);
    // 空いた場所は、近くの生き残りが分かれて埋める（近いほど親になりやすい。子は親と同じく効かない／効く）
    const kids = killed.map((k) => {
      const weights = survivors.map((s) => 1 / (1 + dist(s.slot, k.slot) ** 2));
      const parent = rng.weighted(survivors, weights);
      return { slot: k.slot, parent, d: dist(parent.slot, k.slot), tie: rng.next() };
    });
    kids.sort((a, b) => a.d - b.d || a.tie - b.tie);
    kids.forEach((k, i) => bugs.push({ id: bugs.length, slot: k.slot, resistant: k.parent.resistant, born: year, parent: k.parent.id, order: i, died: null }));
    counts.push(bugs.filter((b) => b.died === null && b.resistant).length);
  }
  return { bugs, counts };
}
let best: { seed: number; score: number; bugs: Bug[]; counts: number[] } | null = null;
for (let seed = 1; seed <= 4000; seed++) {
  const r = simulate(seed);
  const score = r.counts.reduce((a, c, i) => a + Math.abs(c - (TARGET[i] ?? c)), 0);
  if (!best || score < best.score) best = { seed, score, ...r };
}
const { bugs, counts, seed } = best!;
console.log(`乱数の種 ${seed}：効かない細菌 ${counts.join(" → ")}（${N} のうち）`);

// ---------- 置き場所（px） ----------
const BOARD = { x: 140, y: 190, w: 1640, h: 520 };
const SOLDIER = { x: 140, w: 260 };
const FIELD = { x: 420, y: 190, w: 940, h: 520, pad: 28 };
const STAT = { x: 1380, y: 190, w: 400, h: 520 };
const TL = { x: 420, y: 800, w: 940 };
const Z_BUG = 4;
const Z_SOLDIER = 5;
const SPECIES = "ecoli";
const DRUG = "CTRX"; // 兵士は「抗菌薬」とだけ書く（「はじめての人へ」の段5と同じ）
const posRng = createRng(seed + 100);
const POS = Array.from({ length: N }, (_, slot) => {
  const cw = FIELD.w / COLS;
  const ch = (FIELD.h - FIELD.pad * 2) / ROWS;
  return {
    x: Math.round(FIELD.x + (colOf(slot) + 0.5) * cw + (posRng.next() - 0.5) * 24),
    y: Math.round(FIELD.y + FIELD.pad + (rowOf(slot) + 0.5) * ch + (posRng.next() - 0.5) * 30),
  };
});

// ---------- 絵 ----------
const bug0 = bugUrl(SPECIES, 0, Z_BUG);
const bug1 = bugUrl(SPECIES, 1, Z_BUG);
const flash = bugFlashUrl(SPECIES, 0, Z_BUG);
const shield = iconUrl("shield", 4); // 盾の印（14ドット → 56px。細菌と同じ高さ。小さい画面でも分かるように）
const up = iconUrl("up", 3);
const soldier = { idle0: soldierUrl(DRUG, "idle0", Z_SOLDIER), idle1: soldierUrl(DRUG, "idle1", Z_SOLDIER), attack0: soldierUrl(DRUG, "attack0", Z_SOLDIER), attack1: soldierUrl(DRUG, "attack1", Z_SOLDIER) };
const shot = shotUrl(DRUG, 4);
const floor = floorUrl(3);
const membrane = membraneUrl(3);
const DRUG_COLOR = classColor(DRUG);

const fontData = (f: string) => readFileSync(join("node_modules/@fontsource/dotgothic16/files", f)).toString("base64");
const FONT_CSS = `@font-face{font-family:"DG-la";src:url(data:font/woff2;base64,${fontData("dotgothic16-latin-400-normal.woff2")}) format("woff2")}
@font-face{font-family:"DG-ja";src:url(data:font/woff2;base64,${fontData("dotgothic16-japanese-400-normal.woff2")}) format("woff2")}`;
const DOT = `"DG-la","DG-ja","Hiragino Sans","Hiragino Kaku Gothic ProN",sans-serif`;
const img = (u: { url: string; w: number; h: number }, cls: string) => `<img class="${cls}" src="${u.url}" width="${u.w}" height="${u.h}" alt="">`;

const bugHtml = (b: Bug) =>
  `<div class="bug${b.resistant ? " res" : ""}" id="b${b.id}">${img(bug0, "f f0")}${img(bug1, "f f1")}${img(flash, "f fl")}${b.resistant ? `<span class="sh">${img(shield, "")}</span>` : ""}</div>`;

const page = `<!doctype html><meta charset="utf-8"><style>${FONT_CSS}
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;color:#f4ecf7;font-family:${DOT}}
body{background:radial-gradient(ellipse at 75% 10%,rgba(143,125,255,.16),transparent 55%),radial-gradient(ellipse at 10% 90%,rgba(59,224,198,.08),transparent 50%),#0b0812}
body::before{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(148,112,232,.10) 1.4px,transparent 1.6px);background-size:24px 24px}
img{image-rendering:pixelated;display:block}
.k{position:absolute;left:140px;top:110px;font-size:38px;color:#3be0c6;letter-spacing:.08em;white-space:nowrap}
.one{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;font-size:110px;color:#fff;letter-spacing:.06em;text-shadow:0 6px 30px rgba(59,224,198,.35)}
.board{position:absolute;left:${BOARD.x}px;top:${BOARD.y}px;width:${BOARD.w}px;height:${BOARD.h}px}
.sold{position:absolute;left:0;top:0;width:${SOLDIER.w}px;height:${BOARD.h}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}
.sold img{display:none}.sold img.on{display:block}
.tag{font-size:30px;padding:4px 16px 6px;background:rgba(11,8,18,.85);box-shadow:inset 0 0 0 3px #4a3a6a;letter-spacing:.06em}
.field{position:absolute;left:${FIELD.x - BOARD.x}px;top:0;width:${FIELD.w}px;height:${FIELD.h}px;overflow:hidden;background:url(${floor.url}) repeat,linear-gradient(#1a1430,#120d22);box-shadow:inset 0 0 0 3px #33274f}
.mem{position:absolute;left:0;right:0;height:${membrane.h}px;background:url(${membrane.url}) repeat-x}
.mem.t{top:2px}.mem.b{bottom:2px;transform:scaleY(-1)}
.wave{position:absolute;top:0;bottom:0;width:90px;background:linear-gradient(90deg,transparent,${DRUG_COLOR}99 45%,#fff8 60%,transparent);display:none}
.shot{position:absolute;display:none}
.bug{position:absolute;left:0;top:0;width:${bug0.w}px;height:${bug0.h}px;display:none;transform-origin:50% 50%}
.bug .f{position:absolute;left:0;top:0;display:none}.bug .f.on{display:block}
.bug.res .f0,.bug.res .f1{filter:drop-shadow(0 0 3px #ff6352) drop-shadow(0 0 2px #ff6352)}
.bug .sh{position:absolute;right:-18px;top:-26px;transform-origin:50% 50%}
.stat{position:absolute;left:${STAT.x - BOARD.x}px;top:0;width:${STAT.w}px;height:${STAT.h}px;box-sizing:border-box;padding:28px 30px;background:rgba(14,9,22,.92);box-shadow:inset 8px 0 0 #ffb347;display:flex;flex-direction:column}
.stat h2{margin:0;font-size:28px;color:#ffb347;line-height:1.3;letter-spacing:.04em;min-height:74px}
.stat .num{display:flex;align-items:center;gap:16px;margin:10px 0 8px}
.stat .v{font-size:112px;line-height:1;color:#fff;letter-spacing:.02em}
.stat .up{opacity:0}
.stat.end{box-shadow:inset 8px 0 0 #ff6352}.stat.end h2{color:#ff8a7a}.stat.end .v{color:#ff6352}
.meter{display:flex;gap:4px;margin:6px 0 0}
.meter i{display:block;width:14px;height:34px;background:#2a2238}.meter i.on{background:#ff6352}
.legend{margin-top:auto;display:flex;align-items:center;gap:10px;font-size:22px;color:#a493b6;line-height:1.3}
.tl{position:absolute;left:${TL.x}px;top:${TL.y}px;width:${TL.w}px;height:0}
.track{position:absolute;left:0;right:0;top:-3px;height:6px;background:#33274f}
.fill{position:absolute;left:0;top:-3px;height:6px;background:#3be0c6;box-shadow:0 0 10px #3be0c6}
.tick{position:absolute;top:-9px;width:18px;height:18px;margin-left:-9px;background:#2a2238;box-shadow:inset 0 0 0 3px #4a3a6a}
.tick.on{background:#3be0c6;box-shadow:none}
.mark{position:absolute;top:-14px;width:28px;height:28px;margin-left:-14px;background:#fff;box-shadow:0 0 0 4px #3be0c6,0 0 18px #3be0c6}
.ylab{position:absolute;top:-62px;transform:translateX(-50%);font-size:34px;color:#fff;white-space:nowrap}
.now{position:absolute;left:0;top:22px;font-size:30px;color:#3be0c6}
.later{position:absolute;right:0;top:22px;font-size:30px;color:#ff8a7a;transform-origin:100% 0;white-space:nowrap}
.later.on{color:#ff6352;text-shadow:0 0 18px #ff6352;transform:scale(1.25)}
</style>
<p class="k" id="kick"></p>
<p class="one" id="one">抗菌薬を、正しく使う</p>
<div class="board" id="board">
  <div class="sold">${Object.entries(soldier)
    .map(([k, u]) => img(u, `s-${k}`))
    .join("")}<span class="tag">抗菌薬</span></div>
  <div class="field"><div class="mem t"></div><div class="mem b"></div>
    ${bugs.map(bugHtml).join("")}
    <div class="wave" id="wave"></div>
    ${[0, 1, 2].map((i) => img(shot, `shot shot${i}`)).join("")}
  </div>
  <div class="stat" id="stat"><h2 id="sh">薬が効かない細菌</h2><div class="num"><span class="v" id="sv">0%</span>${img(up, "up")}</div>
    <div class="meter" id="meter">${"<i></i>".repeat(20)}</div>
    <p class="legend">${img(iconUrl("shield", 3), "")}<span>盾の印＝薬が効かない細菌</span></p></div>
</div>
<div class="tl" id="tl"><div class="track"></div><div class="fill" id="fill"></div>
  ${Array.from({ length: CYCLES + 1 }, (_, i) => `<div class="tick" id="tick${i}" style="left:${(i / CYCLES) * 100}%"></div>`).join("")}
  <div class="mark" id="mark"></div><div class="ylab" id="ylab"></div>
  <span class="now">いま</span><span class="later" id="later">何年も先</span>
</div>
<script>
const BUGS = ${JSON.stringify(bugs)};
const POS = ${JSON.stringify(POS)};
const COUNTS = ${JSON.stringify(counts)};
const N = ${N}, CYCLES = ${CYCLES}, CYC = ${CYC}, T0 = ${T0}, T_BOARD = ${T_BOARD}, T_END = ${T_END};
const WAVE = ${WAVE}, FLASH = ${FLASH}, FALL = ${FALL}, BIRTH_AT = ${BIRTH_AT}, BIRTH_GAP = ${BIRTH_GAP}, BIRTH_LEN = ${BIRTH_LEN}, BLOCK = ${BLOCK}, STAT_AT = ${STAT_AT};
const FIELD = ${JSON.stringify(FIELD)}, TL = ${JSON.stringify(TL)}, BOARD = ${JSON.stringify(BOARD)};
const BW = ${bug0.w}, BH = ${bug0.h}, SHOT_W = ${shot.w};
const clamp = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const $ = (id) => document.getElementById(id);
const els = BUGS.map((b) => $("b" + b.id));
const cycleOf = (t) => (t < T0 ? -1 : Math.min(CYCLES - 1, Math.floor((t - T0) / CYC)));
// 年 c の波が、x の細菌に届く時刻
const hitAt = (c, x) => T0 + c * CYC + WAVE * ((x - FIELD.x) / FIELD.w);

function bugState(b, t) {
  const p0 = POS[b.slot];
  const s = { x: p0.x, y: p0.y, frame: Math.floor(t * 3.2 + b.id * 0.73) % 2, scale: 1, rot: 0, op: 1, gray: 0, flash: false, dx: 0, dy: Math.sin(t * 2.6 + b.id * 1.1) * 2, shield: 1 };
  if (b.born > 0) {
    const tb = T0 + (b.born - 1) * CYC + BIRTH_AT + b.order * BIRTH_GAP;
    if (t < tb) return null;
    const p = (t - tb) / BIRTH_LEN;
    if (p < 1) {
      const e = ease(p);
      const par = POS[BUGS[b.parent].slot];
      s.x = par.x + (p0.x - par.x) * e;
      s.y = par.y + (p0.y - par.y) * e;
      s.scale = 0.25 + 0.75 * e + 0.18 * Math.sin(Math.PI * p);
    }
  }
  if (b.died !== null) {
    const q = t - hitAt(b.died - 1, p0.x);
    if (q >= 0) {
      if (q < FLASH) {
        s.flash = true;
        s.scale *= 1.18;
      } else if (q < FLASH + FALL) {
        const p = (q - FLASH) / FALL;
        s.dy += p * 64;
        s.rot = p * 85;
        s.scale *= 1 - 0.35 * p;
        s.op = 1 - p * p;
        s.gray = p;
      } else return null;
    }
  }
  if (b.resistant) {
    const c = cycleOf(t);
    if (c >= b.born) {
      const q = t - hitAt(c, p0.x);
      if (q >= 0 && q < BLOCK) {
        s.shield = 1 + 0.9 * Math.sin((Math.PI * q) / BLOCK);
        s.dx = Math.sin(q * 70) * 4 * (1 - q / BLOCK);
      }
    }
  }
  return s;
}

window.render = (t) => {
  // 大きな字 →「でも」で盤面
  const a = 1 - clamp((t - 3.7) / 0.4);
  $("one").style.opacity = String(a);
  $("one").style.display = a > 0 ? "block" : "none";
  $("one").style.transform = "translateY(-50%) scale(" + (0.94 + 0.06 * a) + ")";
  const kick = $("kick");
  kick.textContent = t < T_BOARD ? "耐性を広げないために、欠かせないこと" : "でも";
  kick.style.opacity = String(t < T_BOARD ? 1 - clamp((t - 3.6) / 0.3) : ease((t - T_BOARD) / 0.3));
  const bp = ease((t - T_BOARD) / 0.6);
  for (const id of ["board", "tl"]) {
    $(id).style.opacity = String(bp);
    $(id).style.transform = "translateY(" + (1 - bp) * 50 + "px)";
  }
  const c = cycleOf(t);
  const tau = c < 0 ? -1 : t - (T0 + c * CYC);
  // 兵士：波の間は攻撃のコマ、ほかは待機の2コマ
  const pose = tau >= 0 && tau < 0.5 ? (tau < 0.1 ? "attack0" : "attack1") : Math.floor(t * 2.8) % 2 ? "idle1" : "idle0";
  for (const k of ["idle0", "idle1", "attack0", "attack1"]) document.querySelector(".s-" + k).classList.toggle("on", k === pose);
  // 薬の波と斬撃
  const wave = $("wave");
  if (tau >= 0 && tau < WAVE) {
    wave.style.display = "block";
    wave.style.left = (FIELD.w * (tau / WAVE) - 45) + "px";
  } else wave.style.display = "none";
  [0, 1, 2].forEach((i) => {
    const el = document.querySelector(".shot" + i);
    const tl = 0.02 + i * 0.05;
    const p = (tau - tl) / (WAVE + 0.02);
    if (tau >= 0 && p >= 0 && p <= 1) {
      el.style.display = "block";
      el.style.left = (-SHOT_W + (FIELD.w + SHOT_W) * p) + "px";
      el.style.top = (FIELD.h * (0.2 + 0.28 * i) - 28) + "px";
    } else el.style.display = "none";
  });
  // 細菌
  BUGS.forEach((b, i) => {
    const el = els[i];
    const s = bugState(b, t);
    if (!s) {
      el.style.display = "none";
      return;
    }
    el.style.display = "block";
    el.style.transform = "translate(" + (s.x - FIELD.x - BW / 2 + s.dx) + "px," + (s.y - FIELD.y - BH / 2 + s.dy) + "px) rotate(" + s.rot + "deg) scale(" + s.scale + ")";
    el.style.opacity = String(s.op);
    el.style.filter = s.gray > 0 ? "grayscale(" + s.gray + ") brightness(" + (1 - 0.5 * s.gray) + ")" : "";
    el.querySelector(".f0").classList.toggle("on", !s.flash && s.frame === 0);
    el.querySelector(".f1").classList.toggle("on", !s.flash && s.frame === 1);
    el.querySelector(".fl").classList.toggle("on", s.flash);
    const sh = el.querySelector(".sh");
    if (sh) sh.style.transform = "scale(" + s.shield + ")";
  });
  // 右の数字：増え終わったあとに変わる
  let v = COUNTS[0] / N;
  for (let k = 0; k < CYCLES; k++) {
    const tc = T0 + k * CYC + STAT_AT;
    if (t >= tc) v = COUNTS[k] / N + (COUNTS[k + 1] / N - COUNTS[k] / N) * ease((t - tc) / 0.25);
  }
  $("sv").textContent = Math.round(v * 100) + "%";
  document.querySelectorAll("#meter i").forEach((el, i) => el.classList.toggle("on", i < Math.round(v * 20)));
  document.querySelector(".stat .up").style.opacity = String(v > COUNTS[0] / N + 0.01 ? 1 : 0);
  const end = t >= T_END;
  $("stat").classList.toggle("end", end);
  $("sh").textContent = end ? "効かない細菌が増える" : "薬が効かない細菌";
  // 年表：波とともに印が次の年へ進む
  const tick = (i) => (TL.w * i) / CYCLES;
  const mx = c < 0 ? 0 : tick(c) + (tick(c + 1) - tick(c)) * ease(tau / 0.5);
  $("mark").style.left = mx + "px";
  $("fill").style.width = mx + "px";
  const yi = c < 0 ? 0 : tau >= 0.25 ? c + 1 : c;
  for (let i = 0; i <= CYCLES; i++) $("tick" + i).classList.toggle("on", tick(i) <= mx + 1);
  const ylab = $("ylab");
  ylab.style.left = mx + "px";
  ylab.textContent = yi > 0 && yi < CYCLES ? yi * 5 + "年後" : ""; // 「いま」と「何年も先」は年表の両端に書いてある。第8版の続き：1年刻みから5年刻みに（作者の指摘：もっと先だと伝わるように）
  $("later").classList.toggle("on", yi >= CYCLES);
};
window.render(0);
</script>`;

const htmlFile = resolve(join(OUT, "scene2.html"));
writeFileSync(htmlFile, page);
const { page: p, close } = await openChrome({ width: W, height: H });
try {
  await p.send("Page.navigate", { url: `file://${htmlFile}` });
  await sleep(800);
  await p.eval("document.fonts.ready.then(() => true)");
  if (values.at) {
    for (const t of values.at.split(",").map(Number)) {
      await p.eval(`window.render(${t})`);
      writeFileSync(join(OUT, `at-${t}.png`), await p.png(false));
    }
    console.log(`→ ${OUT}/at-*.png（${values.at} 秒のコマ）`);
    process.exit(0);
  }
  const n = Math.round(DUR * FPS);
  for (let i = 0; i < n; i++) {
    await p.eval(`window.render(${(i / FPS).toFixed(4)})`);
    writeFileSync(join(FRAMES, `f${String(i).padStart(4, "0")}.png`), await p.png(false));
  }
  await p.eval(`window.render(${DUR})`);
  writeFileSync(join(OUT, "scene2-last.png"), await p.png(false));
} finally {
  close();
}
execFileSync("ffmpeg", ["-y", "-v", "error", "-framerate", String(FPS), "-i", join(FRAMES, "f%04d.png"), "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(FPS), join(OUT, "scene2.mp4")], { stdio: "inherit" });
rmSync(FRAMES, { recursive: true, force: true });
console.log(`→ ${join(OUT, "scene2.mp4")}（${DUR} 秒）と scene2-last.png`);
