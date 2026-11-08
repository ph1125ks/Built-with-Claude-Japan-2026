// YouTube のサムネイル（1280×720）の案を描く（2026-11-08 作者の求め「YouTube に上げるので題名・概要欄・サムネイルを」）。
// 録画のコマ（recordings/*.mp4。目印は *.json）と作者の映像から絵を取り、ゲームと同じドット絵の文字（DotGothic16）と大きな見出しを重ねる。
// 画面なしの Chrome で描く（字幕と同じ仕組み。scripts/lib/chrome.ts）。
//   npx tsx scripts/make-thumbnail.ts [--rec recordings] [--out recordings/thumbnail] [--self recordings/author/self.mov] [--self-at 2.5]
//   → recordings/thumbnail/A-効かない.png / B-現在と未来.png / C-作者.png（と同じ名前の .jpg）。Git に入れない（作者の顔が入る案がある）
// 案：A 「抗菌薬が、効かない。」（2050年に膀胱が破られる場面の上に）、B 現在と未来の2つの盤面を並べる、C 作者の顔とロゴ（顔は作者が決める）
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { openChrome, sleep } from "./lib/chrome.ts";
import { bugUrl, imgTag } from "./lib/pixel-art.ts";

const { values } = parseArgs({
  options: {
    rec: { type: "string", default: "recordings" },
    out: { type: "string", default: join("recordings", "thumbnail") },
    self: { type: "string" },
    "self-at": { type: "string", default: "2.5" },
  },
});
const REC = values.rec!;
const OUT = values.out!;
const FRAMES = join(OUT, "_frames");
mkdirSync(FRAMES, { recursive: true });
const W = 1280;
const H = 720;

const SELF = values.self ?? ["mp4", "mov", "MOV", "m4v"].map((e) => join(REC, "author", `self.${e}`)).find((f) => existsSync(f));

/** 録画の目印（record-demo.ts が書いた *.json）から秒を読む */
function at(name: string, label: string): number {
  const j = JSON.parse(readFileSync(join(REC, `${name}.json`), "utf8")) as { markers: { t: number; label: string }[] };
  const m = j.markers.find((x) => x.label === label);
  if (!m) throw new Error(`${name}.json に目印「${label}」がない`);
  return m.t;
}
/** 動画のコマを JPEG で切り出し、data URL で返す（PNG だと data URL が大きすぎて描き終わる前に写ることがある） */
function frame(file: string, sec: number, key: string): string {
  const out = join(FRAMES, `${key}.jpg`);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(sec), "-i", file, "-frames:v", "1", "-q:v", "2", out]);
  return `data:image/jpeg;base64,${readFileSync(out).toString("base64")}`;
}

const ABUSE = join(REC, "abuse-seed570.mp4");
const PROPER = join(REC, "proper-seed570.mp4");
const broken = frame(ABUSE, at("abuse-seed570", "画面：result2") - 0.6, "abuse-2050-broken"); // 膀胱が破られた（赤い帯）
const rush = frame(ABUSE, at("abuse-seed570", "画面：result2") - 1.6, "abuse-2050-rush"); // 「手札すべて効かない」の札が出ている
const win1 = frame(ABUSE, at("abuse-seed570", "画面：result1") - 1.2, "abuse-stage1-win"); // 現在：守り切った！（金色）
const win2 = frame(PROPER, at("proper-seed570", "画面：result2") - 0.9, "proper-2050-win"); // 未来：守り切った！
const self = SELF ? frame(SELF, Number(values["self-at"]), "self") : undefined;

// ゲームと同じドット絵の文字（DotGothic16。@fontsource/dotgothic16 に同梱。SIL OFL 1.1）
const fontData = (f: string) => readFileSync(join("node_modules/@fontsource/dotgothic16/files", f)).toString("base64");
const DOT_CSS = `@font-face{font-family:"DG-la";src:url(data:font/woff2;base64,${fontData("dotgothic16-latin-400-normal.woff2")}) format("woff2")}
@font-face{font-family:"DG-ja";src:url(data:font/woff2;base64,${fontData("dotgothic16-japanese-400-normal.woff2")}) format("woff2")}`;
const FONT = `"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif`;
const DOT = `"DG-la","DG-ja",${FONT}`;
const NIGHT = `background:radial-gradient(ellipse at 75% 10%,rgba(143,125,255,.16),transparent 55%),radial-gradient(ellipse at 10% 90%,rgba(59,224,198,.08),transparent 50%),#0b0812`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 共通の様式：ロゴ（タイトル画面と同じ、桃色の影）、大きな見出し（白に黒い縁）、下の帯 */
const base = `${DOT_CSS}
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;font-family:${FONT};color:#fff}
.bg{position:absolute;inset:0;background-size:cover;background-position:center}
.logo{font-family:${DOT};font-weight:400;line-height:1;letter-spacing:.04em;color:#fff;text-shadow:0 3px 0 #ff4f8b,0 6px 0 #b8255f,0 9px 0 #5a0b2e,0 0 30px rgba(255,79,139,.5)}
.big{font-weight:900;line-height:1.08;letter-spacing:.02em;color:#fff;-webkit-text-stroke:0;text-shadow:0 0 6px #000,0 0 6px #000,0 0 6px #000,3px 3px 0 #000,-3px 3px 0 #000,3px -3px 0 #000,-3px -3px 0 #000,0 10px 24px rgba(0,0,0,.8)}
.tag{position:absolute;right:24px;bottom:22px;padding:8px 18px;border-radius:999px;background:rgba(14,9,22,.85);font-size:24px;font-weight:700;color:#ffd38a;box-shadow:0 0 0 2px rgba(255,211,138,.35)}
.px{image-rendering:pixelated;display:block}`;

const bug = (id: string, z: number, style: string) => imgTag(bugUrl(id, 0, z), "px", style);

/** A：2050年、自分が残した細菌に手札がはじかれる場面（「手札すべて効かない」の札）。「抗菌薬が、効かない。」 */
const pageA = `<style>${base}
.bg{background-image:url(${rush});transform:scale(1.18);transform-origin:62% 46%;filter:saturate(1.1)}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(11,8,18,.94) 0%,rgba(11,8,18,.82) 45%,rgba(11,8,18,.15) 72%,rgba(11,8,18,.1) 100%),linear-gradient(0deg,rgba(11,8,18,.9) 0%,rgba(11,8,18,.5) 22%,transparent 40%)}
.logo{position:absolute;left:44px;top:34px;font-size:56px}
.big{position:absolute;left:44px;top:150px;font-size:148px}
.sub{position:absolute;left:48px;top:482px;padding:10px 22px;background:rgba(14,9,22,.86);box-shadow:inset 8px 0 0 #ffb347;font-size:38px;font-weight:700;color:#ffd38a;white-space:nowrap}
.kind{position:absolute;left:48px;bottom:24px;font-size:26px;font-weight:700;color:#d9cbe8}
.bugs{position:absolute;right:40px;bottom:96px;display:flex;align-items:flex-end;gap:14px;filter:drop-shadow(0 0 18px rgba(255,79,139,.7))}</style>
<div class="bg"></div><div class="shade"></div>
<div class="logo">センタクアツ</div>
<div class="big">抗菌薬が、<br>効かない。</div>
<div class="sub">あなたの選択が、未来の敵をつくる</div>
<div class="kind">抗菌薬の使い方を体感する、教育タワーディフェンス</div>
<div class="bugs">${bug("ecoli", 9, "")}${bug("efaecalis", 7, "margin-bottom:10px")}</div>
<div class="tag">Built with Claude: Japan 2026 ｜ 3分</div>`;

/** B：現在（楽勝）と未来（効かない）を斜めに並べる。下の帯にロゴ・一言・札 */
const pageB = `<style>${base}
.half{position:absolute;top:0;bottom:0;width:60%;background-size:cover;background-position:center}
.l{left:0;background-image:url(${win1});clip-path:polygon(0 0,100% 0,calc(100% - 140px) 100%,0 100%);filter:saturate(1.05)}
.r{right:0;background-image:url(${broken});clip-path:polygon(140px 0,100% 0,100% 100%,0 100%)}
.seam{position:absolute;left:calc(40% + 70px);top:-40px;width:14px;height:800px;background:#fff;transform:skewX(-10deg);box-shadow:0 0 24px #fff}
.shade{position:absolute;inset:0;background:linear-gradient(0deg,rgba(11,8,18,.9) 0%,rgba(11,8,18,.6) 28%,transparent 50%),linear-gradient(180deg,rgba(11,8,18,.7) 0%,transparent 20%)}
.lab{position:absolute;top:28px;padding:8px 22px;font-family:${DOT};font-size:40px;letter-spacing:.06em;background:rgba(14,9,22,.9)}
.lab.l1{left:36px;color:#ffd38a;box-shadow:inset 8px 0 0 #ffb347}
.lab.r1{right:36px;color:#ff8fb3;box-shadow:inset 8px 0 0 #ff4f8b}
.big{position:absolute;bottom:124px;font-size:124px}
.big.l1{left:40px}
.big.r1{right:40px;color:#ffb3c9}
.band{position:absolute;left:0;right:0;bottom:0;height:100px;background:rgba(11,8,18,.94);display:flex;align-items:center;gap:26px;padding:0 32px;box-shadow:0 -1px 0 rgba(255,255,255,.12)}
.band .logo{font-size:50px;white-space:nowrap;margin-bottom:8px}
.band .sub{font-size:26px;font-weight:700;color:#ffd38a;white-space:nowrap}
.band .tag{position:static;margin-left:auto;font-size:22px;white-space:nowrap}</style>
<div class="half l"></div><div class="half r"></div><div class="seam"></div><div class="shade"></div>
<div class="lab l1">現在</div><div class="lab r1">未来（2050年）</div>
<div class="big l1">楽勝</div><div class="big r1">効かない</div>
<div class="band"><div class="logo">センタクアツ</div><div class="sub">あなたの選択が、未来の敵をつくる</div><div class="tag">Built with Claude: Japan 2026 ｜ 3分</div></div>`;

/** C：作者の顔（左）とロゴ・一言（右）。顔を出すかは作者が決める */
const pageC = `<style>${base}
body{${NIGHT}}
.face{position:absolute;left:0;top:0;bottom:0;width:44%;background-image:url(${self ?? ""});background-size:cover;background-position:58% 40%;clip-path:polygon(0 0,100% 0,calc(100% - 90px) 100%,0 100%)}
.seam{position:absolute;left:calc(44% - 56px);top:-40px;width:12px;height:800px;background:#ff4f8b;transform:skewX(-7deg);box-shadow:0 0 24px rgba(255,79,139,.8)}
.t{position:absolute;left:47%;top:64px;right:36px;display:flex;flex-direction:column;gap:20px}
.logo{font-size:84px;white-space:nowrap}
.o{margin:-10px 0 0;font-family:${DOT};font-size:24px;letter-spacing:.12em;color:#3be0c6}
.big{font-size:64px;line-height:1.2;white-space:nowrap}
.sub{align-self:flex-start;padding:8px 20px;background:rgba(14,9,22,.86);box-shadow:inset 8px 0 0 #ffb347;font-size:30px;font-weight:700;color:#ffd38a;white-space:nowrap}
.bugs{position:absolute;right:40px;bottom:86px;display:flex;align-items:flex-end;gap:14px;filter:drop-shadow(0 0 16px rgba(255,79,139,.6))}</style>
<div class="face"></div><div class="seam"></div>
<div class="t"><div class="logo">センタクアツ</div><p class="o">選択圧（せんたくあつ）から</p>
<div class="big">薬剤師がつくった<br>抗菌薬の教育ゲーム</div>
<div class="sub">あなたの選択が、未来の敵をつくる</div></div>
<div class="bugs">${bug("ecoli", 5, "")}${bug("kpneumoniae", 4, "margin-bottom:4px")}${bug("efaecalis", 4, "margin-bottom:8px")}</div>
<div class="tag">Built with Claude: Japan 2026 ｜ 3分</div>`;

const pages: [string, string][] = [
  ["A-効かない", pageA],
  ["B-現在と未来", pageB],
  ...(self ? ([["C-作者", pageC]] as [string, string][]) : []),
];
if (!self) console.warn("⚠ 作者の映像がないので C 案は作らない（--self <file>）");

const { page, close } = await openChrome({ width: W, height: H });
try {
  await page.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  for (const [name, body] of pages) {
    await page.send("Page.navigate", { url: `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8">${body}`)}` });
    await sleep(1200); // 字体と大きな data URL の絵を待つ
    const png = join(OUT, `${name}.png`);
    writeFileSync(png, await page.png());
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", png, "-q:v", "2", join(OUT, `${name}.jpg`)]);
    console.log(`→ ${png}（と .jpg）`);
  }
} finally {
  close();
}
void esc;
void win2;
