// 仮の動画（3分）を作る（docs/DEMO.md の時間配分どおり。音声はまだ入れない）。
// 録画（scripts/record-demo.ts の recordings/*.mp4 と目印の *.json）を切り出して早送りし、台本のナレーションを字幕にして重ね、つなぐ。
// 字幕は画面なしの Chrome で透明な PNG に描き、ffmpeg で重ねる（手元の ffmpeg には文字を描く機能がないため）。
//   npx tsx scripts/make-draft-video.ts [--rec recordings] [--seed 570]
//   → recordings/draft-video.mp4（1920×1080、30fps）と、ナレーションの字幕 recordings/draft-video.srt
// シーン6（教員モード）とシーン7（開発の画面）は、まだ撮るものがないので仮の画面にしている
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { openChrome, sleep, type Page } from "./lib/chrome.ts";

const { values } = parseArgs({
  options: {
    rec: { type: "string", default: "recordings" },
    seed: { type: "string", default: "570" },
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

/** ナレーションを字幕の区切りに分ける（句点で切り、長い文は読点で切る） */
function chunks(text: string, max = 32): string[] {
  const out: string[] = [];
  for (const s of text.match(/[^。]+。?/g) ?? [text]) {
    if (s.length <= max) {
      out.push(s);
      continue;
    }
    let cur = "";
    for (const part of s.match(/[^、]+、?/g) ?? [s]) {
      if (cur && (cur + part).length > max) {
        out.push(cur);
        cur = part;
      } else cur += part;
    }
    if (cur) out.push(cur);
  }
  return out.map((x) => x.trim()).filter(Boolean);
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
type Kind = "sub" | "top" | "big" | "intro" | "speed" | "card";

function html(kind: Kind, text: string, extra?: string[]): string {
  const base = `html,body{margin:0;width:${W}px;height:${H}px;font-family:${FONT};}`;
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
      return `<style>${base}div{position:absolute;right:60px;top:64px;padding:8px 20px;border-radius:999px;background:rgba(24,10,18,.78);color:#fff;font-size:30px;font-weight:700}</style><div>${esc(text)}</div>`;
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

/** 録画の from〜to 秒を speed 倍で切り出す。長さは (to - from) / speed */
function clip(take: string, from: number, to: number, speed = 1): string {
  const out = join(TMP, `seg${++segCount}.mp4`);
  ff(["-ss", String(from), "-t", String(to - from), "-i", join(REC, `${take}.mp4`), "-vf", `setpts=(PTS-STARTPTS)/${speed},fps=30,scale=${W}:${H}`, "-t", String((to - from) / speed), ...ENC, out]);
  return out;
}
/** 静止画を dur 秒の動画にする */
function still(png: string, dur: number): string {
  const out = join(TMP, `seg${++segCount}.mp4`);
  ff(["-loop", "1", "-t", String(dur), "-i", png, "-vf", `fps=30,scale=${W}:${H}`, ...ENC, out]);
  return out;
}
/** 録画の1コマを静止画にする */
function frame(take: string, t: number): string {
  const out = join(TMP, `frame${++segCount}.png`);
  ff(["-ss", String(t), "-i", join(REC, `${take}.mp4`), "-frames:v", "1", out]);
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

// ---------- 組み立て ----------

interface Built {
  n: number;
  file: string;
  dur: number;
  subs: { start: number; end: number; text: string }[];
}

async function main(): Promise<void> {
  const script = readScript();
  const { page, close } = await openChrome({ width: W, height: H });
  const built: Built[] = [];
  try {
    /** ナレーションを、シーンの長さに文字数の割合で割り振った字幕にする */
    const narrationSubs = async (n: number, dur: number, from = 0.3): Promise<{ ovs: Overlay[]; subs: Built["subs"] }> => {
      const text = script.get(n)?.narration;
      if (!text) return { ovs: [], subs: [] };
      const parts = chunks(text);
      const total = parts.reduce((s, p) => s + p.length, 0);
      const span = dur - from - 0.3;
      let t = from;
      const ovs: Overlay[] = [];
      const subs: Built["subs"] = [];
      for (const p of parts) {
        const d = (span * p.length) / total;
        ovs.push({ png: await render(page, "sub", p), start: t, end: t + d });
        subs.push({ start: t, end: t + d, text: p });
        t += d;
      }
      return { ovs, subs };
    };
    const speedBadge = async (k: number, start: number, end: number): Promise<Overlay> => ({ png: await render(page, "speed", `早送り ×${Math.round(k)}`), start, end });

    const s1 = at(ABUSE, "ステージ1を始める");
    const r1 = at(ABUSE, "画面：result1");
    const b2 = at(ABUSE, "結果1 → ブリーフィング（2050年）");
    const s2 = at(ABUSE, "2050年を始める");
    const r2 = at(ABUSE, "画面：result2");
    const p1 = at(PROPER, "ステージ1を始める");
    const pr1 = at(PROPER, "画面：result1");
    const p2 = at(PROPER, "2050年を始める");
    const pr2 = at(PROPER, "画面：result2");
    const title = frame("title", 3);

    const scene = async (n: number, dur: number, parts: string[], extra: Overlay[], narrationFrom = 0.3) => {
      const base = parts.length === 1 ? parts[0]! : concat(parts, join(TMP, `base${n}.mp4`));
      const { ovs, subs } = await narrationSubs(n, dur, narrationFrom);
      const file = overlay(base, [...extra, ...ovs], dur, join(TMP, `scene${n}.mp4`));
      built.push({ n, file, dur, subs });
      console.log(`シーン${n}：${dur}秒`);
    };

    // 0 つかみ（4秒）：2050年で膀胱が破られる直前
    await scene(0, 4, [clip(ABUSE, r2 - 5, r2 - 1)], [{ png: await render(page, "big", script.get(0)?.main ?? "抗菌薬が、効かなくなる。"), start: 0, end: 4 }]);
    // 1 課題・作者紹介（20秒）：タイトル
    const intro = script.get(1)?.intro ?? [];
    // 作者紹介のカードは、タイトルを見せたあと（11〜18秒）に出す（タイトルの文字に重なるため）
    await scene(1, 20, [still(title, 20)], intro.length ? [{ png: await render(page, "intro", intro[0]!, intro.slice(1)), start: 11, end: 18 }] : []);
    // 2 遊び方（20秒）：ステージ1の始まり（×4）
    const sup2 = script.get(2)?.supplements[0];
    await scene(2, 20, [clip(ABUSE, s1, s1 + 80, 4)], [await speedBadge(4, 0, 20), ...(sup2 ? [{ png: await render(page, "top", sup2), start: 0, end: 20 }] : [])]);
    // 3 ステージ1 乱用（22秒）：残りを早送り（12秒）→ 結果1（10秒）
    const k3 = (r1 - (s1 + 80)) / 12;
    await scene(3, 22, [clip(ABUSE, s1 + 80, r1, k3), clip(ABUSE, r1, r1 + 10)], [
      await speedBadge(k3, 0, 12),
      ...(script.get(3)?.supplements[0] ? [{ png: await render(page, "top", script.get(3)!.supplements[0]!), start: 12, end: 22 }] : []),
    ]);
    // 4 2050年 乱用（22秒）：推移の表（9秒）→ 2050年を早送り（10秒）→ 敗北（3秒）。最後に大きく題
    const k4 = (r2 - s2) / 10;
    await scene(4, 22, [clip(ABUSE, b2, b2 + 9), clip(ABUSE, s2, r2, k4), clip(ABUSE, r2, r2 + 3)], [
      await speedBadge(k4, 9, 19),
      { png: await render(page, "big", "あなたの選択が、未来の敵をつくる"), start: 19, end: 22 },
    ]);
    // 5 やり直し 適正（24秒）：ステージ1（14秒）→ 2050年（7秒）→ 守り切った（3秒）
    const k5a = (pr1 - p1) / 14;
    const k5b = (pr2 - p2) / 7;
    await scene(5, 24, [clip(PROPER, p1, pr1, k5a), clip(PROPER, p2, pr2, k5b), clip(PROPER, pr2, pr2 + 3)], [
      await speedBadge(k5a, 0, 14),
      await speedBadge(k5b, 14, 21),
      ...(script.get(5)?.supplements[0] ? [{ png: await render(page, "top", script.get(5)!.supplements[0]!), start: 0, end: 24 }] : []),
    ]);
    // 6 教える側（40秒）：教員モードはまだないので仮の画面。補足の字幕は順に出す
    const sup6 = script.get(6)?.supplements ?? [];
    const ov6: Overlay[] = [];
    for (const [i, t] of sup6.entries()) ov6.push({ png: await render(page, "top", t), start: (40 / sup6.length) * i, end: (40 / sup6.length) * (i + 1) });
    await scene(6, 40, [still(await render(page, "card", "シーン6　教える側：Claude がステージを作る", ["（教員モードの画面は、これから作って収録します）"]), 40)], ov6);
    // 7 作り方（15秒）：仮の画面
    await scene(7, 15, [still(await render(page, "card", "シーン7　作り方：Claude Code を中心にした開発", ["（データ監査のサブエージェント・耐性モデルの比較・コミット前のフックの画面を、あとで差し込みます）"]), 15)], []);
    // 8 使い続ける場面（11秒）：タイトル
    await scene(8, 11, [still(title, 11)], [{ png: await render(page, "top", "病院実務実習 ／ 院内の新人研修 ／ 大学・専門学校の講義"), start: 0, end: 6 }]);
    // 9 エンドカード（2秒）
    await scene(9, 2, [still(await render(page, "card", "センタクアツ（仮）", ["あそぶ：ph1125ks.github.io/Built-with-Claude-Japan-2026", "コード：github.com/ph1125ks/Built-with-Claude-Japan-2026"]), 2)], []);
  } finally {
    close();
  }

  const out = join(REC, "draft-video.mp4");
  concat(built.map((b) => b.file), join(TMP, "all.mp4"));
  ff(["-i", join(TMP, "all.mp4"), "-c", "copy", out]);
  // ナレーションの字幕（.srt）：録音や YouTube の字幕の下書きに使う
  const ts = (t: number) => {
    const ms = Math.round(t * 1000);
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  let offset = 0;
  let k = 0;
  const srt: string[] = [];
  for (const b of built) {
    for (const s of b.subs) srt.push(`${++k}\n${ts(offset + s.start)} --> ${ts(offset + s.end)}\n${s.text}\n`);
    offset += b.dur;
  }
  writeFileSync(join(REC, "draft-video.srt"), srt.join("\n"));
  console.log(`→ ${out}（${offset} 秒）と draft-video.srt`);
}

await main();
