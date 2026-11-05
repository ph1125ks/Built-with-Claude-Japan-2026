// デモ動画の BGM を、外部の音源を使わずにすべてコードで合成する（ファミコン風の音色）。
// ハッカソンの決まりで、動画には期間中にこのリポジトリで作ったものだけを使う。サンプルや素材は読み込まず、波形を1サンプルずつ計算する。
// 音色：リードは矩形波（デューティ比 12.5／25／50%。PolyBLEP で折り返しを抑え、5〜6 kHz から上を軽く落とす）、
//       ベースは三角波（16段の階段状にして、ファミコンの三角波に似せる）、ドラムはノイズ（キック・スネア・ハイハット）。
// 曲：BPM 120・4/4（1小節＝2秒）。調はニ短調と、その平行調のヘ長調だけを使い、区間が変わっても1曲に聞こえるようにする。
//     区間（mood）ごとに、楽器の組み合わせ・刻み・和音の進行を変える。区間の頭を小節の頭にして始め、
//     終わりは小節の途中でもそのまま切ってフェードする（区間の終わりより後には新しい音を置かず、鳴っている音だけを --xfade 秒で消す）。
//     次の区間は、頭にアクセント（hits）があればすぐに、なければ少しずつ入る。
//     hits の時刻には、シンバル風のノイズと低音の短いアクセントを入れる。
// 音量：全体を -18 LUFS（ITU-R BS.1770 の積分ラウドネス）に合わせ、先読みのリミッタでピークを --peak dBFS より下に収める。
//       ナレーションに合わせて下げる処理（ダッキング）と最終の音量合わせは、動画を組み立てる側（scripts/make-draft-video.ts）でやる。
// 書き出し：48 kHz・16 bit・ステレオの WAV。乱数の種は固定なので、同じ cue からは毎回同じ音ができる。
//   npx tsx scripts/make-bgm.ts --cues recordings/bgm/cues.sample.json --out recordings/bgm/bgm.wav [--lufs -18] [--peak -1] [--xfade 0.75]
// cue（JSON）の形：
//   { "total": 179.5, "sections": [{ "from": 0, "to": 12.5, "mood": "hook" }, ...], "hits": [12.5] }
//   mood：hook（冒頭・不穏な持続音と鼓動）／play（遊び方・明るい）／tension（2050年で負ける・短調で押し寄せる）／
//         hope（守り切る・長調へ持ち上がる）／build（Claude が設計・検証する・考えるアルペジオ）／outro（締め・主音で終わる）
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    cues: { type: "string" },
    out: { type: "string", default: "recordings/bgm/bgm.wav" },
    lufs: { type: "string", default: "-18" },
    peak: { type: "string", default: "-1" },
    xfade: { type: "string", default: "0.75" },
  },
});
if (!values.cues) {
  console.error("使い方：npx tsx scripts/make-bgm.ts --cues <cues.json> [--out recordings/bgm/bgm.wav] [--lufs -18] [--peak -1] [--xfade 0.75]");
  process.exit(1);
}

const SR = 48000;
const BPM = 120;
const STEP = 60 / BPM / 4; // 16分音符（0.125 秒）
const BAR = STEP * 16; // 1小節（2 秒）
const TARGET_LUFS = Number(values.lufs);
const PEAK_DB = Number(values.peak);
const XF = Number(values.xfade);

// ---------- cue を読む ----------

const MOODS = ["hook", "play", "tension", "hope", "build", "outro"] as const;
type Mood = (typeof MOODS)[number];
interface Section {
  from: number;
  to: number;
  mood: Mood;
}
interface Cues {
  total: number;
  sections: Section[];
  hits: number[];
}

function readCues(file: string): Cues {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { total?: unknown; sections?: { from?: unknown; to?: unknown; mood?: unknown }[]; hits?: unknown[] };
  const total = Number(raw.total);
  if (!(total > 0)) throw new Error(`${file}：total（曲の長さ・秒）がない`);
  const sections = (raw.sections ?? [])
    .map((s, i) => {
      const mood = s.mood as Mood;
      if (!MOODS.includes(mood)) throw new Error(`${file}：sections[${i}] の mood「${String(s.mood)}」は使えない（${MOODS.join("・")}）`);
      const from = Math.max(0, Number(s.from));
      const to = Math.min(total, Number(s.to));
      if (!(to > from)) throw new Error(`${file}：sections[${i}] の from（${String(s.from)}）が to（${String(s.to)}）より前になっていない`);
      return { from, to, mood };
    })
    .sort((a, b) => a.from - b.from);
  if (!sections.length) throw new Error(`${file}：sections が空`);
  const hits = (raw.hits ?? [])
    .map(Number)
    .filter((t) => t >= 0 && t < total)
    .sort((a, b) => a - b);
  return { total, sections, hits };
}

// ---------- 音の高さ・旋律の書き方 ----------

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 音名（"D2"・"Bb4"・"C#6"）を MIDI の番号にする */
function midi(name: string): number {
  const m = name.match(/^([A-G])(#|b)?(-?\d)$/);
  if (!m) throw new Error(`音名が読めない：${name}`);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]!]! + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

interface Mel {
  step: number; // 旋律の頭から何個目の16分音符か
  len: number; // 16分音符いくつ分か
  note: number;
}
/** 旋律を「音名:長さ（16分音符の数）」で書いたものを読む（r は休み）。小節の数と長さが合わなければ止める */
function mel(text: string, bars: number): Mel[] {
  const out: Mel[] = [];
  let step = 0;
  for (const tok of text.trim().split(/\s+/)) {
    const [name, len] = tok.split(":");
    const n = Number(len);
    if (!name || !(n > 0)) throw new Error(`旋律の書き方がおかしい：${tok}`);
    if (name !== "r") out.push({ step, len: n, note: midi(name) });
    step += n;
  }
  if (step !== bars * 16) throw new Error(`旋律の長さが ${bars} 小節（${bars * 16}）でなく ${step}：${text.slice(0, 40)}…`);
  return out;
}

// 和音：ベースの根音（低い音）と、分散和音に使う音（4 オクターブ目のあたりで、つながりよく並べる）
const ROOT: Record<string, number> = {
  Dm: midi("D2"),
  F: midi("F2"),
  Gm: midi("G2"),
  Am: midi("A2"),
  A: midi("A2"),
  Bb: midi("Bb1"),
  C: midi("C2"),
};
const TRIAD: Record<string, number[]> = {
  Dm: ["D4", "F4", "A4"].map(midi),
  F: ["F4", "A4", "C5"].map(midi),
  Gm: ["D4", "G4", "Bb4"].map(midi),
  Am: ["E4", "A4", "C5"].map(midi),
  A: ["E4", "A4", "C#5"].map(midi),
  Bb: ["D4", "F4", "Bb4"].map(midi),
  C: ["E4", "G4", "C5"].map(midi),
};
// build で使う、4つの音の和音（9度・7度を足して、考えている感じの響きにする）
const COLOR: Record<string, { root: string; tones: number[] }> = {
  Dm9: { root: "Dm", tones: ["D4", "F4", "A4", "E5"].map(midi) },
  Bbmaj7: { root: "Bb", tones: ["Bb3", "D4", "F4", "A4"].map(midi) },
  Fmaj7: { root: "F", tones: ["C4", "F4", "A4", "E5"].map(midi) },
  Cadd9: { root: "C", tones: ["C4", "E4", "G4", "D5"].map(midi) },
  Gm7: { root: "Gm", tones: ["D4", "F4", "G4", "Bb4"].map(midi) },
  A7: { root: "A", tones: ["E4", "G4", "A4", "C#5"].map(midi) },
};

// ---------- 乱数（種を固定して、毎回同じ音にする） ----------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand01 = mulberry32(20261105);
/** -1〜1 の白いノイズ */
const white = () => rand01() * 2 - 1;

/** ファミコンのノイズ（15 ビットの LFSR を clock Hz で進め、出力を次の刻みまで保つ）。スネアに使う */
class Lfsr {
  private reg = 1;
  private acc = 0;
  constructor(private readonly clock: number) {}
  next(): number {
    this.acc += this.clock / SR;
    while (this.acc >= 1) {
      this.acc -= 1;
      const fb = (this.reg ^ (this.reg >> 1)) & 1;
      this.reg = (this.reg >> 1) | (fb << 14);
    }
    return this.reg & 1 ? 1 : -1;
  }
}

// ---------- 音の入れ物 ----------

/** 左右の音。start は曲の頭から何サンプル目から始まるか */
class Stereo {
  readonly L: Float32Array;
  readonly R: Float32Array;
  constructor(
    readonly start: number,
    readonly length: number,
  ) {
    this.L = new Float32Array(length);
    this.R = new Float32Array(length);
  }
}
/** 左右の振り分け（-1 が左、1 が右。真ん中で両方 0.707） */
const panGains = (p: number): [number, number] => [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)];

// ---------- 音色 ----------

interface Env {
  a: number; // 立ち上がり（秒）
  d: number; // 減衰して s になるまで（秒）
  s: number; // 押している間の大きさ
  r: number; // 離してから消えるまで（秒）
  tau?: number; // 押している間も、この時定数で減衰させる（はじく音・鐘の音）
}
interface Voice {
  wave: "pulse" | "tri";
  duty?: number; // 矩形波のデューティ比（0.125・0.25・0.5）
  vel: number;
  pan?: number;
  env: Env;
  vib?: { rate: number; depth: number; delay: number }; // ビブラート（depth は周波数の比）
  trem?: { rate: number; depth: number }; // 音量のゆれ
  send?: number; // やまびこ（ディレイ）へ送る量
  steps16?: boolean; // 三角波を16段の階段にする（ファミコンの三角波の音）
}

function envLevel(e: Env, t: number, dur: number): number {
  const held = (x: number) => {
    if (x < e.a) return x / e.a;
    const y = x - e.a;
    const v = y < e.d ? 1 - (1 - e.s) * (y / e.d) : e.s;
    return e.tau ? v * Math.exp(-y / e.tau) : v;
  };
  if (t < dur) return held(t);
  const k = 1 - (t - dur) / e.r;
  return k > 0 ? held(dur) * k : 0;
}

/** 帯域制限した矩形波のための補正（PolyBLEP）。角を少し丸めて、高い倍音の折り返しを抑える */
function blep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** 音を1つ書く（t0 秒から dur 秒押して離す） */
function writeTone(out: Stereo, send: Float32Array | null, t0: number, dur: number, note: number, v: Voice): void {
  const f0 = hz(note);
  const i0 = Math.round(t0 * SR) - out.start;
  const n = Math.ceil((dur + v.env.r) * SR);
  const [gl, gr] = panGains(v.pan ?? 0);
  const duty = v.duty ?? 0.5;
  const dc = 2 * duty - 1; // 矩形波の直流分（引いて、平均を 0 にする）
  const { L, R } = out;
  // 三角波は 0 を通るところから始める（始まりの「プツッ」を防ぐ）
  let ph = v.wave === "tri" ? 0.75 : 0;
  for (let k = 0; k < n; k++) {
    const i = i0 + k;
    if (i >= out.length) break;
    const t = k / SR;
    let f = f0;
    if (v.vib && t > v.vib.delay) {
      const u = t - v.vib.delay;
      f *= 1 + v.vib.depth * Math.min(1, u / 0.4) * Math.sin(2 * Math.PI * v.vib.rate * u);
    }
    const dt = f / SR;
    if (i >= 0) {
      let y: number;
      if (v.wave === "pulse") y = (ph < duty ? 1 : -1) + blep(ph, dt) - blep((ph - duty + 1) % 1, dt) - dc;
      else {
        const tri = 4 * Math.abs(ph - 0.5) - 1;
        y = v.steps16 ? Math.round(tri * 7.5 + 7.5) / 7.5 - 1 : tri;
      }
      let a = envLevel(v.env, t, dur) * v.vel;
      if (v.trem) a *= 1 - v.trem.depth * (0.5 - 0.5 * Math.cos(2 * Math.PI * v.trem.rate * t));
      const s = y * a;
      L[i] = L[i]! + s * gl;
      R[i] = R[i]! + s * gr;
      if (send && v.send) send[i] = send[i]! + s * v.send;
    }
    ph += dt;
    if (ph >= 1) ph -= 1;
  }
}

/** キック：三角波の音程を急に下げて「ドン」。soft は鼓動用（低く・丸く、打つ音のノイズなし） */
function writeKick(out: Stereo, t0: number, vel: number, soft = false): void {
  const i0 = Math.round(t0 * SR) - out.start;
  const len = Math.round((soft ? 0.5 : 0.38) * SR);
  const [f0, f1, tf, ta, at] = soft ? [95, 42, 0.05, 0.13, 0.008] : [160, 48, 0.03, 0.12, 0.0015];
  let ph = 0.75;
  for (let k = 0; k < len; k++) {
    const i = i0 + k;
    if (i >= out.length) break;
    const t = k / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t / tf);
    let y = (4 * Math.abs(ph - 0.5) - 1) * Math.min(1, t / at) * Math.exp(-t / ta);
    if (!soft) y += 0.3 * white() * Math.exp(-t / 0.004);
    ph = (ph + f / SR) % 1;
    if (i < 0) continue;
    const s = y * vel * 0.707;
    out.L[i] = out.L[i]! + s;
    out.R[i] = out.R[i]! + s;
  }
}

/** スネア：ファミコンのノイズ（少し粗い刻み）と、短い三角波の胴鳴り */
function writeSnare(out: Stereo, t0: number, vel: number): void {
  const i0 = Math.round(t0 * SR) - out.start;
  const len = Math.round(0.24 * SR);
  const nz = new Lfsr(21000);
  const [gl, gr] = panGains(0.08);
  let ph = 0.75;
  for (let k = 0; k < len; k++) {
    const i = i0 + k;
    if (i >= out.length) break;
    const t = k / SR;
    const f = 170 + 30 * Math.exp(-t / 0.02);
    const body = (4 * Math.abs(ph - 0.5) - 1) * 0.55 * Math.exp(-t / 0.04);
    const noise = nz.next() * Math.exp(-t / 0.07);
    ph = (ph + f / SR) % 1;
    if (i < 0) continue;
    const s = (body + noise) * Math.min(1, t / 0.001) * vel;
    out.L[i] = out.L[i]! + s * gl;
    out.R[i] = out.R[i]! + s * gr;
  }
}

/** ハイハット：白いノイズの高いところだけ（一次の高域フィルタ2段、約 7 kHz）。open は長めに鳴らす */
function writeHat(out: Stereo, t0: number, vel: number, open = false): void {
  const i0 = Math.round(t0 * SR) - out.start;
  const tau = open ? 0.11 : 0.022;
  const len = Math.round((open ? 0.4 : 0.1) * SR);
  const a = Math.exp((-2 * Math.PI * 7000) / SR);
  const [gl, gr] = panGains(0.25);
  let x1 = 0;
  let y1 = 0;
  let y2 = 0;
  let z1 = 0;
  for (let k = 0; k < len; k++) {
    const i = i0 + k;
    if (i >= out.length) break;
    const t = k / SR;
    const x = white();
    // 一次の高域フィルタを2回
    const h1 = a * (y1 + x - x1);
    x1 = x;
    y1 = h1;
    const h2 = a * (y2 + h1 - z1);
    z1 = h1;
    y2 = h2;
    if (i < 0) continue;
    const s = h2 * Math.min(1, t / 0.0008) * Math.exp(-t / tau) * vel * Math.min(1, (len - k) / 200);
    out.L[i] = out.L[i]! + s * gl;
    out.R[i] = out.R[i]! + s * gr;
  }
}

/** シンバル風のノイズ（左右で別のノイズにして広げる。3 kHz より上を残し、長めに減衰） */
function writeCrash(out: Stereo, t0: number, vel: number, lenSec = 2.8): void {
  const i0 = Math.round(t0 * SR) - out.start;
  const len = Math.round(lenSec * SR);
  const a = Math.exp((-2 * Math.PI * 3000) / SR);
  const lp = 1 - Math.exp((-2 * Math.PI * 11000) / SR);
  const st = [0, 0].map(() => ({ x1: 0, y1: 0, z1: 0, y2: 0, l: 0 }));
  for (let k = 0; k < len; k++) {
    const i = i0 + k;
    if (i >= out.length) break;
    const t = k / SR;
    const env = Math.min(1, t / 0.0015) * (0.6 * Math.exp(-t / 0.25) + 0.4 * Math.exp(-t / 0.9)) * Math.min(1, (len - k) / (0.2 * SR));
    for (let c = 0; c < 2; c++) {
      const s = st[c]!;
      const x = white();
      const h1 = a * (s.y1 + x - s.x1);
      s.x1 = x;
      s.y1 = h1;
      const h2 = a * (s.y2 + h1 - s.z1);
      s.z1 = h1;
      s.y2 = h2;
      s.l += lp * (h2 - s.l);
      if (i < 0) continue;
      const ch = c === 0 ? out.L : out.R;
      ch[i] = ch[i]! + s.l * env * vel;
    }
  }
}

/** アクセントの低音：三角波の音程を少し下げながら「ドーン」（1オクターブ下も半分の大きさで重ねる） */
function writeBoom(out: Stereo, t0: number, note: number, vel: number): void {
  const i0 = Math.round(t0 * SR) - out.start;
  const len = Math.round(1.4 * SR);
  const f = hz(note);
  let p1 = 0.75;
  let p2 = 0.75;
  for (let k = 0; k < len; k++) {
    const i = i0 + k;
    if (i >= out.length) break;
    const t = k / SR;
    const bend = 1 + 0.8 * Math.exp(-t / 0.05);
    const y = (4 * Math.abs(p1 - 0.5) - 1) + 0.5 * (4 * Math.abs(p2 - 0.5) - 1);
    p1 = (p1 + (f * bend) / SR) % 1;
    p2 = (p2 + (f * bend) / 2 / SR) % 1;
    if (i < 0) continue;
    const s = y * Math.min(1, t / 0.003) * Math.exp(-t / 0.4) * Math.min(1, (len - k) / 2000) * vel * 0.707;
    out.L[i] = out.L[i]! + s;
    out.R[i] = out.R[i]! + s;
  }
}

/** 持ち上がるノイズ（t0〜t1。こもった音からだんだん明るく大きくなり、t1 で止まる） */
function writeRiser(out: Stereo, t0: number, t1: number, vel: number): void {
  const i0 = Math.round(t0 * SR) - out.start;
  const len = Math.round((t1 - t0) * SR);
  const st = [0, 0];
  for (let k = 0; k < len; k++) {
    const i = i0 + k;
    if (i >= out.length) break;
    const x = k / len;
    const g = 1 - Math.exp((-2 * Math.PI * 250 * 20 ** x) / SR);
    const env = x ** 2.2 * vel * Math.min(1, (len - k) / 480);
    for (let c = 0; c < 2; c++) {
      st[c] = st[c]! + g * (white() - st[c]!);
      if (i < 0) continue;
      const ch = c === 0 ? out.L : out.R;
      ch[i] = ch[i]! + st[c]! * env;
    }
  }
}

// ---------- フィルタ ----------

type Coef = { b: [number, number, number]; a: [number, number] };
function biquadCoef(kind: "lp" | "hp", fc: number, q = Math.SQRT1_2): Coef {
  const w = (2 * Math.PI * fc) / SR;
  const c = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  const b0 = (kind === "lp" ? (1 - c) / 2 : (1 + c) / 2) / a0;
  const b1 = (kind === "lp" ? 1 - c : -(1 + c)) / a0;
  return { b: [b0, b1, b0], a: [(-2 * c) / a0, (1 - al) / a0] };
}
/** 2次のフィルタをその場でかける */
function filterInPlace(x: Float32Array, { b, a }: Coef): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i]!;
    const y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    x[i] = y0;
  }
}
const lowpass = (s: Stereo, fc: number) => {
  filterInPlace(s.L, biquadCoef("lp", fc));
  filterInPlace(s.R, biquadCoef("lp", fc));
};

/** 左右に交互に返るやまびこ（ピンポンディレイ）。返りはこもらせる */
function pingPong(send: Float32Array, delay: number, fb: number): Stereo {
  const D = Math.round(delay * SR);
  const e = new Stereo(0, send.length);
  for (let i = D; i < send.length; i++) {
    e.L[i] = send[i - D]! + fb * e.R[i - D]!;
    e.R[i] = fb * e.L[i - D]!;
  }
  lowpass(e, 3000);
  return e;
}

// ---------- 区間1つ分の音（楽器ごとの通り道に分けて書き、最後にフィルタをかけて混ぜる） ----------

class Track {
  readonly start: number;
  readonly length: number;
  readonly pulse: Stereo; // 矩形波（リード・分散和音）
  readonly tri: Stereo; // 三角波（ベース）
  readonly drum: Stereo; // ノイズ（ドラム）
  readonly send: Float32Array; // やまびこへ送る音
  constructor(
    readonly from: number,
    readonly to: number,
    end: number,
  ) {
    this.start = Math.floor(from * SR);
    this.length = Math.ceil(end * SR) - this.start;
    this.pulse = new Stereo(this.start, this.length);
    this.tri = new Stereo(this.start, this.length);
    this.drum = new Stereo(this.start, this.length);
    this.send = new Float32Array(this.length);
  }
  /** 区間の中で鳴り始める音だけを書く（区間の終わりより後には新しい音を置かない） */
  private inside(t: number): boolean {
    return t >= this.from - 1e-6 && t < this.to - 1e-6;
  }
  tone(t: number, dur: number, note: number, v: Voice): void {
    if (this.inside(t)) writeTone(v.wave === "tri" ? this.tri : this.pulse, this.send, t, dur, note, v);
  }
  kick(t: number, vel: number, soft = false): void {
    if (this.inside(t)) writeKick(this.drum, t, vel, soft);
  }
  snare(t: number, vel: number): void {
    if (this.inside(t)) writeSnare(this.drum, t, vel);
  }
  hat(t: number, vel: number, open = false): void {
    if (this.inside(t)) writeHat(this.drum, t, vel, open);
  }
  crash(t: number, vel: number, len?: number): void {
    if (this.inside(t)) writeCrash(this.drum, t, vel, len);
  }
  riser(t0: number, t1: number, vel: number): void {
    if (this.inside(t0)) writeRiser(this.drum, t0, t1, vel);
  }
}

// ---------- 楽器の設定 ----------

const LEAD25: Voice = { wave: "pulse", duty: 0.25, vel: 0.15, pan: -0.2, env: { a: 0.004, d: 0.12, s: 0.6, r: 0.06 } };
const LEAD_TENSE: Voice = { wave: "pulse", duty: 0.25, vel: 0.14, pan: -0.2, env: { a: 0.003, d: 0.2, s: 0.7, r: 0.05 }, vib: { rate: 6, depth: 0.003, delay: 0.3 } };
const LEAD50: Voice = { wave: "pulse", duty: 0.5, vel: 0.11, pan: -0.15, env: { a: 0.015, d: 0.25, s: 0.7, r: 0.12 }, vib: { rate: 5.2, depth: 0.0045, delay: 0.25 }, send: 0.22 };
const LEAD_SOFT: Voice = { ...LEAD50, vel: 0.08, pan: -0.25, send: 0.3 };
const ARP: Voice = { wave: "pulse", duty: 0.125, vel: 0.075, pan: 0.35, env: { a: 0.002, d: 0.02, s: 0.8, r: 0.04, tau: 0.18 } };
const ARP_SHORT: Voice = { ...ARP, vel: 0.06, env: { a: 0.002, d: 0.02, s: 0.8, r: 0.025, tau: 0.07 } };
const ARP_ECHO: Voice = { ...ARP, vel: 0.07, send: 0.45, env: { a: 0.002, d: 0.02, s: 0.8, r: 0.05, tau: 0.3 } };
const PAD: Voice = { wave: "pulse", duty: 0.25, vel: 0.03, pan: 0.15, env: { a: 0.08, d: 0.3, s: 0.75, r: 0.25 } };
const BASS: Voice = { wave: "tri", vel: 0.3, env: { a: 0.003, d: 0.08, s: 0.85, r: 0.03 }, steps16: true };
const BASS_TIGHT: Voice = { ...BASS, env: { a: 0.002, d: 0.05, s: 0.7, r: 0.02 } };
const BASS_SOFT: Voice = { ...BASS, vel: 0.3, env: { a: 0.02, d: 0.3, s: 0.7, r: 0.15 } };

// ドラムの譜面（16分音符16個で1小節。数字が大きいほど強い、. は休み）
interface Kit {
  kick?: string;
  heart?: string; // 鼓動（やわらかいキック）
  snare?: string;
  hat?: string;
  open?: string;
}
const KIT = {
  hook: { heart: "8.5.....8.5....." },
  play: { kick: "8.......7.4.....", snare: "....6.......6...", hat: "2.4.2.4.2.4.2.4." },
  playFill: { kick: "8.......7.4.....", snare: "....6.......6.45", hat: "2.4.2.4.2.4.2..." },
  tension: { kick: "8...8...8...8...", snare: "....7.......7...", hat: "4242424242424242" },
  tensionFill: { kick: "8...8...8...8.6.", snare: "....7.......5677", hat: "42424242424242.." },
  hope: { kick: "8.......8.6.....", snare: "....7.......7...", hat: "2.4.2.4.2.4.2.4." },
  hopeOpen: { kick: "8.......8.6.....", snare: "....7.......7...", hat: "2.4.2.4.2.4.2...", open: "..............4." },
  build: { kick: "4.........2.....", hat: "..2...2...2...2." },
  buildDense: { kick: "4.........2.....", snare: "............2...", hat: "..2...2...2...22" },
  outro: { kick: "7.......6.......", snare: "....5.......5...", hat: "2.3.2.3.2.3.2.3." },
  outroFill: { kick: "7.......6.......", snare: "....5.......4567", hat: "2.3.2.3.2.3....." },
} satisfies Record<string, Kit>;

function drums(tk: Track, t0: number, kit: Kit, scale = 1): void {
  const v = (pat: string | undefined, s: number) => {
    const c = pat?.[s];
    return c && c !== "." ? (Number(c) / 9) * scale : 0;
  };
  for (let s = 0; s < 16; s++) {
    const t = t0 + s * STEP;
    if (v(kit.kick, s)) tk.kick(t, 0.55 * v(kit.kick, s));
    if (v(kit.heart, s)) tk.kick(t, 0.6 * v(kit.heart, s), true);
    if (v(kit.snare, s)) tk.snare(t, 0.3 * v(kit.snare, s));
    if (v(kit.hat, s)) tk.hat(t, 0.09 * v(kit.hat, s));
    if (v(kit.open, s)) tk.hat(t, 0.08 * v(kit.open, s), true);
  }
}

// ---------- 旋律 ----------

// play：遊び方とステージ1（ヘ長調。F・Am・Bb・C・Dm・Bb・Gm・C）。A と B を8小節ずつ交互に
const PLAY_A = mel(
  `C5:2 r:2 F5:2 r:2 A5:4 G5:2 F5:2   E5:4 r:2 C5:2 E5:2 r:2 A5:4   D5:2 r:2 F5:2 Bb5:2 A5:4 G5:4   G5:6 E5:2 C5:4 r:4
   D5:2 r:2 F5:2 r:2 A5:4 C6:2 A5:2   Bb5:6 A5:2 F5:4 D5:4   G5:2 r:2 Bb5:2 r:2 D6:4 C6:2 Bb5:2   C6:4 Bb5:2 G5:2 E5:4 r:4`,
  8,
);
const PLAY_B = mel(
  `A5:2 G5:2 F5:2 C5:2 r:4 F5:2 G5:2   A5:6 G5:2 E5:4 r:4   F5:2 G5:2 A5:2 Bb5:2 D6:4 C6:4   Bb5:2 A5:2 G5:4 r:8
   F5:2 E5:2 D5:2 A4:2 r:4 D5:2 E5:2   F5:6 D5:2 Bb4:4 r:4   G5:2 A5:2 Bb5:2 D6:2 C6:4 Bb5:4   A5:4 Bb5:2 A5:2 G5:4 E5:4`,
  8,
);
// tension：2050年で負ける（ニ短調。Dm・Bb・Gm・A）。2回目からは最後の小節を上へ
const TENSE_A = mel(`A5:6 F5:2 D5:4 E5:4   F5:6 D5:2 Bb4:4 D5:4   G5:6 Bb5:2 D6:4 C6:2 Bb5:2   A5:6 G5:2 E5:4 C#5:4`, 4);
const TENSE_B = mel(`A5:6 F5:2 D5:4 E5:4   F5:6 D5:2 Bb4:4 D5:4   G5:6 Bb5:2 D6:4 C6:2 Bb5:2   A5:4 C#6:4 E6:4 C#6:4`, 4);
// hope：守り切る（ヘ長調。Bb・C・Am・Dm・Bb・C・F・F）
const HOPE = mel(`F5:4 G5:4 A5:4 Bb5:4   C6:8 Bb5:4 A5:4   A5:8 G5:4 E5:4   F5:12 r:4   D6:4 C6:4 Bb5:4 A5:4   G5:4 C6:4 Bb5:4 G5:4   F5:4 A5:4 C6:8   A5:16`, 8);
// build：考えている対旋律（ニ短調。Dm9・Bbmaj7・Fmaj7・Cadd9・Dm9・Bbmaj7・Gm7・A7。1オクターブ下げて鳴らす）
const BUILD_MEL = mel(`F5:8 E5:8   D5:8 F5:8   E5:8 C5:8   D5:12 r:4   A5:8 G5:4 F5:4   F5:8 D5:8   Bb4:8 D5:8   C#5:8 E5:8`, 8);
// outro：和音ごとの1小節の旋律と、終わりの和音の前の小節（C → F で主音へ）
const OUTRO_LEAD: Record<string, Mel[]> = {
  F: mel("A5:6 C6:2 A5:4 F5:4", 1),
  Am: mel("E5:6 A5:2 C6:8", 1),
  Bb: mel("D6:6 C6:2 Bb5:4 F5:4", 1),
  C: mel("E5:6 G5:2 C6:4 Bb5:4", 1),
  Dm: mel("F5:6 A5:2 D6:8", 1),
};
const OUTRO_CADENCE = mel("C6:6 Bb5:2 G5:4 E5:4", 1);

// ---------- 区間ごとの曲 ----------

interface Gen {
  tk: Track;
  from: number;
  to: number;
  bars: number; // 区間に入る小節の数（終わりの半端な小節も数える）
  T: (bar: number, step?: number) => number; // 区間の頭から bar 小節・step 個目の16分音符の時刻
}

function playMel(g: Gen, bar: number, m: Mel[], v: Voice, transpose = 0, gate = 0.9): void {
  for (const x of m) g.tk.tone(g.T(bar, x.step), x.len * STEP * gate, x.note + transpose, v);
}

/** hook：低い持続音と鼓動。まばらに、半音でためらうような高い音。終わりにノイズが持ち上がって次の場面へ */
function genHook(g: Gen): void {
  const { tk, from, to } = g;
  const L = to - from;
  const hold = L + XF + 0.5;
  tk.tone(from, hold, midi("D2"), { wave: "tri", vel: 0.24, env: { a: 1.2, d: 0.1, s: 1, r: 0.3 } });
  tk.tone(from, hold, midi("D3"), { wave: "pulse", duty: 0.5, vel: 0.05, pan: -0.25, env: { a: 2, d: 0.1, s: 1, r: 0.4 }, trem: { rate: 0.25, depth: 0.6 } });
  tk.tone(from + 0.5, hold, midi("A3"), { wave: "pulse", duty: 0.5, vel: 0.045, pan: 0.25, env: { a: 2, d: 0.1, s: 1, r: 0.4 }, trem: { rate: 0.33, depth: 0.6 } });
  const bell: Voice = { wave: "pulse", duty: 0.25, vel: 0.07, pan: 0.3, env: { a: 0.003, d: 0.05, s: 0.8, r: 0.1, tau: 0.45 }, send: 0.55 };
  const motif: [string, number][][] = [[["A5", 0]], [["Bb5", 0]], [["A5", 0], ["D6", 8]], [["Bb5", 0]], [["C#6", 0], ["A5", 8]]];
  for (let b = 0; b < g.bars; b++) {
    // 鼓動はだんだん強く
    drums(tk, g.T(b), KIT.hook, 0.55 + 0.45 * Math.min(1, (g.T(b) - from) / L));
    if (b === 0) continue;
    for (const [name, step] of motif[(b - 1) % motif.length]!) tk.tone(g.T(b, step), 8 * STEP, midi(name), bell);
  }
  if (L >= 3) tk.riser(to - Math.min(2, L / 3), to, 0.1);
}

/** play：明るく好奇心のある感じ。はずむベース、8分の分散和音（軽いやまびこつき）、25% のリード、軽いドラム */
function genPlay(g: Gen): void {
  const prog = ["F", "Am", "Bb", "C", "Dm", "Bb", "Gm", "C"];
  const bounce: [number, number, number][] = [[0, 3, 0], [4, 2, 12], [6, 2, 0], [8, 3, 7], [12, 2, 12], [14, 2, 7]];
  for (let b = 0; b < g.bars; b++) {
    const t0 = g.T(b);
    const name = prog[b % prog.length]!;
    for (const [s, len, iv] of bounce) g.tk.tone(t0 + s * STEP, len * STEP * 0.95, ROOT[name]! + iv, BASS);
    const tr = TRIAD[name]!;
    [0, 1, 2, 1, 0, 1, 2, 1].forEach((k, j) => g.tk.tone(t0 + j * 2 * STEP, STEP * 1.2, tr[k]! + 12, { ...ARP, send: 0.25 }));
    drums(g.tk, t0, b % 8 === 7 ? KIT.playFill : KIT.play);
  }
  for (let p = 0; p * 8 < g.bars; p++) playMel(g, p * 8, p % 2 ? PLAY_B : PLAY_A, LEAD25);
}

/** tension：短調で押し寄せる。16分のベースと分散和音、四つ打ち、4小節ごとのフィル */
function genTension(g: Gen): void {
  const prog = ["Dm", "Bb", "Gm", "A"];
  for (let b = 0; b < g.bars; b++) {
    const t0 = g.T(b);
    const name = prog[b % prog.length]!;
    const tr = TRIAD[name]!;
    for (let s = 0; s < 16; s++) {
      g.tk.tone(t0 + s * STEP, STEP * 0.75, ROOT[name]! + [0, 0, 12, 0][s % 4]!, BASS_TIGHT);
      g.tk.tone(t0 + s * STEP, STEP * 0.6, tr[[2, 0, 1, 0][s % 4]!]! + 12, ARP_SHORT);
    }
    drums(g.tk, t0, b % 4 === 3 ? KIT.tensionFill : KIT.tension);
  }
  for (let p = 0; p * 4 < g.bars; p++) playMel(g, p * 4, p % 2 ? TENSE_B : TENSE_A, LEAD_TENSE);
}

/** hope：長調へ持ち上がる。のぼる16分の分散和音、伸ばす和音、50% のあたたかいリード */
function genHope(g: Gen): void {
  const prog = ["Bb", "C", "Am", "Dm", "Bb", "C", "F", "F"];
  for (let b = 0; b < g.bars; b++) {
    const t0 = g.T(b);
    const name = prog[b % prog.length]!;
    const tr = TRIAD[name]!;
    for (let j = 0; j < 8; j++) g.tk.tone(t0 + j * 2 * STEP, 2 * STEP * 0.8, ROOT[name]! + (j % 2 ? 12 : 0), BASS);
    for (const n of tr) g.tk.tone(t0, BAR * 0.95, n, PAD);
    for (let s = 0; s < 16; s++) g.tk.tone(t0 + s * STEP, STEP * 0.7, s % 4 === 3 ? tr[0]! + 24 : tr[s % 4]! + 12, ARP);
    drums(g.tk, t0, b % 4 === 3 ? KIT.hopeOpen : KIT.hope);
  }
  for (let p = 0; p * 8 < g.bars; p++) playMel(g, p * 8, HOPE, LEAD50, 0, 0.95);
}

/** build：落ち着いて考えている感じ。やまびこつきの分散和音、2分音符のベース、控えめなドラム。
 *  8小節ずつの段落で、対旋律を足したり（奇数の段落）、分散和音を16分に速めたり（3つ目の段落）する */
function genBuild(g: Gen): void {
  const prog = ["Dm9", "Bbmaj7", "Fmaj7", "Cadd9", "Dm9", "Bbmaj7", "Gm7", "A7"];
  const p8 = [0, 1, 2, 3, 1, 2, 3, 2];
  const p16 = [0, 1, 2, 3, 1, 2, 3, 2, 0, 1, 2, 3, 2, 3, 1, 2];
  for (let b = 0; b < g.bars; b++) {
    const t0 = g.T(b);
    const ch = COLOR[prog[b % prog.length]!]!;
    const dense = Math.floor(b / 8) % 4 === 2;
    if (dense) p16.forEach((k, s) => g.tk.tone(t0 + s * STEP, STEP * 0.8, ch.tones[k]! + 12, { ...ARP_ECHO, vel: 0.06 }));
    else p8.forEach((k, j) => g.tk.tone(t0 + j * 2 * STEP, 2 * STEP * 0.8, ch.tones[k]! + 12, ARP_ECHO));
    const r = ROOT[ch.root]!;
    g.tk.tone(t0, 7 * STEP, r, BASS_SOFT);
    g.tk.tone(t0 + 8 * STEP, 7 * STEP, r + (b % 2 ? 12 : 0), BASS_SOFT);
    if (b >= 2) drums(g.tk, t0, dense ? KIT.buildDense : KIT.build);
  }
  for (let p = 1; p * 8 < g.bars; p += 2) playMel(g, p * 8, BUILD_MEL, LEAD_SOFT, -12, 0.95);
}

/** outro：ヘ長調で Bb → C → F と解決し、主音 F の和音を長く鳴らして、区間の終わり（total）で消える */
function genOutro(g: Gen): void {
  const { tk, from, to } = g;
  const cycle = ["F", "Am", "Bb", "C", "F", "Dm", "Bb", "C"];
  // 終わりの和音は、区間の終わりから 3 秒以上前の、いちばん遅い小節の頭に置く
  const nPre = Math.max(0, Math.floor((to - from - 3) / BAR));
  const tFin = g.T(nPre);
  for (let b = 0; b < nPre; b++) {
    const t0 = g.T(b);
    const name = cycle[(((b - nPre) % cycle.length) + cycle.length) % cycle.length]!;
    const last = b === nPre - 1;
    const r = ROOT[name]!;
    [0, 12, 7, 12, 0, 12, 7, 12].forEach((iv, j) => tk.tone(t0 + j * 2 * STEP, 2 * STEP * 0.8, r + iv, BASS));
    const tr = TRIAD[name]!;
    [0, 1, 2, 1, 0, 1, 2, 1].forEach((k, j) => tk.tone(t0 + j * 2 * STEP, STEP * 1.2, tr[k]! + 12, ARP_ECHO));
    playMel(g, b, last ? OUTRO_CADENCE : OUTRO_LEAD[name]!, LEAD50, 0, 0.92);
    drums(tk, t0, last ? KIT.outroFill : KIT.outro, 0.9);
  }
  // 終わりの和音（F）：低い F、F・A・C、高い F の鐘。区間の終わりまでに -40 dB ほどまで減衰させる
  const dur = to - tFin;
  const tau = dur / 4.5;
  tk.tone(tFin, dur, midi("F2"), { ...BASS, vel: 0.36, env: { a: 0.003, d: 0.001, s: 1, r: 0.05, tau } });
  tk.tone(tFin, dur, midi("F1"), { wave: "tri", vel: 0.2, env: { a: 0.01, d: 0.001, s: 1, r: 0.05, tau } });
  for (const n of ["A4", "C5"]) tk.tone(tFin, dur, midi(n), { ...PAD, vel: 0.045, env: { a: 0.01, d: 0.001, s: 1, r: 0.05, tau } });
  tk.tone(tFin, dur, midi("F5"), { ...LEAD50, vel: 0.12, env: { a: 0.012, d: 0.001, s: 1, r: 0.05, tau } });
  tk.tone(tFin, dur, midi("F6"), { ...ARP_ECHO, vel: 0.05, env: { a: 0.002, d: 0.001, s: 1, r: 0.05, tau: 0.6 } });
  tk.kick(tFin, 0.45);
  tk.crash(tFin, 0.1, Math.min(2.8, dur));
}

const MOOD: Record<Mood, { gen: (g: Gen) => void; key: string; cut: number; gain: number; echo?: { delay: number; fb: number } }> = {
  hook: { gen: genHook, key: "ニ短調", cut: 2400, gain: 0.9, echo: { delay: 0.375, fb: 0.45 } },
  play: { gen: genPlay, key: "ヘ長調", cut: 5500, gain: 0.85, echo: { delay: 0.375, fb: 0.25 } },
  tension: { gen: genTension, key: "ニ短調", cut: 5000, gain: 0.95 },
  hope: { gen: genHope, key: "ヘ長調", cut: 5800, gain: 0.85, echo: { delay: 0.375, fb: 0.25 } },
  build: { gen: genBuild, key: "ニ短調", cut: 4500, gain: 0.92, echo: { delay: 0.375, fb: 0.4 } },
  outro: { gen: genOutro, key: "ヘ長調", cut: 5200, gain: 0.85, echo: { delay: 0.375, fb: 0.35 } },
};

// ---------- 音量（ITU-R BS.1770 のラウドネスと、先読みのリミッタ） ----------

// K 特性のフィルタ（48 kHz の係数）
const K1: Coef = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] };
const K2: Coef = { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] };

/** 積分ラウドネス（LUFS）。400 ms の区切りを 100 ms ずつずらし、-70 LUFS と「平均 -10 LU」の2つのゲートをかける */
function loudness(s: Stereo, i0 = 0, i1 = s.length): number {
  const hop = SR / 10;
  const nh = Math.floor((i1 - i0) / hop);
  const hs = new Float64Array(nh);
  for (const ch of [s.L, s.R]) {
    const st = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = i0; i < i0 + nh * hop; i++) {
      const x = ch[i]!;
      const y1 = K1.b[0] * x + K1.b[1] * st[0]! + K1.b[2] * st[1]! - K1.a[0] * st[2]! - K1.a[1] * st[3]!;
      st[1] = st[0]!;
      st[0] = x;
      st[3] = st[2]!;
      st[2] = y1;
      const y2 = K2.b[0] * y1 + K2.b[1] * st[4]! + K2.b[2] * st[5]! - K2.a[0] * st[6]! - K2.a[1] * st[7]!;
      st[5] = st[4]!;
      st[4] = y1;
      st[7] = st[6]!;
      st[6] = y2;
      const j = Math.floor((i - i0) / hop);
      hs[j] = hs[j]! + y2 * y2;
    }
  }
  const blocks: number[] = [];
  for (let j = 0; j + 4 <= nh; j++) blocks.push((hs[j]! + hs[j + 1]! + hs[j + 2]! + hs[j + 3]!) / (4 * hop));
  const lk = (z: number) => -0.691 + 10 * Math.log10(z);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const g1 = blocks.filter((z) => z > 0 && lk(z) > -70);
  if (!g1.length) return -Infinity;
  const rel = lk(mean(g1)) - 10;
  const g2 = g1.filter((z) => lk(z) > rel);
  return lk(mean(g2));
}

/** 左右のうち大きい方の、いちばん大きいサンプル（dBFS） */
function peakDb(s: Stereo): number {
  let m = 0;
  for (const ch of [s.L, s.R]) for (let i = 0; i < ch.length; i++) m = Math.max(m, Math.abs(ch[i]!));
  return 20 * Math.log10(m || 1e-9);
}

/**
 * 先読みのリミッタ。ceiling（倍率）を超えそうなところだけ、3 ms 前からなめらかに下げ、0.12 秒で戻す。
 * どのサンプルも「そこで要る倍率」以下になるので、ceiling を超えない。いちばん大きく下げた量（dB）を返す
 */
function limit(s: Stereo, ceiling: number): number {
  const n = s.length;
  const la = Math.round(0.003 * SR);
  const rel = 1 - Math.exp(-1 / (0.12 * SR));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) need[i] = Math.min(1, ceiling / Math.max(Math.abs(s.L[i]!), Math.abs(s.R[i]!), 1e-12));
  // 先の la サンプルの中の最小（単調な待ち行列で O(n)）
  const g = new Float32Array(n);
  const q = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  let prev = 1;
  let j = 0;
  for (let i = 0; i < n; i++) {
    for (; j < n && j <= i + la; j++) {
      while (qt > qh && need[q[qt - 1]!]! >= need[j]!) qt--;
      q[qt++] = j;
    }
    while (q[qh]! < i) qh++;
    const m = need[q[qh]!]!;
    prev = m < prev ? m : prev + (m - prev) * rel;
    g[i] = prev;
  }
  // la サンプルの移動平均で、下げ始めを坂にする
  let acc = 0;
  let minG = 1;
  for (let i = 0; i < n; i++) {
    acc += g[i]!;
    if (i >= la) acc -= g[i - la]!;
    const gain = acc / Math.min(i + 1, la);
    minG = Math.min(minG, gain);
    s.L[i] = s.L[i]! * gain;
    s.R[i] = s.R[i]! * gain;
  }
  return -20 * Math.log10(minG);
}

// ---------- WAV ----------

function writeWav(file: string, s: Stereo): void {
  const n = s.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // ステレオ
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(n * 4, 40);
  // 16 bit にするときの段差を目立たせないよう、三角分布のディザ（±1 LSB）を足す
  const dither = mulberry32(7);
  const q = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x * 32767 + dither() - dither())));
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(q(s.L[i]!), 44 + i * 4);
    buf.writeInt16LE(q(s.R[i]!), 46 + i * 4);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
}

// ---------- 組み立て ----------

const cues = readCues(values.cues);
const { total, sections, hits } = cues;
const N = Math.round(total * SR);
const master = new Stereo(0, N);
const fmt = (x: number) => x.toFixed(1);
console.log(`BGM を合成する：${fmt(total)} 秒、BPM ${BPM}（1小節 ${BAR} 秒）、区間 ${sections.length}、アクセント ${hits.length}`);

const hitNear = (t: number) => hits.some((h) => Math.abs(h - t) < 0.3);
sections.forEach((sec, idx) => {
  const cfg = MOOD[sec.mood];
  const isLast = idx === sections.length - 1;
  const final = sec.mood === "outro" || isLast;
  // 入り：最初の区間は 1 秒、頭にアクセントがあればすぐ、なければ xfade の 6 割で入る
  const inLen = idx === 0 ? 1 : hitNear(sec.from) ? 0.02 : XF * 0.6;
  // 終わり：outro は最後の 1 秒で 0 に、outro でない最後の区間は 2 秒で消す。ほかは区間の終わりから xfade 秒で消す
  const outLen = sec.mood === "outro" ? 1 : isLast ? 2 : XF + 0.05;
  const outStart = final ? sec.to - outLen : sec.to - 0.05;
  const end = Math.min(total, final ? sec.to : sec.to + XF + 0.05);
  const tk = new Track(sec.from, sec.to, end);
  const len = sec.to - sec.from;
  cfg.gen({ tk, from: sec.from, to: sec.to, bars: Math.ceil(len / BAR - 1e-9), T: (bar, step = 0) => sec.from + bar * BAR + step * STEP });

  // 通り道ごとにフィルタをかける（リードは cut Hz から上を軽く落とす）
  lowpass(tk.pulse, cfg.cut);
  lowpass(tk.tri, 5000);
  lowpass(tk.drum, 11000);
  const echo = cfg.echo ? pingPong(tk.send, cfg.echo.delay, cfg.echo.fb) : null;
  for (let k = 0; k < tk.length; k++) {
    const i = tk.start + k;
    if (i < 0 || i >= N) continue;
    const t = i / SR;
    let g = cfg.gain;
    if (sec.mood === "tension") g *= 0.85 + 0.2 * Math.min(1, (t - sec.from) / len); // だんだん押し寄せる
    const u = (t - sec.from) / inLen;
    if (u < 1) g *= Math.sin((Math.max(0, u) * Math.PI) / 2);
    const w = (t - outStart) / outLen;
    if (w > 0) g *= w >= 1 ? 0 : Math.cos((w * Math.PI) / 2);
    if (g <= 0) continue;
    const l = tk.pulse.L[k]! + tk.tri.L[k]! + tk.drum.L[k]! + (echo ? echo.L[k]! : 0);
    const r = tk.pulse.R[k]! + tk.tri.R[k]! + tk.drum.R[k]! + (echo ? echo.R[k]! : 0);
    master.L[i] = master.L[i]! + l * g;
    master.R[i] = master.R[i]! + r * g;
  }
  console.log(`  ${fmt(sec.from).padStart(5)}〜${fmt(sec.to).padStart(5)} 秒  ${sec.mood.padEnd(7)} ${cfg.key}`);
});

// 画面が大きく切り替わるところのアクセント：シンバル風のノイズ＋低音（ヘ長調の区間は F、ニ短調の区間は D）
for (const h of hits) {
  // 終わりに近すぎると、シンバルの減衰が途中で切れてしまう
  if (h > total - 1.5) {
    console.log(`  アクセント ${fmt(h)} 秒は、終わり（${fmt(total)} 秒）に近すぎるので入れない`);
    continue;
  }
  const sec = sections.find((s) => Math.abs(s.from - h) < 0.3) ?? sections.find((s) => h >= s.from && h < s.to);
  const low = sec && MOOD[sec.mood].key === "ヘ長調" ? "F2" : "D2";
  writeCrash(master, h, 0.2);
  writeBoom(master, h, midi(low), 0.42);
  writeKick(master, h, 0.5);
}

// 25 Hz より下（直流分を含む）を切る
filterInPlace(master.L, biquadCoef("hp", 25));
filterInPlace(master.R, biquadCoef("hp", 25));

// 目標のラウドネスに合わせる。リミッタで少し小さくなるぶんは、測り直して合わせ直す
const ceiling = 10 ** ((PEAK_DB - 0.5) / 20); // サンプルのピークは --peak より 0.5 dB 下（間のピークのための余裕）
const raw = loudness(master);
let gainDb = TARGET_LUFS - raw;
let out = master;
let reduced = 0;
let lufs = raw;
for (let iter = 0; iter < 4; iter++) {
  out = new Stereo(0, N);
  const k = 10 ** (gainDb / 20);
  for (let i = 0; i < N; i++) {
    out.L[i] = master.L[i]! * k;
    out.R[i] = master.R[i]! * k;
  }
  reduced = limit(out, ceiling);
  lufs = loudness(out);
  if (Math.abs(lufs - TARGET_LUFS) < 0.1) break;
  gainDb += TARGET_LUFS - lufs;
}
// 念のため、頭と終わりをごく短くフェード
const edge = Math.round(0.005 * SR);
for (let i = 0; i < edge; i++) {
  const k = i / edge;
  out.L[i] = out.L[i]! * k;
  out.R[i] = out.R[i]! * k;
  out.L[N - 1 - i] = out.L[N - 1 - i]! * k;
  out.R[N - 1 - i] = out.R[N - 1 - i]! * k;
}

console.log(`音量：${lufs.toFixed(1)} LUFS（目標 ${TARGET_LUFS}。合成したままは ${raw.toFixed(1)} LUFS、${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)} dB）`);
console.log(`ピーク：${peakDb(out).toFixed(2)} dBFS（上限 ${(PEAK_DB - 0.5).toFixed(1)} dBFS。リミッタで下げた量は最大 ${reduced.toFixed(1)} dB）`);
console.log("区間ごとの大きさ（目安）：");
for (const sec of sections) {
  const v = loudness(out, Math.floor(sec.from * SR), Math.min(N, Math.floor(sec.to * SR)));
  console.log(`  ${sec.mood.padEnd(7)} ${Number.isFinite(v) ? v.toFixed(1) : "-∞"} LUFS`);
}
writeWav(values.out!, out);
console.log(`書き出し：${values.out}（48 kHz・16 bit・ステレオ）`);
