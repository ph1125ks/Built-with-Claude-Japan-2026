// 動画の冒頭（シーン0）の図：薬剤耐性（AMR）に起因する死亡者数の推定（年間）。2050年の棒が伸びて、がんを追い越す。
// 数値は The Review on Antimicrobial Resistance（議長 Jim O'Neill）「Antimicrobial Resistance: Tackling a crisis for the health
// and wealth of nations」2014年12月 p.5 の図から（数値だけを使い、図は写さずにゲームの画風で描き直す。2026-11-05 作者の希望）。
// 報告書は、対策をとらずに耐性が上がり続けた場合の、おおまかな試算としている（p.6）。日本語の紹介は AMR臨床リファレンスセンターの
// 「アクションプラン」のページ（https://amr.jihs.go.jp/medics/2-4.html）にもある。
//   npx tsx scripts/make-hook-chart.ts [--dur 9.5]
//   → recordings/hook/hook.mp4（1920×1080・30fps。絵だけで音はなし）と、最後の場面の静止画 hook-last.png
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { openChrome, sleep } from "./lib/chrome.ts";

const { values } = parseArgs({ options: { dur: { type: "string", default: "9.5" }, out: { type: "string", default: "recordings/hook" } } });
const W = 1920;
const H = 1080;
const FPS = 30;
const DUR = Number(values.dur);
const OUT = values.out!;
const FRAMES = join(OUT, "frames");
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

// ゲームと同じドット絵の文字（DotGothic16。npm の @fontsource/dotgothic16 に同梱。SIL OFL 1.1）を埋め込む
const fontData = (f: string) => readFileSync(join("node_modules/@fontsource/dotgothic16/files", f)).toString("base64");
const FONT_CSS = `@font-face{font-family:"DG-la";src:url(data:font/woff2;base64,${fontData("dotgothic16-latin-400-normal.woff2")}) format("woff2")}
@font-face{font-family:"DG-ja";src:url(data:font/woff2;base64,${fontData("dotgothic16-japanese-400-normal.woff2")}) format("woff2")}`;

/** 報告書 p.5 の図の数値（万人）。比べる死因は図にあるもののうち、多いほうから */
const ROWS = [
  { key: "cancer", label: "がん", value: 820, kind: "other" },
  { key: "diabetes", label: "糖尿病", value: 150, kind: "other" },
  { key: "traffic", label: "交通事故", value: 120, kind: "other" },
  { key: "now", label: "いまの薬剤耐性", note: "少なく見積もって", value: 70, kind: "now" },
  { key: "amr2050", label: "2050年の薬剤耐性", value: 1000, kind: "future" },
] as const;

const page = `<!doctype html><meta charset="utf-8"><style>${FONT_CSS}
html,body{margin:0;width:${W}px;height:${H}px;background:#0b0812;color:#f4ecf7;font-family:"DG-la","DG-ja","Hiragino Sans",sans-serif;overflow:hidden}
/* うすいドットの格子（ゲームの盤面の雰囲気） */
body{background-image:radial-gradient(rgba(148,112,232,.10) 1.4px,transparent 1.6px);background-size:24px 24px}
.wrap{position:absolute;left:130px;right:130px;top:128px}
.kicker{font-size:34px;color:#3be0c6;letter-spacing:.06em;margin:0 0 8px}
.src{font-size:21px;color:#9a8ab1;margin:0 0 54px;line-height:1.5}
.row{display:grid;grid-template-columns:440px 1fr;align-items:center;height:100px}
.lab{font-size:38px;text-align:right;padding-right:34px;line-height:1.1;white-space:nowrap}
.lab small{display:block;font-size:22px;color:#9a8ab1;margin-top:4px}
.track{position:relative;height:54px}
.bar{position:absolute;left:0;top:0;height:54px;display:flex;gap:4px;align-items:stretch}
.cell{width:22px;height:54px;flex:none}
.val{position:absolute;top:2px;font-size:44px;white-space:nowrap}
.row.future{margin-top:34px}
.row.future .lab{font-size:42px}
.row.future .val{font-size:64px;top:-8px}
.cross{position:absolute;top:-30px;bottom:-30px;width:0;border-left:4px dashed rgba(244,236,247,.55)}
.tag{position:absolute;font-size:34px;color:#0b0812;background:#f4ecf7;padding:6px 14px;white-space:nowrap}
</style>
<div class="wrap">
  <p class="kicker">薬剤耐性（AMR）に起因する死亡者数の推定（年間）</p>
  <p class="src">対策をとらずに耐性が上がり続けた場合の試算。The Review on Antimicrobial Resistance（議長 J. O'Neill）2014年 p.5 の数値から作成</p>
  <div id="rows"></div>
</div>
<script>
const ROWS = ${JSON.stringify(ROWS)};
const MAXW = 930, MAXV = 1000, CELL = 26; // 1マス＝22px＋すき間4px
const COLOR = { other: "#6b6378", now: "#26a894", future: "#9470e8" };
const rows = document.getElementById("rows");
for (const r of ROWS) {
  rows.insertAdjacentHTML("beforeend", '<div class="row ' + r.kind + '" id="r-' + r.key + '"><div class="lab">' + r.label + (r.note ? '<small>' + r.note + '</small>' : '') + '</div><div class="track"><div class="bar"></div><div class="val"></div></div></div>');
}
const track = (k) => document.querySelector("#r-" + k + " .track");
const cancerX = (820 / MAXV) * MAXW;
track("amr2050").insertAdjacentHTML("beforeend", '<div class="cross" style="left:' + cancerX + 'px;opacity:0"></div><div class="tag" style="left:' + (cancerX + 18) + 'px;top:-74px;opacity:0">がんを超える</div>');
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const fmt = (v) => v >= 1000 ? "1,000万人" : Math.round(v) + "万人";
// 時刻 t（秒）の場面を描く。棒は 1マスずつ伸びる（ドット絵の見え方）
const PLAN = { cancer: [0.6, 1.6], diabetes: [0.9, 0.7], traffic: [1.1, 0.7], now: [2.2, 0.6], amr2050: [3.4, 3.0] };
window.render = (t) => {
  document.querySelector(".kicker").style.opacity = String(ease(t / 0.5));
  document.querySelector(".src").style.opacity = String(ease((t - 0.2) / 0.6));
  for (const r of ROWS) {
    const [start, len] = PLAN[r.key];
    const p = r.key === "amr2050" ? Math.min(1, Math.max(0, (t - start) / len)) ** 1.6 : ease((t - start) / len);
    const v = r.value * p;
    const w = (v / MAXV) * MAXW;
    const n = Math.floor(w / CELL);
    const rest = w - n * CELL;
    const bar = track(r.key).querySelector(".bar");
    let html = "";
    for (let i = 0; i < n; i++) html += '<div class="cell" style="background:' + COLOR[r.kind] + '"></div>';
    if (rest > 2) html += '<div class="cell" style="width:' + Math.min(22, rest) + 'px;background:' + COLOR[r.kind] + '"></div>';
    bar.innerHTML = html;
    const val = track(r.key).querySelector(".val");
    val.textContent = p > 0 ? fmt(v) : "";
    val.style.left = (w + 22) + "px";
    document.getElementById("r-" + r.key).style.opacity = t >= start - 0.15 ? "1" : "0";
  }
  // 2050年の棒が、がんの長さを超えたら印を出す
  const passed = (Math.min(1, Math.max(0, (t - PLAN.amr2050[0]) / PLAN.amr2050[1])) ** 1.6) * 1000 >= 820;
  const tr = track("amr2050");
  tr.querySelector(".cross").style.opacity = passed ? "1" : "0";
  tr.querySelector(".tag").style.opacity = passed ? "1" : "0";
};
window.render(0);
</script>`;

const htmlFile = resolve(join(OUT, "hook.html"));
writeFileSync(htmlFile, page);
const { page: p, close } = await openChrome({ width: W, height: H });
try {
  await p.send("Page.navigate", { url: `file://${htmlFile}` });
  await sleep(800);
  await p.eval("document.fonts.ready.then(() => true)");
  const n = Math.round(DUR * FPS);
  for (let i = 0; i < n; i++) {
    await p.eval(`window.render(${(i / FPS).toFixed(4)})`);
    writeFileSync(join(FRAMES, `f${String(i).padStart(4, "0")}.png`), await p.png(false));
  }
  await p.eval(`window.render(${DUR})`);
  writeFileSync(join(OUT, "hook-last.png"), await p.png(false));
} finally {
  close();
}
execFileSync("ffmpeg", ["-y", "-v", "error", "-framerate", String(FPS), "-i", join(FRAMES, "f%04d.png"), "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(FPS), join(OUT, "hook.mp4")], { stdio: "inherit" });
rmSync(FRAMES, { recursive: true, force: true });
console.log(`→ ${join(OUT, "hook.mp4")}（${DUR} 秒）と hook-last.png`);
