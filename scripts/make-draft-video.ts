// 仮の動画（3分）を作る（docs/DEMO.md の時間配分どおり）。
// 録画（scripts/record-demo.ts の recordings/*.mp4 と目印の *.json）を切り出して早送りし、台本のナレーションを字幕と声にして重ね、つなぐ。
// 字幕は画面なしの Chrome で透明な PNG に描き、ffmpeg で重ねる（手元の ffmpeg には文字を描く機能がないため）。
// 声：recordings/voice/scene{N}.wav（m4a・aiff・mp3 も可）があれば作者の録音を使う。なければ macOS の読み上げ（say）で仮の声を作る。
//     仮の声は尺を確かめるためだけのもの（提出版は作者の録音にする）。仮の声のときは、字幕の時刻を声の区切りに合わせる。
//     録音のときは、頭と終わりの無音を切り、声の中の無音を手がかりに字幕の時刻を合わせる（scripts/lib/align.ts）
//   npx tsx scripts/make-draft-video.ts [--rec recordings] [--seed 570] [--voice Kyoko]
//   → recordings/draft-video.mp4（1920×1080、30fps、声は AAC）、ナレーションの字幕 recordings/draft-video.srt、
//     シーンごとの記録 recordings/draft-video.json（絵コンテ表を作る scripts/make-storyboard.ts が読む）
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { alignChunks, silences } from "./lib/align.ts";
import { ANCHORS, chunks, VOICE_FROM } from "./lib/video-cues.ts";
import { openChrome, sleep, type Page } from "./lib/chrome.ts";

const { values } = parseArgs({
  options: {
    rec: { type: "string", default: "recordings" },
    seed: { type: "string", default: "570" },
    voice: { type: "string", default: "Kyoko" },
  },
});
const W = 1920;
const H = 1080;
const REC = values.rec!;
const TMP = join(REC, "_draft");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// ---------- 台本を読む ----------

interface SceneText {
  narration?: string;
  main?: string;
  supplements: string[];
  intro: string[];
}
function readScript(): Map<number, SceneText> {
  const md = readFileSync("docs/DEMO.md", "utf8");
  const out = new Map<number, SceneText>();
  for (const part of md.split(/\n### シーン/).slice(1)) {
    const n = Number(part.match(/^(\d+)/)?.[1]);
    const narration = part.match(/\*\*ナレーション\*\*[^\n]*\n\s*>\s*(.+)/)?.[1]?.trim();
    const main = part.match(/\*\*字幕\*\*：「([^」]+)」/)?.[1];
    const supLine = part.split("\n").find((l) => l.includes("**字幕（補足）**"));
    const supplements = supLine ? [...supLine.matchAll(/「([^」]+)」/g)].map((m) => m[1]!) : [];
    const introBlock = part.match(/\*\*字幕（作者紹介[^\n]*\n((?:[ \t]+- .+\n)+)/)?.[1];
    const intro = introBlock ? introBlock.split("\n").map((l) => l.replace(/^\s+- /, "").trim()).filter(Boolean) : [];
    out.set(n, { narration, main, supplements, intro });
  }
  return out;
}

// ---------- 録画の目印 ----------

const markers = (take: string) => (JSON.parse(readFileSync(join(REC, `${take}.json`), "utf8")) as { markers: { t: number; label: string }[] }).markers;
function at(take: string, label: string): number {
  const m = markers(take).find((x) => x.label === label);
  if (!m) throw new Error(`${take} に目印「${label}」がない（録画し直す）`);
  return m.t;
}
const ABUSE = `abuse-seed${values.seed}`;
const PROPER = `proper-seed${values.seed}`;

// ---------- 字幕の絵（Chrome で描く） ----------

const FONT = `"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif`;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
type Kind = "sub" | "top" | "big" | "intro" | "speed" | "speedLow" | "places" | "card";

function html(kind: Kind, text: string, extra?: string[]): string {
  const base = `html,body{margin:0;width:${W}px;height:${H}px;font-family:${FONT};}`;
  const speed = (top: number) =>
    `<style>${base}div{position:absolute;right:60px;top:${top}px;padding:8px 20px;border-radius:999px;background:rgba(24,10,18,.78);color:#fff;font-size:30px;font-weight:700}</style><div>${esc(text)}</div>`;
  switch (kind) {
    case "sub":
      // 画面の幅いっぱいまで使えるよう、外側の箱で中央に寄せる（left:50% だと半分の幅で折り返してしまう）
      return `<style>${base}body{display:flex;justify-content:center;align-items:flex-end}div{margin-bottom:56px;max-width:1720px;padding:12px 30px;border-radius:14px;background:rgba(24,10,18,.74);color:#fff;font-size:46px;font-weight:700;line-height:1.35;text-align:center;white-space:pre-wrap}</style><div>${esc(text)}</div>`;
    case "top":
      return `<style>${base}body{display:flex;justify-content:center;align-items:flex-start}div{margin-top:64px;max-width:1500px;padding:10px 26px;border-radius:12px;background:rgba(122,30,69,.9);color:#fff;font-size:32px;font-weight:700;text-align:center}</style><div>${esc(text)}</div>`;
    case "big":
      return `<style>${base}div{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);padding:40px 0;background:rgba(20,8,14,.62);color:#fff;font-size:88px;font-weight:800;text-align:center;letter-spacing:.04em;text-shadow:0 4px 18px rgba(0,0,0,.5)}</style><div>${esc(text)}</div>`;
    case "intro":
      return `<style>${base}div{position:absolute;left:80px;top:150px;padding:28px 36px;border-radius:16px;background:rgba(255,255,255,.95);color:#3b0a24;box-shadow:0 8px 30px rgba(60,10,30,.25);border-left:10px solid #a3214f}b{display:block;font-size:52px;margin-bottom:10px}p{margin:6px 0;font-size:30px;font-weight:600}</style><div><b>${esc(text)}</b>${(extra ?? []).map((l) => `<p>${esc(l)}</p>`).join("")}</div>`;
    case "speed":
      return speed(64);
    case "speedLow":
      // 拡大した教員用の画面では、右上に経過時間が出るので、その下に置く
      return speed(124);
    case "places":
      // 使っていく場面（シーン8）。タイトルのロゴに重ならないよう、右の盤面の上に出す
      return `<style>${base}div{position:absolute;right:90px;top:270px;padding:26px 36px 22px;background:rgba(14,9,22,.88);box-shadow:inset 6px 0 0 #3be0c6;color:#fff}h2{margin:0 0 6px;font-size:28px;color:#3be0c6;letter-spacing:.08em}p{margin:12px 0;font-size:46px;font-weight:800}</style><div><h2>${esc(text)}</h2>${(extra ?? []).map((l) => `<p>${esc(l)}</p>`).join("")}</div>`;
    case "card":
      return `<style>${base}body{background:linear-gradient(135deg,#3b0a24,#7a1e45);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;text-align:center}h1{margin:0;font-size:72px}p{margin:0;font-size:36px;opacity:.92;max-width:1500px}</style><h1>${esc(text)}</h1>${(extra ?? []).map((l) => `<p>${esc(l)}</p>`).join("")}`;
  }
}

let pngCount = 0;
async function render(page: Page, kind: Kind, text: string, extra?: string[]): Promise<string> {
  await page.send("Page.navigate", { url: `data:text/html;charset=utf-8,${encodeURIComponent(html(kind, text, extra))}` });
  await sleep(250);
  const file = join(TMP, `ov${++pngCount}.png`);
  writeFileSync(file, await page.png(kind !== "card"));
  return file;
}

// ---------- 動画の部品（ffmpeg） ----------

const ENC = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30"];
let segCount = 0;
const ff = (args: string[]) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: "inherit" });
const probe = (file: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

/** 録画の from〜to 秒を speed 倍で切り出す。長さは (to - from) / speed。crop は拡大する範囲（ffmpeg の crop。t は切り出した部品の中の秒） */
function clip(take: string, from: number, to: number, speed = 1, crop?: string): string {
  const out = join(TMP, `seg${++segCount}.mp4`);
  const vf = [`setpts=(PTS-STARTPTS)/${speed}`, "fps=30", ...(crop ? [crop] : []), `scale=${W}:${H}:flags=lanczos`].join(",");
  ff(["-ss", String(from), "-t", String(to - from), "-i", join(REC, `${take}.mp4`), "-vf", vf, "-t", String((to - from) / speed), ...ENC, out]);
  return out;
}
/** 静止画を dur 秒の動画にする */
function still(png: string, dur: number): string {
  const out = join(TMP, `seg${++segCount}.mp4`);
  ff(["-loop", "1", "-t", String(dur), "-i", png, "-vf", `fps=30,scale=${W}:${H}`, ...ENC, out]);
  return out;
}
function concat(parts: string[], out: string): string {
  const list = join(TMP, `list${++segCount}.txt`);
  writeFileSync(list, parts.map((p) => `file '${p.split("/").pop()}'`).join("\n"));
  ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out]);
  return out;
}
interface Overlay {
  png: string;
  start: number;
  end: number;
  kind?: Kind;
  text?: string;
}
/** 下地の動画に字幕の絵を重ねる */
function overlay(base: string, overlays: Overlay[], dur: number, out: string): string {
  if (overlays.length === 0) {
    ff(["-i", base, "-t", String(dur), ...ENC, out]);
    return out;
  }
  const inputs = overlays.flatMap((o) => ["-i", o.png]);
  const chain = overlays
    .map((o, i) => `[${i === 0 ? "0:v" : `v${i}`}][${i + 1}:v]overlay=0:0:enable='between(t,${o.start.toFixed(2)},${o.end.toFixed(2)})'[v${i + 1}]`)
    .join(";");
  ff(["-i", base, ...inputs, "-filter_complex", chain, "-map", `[v${overlays.length}]`, "-t", String(dur), ...ENC, out]);
  return out;
}

// ---------- 声 ----------

interface Sub {
  start: number;
  end: number;
  text: string;
}
interface Voice {
  file: string;
  dur: number;
  source: "録音" | "仮の読み上げ";
  /** 仮の読み上げのときだけ：字幕の区切りごとの、声の中での時刻 */
  parts?: Sub[];
}
/** 仮の読み上げで読み違える語の読み（声にだけ使う。字幕はそのまま） */
const READING: [RegExp, string][] = [
  [/Claude Code/g, "クロード コード"],
  [/Claude/g, "クロード"],
  [/AST/g, "エーエスティー"],
  [/JANIS/g, "ジャニス"],
];
const GAP = 0.12;

/**
 * シーン n の声。作者の録音（recordings/voice/scene{n}.*）があればそれを使う。なければ字幕の区切りごとに読み上げてつなぐ。
 * anchors：[語, 秒]。その語で始まる区切りを、シーンの頭からその秒より前には始めない（画面の切り替わりに合わせる。仮の声だけ）
 */
function voiceFor(n: number, text: string, from: number, anchors: [string, number][]): Voice {
  for (const ext of ["wav", "m4a", "aiff", "mp3"]) {
    const f = join(REC, "voice", `scene${n}.${ext}`);
    if (existsSync(f)) {
      // 録音の頭と終わりの無音を切る（声をシーンの頭から from 秒に置き、余りを正しく測るため）
      const out = join(TMP, `rec${n}.wav`);
      const trim = "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB";
      ff(["-i", f, "-af", `${trim},areverse,${trim},areverse`, "-ac", "1", "-ar", "48000", out]);
      return { file: out, dur: probe(out), source: "録音" };
    }
  }
  const parts: Sub[] = [];
  const files: string[] = [];
  let t = 0;
  for (const [i, p] of chunks(text).entries()) {
    const aiff = join(TMP, `tts${n}-${i}.aiff`);
    let spoken = p;
    for (const [re, r] of READING) spoken = spoken.replace(re, r);
    execFileSync("say", ["-v", values.voice!, "-o", aiff, spoken]);
    const d = probe(aiff);
    const anchor = anchors.find(([w]) => p.startsWith(w));
    if (anchor) t = Math.max(t, anchor[1] - from);
    parts.push({ start: t, end: t + d, text: p });
    files.push(aiff);
    t += d + GAP;
  }
  // 区切りのあとに、次の区切りまでの無音を足してつなぐ
  const filter =
    files.map((_, i) => `[${i}:a]aresample=48000,apad=pad_dur=${i + 1 < parts.length ? (parts[i + 1]!.start - parts[i]!.end).toFixed(3) : 0}[a${i}]`).join(";") +
    `;${files.map((_, i) => `[a${i}]`).join("")}concat=n=${files.length}:v=0:a=1[out]`;
  const out = join(TMP, `voice${n}.wav`);
  ff([...files.flatMap((f) => ["-i", f]), "-filter_complex", filter, "-map", "[out]", "-ac", "1", out]);
  return { file: out, dur: probe(out), source: "仮の読み上げ", parts };
}

/** シーンの長さちょうどの音声（声を from 秒から置く。声がなければ無音） */
function sceneAudio(n: number, dur: number, voice?: Voice, from = 0.3): string {
  const out = join(TMP, `audio${n}.wav`);
  if (!voice) ff(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(dur), "-c:a", "pcm_s16le", out]);
  else ff(["-i", voice.file, "-af", `aresample=48000,adelay=${Math.round(from * 1000)}:all=1,apad`, "-ac", "2", "-t", String(dur), "-c:a", "pcm_s16le", out]);
  return out;
}

// ---------- 組み立て ----------

interface SceneSpec {
  n: number;
  dur: number;
  /** 絵コンテ表に出す「画面」の説明 */
  screen: string;
  parts: string[];
  overlays: Overlay[];
  /** ナレーションを始める秒 */
  from?: number;
  /** 画面に合わせて待たせる区切り（省くと scripts/lib/video-cues.ts の ANCHORS） */
  anchors?: [string, number][];
  /** ナレーションの語に合わせて出す絵（その語で始まる字幕と同時に出し、len 秒出す） */
  cues?: { word: string; len: number; png: string; kind: Kind; text: string }[];
}
interface Built {
  n: number;
  file: string;
  audio: string;
  dur: number;
  screen: string;
  subs: Sub[];
  overlays: { kind?: Kind; text?: string; start: number; end: number }[];
  narration?: string;
  voice?: { source: Voice["source"]; start: number; dur: number; margin: number };
}

async function main(): Promise<void> {
  const script = readScript();
  const { page, close } = await openChrome({ width: W, height: H });
  const built: Built[] = [];
  const warnings: string[] = [];
  try {
    const ov = async (kind: Kind, text: string, start: number, end: number, extra?: string[]): Promise<Overlay> => ({
      png: await render(page, kind, text, extra),
      start,
      end,
      kind,
      text,
    });
    const speedBadge = (k: number, start: number, end: number, kind: Kind = "speed") => ov(kind, `早送り ×${Math.round(k)}`, start, end);

    const scene = async (s: SceneSpec) => {
      const from = s.from ?? VOICE_FROM;
      const base = s.parts.length === 1 ? s.parts[0]! : concat(s.parts, join(TMP, `base${s.n}.mp4`));
      const text = script.get(s.n)?.narration;
      const anchors = s.anchors ?? (ANCHORS[s.n] ?? []).map((a): [string, number] => [a.word, a.at]);
      const voice = text ? voiceFor(s.n, text, from, anchors) : undefined;
      // 字幕：仮の声は区切りの時刻どおり。録音は、無音を除いて話している時間を文字数の割合で分け、近くの無音にそろえる（scripts/lib/align.ts）
      let subs: Sub[] = [];
      if (text && voice?.parts) subs = voice.parts.map((p) => ({ start: from + p.start, end: from + p.end, text: p.text }));
      else if (text && voice) subs = alignChunks(chunks(text), voice.dur, silences(voice.file)).map((p) => ({ start: from + p.start, end: from + p.end, text: p.text }));
      const subOvs: Overlay[] = [];
      // 字幕は、次の字幕まで間が短ければ次が出るまで残す（重ならないように）
      for (const [i, sb] of subs.entries()) {
        const next = subs[i + 1];
        const end = next ? (next.start - sb.end < 1 ? next.start : sb.end + 0.4) : Math.min(s.dur, sb.end + 0.6);
        subOvs.push(await ov("sub", sb.text, sb.start, end));
      }
      const cueOvs: Overlay[] = (s.cues ?? []).flatMap((c) => {
        const sb = subs.find((x) => x.text.startsWith(c.word));
        if (!sb) {
          warnings.push(`シーン${s.n}：字幕に「${c.word}」がないので「${c.text}」を出せない`);
          return [];
        }
        return [{ png: c.png, start: sb.start, end: Math.min(sb.start + c.len, s.dur), kind: c.kind, text: c.text }];
      });
      const all = [...s.overlays, ...cueOvs, ...subOvs];
      const file = overlay(base, all, s.dur, join(TMP, `scene${s.n}.mp4`));
      const audio = sceneAudio(s.n, s.dur, voice, from);
      const margin = voice ? s.dur - (from + voice.dur) : 0;
      if (voice && margin < 0.3) warnings.push(`シーン${s.n}：ナレーションの余りが ${margin.toFixed(1)} 秒（${s.dur} 秒の枠に ${voice.dur.toFixed(1)} 秒の声）`);
      built.push({
        n: s.n,
        file,
        audio,
        dur: s.dur,
        screen: s.screen,
        subs,
        narration: text,
        overlays: [...s.overlays, ...cueOvs].map(({ kind, text, start, end }) => ({ kind, text, start, end })),
        voice: voice ? { source: voice.source, start: from, dur: voice.dur, margin } : undefined,
      });
      console.log(`シーン${s.n}：${s.dur}秒${voice ? `（声 ${voice.source} ${voice.dur.toFixed(1)} 秒・余り ${margin.toFixed(1)} 秒）` : ""}`);
    };

    const s1 = at(ABUSE, "ステージ1を始める");
    const r1 = at(ABUSE, "画面：result1");
    const b2 = at(ABUSE, "結果1 → ブリーフィング（2050年）");
    const s2 = at(ABUSE, "2050年を始める");
    const r2 = at(ABUSE, "画面：result2");
    const p1 = at(PROPER, "ステージ1を始める");
    const pr1 = at(PROPER, "画面：result1");
    const p2 = at(PROPER, "2050年を始める");
    const pr2 = at(PROPER, "画面：result2");
    // タイトル画面（後ろで適正ボットが遊ぶデモが動いている）。シーン1と8で別の場面を使う
    if (at("title", "タイトル → 遊び方") < 38) throw new Error("title の録画のタイトル画面が短い（scripts/record-demo.ts の title で撮り直す）");

    // 0 つかみ（4秒）：2050年で膀胱が破られる直前
    await scene({
      n: 0,
      dur: 4,
      screen: "乱用の2050年、膀胱が破られる直前（等倍）",
      parts: [clip(ABUSE, r2 - 5, r2 - 1)],
      overlays: [await ov("big", script.get(0)?.main ?? "抗菌薬が、効かなくなる。", 0, 4)],
    });
    // 1 課題・作者紹介（22秒）：タイトル画面（後ろのデモが動く）。作者紹介は「そこで、…私が」に合わせて出す
    const intro = script.get(1)?.intro ?? [];
    await scene({
      n: 1,
      dur: 22,
      screen: "タイトル画面（後ろでボットが遊ぶデモが動く。等倍）＋ 作者紹介のカード",
      parts: [clip("title", 1, 23)],
      overlays: [],
      cues: intro.length ? [{ word: "そこで", len: 7.5, png: await render(page, "intro", intro[0]!, intro.slice(1)), kind: "intro", text: intro.join(" ／ ") }] : [],
    });
    // 2 遊び方（20秒）：ステージ1の始まり（×4）
    const sup2 = script.get(2)?.supplements[0];
    await scene({
      n: 2,
      dur: 20,
      screen: "乱用のステージ1の始まり（早送り ×4）。細菌が近づくにつれ、菌名・効かない薬が出る",
      parts: [clip(ABUSE, s1, s1 + 80, 4)],
      overlays: [await speedBadge(4, 0, 20), ...(sup2 ? [await ov("top", sup2, 0, 20)] : [])],
    });
    // 3 ステージ1 乱用（21秒）：残りを早送り（11秒）→ 結果1（10秒）。「ところが結果を見ると」を結果画面に合わせる
    const k3 = (r1 - (s1 + 80)) / 11;
    const sup3 = script.get(3)?.supplements[0];
    await scene({
      n: 3,
      dur: 21,
      screen: `乱用のステージ1の続き（早送り ×${Math.round(k3)}。カルバペネム系を連打して勝つ）→ 結果画面（等倍）`,
      parts: [clip(ABUSE, s1 + 80, r1, k3), clip(ABUSE, r1, r1 + 10)],
      overlays: [await speedBadge(k3, 0, 11), ...(sup3 ? [await ov("top", sup3, 11, 21)] : [])],
    });
    // 4 2050年 乱用（22秒）：推移の表（8秒）→ 2050年を早送り（11秒）→ 敗北（3秒）。題「あなたの選択が…」はナレーションに合わせる
    // （表を 9 → 8秒にしたのは、録音で「手札の薬が」の前にあける間を約1秒に縮め、1秒に5字で読んでも収まるようにするため。2026-11-05）
    const k4 = (r2 - s2) / 11;
    await scene({
      n: 4,
      dur: 22,
      screen: `2050年のブリーフィングと耐性率の推移の表（等倍）→ 乱用の2050年（早送り ×${Math.round(k4)}）→ 敗北`,
      parts: [clip(ABUSE, b2, b2 + 8), clip(ABUSE, s2, r2, k4), clip(ABUSE, r2, r2 + 3)],
      overlays: [await speedBadge(k4, 8, 19)],
      cues: [{ word: "あなたの選択が", len: 3.6, png: await render(page, "big", "あなたの選択が、未来の敵をつくる"), kind: "big", text: "あなたの選択が、未来の敵をつくる" }],
    });
    // 5 やり直し 適正（24秒）：ステージ1（14秒）→ 2050年（7秒）→ 守り切った（3秒）。
    // 最後は結果画面ではなく、盤面に「守り切った！」の帯と紙吹雪が出る場面を等倍で（2026-11-04 作者の判断「見せ方で対処」：
    // 適正でも上がる組が結果の表に大きく映り、「今度は2050年も守り切れました」と食い違って見えたため）
    const won2 = pr2 - 3.1;
    const k5a = (pr1 - p1) / 14;
    const k5b = (won2 - p2) / 7;
    const sup5 = script.get(5)?.supplements[0];
    await scene({
      n: 5,
      dur: 24,
      screen: `適正のステージ1（早送り ×${Math.round(k5a)}）→ 2050年（早送り ×${Math.round(k5b)}）→ 盤面の「守り切った！」と紙吹雪（等倍）`,
      parts: [clip(PROPER, p1, pr1, k5a), clip(PROPER, p2, won2, k5b), clip(PROPER, won2, pr2 - 0.1)],
      overlays: [await speedBadge(k5a, 0, 14), await speedBadge(k5b, 14, 21), ...(sup5 ? [await ov("top", sup5, 0, 24)] : [])],
    });
    // 6 教える側（38秒）：教員モードの録画（record-demo.ts の teacher）。
    // 入力（全体、8秒）→ Claude の作業を拡大して早送り（14秒）→ できたステージと承認・QR を拡大して下へ送る（10秒）→ 学生が遊ぶ（6秒）
    // 教員用の画面は字が小さいので、作業の記録（右の欄）を約1.8倍、できたステージを1.5倍に切り出す。補足の字幕は、拡大した画面に重ならない場面に出す
    const sup6 = script.get(6)?.supplements ?? [];
    const TEACHER = "teacher";
    const tReg = at(TEACHER, "地域：大阪府");
    const tGo = at(TEACHER, "ステージを作る");
    const tEnd = at(TEACHER, "設計の終わり：done");
    const tUrl = at(TEACHER, "学生用の URL");
    const tPlay = at(TEACHER, "できたステージを遊ぶ");
    const kIn = (tGo + 1 - (tReg - 1)) / 8;
    const kWork = (tEnd - (tGo + 1)) / 14;
    const kRes = (tUrl + 5 - tEnd) / 10;
    await scene({
      n: 6,
      dur: 38,
      screen: `教員モード：地域と教えたいことを入力（全体）→ Claude の作業の記録を拡大（早送り ×${Math.round(kWork)}）→ できたステージと承認・QR を拡大 → できたステージで遊ぶ`,
      parts: [
        clip(TEACHER, tReg - 1, tGo + 1, kIn),
        clip(TEACHER, tGo + 1, tEnd, kWork, "crop=1080:608:730:93"),
        clip(TEACHER, tEnd, tUrl + 5, kRes, "crop=w=1280:h=720:x=630:y='min(360,36*t)'"),
        clip(TEACHER, tPlay + 3, tPlay + 9),
      ],
      overlays: [
        ...(sup6[0] ? [await ov("top", sup6[0], 0, 8)] : []),
        await speedBadge(kWork, 8, 22, "speedLow"),
        ...(sup6[1] ? [await ov("top", sup6[1], 32, 38)] : []),
      ],
    });
    // 7 作り方（15秒）：scripts/make-scene7.ts が作った絵（開発の記録・データ監査・耐性モデルの比較・フック）を順に
    const sc7: [string, number][] = [
      ["git.png", 3],
      ["audit.png", 4],
      ["models.png", 4.5],
      ["hook.png", 3.5],
    ];
    const have7 = sc7.filter(([f]) => existsSync(join(REC, "scene7", f)));
    if (have7.length !== sc7.length) warnings.push(`シーン7：絵が足りない（${sc7.map(([f]) => f).filter((f) => !have7.some(([g]) => g === f)).join("・")}）。npx tsx scripts/make-scene7.ts で作る`);
    const scale7 = 15 / have7.reduce((a, [, d]) => a + d, 0);
    await scene({
      n: 7,
      dur: 15,
      screen: `開発の画面を順に：${have7.map(([f, d]) => `${{ "git.png": "Git の記録（期間中の開発）", "audit.png": "データ監査の報告", "models.png": "耐性モデル A/B の比較", "hook.png": "フックがコミットを止めた画面" }[f]}（${(d * scale7).toFixed(1)}秒）`).join(" → ")}`,
      parts: have7.map(([f, d]) => still(join(REC, "scene7", f), d * scale7)),
      overlays: [],
    });
    // 8 使い続ける場面（11秒）：タイトル画面（シーン1とは別の場面のデモ）
    const PLACES = ["病院実務実習", "院内の新人研修", "大学・専門学校の講義"];
    await scene({
      n: 8,
      dur: 11,
      screen: "タイトル画面（後ろのデモが動く。シーン1とは別の場面）＋ 右に使っていく場面",
      parts: [clip("title", 27, 38)],
      overlays: [{ ...(await ov("places", "使っていく場面", 0.3, 10.6, PLACES)), text: `使っていく場面：${PLACES.join(" ／ ")}` }],
    });
    // 9 エンドカード（2秒）
    const endLines = ["あそぶ：ph1125ks.github.io/Built-with-Claude-Japan-2026", "コード：github.com/ph1125ks/Built-with-Claude-Japan-2026"];
    await scene({ n: 9, dur: 2, screen: "エンドカード", parts: [still(await render(page, "card", "センタクアツ（仮）", endLines), 2)], overlays: [] });
    built.at(-1)!.overlays.push({ kind: "card", text: ["センタクアツ（仮）", ...endLines].join(" ／ "), start: 0, end: 2 });
  } finally {
    close();
  }

  // 映像と声をつなぎ、声の大きさをそろえて（EBU R128、-16 LUFS）重ねる
  const out = join(REC, "draft-video.mp4");
  concat(
    built.map((b) => b.file),
    join(TMP, "all.mp4"),
  );
  concat(
    built.map((b) => b.audio),
    join(TMP, "all.wav"),
  );
  ff(["-i", join(TMP, "all.mp4"), "-i", join(TMP, "all.wav"), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-shortest", out]);

  // ナレーションの字幕（.srt）：録音や YouTube の字幕の下書きに使う
  const ts = (t: number) => {
    const ms = Math.round(t * 1000);
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  let offset = 0;
  let k = 0;
  const srt: string[] = [];
  const report = [];
  for (const b of built) {
    for (const s of b.subs) srt.push(`${++k}\n${ts(offset + s.start)} --> ${ts(offset + s.end)}\n${s.text}\n`);
    report.push({ n: b.n, start: offset, dur: b.dur, screen: b.screen, narration: b.narration, voice: b.voice, subs: b.subs, overlays: b.overlays });
    offset += b.dur;
  }
  writeFileSync(join(REC, "draft-video.srt"), srt.join("\n"));
  if (offset > 180) warnings.push(`全体が ${offset} 秒で、3分を超えている`);
  // シーンごとの記録（絵コンテ表の元）
  writeFileSync(join(REC, "draft-video.json"), JSON.stringify({ made: new Date().toISOString(), total: offset, voice: values.voice, warnings, scenes: report }, null, 2));
  console.log(`→ ${out}（${offset} 秒）と draft-video.srt・draft-video.json`);
  for (const w of warnings) console.warn(`⚠ ${w}`);
}

await main();
