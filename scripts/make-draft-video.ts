// 仮の動画（3分）を作る（docs/DEMO.md の時間配分どおり。台本 第2版、2026-11-05）。
// 録画（scripts/record-demo.ts の recordings/*.mp4 と目印の *.json）を切り出して早送りし、台本のナレーションを字幕と声にして重ね、つなぐ。
// 冒頭の図は scripts/make-hook-chart.ts（recordings/hook/hook.mp4）、シーン7の絵は scripts/make-scene7.ts（recordings/scene7/）。
// BGM：scripts/make-bgm.ts があれば、シーンの区切りから曲の区間（cue）を作って合成し、声の下で小さく流す（声が出ている間はさらに下げる）
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
  /** シーン8：使っていく場面（「**使っていく場面**」の下の箇条書き） */
  places: string[];
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
    const placeBlock = part.match(/\*\*使っていく場面\*\*[^\n]*\n((?:[ \t]+- .+\n)+)/)?.[1];
    const places = placeBlock ? placeBlock.split("\n").map((l) => l.replace(/^\s+- /, "").trim()).filter(Boolean) : [];
    out.set(n, { narration, main, supplements, intro, places });
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
type Kind = "sub" | "top" | "big" | "intro" | "speed" | "speedLow" | "places" | "card" | "loop" | "fact" | "compare";

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
    case "loop": {
      // シーン7（教える側）の工程の図。text は光らせる段階（"3+" は、直したあとの2回目）。言葉は docs/PLAIN-LANGUAGE.md
      const active = Number(text.replace("+", ""));
      const again = text.endsWith("+");
      const steps = [
        ["データを読む", "地域の公開データ・使える薬"],
        ["案を作る", "見本をもとに手札と敵の出し方"],
        ["試す", "自動のプレイヤー4種 × 60回"],
        ["直す", "目安に近い・届かない点を"],
        ["提出", "別の条件で100回ずつ確かめ直す"],
      ];
      const rows = steps
        .map(([a, b], i) => {
          const n = i + 1;
          const state = n === active ? "on" : n < active || (again && n === 4) ? "done" : "todo";
          const label = n === 3 && again ? `${a}（2回目）` : a;
          return `<li class="${state}"><i>${n < active || (again && n === 4) ? "✓" : n}</i><span><b>${esc(label!)}</b><small>${esc(b!)}</small></span></li>`;
        })
        .join("");
      return `<style>${base}div{position:absolute;right:36px;top:170px;width:380px;box-sizing:border-box;padding:16px 18px 12px;background:rgba(14,9,22,.92);box-shadow:inset 6px 0 0 #3be0c6;color:#fff}h2{margin:0 0 10px;font-size:24px;color:#3be0c6;letter-spacing:.08em}ol{list-style:none;margin:0;padding:0}li{display:flex;gap:14px;align-items:center;padding:8px 10px;margin:4px 0}li i{font-style:normal;width:40px;height:40px;display:grid;place-items:center;font-size:24px;font-weight:800;background:#2a2238;flex:none}li b{display:block;font-size:26px}li small{display:block;font-size:16px;color:#a493b6}li.on{background:#3be0c6;color:#0b0812}li.on i{background:#0b0812;color:#3be0c6}li.on small{color:#0b3a33}li.done{opacity:.55}li.todo{opacity:.4}p{margin:10px 0 0;font-size:18px;color:#a493b6}</style><div><h2>AI（Claude）の作業の流れ</h2><ol>${rows}</ol><p>③と④を、目安を満たすまでくり返す</p></div>`;
    }
    case "fact":
      // シーン7：Claude が自分で見つけて直した数字（右下。字幕の上）
      return `<style>${base}div{position:absolute;right:36px;bottom:160px;width:380px;box-sizing:border-box;padding:14px 18px;background:rgba(14,9,22,.92);box-shadow:inset 6px 0 0 #ffb347;color:#fff}h2{margin:0;font-size:22px;color:#ffb347}b{display:block;font-size:48px;font-weight:800;margin:4px 0;white-space:nowrap}p{margin:0;font-size:18px;color:#cdbfe0;line-height:1.45}</style><div><h2>${esc(text)}</h2><b>${esc(extra?.[0] ?? "")}</b><p>${esc(extra?.[1] ?? "")}</p></div>`;
    case "compare": {
      // シーン6の最後：1回目（切り札を連打）と2回目（その細菌に合う薬へ）の並べ比べ。text は JSON
      const cols = JSON.parse(text) as { head: string; rows: string[]; bad: boolean }[];
      const col = (c: { head: string; rows: string[]; bad: boolean }) =>
        `<section class="${c.bad ? "bad" : "good"}"><h2>${esc(c.head)}</h2>${c.rows.map((r) => `<p>${esc(r)}</p>`).join("")}</section>`;
      return `<style>${base}body{background:#0b0812;color:#f4ecf7;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:34px}h1{margin:0;font-size:46px;letter-spacing:.04em}div{display:flex;gap:40px}section{width:720px;padding:30px 36px;background:#160f22}section.bad{box-shadow:inset 0 0 0 4px #ff6352}section.good{box-shadow:inset 0 0 0 4px #3be0c6}h2{margin:0 0 18px;font-size:40px}section.bad h2{color:#ff8a7a}section.good h2{color:#3be0c6}p{margin:12px 0;font-size:32px;font-weight:700}</style><h1>同じ細菌、同じ手札。ちがうのは選び方だけ</h1><div>${cols.map(col).join("")}</div>`;
    }
    case "card":
      return `<style>${base}body{background:linear-gradient(135deg,#3b0a24,#7a1e45);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;text-align:center}h1{margin:0;font-size:72px}p{margin:0;font-size:36px;opacity:.92;max-width:1500px}</style><h1>${esc(text)}</h1>${(extra ?? []).map((l) => `<p>${esc(l)}</p>`).join("")}`;
  }
}

/** 順に（同じページで描くので、並べて動かさない） */
async function seq<T>(fs: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = [];
  for (const f of fs) out.push(await f());
  return out;
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

// 色の範囲は tv（限定範囲）にそろえる。録画（pc）と、図や静止画（tv）が1つのシーンで混ざると、つなぎ目でフィルタが組み直され、
// 字幕の重ね合わせが消える（2026-11-05、シーン0で起きた）。動画全体でもそろえておく。色の行列は録画と同じ bt470bg（図や静止画も
// RGB からの変換は既定で同じ行列なので、印を付けるだけで色は変わらない）。印がないと x264 が範囲を書かず「未指定」と読まれる
const COLOR = "setparams=range=tv:colorspace=bt470bg";
const ENC = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt470bg", "-r", "30"];
let segCount = 0;
const ff = (args: string[]) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: "inherit" });
const probe = (file: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

/** 録画の from〜to 秒を speed 倍で切り出す。長さは (to - from) / speed。crop は拡大する範囲（ffmpeg の crop。t は切り出した部品の中の秒） */
function clip(take: string, from: number, to: number, speed = 1, crop?: string): string {
  const out = join(TMP, `seg${++segCount}.mp4`);
  const vf = [`setpts=(PTS-STARTPTS)/${speed}`, "fps=30", ...(crop ? [crop] : []), `scale=${W}:${H}:flags=lanczos:out_range=tv`, COLOR].join(",");
  ff(["-ss", String(from), "-t", String(to - from), "-i", join(REC, `${take}.mp4`), "-vf", vf, "-t", String((to - from) / speed), ...ENC, out]);
  return out;
}
/** 録画以外の動画ファイル（冒頭の図など）を、頭から dur 秒の部品にする */
function fileClip(file: string, dur: number): string {
  const out = join(TMP, `seg${++segCount}.mp4`);
  ff(["-i", file, "-vf", `fps=30,scale=${W}:${H}:out_range=tv,${COLOR}`, "-t", String(dur), ...ENC, out]);
  return out;
}
/** 静止画を dur 秒の動画にする */
function still(png: string, dur: number): string {
  const out = join(TMP, `seg${++segCount}.mp4`);
  ff(["-loop", "1", "-t", String(dur), "-i", png, "-vf", `fps=30,scale=${W}:${H}:out_range=tv,${COLOR}`, ...ENC, out]);
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

    // 台本 第3版（2026-11-05。すべての人に伝わるように。docs/DEMO.md・docs/PLAIN-LANGUAGE.md）
    // 0 つかみ（12.5秒）：2050年の試算の図（9.5秒。scripts/make-hook-chart.ts）→ ゲームの2050年で膀胱が破られる直前（3秒）
    const HOOK = join(REC, "hook", "hook.mp4");
    if (!existsSync(HOOK)) throw new Error("冒頭の図がない（npx tsx scripts/make-hook-chart.ts で作る）");
    const hookDur = probe(HOOK);
    await scene({
      n: 0,
      dur: 12,
      screen: "図「薬剤耐性（AMR）に起因する死亡者数の推定（年間）」：2050年の棒が 1,000万人まで伸び、がんを超える（O'Neill 2014 p.5 の数値から描いた）→ 乱用の2050年、膀胱が破られる直前（等倍）",
      parts: [fileClip(HOOK, hookDur), clip(ABUSE, r2 - 1 - (12 - hookDur), r2 - 1)],
      overlays: [await ov("big", script.get(0)?.main ?? "抗菌薬が、効かなくなる。", hookDur, 12)],
    });
    // 1 誰が・なぜ（16.5秒）：タイトル画面（後ろのデモが動く）。作者紹介は「病院で」（名乗りの文）に合わせて出す
    const intro = script.get(1)?.intro ?? [];
    await scene({
      n: 1,
      dur: 15.5,
      screen: "タイトル画面（後ろでボットが遊ぶデモが動く。等倍）＋ 作者紹介のカード",
      parts: [clip("title", 1, 16.5)],
      overlays: [],
      cues: intro.length ? [{ word: "病院で", len: 7, png: await render(page, "intro", intro[0]!, intro.slice(1)), kind: "intro", text: intro.join(" ／ ") }] : [],
    });
    // 2 しくみ（30.5秒）：「はじめての人へ」のページの動画用の見せ方（intro.html?present=1）の録画（record-demo.ts の intro）。
    // ないときは、前提の鎖の文を並べた仮の絵にする
    const INTRO_TAKE = "intro";
    const sup2 = script.get(2)?.supplements ?? [];
    const introParts = existsSync(join(REC, `${INTRO_TAKE}.mp4`))
      ? (() => {
          // 見せ方の 2.（抗菌薬）から。1.（細菌、4.5秒）は使わない（src/intro/present-plan.ts）
          const i0 = at(INTRO_TAKE, "見せ方の始まり") + 4.5;
          return [clip(INTRO_TAKE, i0, i0 + 34)];
        })()
      : (warnings.push("シーン2：しくみの録画（recordings/intro.mp4）がないので、仮の絵にした（record-demo.ts --take intro で撮る）"),
        [still(await render(page, "card", "しくみ（仮の絵）", ["抗菌薬（いわゆる抗生物質）は、細菌を倒す薬", "薬ごとに効く細菌が違い、ほとんどに効く「切り札」もある", "はじめは細菌が分からないので、切り札が選ばれがち", "薬を使うと、効かない細菌だけが残って増える＝選択圧"]), 34)]);
    await scene({
      n: 2,
      dur: 34,
      screen: "「はじめての人へ」の動画用の見せ方：細菌を倒す兵士（抗菌薬）→ 細菌 × 薬の表（切り札はほとんどに効く）→ 遠く・中ほど・近くで分かること（検査の結果が数日かけて届く）→ 薬をかけると効かない細菌だけが残って増える（選択圧）",
      parts: introParts,
      overlays: [],
      cues: [
        ...(sup2[0] ? [{ word: "抗菌薬、", len: 5, png: await render(page, "top", sup2[0]), kind: "top" as Kind, text: sup2[0] }] : []),
        ...(sup2[1] ? [{ word: "薬ごとに", len: 6, png: await render(page, "top", sup2[1]), kind: "top" as Kind, text: sup2[1] }] : []),
        ...(sup2[2] ? [{ word: "これが", len: 4, png: await render(page, "top", sup2[2]), kind: "top" as Kind, text: sup2[2] }] : []),
      ],
    });
    // 3 遊び方（9.5秒）：ステージ1の始まり（×4）
    const sup3 = script.get(3)?.supplements[0];
    await scene({
      n: 3,
      dur: 10.5,
      screen: "乱用のステージ1の始まり（早送り ×4）。細菌が近づくにつれ、名前・効かない薬が出る",
      parts: [clip(ABUSE, s1, s1 + 42, 4)],
      overlays: [await speedBadge(4, 0, 10.5), ...(sup3 ? [await ov("top", sup3, 0, 10.5)] : [])],
    });
    // 4 ステージ1 乱用（15秒）：残りを早送り（7秒）→ 結果1（8秒。いちばん上に原因の一文）。「ところが」を結果画面に合わせる
    const k4 = (r1 - (s1 + 42)) / 7;
    const sup4 = script.get(4)?.supplements[0];
    await scene({
      n: 4,
      dur: 14.5,
      screen: `乱用のステージ1の続き（早送り ×${Math.round(k4)}。切り札のカルバペネム系を連打して勝つ）→ 結果画面（等倍。いちばん上に原因の一文）`,
      parts: [clip(ABUSE, s1 + 42, r1, k4), clip(ABUSE, r1, r1 + 7.5)],
      overlays: [await speedBadge(k4, 0, 7), ...(sup4 ? [await ov("top", sup4, 7, 14.5)] : [])],
    });
    // 5 2050年 乱用（16秒）：推移の表（6秒）→ 2050年を早送り（7秒）→ 敗北（3秒）。題「あなたの選択が…」と名前の由来はナレーションに合わせる
    const k5 = (r2 - s2) / 7.5;
    const sup5 = script.get(5)?.supplements[0];
    await scene({
      n: 5,
      dur: 16.5,
      screen: `2050年のブリーフィングと耐性率の推移の表（等倍）→ 乱用の2050年（早送り ×${Math.round(k5)}）→ 敗北`,
      parts: [clip(ABUSE, b2, b2 + 6), clip(ABUSE, s2, r2, k5), clip(ABUSE, r2, r2 + 3)],
      overlays: [await speedBadge(k5, 6, 13.5)],
      cues: [
        { word: "あなたの選択が", len: 3.6, png: await render(page, "big", "あなたの選択が、未来の敵をつくる"), kind: "big", text: "あなたの選択が、未来の敵をつくる" },
        ...(sup5 ? [{ word: "あなたの選択が", len: 3.6, png: await render(page, "top", sup5), kind: "top" as Kind, text: sup5 }] : []),
      ],
    });
    // 6 やり直し 適正（17.5秒）：ステージ1（9秒）→ 2050年（3.5秒）→ 守り切った（2秒）→ 1回目と2回目の並べ比べ（3秒）。
    // 最後は結果画面ではなく、盤面に「守り切った！」の帯と紙吹雪が出る場面（2026-11-04 作者の判断「見せ方で対処」）。
    // 並べ比べの数字は、録画（種 570・モデル A）の結果画面の値（2026-11-05 に確かめた）：
    //   乱用：ステージ1の切り札（カルバペネム系）100% → 2050年に膀胱が破られた（手札のどの薬も効かない細菌 12%）
    //   適正：ステージ1の切り札 3% → 2050年も守り切った（膀胱 88／100、手札のどの薬も効かない細菌 0%）
    const won2 = pr2 - 3.1;
    const k6a = (pr1 - p1) / 8;
    const k6b = (won2 - p2) / 3.5;
    const sup6 = script.get(6)?.supplements[0];
    const COMPARE = [
      { head: "1回目：切り札を連打", rows: ["ステージ1で切り札（カルバペネム系）を 100%", "2050年：膀胱が破られた", "手札のどの薬も効かない細菌 12%"], bad: true },
      { head: "2回目：その細菌に合う薬へ", rows: ["ステージ1で切り札（カルバペネム系）を 3%", "2050年：守り切った（膀胱 88／100）", "手札のどの薬も効かない細菌 0%"], bad: false },
    ];
    await scene({
      n: 6,
      dur: 16,
      screen: `適正のステージ1（早送り ×${Math.round(k6a)}）→ 2050年（早送り ×${Math.round(k6b)}）→ 盤面の「守り切った！」（等倍）→ 1回目と2回目の並べ比べ`,
      parts: [clip(PROPER, p1, pr1, k6a), clip(PROPER, p2, won2, k6b), clip(PROPER, won2, won2 + 2), still(await render(page, "compare", JSON.stringify(COMPARE)), 2.5)],
      overlays: [await speedBadge(k6a, 0, 8), await speedBadge(k6b, 8, 11.5), ...(sup6 ? [await ov("top", sup6, 0, 13.5)] : [])],
    });
    built.at(-1)!.overlays.push({ kind: "compare", text: COMPARE.map((c) => `${c.head}：${c.rows.join("／")}`).join(" ｜ "), start: 13.5, end: 16 });
    // 7 教える側（34秒）：教員モードの録画（record-demo.ts の teacher。本物の Claude を動かした回）。
    // 入力（全体、7秒）→ Claude の作業を拡大（17秒。自分で見つけて直す場面はゆっくり）→ できたステージと承認・QR（6秒）→ 学生が遊ぶ（4秒）
    // 作業の記録の時刻（録画の秒）：1回目のシミュレーションの合格が約40秒、「乱用の2050年の勝率 27% は上限 30% に近い」と書いて
    // 波を増やすのが約48秒、2回目（17%）が約72秒、提出が約78秒から（2026-11-05 に録画のコマを見て確かめた）
    const sup7 = script.get(7)?.supplements ?? [];
    const TEACHER = "teacher";
    const tReg = at(TEACHER, "地域：大阪府");
    const tGo = at(TEACHER, "ステージを作る");
    const tEnd = at(TEACHER, "設計の終わり：done");
    const tUrl = at(TEACHER, "学生用の URL");
    const tPlay = at(TEACHER, "できたステージを遊ぶ");
    const kIn = (tGo + 1 - (tReg - 1)) / 7;
    // 作業の記録の欄を約1.33倍にして左に寄せ、右の約400px を工程の図と直した数字の欄にする
    // （約1.8倍で画面いっぱいにすると、右の図が Claude の書いた肝心の一文の右端を隠した。2026-11-05）
    const WORK = "crop=1080:608:730:93,scale=1440:810:flags=lanczos,pad=1920:1080:40:135:color=0x0d0915";
    // 作業の区切り（録画の秒、速さ）。合わせて17秒にする
    const wA = [tGo + 1, 44, 9] as const; // データを読む → 案 → 1回目の試し
    const wB = [44, 56, 2] as const; // 1回目の結果と「27% は上限に近い → 波を増やす」（ゆっくり）
    const wC = [56, 78, 7] as const; // 2回目の試し（17%）
    const dA = (wA[1] - wA[0]) / wA[2];
    const dB = (wB[1] - wB[0]) / wB[2];
    const dC = (wC[1] - wC[0]) / wC[2];
    const WORKLEN = 17;
    const kD = (tEnd - 78) / (WORKLEN - dA - dB - dC); // 提出
    const kRes = (tUrl + 5 - tEnd) / 6;
    const w0 = 7; // 作業の場面が始まる秒（シーンの中）
    const at7 = (rec: number) => {
      // 録画の秒 → シーンの中の秒
      if (rec <= wA[1]) return w0 + (rec - wA[0]) / wA[2];
      if (rec <= wB[1]) return w0 + dA + (rec - wB[0]) / wB[2];
      if (rec <= wC[1]) return w0 + dA + dB + (rec - wC[0]) / wC[2];
      return w0 + dA + dB + dC + (rec - 78) / kD;
    };
    const loopAt: [string, number, number][] = [
      ["1", at7(tGo + 1), at7(20)],
      ["2", at7(20), at7(37)],
      ["3", at7(37), at7(47)],
      ["4", at7(47), at7(58)],
      ["3+", at7(58), at7(77)],
      ["5", at7(77), w0 + WORKLEN],
    ];
    const factHead = "切り札を使い続けても、2050年を守れてしまう割合";
    const factNote = "目安は 30% 以下（低いほど、乱用では勝てない）。合格していたが、上限に近いので、AI が自分で敵を増やして確かめ直した";
    await scene({
      n: 7,
      dur: 34,
      screen: `教員モード：地域と教えたいことを入力（全体）→ AI（Claude）の作業の記録を拡大（早送り ×${wA[2]} → 自分で直す場面 ×${wB[2]} → ×${wC[2]} → ×${Math.round(kD)}）＋ 右に工程の図・右下に直した数字 → できたステージと承認・QR を拡大 → できたステージで遊ぶ`,
      parts: [
        clip(TEACHER, tReg - 1, tGo + 1, kIn),
        clip(TEACHER, wA[0], wA[1], wA[2], WORK),
        clip(TEACHER, wB[0], wB[1], wB[2], WORK),
        clip(TEACHER, wC[0], wC[1], wC[2], WORK),
        clip(TEACHER, 78, tEnd, kD, WORK),
        clip(TEACHER, tEnd, tUrl + 5, kRes, "crop=w=1280:h=720:x=630:y='min(360,60*t)'"),
        clip(TEACHER, tPlay + 3, tPlay + 7),
      ],
      overlays: [
        ...(sup7[0] ? [await ov("top", sup7[0], 0, 3.5)] : []),
        ...(sup7[1] ? [await ov("top", sup7[1], 3.5, 7)] : []),
        await speedBadge(wA[2], w0, w0 + dA, "speedLow"),
        await ov("speedLow", `ゆっくり ×${wB[2]}`, w0 + dA, w0 + dA + dB),
        await speedBadge(wC[2], w0 + dA + dB, w0 + dA + dB + dC, "speedLow"),
        await speedBadge(kD, w0 + dA + dB + dC, w0 + WORKLEN, "speedLow"),
        ...(await seq(loopAt.map(([k, a, b]) => () => ov("loop", k, a, b)))),
        { ...(await ov("fact", factHead, at7(48), at7(72), ["27% → ？", factNote])), text: `${factHead} 27%（上限 30% に近い）→ 敵を増やす` },
        { ...(await ov("fact", factHead, at7(72), w0 + WORKLEN, ["27% → 17%", factNote])), text: `${factHead} 27% → 17%` },
        ...(sup7[2] ? [await ov("top", sup7[2], 30, 34)] : []),
      ],
    });
    // 8 作り方（11.5秒）：scripts/make-scene7.ts が作った絵（開発の記録・スキルの評価・データ監査・フック）を順に
    const sc8: [string, number][] = [
      ["git.png", 2.6],
      ["eval.png", 3.6],
      ["audit.png", 2.7],
      ["hook.png", 2.6],
    ];
    const have8 = sc8.filter(([f]) => existsSync(join(REC, "scene7", f)));
    if (have8.length !== sc8.length) warnings.push(`シーン8：絵が足りない（${sc8.map(([f]) => f).filter((f) => !have8.some(([g]) => g === f)).join("・")}）。npx tsx scripts/make-scene7.ts で作る`);
    const scale8 = 10.5 / have8.reduce((a, [, d]) => a + d, 0);
    const name8: Record<string, string> = { "git.png": "Git の記録（期間中の開発）", "eval.png": "スキル（知識のメモ）の評価", "audit.png": "サブエージェント（確認係の AI）のデータ照合", "hook.png": "フック（見張り）がコミットを止めた画面" };
    await scene({
      n: 8,
      dur: 10.5,
      screen: `開発の画面を順に：${have8.map(([f, d]) => `${name8[f]}（${(d * scale8).toFixed(1)}秒）`).join(" → ")}`,
      parts: have8.map(([f, d]) => still(join(REC, "scene7", f), d * scale8)),
      overlays: [],
    });
    // 9 使い続ける場面・締め（13.5秒）：タイトル画面（シーン1とは別の場面のデモ）
    const PLACES = script.get(9)?.places?.length ? script.get(9)!.places! : ["病院実務実習", "院内の新人研修", "大学・専門学校の講義"];
    await scene({
      n: 9,
      dur: 13.5,
      screen: "タイトル画面（後ろのデモが動く。シーン1とは別の場面）＋ 右に使っていく場面",
      parts: [clip("title", 25, 38.5)],
      overlays: [{ ...(await ov("places", "使っていく場面", 0.3, 13.2, PLACES)), text: `使っていく場面：${PLACES.join(" ／ ")}` }],
    });
    // 10 エンドカード（2.5秒）
    const endLines = [
      "未来の耐性菌は、いまの一手で減らせる。",
      "あそぶ：ph1125ks.github.io/Built-with-Claude-Japan-2026",
      "はじめての人へ・Claude の作業記録：同じサイトの intro.html・replay.html",
      "コード：github.com/ph1125ks/Built-with-Claude-Japan-2026",
    ];
    await scene({ n: 10, dur: 2, screen: "エンドカード", parts: [still(await render(page, "card", "センタクアツ（仮）", endLines), 2)], overlays: [] });
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
  // BGM：シーンの区切りから曲の区間を作り、scripts/make-bgm.ts で合成する（このリポジトリのコードで作った曲だけを使う）
  const bgm = makeBgm(built, warnings);
  if (bgm) {
    // 声の大きさをそろえてから、BGM を声の下に小さく重ねる。声が出ている間は、さらに下げる（サイドチェーンのコンプレッサー）
    const mix =
      `[1:a]aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11,asplit=2[v1][v2];` +
      `[2:a]aresample=48000,aformat=channel_layouts=stereo,volume=${BGM_DB}dB[b];` +
      `[b][v2]sidechaincompress=threshold=0.02:ratio=4:attack=20:release=400[bd];` +
      `[v1][bd]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89[out]`;
    ff(["-i", join(TMP, "all.mp4"), "-i", join(TMP, "all.wav"), "-i", bgm, "-filter_complex", mix, "-map", "0:v", "-map", "[out]", "-c:v", "copy", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-shortest", out]);
  } else ff(["-i", join(TMP, "all.mp4"), "-i", join(TMP, "all.wav"), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-shortest", out]);

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

/** BGM の大きさ（make-bgm.ts の書き出しは約 -18 LUFS。声（-16 LUFS）より 12 dB ほど下に置き、声の間はさらに下がる） */
const BGM_DB = -10;
/** シーンごとの曲の気分（scripts/make-bgm.ts の mood） */
const MOOD: Record<number, string> = { 0: "hook", 1: "play", 2: "build", 3: "play", 4: "play", 5: "tension", 6: "hope", 7: "build", 8: "build", 9: "outro", 10: "outro" };

/** シーンの区切りから cue を作り、BGM を合成する。スクリプトがない・失敗したときは BGM なしで続ける */
function makeBgm(built: Built[], warnings: string[]): string | null {
  if (!existsSync("scripts/make-bgm.ts")) {
    warnings.push("BGM：scripts/make-bgm.ts がないので、BGM なしで書き出した");
    return null;
  }
  const dir = join(REC, "bgm");
  mkdirSync(dir, { recursive: true });
  const sections: { from: number; to: number; mood: string }[] = [];
  const hits: number[] = [];
  let t = 0;
  for (const b of built) {
    const mood = MOOD[b.n] ?? "build";
    const last = sections.at(-1);
    if (last && last.mood === mood) last.to = t + b.dur;
    else {
      sections.push({ from: t, to: t + b.dur, mood });
      if (t > 0) hits.push(t);
    }
    // シーン0の中で、図からゲームの場面に切り替わるところ
    if (b.n === 0) {
      const cut = b.overlays.find((o) => o.kind === "big")?.start;
      if (cut) hits.push(cut);
    }
    t += b.dur;
  }
  const cues = join(dir, "cues.json");
  writeFileSync(cues, JSON.stringify({ total: t, sections, hits: hits.sort((a, b) => a - b) }, null, 2));
  const out = join(dir, "bgm.wav");
  try {
    execFileSync("npx", ["tsx", "scripts/make-bgm.ts", "--cues", cues, "--out", out], { stdio: "inherit" });
    return out;
  } catch (e) {
    warnings.push(`BGM：合成に失敗したので、BGM なしで書き出した（${(e as Error).message.split("\n")[0]}）`);
    return null;
  }
}

await main();
