// デモ動画の絵コンテ表（1枚の HTML）を作る。scripts/make-draft-video.ts の書き出し（recordings/draft-video.mp4・draft-video.json）から、
// シーンごとの時刻・長さ・サムネイル・画面・テロップ・ナレーションと声の余りを並べ、縮小版の動画を添える。
// 直しを「シーン3」「0:52 の字幕」のように時間やシーン番号で伝えるためのもの（Discord のオフィスアワーの助言）。
//   npx tsx scripts/make-storyboard.ts
//   → recordings/storyboard/index.html と preview.mp4（960×540）・thumbs/*.jpg（Git に入れない）
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REC = "recordings";
const OUT = join(REC, "storyboard");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "thumbs"), { recursive: true });

interface Sub {
  start: number;
  end: number;
  text: string;
}
interface Scene {
  n: number;
  start: number;
  dur: number;
  screen: string;
  narration?: string;
  voice?: { source: string; start: number; dur: number; margin: number };
  subs: Sub[];
  overlays: { kind?: string; text?: string; start: number; end: number }[];
}
const report = JSON.parse(readFileSync(join(REC, "draft-video.json"), "utf8")) as { made: string; total: number; voice: string; warnings: string[]; scenes: Scene[] };

// シーンの名前は台本（DEMO.md の「### シーン0　つかみ（0:00–0:04）」）から取る
const names = new Map<number, string>();
for (const m of readFileSync("docs/DEMO.md", "utf8").matchAll(/^### シーン(\d+)　(.+?)（/gm)) names.set(Number(m[1]), m[2]!);

const ff = (args: string[]) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: "inherit" });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const tc = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
const KIND: Record<string, string> = { big: "大きな字幕", bigLow: "大きな字幕", hook: "大きな字幕（冒頭）", top: "補足（上）", note: "図の下の一行", intro: "名乗り（写真と経歴）", speed: "早送り", speedLow: "早送り", places: "使う場面", card: "カード", end: "カード", label: "左上の札", loop: "工程の図", fact: "直した数字", compare: "並べ比べ" };

// サムネイル（各シーンの 30% と 75% の位置）と縮小版の動画（15MB 以下に収める）
const video = join(REC, "draft-video.mp4");
for (const s of report.scenes) {
  for (const [k, f] of [
    ["a", 0.3],
    ["b", 0.75],
  ] as const) {
    ff(["-ss", (s.start + s.dur * f).toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale=480:270:flags=lanczos", "-q:v", "4", join(OUT, "thumbs", `s${s.n}${k}.jpg`)]);
  }
}
ff(["-i", video, "-vf", "scale=960:540:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-maxrate", "560k", "-bufsize", "1120k", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", join(OUT, "preview.mp4")]);

const made = new Date(report.made).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" });
const strip = report.scenes
  .map((s) => `<button class="seg" style="flex-grow:${s.dur}" data-t="${s.start}" data-n="${s.n}" title="シーン${s.n}　${esc(names.get(s.n) ?? "")}（${tc(s.start)}〜）"><span>${s.n}</span></button>`)
  .join("") + (report.total < 180 ? `<div class="rest" style="flex-grow:${180 - report.total}" title="3:00 までの残り ${(180 - report.total).toFixed(1)}秒"></div>` : "");

const marginChip = (s: Scene) => {
  if (!s.voice) return `<span class="chip quiet">声なし</span>`;
  const m = s.voice.margin;
  const cls = m < 0 ? "over" : m < 1.5 ? "tight" : "ok";
  const label = m < 0 ? `${(-m).toFixed(1)}秒はみ出す` : `余り ${m.toFixed(1)}秒`;
  return `<span class="chip ${cls}">${label}</span>`;
};

const rows = report.scenes
  .map((s) => {
    const items = [
      ...s.overlays.filter((o) => o.text).map((o) => ({ t: s.start + o.start, e: s.start + o.end, label: KIND[o.kind ?? ""] ?? "絵", text: o.text! })),
      ...s.subs.map((u) => ({ t: s.start + u.start, e: s.start + u.end, label: "字幕", text: u.text })),
    ].sort((a, b) => a.t - b.t);
    const list = items.map((i) => `<li><button class="tc" data-t="${i.t.toFixed(2)}">${tc(i.t)}</button><span class="kind">${esc(i.label)}</span><span class="txt">${esc(i.text)}</span></li>`).join("");
    const voice = s.voice ? `声：${esc(s.voice.source)} ${s.voice.dur.toFixed(1)}秒（${tc(s.start + s.voice.start)} から）` : "";
    return `<article class="scene" id="s${s.n}" data-n="${s.n}">
  <header class="scene-head">
    <button class="num" data-t="${s.start}" aria-label="シーン${s.n}へ">${s.n}</button>
    <div class="scene-title"><h2>${esc(names.get(s.n) ?? `シーン${s.n}`)}</h2><p class="when"><span class="mono">${tc(s.start)}–${tc(s.start + s.dur)}</span>　${s.dur}秒</p></div>
    ${marginChip(s)}
  </header>
  <div class="scene-body">
    <div class="thumbs"><img src="thumbs/s${s.n}a.jpg" alt="シーン${s.n}の画面（前半）" loading="lazy" data-t="${(s.start + s.dur * 0.3).toFixed(2)}"><img src="thumbs/s${s.n}b.jpg" alt="シーン${s.n}の画面（後半）" loading="lazy" data-t="${(s.start + s.dur * 0.75).toFixed(2)}"></div>
    <div class="detail">
      <h3>画面</h3><p>${esc(s.screen)}</p>
      ${s.narration ? `<h3>ナレーション <span class="count">${s.narration.length}字</span></h3><blockquote>${esc(s.narration)}</blockquote><p class="voice">${voice}</p>` : ""}
      ${list ? `<h3>テロップ</h3><ul class="cues">${list}</ul>` : ""}
    </div>
  </div>
</article>`;
  })
  .join("\n");

const warn = report.warnings.length ? `<ul class="warn">${report.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : `<p class="allgood">尺の警告はありません。</p>`;

const page = `<title>センタクアツ 動画の絵コンテ</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DotGothic16&family=BIZ+UDPGothic:wght@400;700&display=swap">
<style>
/* 動画と同じ夜の盤面の色で、1つの見た目にそろえる（暗い画面だけ）。上に動画と3分の帯、下にシーンを時間順に縦に並べる */
:root{
  color-scheme:dark;
  --bg:#0d0a14; --panel:#171024; --panel2:#1f1630; --line:#33274f;
  --ink:#f4ecf7; --ink2:#cdbfe0; --muted:#9a8ab1;
  --teal:#3be0c6; --gold:#ffcc4d; --pink:#ff7fb0; --red:#ff6352;
  --display:"DotGothic16","Hiragino Sans",sans-serif;
  --body:"BIZ UDPGothic","Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
}
body{background:var(--bg);color:var(--ink);font-family:var(--body);font-size:15px;line-height:1.7}
.wrap{max-width:1180px;margin:0 auto;padding-block:28px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:22px}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.top h1{font-family:var(--display);font-weight:400;font-size:clamp(26px,4vw,38px);line-height:1.2;margin:0;letter-spacing:.04em;text-wrap:balance}
.top h1 small{display:block;font-size:.5em;color:var(--teal);letter-spacing:.12em;margin-bottom:6px}
.meta{display:flex;flex-wrap:wrap;gap:6px 18px;color:var(--ink2);margin:8px 0 0;font-size:14px}
.meta b{color:var(--ink);font-weight:700}
.how{background:var(--panel);box-shadow:inset 0 0 0 1px var(--line);padding:12px 16px;margin:0;color:var(--ink2);font-size:14px}
.how b{color:var(--gold)}
.player{display:grid;grid-template-columns:minmax(0,640px) minmax(0,1fr);gap:20px;align-items:start}
video{width:100%;aspect-ratio:16/9;background:#000;display:block;max-width:100%}
.side{display:flex;flex-direction:column;gap:12px;min-width:0}
.side h2{font-family:var(--display);font-weight:400;font-size:18px;margin:0;color:var(--ink)}
.now{font-family:var(--mono);font-size:28px;color:var(--gold);font-variant-numeric:tabular-nums}
.warn{margin:0;padding-left:1.2em;color:#ffb3a8}
.allgood{margin:0;color:var(--teal)}
.strip{position:relative;display:flex;gap:2px;height:44px}
.seg{flex-basis:0;min-width:0;border:0;background:var(--panel2);color:var(--ink2);font-family:var(--display);font-size:16px;cursor:pointer;padding:0;box-shadow:inset 0 -3px 0 var(--line)}
.seg:hover,.seg:focus-visible{background:#2b2042;color:var(--ink);outline:none}
.seg.on{background:#123a35;color:var(--teal);box-shadow:inset 0 -3px 0 var(--teal)}
.rest{flex-basis:0;background:repeating-linear-gradient(135deg,transparent 0 4px,var(--line) 4px 6px)}
.head{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--gold);left:0;pointer-events:none}
.ticks{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;font-family:var(--mono);margin-top:4px}
.scene{background:var(--panel);box-shadow:inset 0 0 0 1px var(--line);padding:16px 18px;display:flex;flex-direction:column;gap:12px;scroll-margin-top:16px}
.scene.on{box-shadow:inset 0 0 0 2px var(--teal)}
.scene-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.num{font-family:var(--display);font-size:26px;width:48px;height:48px;border:0;background:var(--gold);color:#1a1020;cursor:pointer;flex:none}
.num:focus-visible,.tc:focus-visible,.thumbs img:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
.scene-title{flex:1;min-width:0}
.scene-title h2{margin:0;font-size:19px;font-weight:700;text-wrap:balance}
.when{margin:0;color:var(--muted);font-size:13px}
.chip{font-size:13px;font-weight:700;padding:3px 10px;white-space:nowrap}
.chip.ok{background:#123a35;color:var(--teal)}
.chip.tight{background:#3d3110;color:var(--gold)}
.chip.over{background:#4a1612;color:#ffb3a8}
.chip.quiet{background:var(--panel2);color:var(--muted)}
.scene-body{display:grid;grid-template-columns:minmax(0,500px) minmax(0,1fr);gap:18px}
.thumbs{display:grid;grid-template-columns:1fr 1fr;gap:6px;align-content:start}
.thumbs img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;cursor:pointer;background:#000}
.detail{min-width:0}
.detail h3{font-size:12px;letter-spacing:.12em;color:var(--pink);margin:0 0 2px;font-weight:700}
.detail h3 .count{color:var(--muted);letter-spacing:0;font-weight:400;margin-left:6px}
.detail p{margin:0 0 10px;color:var(--ink2)}
blockquote{margin:0 0 4px;padding:6px 12px;background:var(--panel2);color:var(--ink);box-shadow:inset 3px 0 0 var(--pink)}
.voice{font-size:13px;color:var(--muted)!important}
.cues{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.cues li{display:grid;grid-template-columns:62px 84px minmax(0,1fr);gap:8px;align-items:baseline;font-size:14px}
.tc{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:13px;border:0;background:none;color:var(--teal);cursor:pointer;padding:0;text-align:left}
.tc:hover{text-decoration:underline}
.kind{font-size:12px;color:var(--muted)}
.txt{color:var(--ink2);overflow-wrap:anywhere}
@media (max-width:820px){
  .player,.scene-body{grid-template-columns:minmax(0,1fr)}
  .cues li{grid-template-columns:56px minmax(0,1fr)}
  .cues .kind{display:none}
}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style>
<div class="wrap">
  <header class="top">
    <h1><small>Built with Claude: Japan 2026 ／ デモ動画</small>センタクアツ　動画の絵コンテ</h1>
    <p class="meta"><span>書き出し <b>${esc(made)}</b></span><span>全体 <b class="mono">${tc(report.total)}</b>（上限 3:00）</span><span>声 <b>${report.scenes.some((s) => s.voice?.source === "録音") ? "作者の録音（ないシーンは仮の読み上げ）" : `仮の読み上げ（${esc(report.voice)}）`}</b></span></p>
  </header>
  <p class="how">直したいところは、<b>「シーン3」</b>や<b>「0:52 の字幕」</b>のように、シーン番号か時刻で伝えてください。時刻やサムネイルを押すと、その場面から動画が流れます。仮の読み上げは尺を確かめるためのもので、提出版は作者の録音に替えます。</p>
  <section class="player" aria-label="動画">
    <video id="v" src="preview.mp4" controls preload="metadata" playsinline></video>
    <div class="side">
      <h2>いまの位置</h2>
      <div class="now" id="now">0:00.0</div>
      <h2>尺の警告</h2>
      ${warn}
    </div>
  </section>
  <section aria-label="シーンの時間の帯">
    <div class="strip" id="strip">${strip}<div class="head" id="head"></div></div>
    <div class="ticks"><span>0:00</span><span>0:30</span><span>1:00</span><span>1:30</span><span>2:00</span><span>2:30</span><span>3:00</span></div>
  </section>
  ${rows}
</div>
<script>
(() => {
  const v = document.getElementById("v");
  const head = document.getElementById("head");
  const now = document.getElementById("now");
  const TOTAL = 180;
  const scenes = ${JSON.stringify(report.scenes.map((s) => ({ n: s.n, start: s.start, end: s.start + s.dur })))};
  let current = -1;
  const seek = (t) => { v.currentTime = Number(t); v.play().catch(() => {}); };
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-t]");
    if (el) seek(el.dataset.t);
  });
  const show = () => {
    const t = v.currentTime || 0;
    now.textContent = Math.floor(t / 60) + ":" + (t % 60).toFixed(1).padStart(4, "0");
    head.style.left = Math.min(100, (t / TOTAL) * 100) + "%";
    const s = scenes.find((x) => t >= x.start && t < x.end);
    const n = s ? s.n : -1;
    if (n === current) return;
    current = n;
    document.querySelectorAll(".seg, .scene").forEach((el) => el.classList.toggle("on", Number(el.dataset.n) === n));
  };
  v.addEventListener("timeupdate", show);
  v.addEventListener("seeked", show);
  show();
})();
</script>
`;
writeFileSync(join(OUT, "index.html"), page);
console.log(`→ ${join(OUT, "index.html")}（preview.mp4・thumbs/ ${report.scenes.length * 2} 枚）`);
