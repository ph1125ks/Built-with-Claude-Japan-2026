// 仮の動画（3分）を作る（docs/DEMO.md の時間配分どおり。台本 第5版：問題から入り、作者は身元の開示として名乗る、2026-11-06）。
// 録画（scripts/record-demo.ts の recordings/*.mp4 と目印の *.json）を切り出して早送りし、台本のナレーションを字幕と声にして重ね、つなぐ。
// 試算の図は scripts/make-hook-chart.ts（recordings/hook/hook.mp4）、道のりの絵は scripts/make-scene7.ts（recordings/scene7/）。
// 作者の写真は recordings/author/photo1.jpg（シーン3。顔を丸く小さく切る）。作者が用意したもので、Git に入れない。
// BGM：scripts/make-bgm.ts があれば、シーンの区切りから曲の区間（cue）を作って合成し、声の下で小さく流す（声が出ている間はさらに下げる）
// 字幕は画面なしの Chrome で透明な PNG に描き、ffmpeg で重ねる（手元の ffmpeg には文字を描く機能がないため）。
// 声：recordings/voice/scene{N}.wav（m4a・aiff・mp3 も可）があれば作者の録音を使う。なければ macOS の読み上げ（say）で仮の声を作る。
//     仮の声は尺を確かめるためだけのもの（提出版は作者の録音にする）。仮の声のときは、字幕の時刻を声の区切りに合わせる。
//     録音のときは、頭と終わりの無音を切り、声の中の無音を手がかりに字幕の時刻を合わせる（scripts/lib/align.ts）
//   npx tsx scripts/make-draft-video.ts [--rec recordings] [--seed 570] [--voice Kyoko] [--rate 200]
//   --rate：仮の読み上げの速さ（say -r）。200 で1秒に約5.8字（作者が少し早口で読む速さ。第6版、2026-11-06）。省くと 200
//   → recordings/draft-video.mp4（1920×1080、30fps、声は AAC）、ナレーションの字幕 recordings/draft-video.srt、
//     シーンごとの記録 recordings/draft-video.json（絵コンテ表を作る scripts/make-storyboard.ts が読む）
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import QRCode from "qrcode";
import { alignChunks, silences } from "./lib/align.ts";
import { ANCHORS, chunks, VOICE_FROM } from "./lib/video-cues.ts";
import { openChrome, sleep, type Page } from "./lib/chrome.ts";

const { values } = parseArgs({
  options: {
    rec: { type: "string", default: "recordings" },
    seed: { type: "string", default: "570" },
    voice: { type: "string", default: "Kyoko" },
    // 仮の読み上げの速さ（say -r）。178 で1秒に約5.3字（作者の録音で測った速さ。第6版の 200 は1割早口）
    rate: { type: "string", default: "178" },
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
  /** シーン10：使っていく場面（「**使っていく場面**」の下の箇条書き） */
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
type Kind = "sub" | "top" | "big" | "intro" | "speed" | "speedLow" | "places" | "card" | "loop" | "fact" | "compare" | "label" | "note" | "gap" | "bigLow" | "hook" | "end";
/** 背景まで描く絵（透明にしない） */
const OPAQUE: Kind[] = ["card", "intro", "gap", "end"];
/** エンドカードの QR（学生用の URL。評価役の「2.5秒では URL を読めない」を受けて足した） */
const PLAY_URL = "https://ph1125ks.github.io/Built-with-Claude-Japan-2026/";
const PLAY_QR = await QRCode.toDataURL(PLAY_URL, { margin: 1, width: 360, color: { dark: "#0b0812", light: "#ffffff" } });

// ゲームと同じドット絵の文字（DotGothic16。@fontsource/dotgothic16 に同梱。SIL OFL 1.1）。16px 以上の見出しにだけ使う
const fontData = (f: string) => readFileSync(join("node_modules/@fontsource/dotgothic16/files", f)).toString("base64");
const DOT_CSS = `@font-face{font-family:"DG-la";src:url(data:font/woff2;base64,${fontData("dotgothic16-latin-400-normal.woff2")}) format("woff2")}
@font-face{font-family:"DG-ja";src:url(data:font/woff2;base64,${fontData("dotgothic16-japanese-400-normal.woff2")}) format("woff2")}`;
const DOT = `"DG-la","DG-ja",${FONT}`;
/** 作者の写真（recordings/author/。作者が用意したもの。Git に入れない） */
const photoUrl = (name: string) => `data:image/jpeg;base64,${readFileSync(join(REC, "author", name)).toString("base64")}`;
/** 夜の盤面と同じ背景（ゲームの theme と同じ色） */
const NIGHT = `background:radial-gradient(ellipse at 75% 10%,rgba(143,125,255,.16),transparent 55%),radial-gradient(ellipse at 10% 90%,rgba(59,224,198,.08),transparent 50%),#0b0812`;

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
    case "bigLow":
      // bigLow：ゲームの帯（「膀胱が破られた」など）が画面の中ほどに出る場面では、下寄りに置く（シーン0）
      return `<style>${base}div{position:absolute;left:0;right:0;top:${kind === "bigLow" ? 68 : 50}%;transform:translateY(-50%);padding:40px 0;background:rgba(20,8,14,.62);color:#fff;font-size:88px;font-weight:800;text-align:center;letter-spacing:.04em;text-shadow:0 4px 18px rgba(0,0,0,.5)}</style><div>${esc(text)}</div>`;
    case "hook":
      // シーン0の大きな字幕。第7版は1本「抗菌薬が効かない。楽勝だったはずなのに。」（text。extra[0] があれば上に小さく出す。第6版はそれで2本にしたが、
      // 初見の読み手役3人が「6.5秒で2本は読めない」と言い、作者が1本にした）。下寄り（ゲームの帯を避ける）
      return `<style>${base}div{position:absolute;left:0;right:0;top:68%;transform:translateY(-50%);padding:30px 0 34px;background:rgba(20,8,14,.66);color:#fff;text-align:center;text-shadow:0 4px 18px rgba(0,0,0,.5)}small{display:block;font-size:40px;font-weight:700;color:#ffd38a;letter-spacing:.04em;margin-bottom:10px}b{display:block;font-size:80px;font-weight:800;letter-spacing:.04em}</style><div>${extra?.[0] ? `<small>${esc(extra[0])}</small>` : ""}<b>${esc(text)}</b></div>`;
    case "intro": {
      // 名乗りの場面（シーン3）。丸く小さく切った作者の写真（直径は画面の高さの2割。白衣の1枚目）と、右に経歴のカード。背景は夜の盤面。
      // 第5版：写真は顔だけを小さく（作者の判断。身元の開示であって、自己アピールにしない）。
      // 写真（724×1086）の顔の中心はおよそ (362, 365)。直径 400px ほどを 216px に縮めて丸く切る（2026-11-06 に写真を見て決めた）
      const D = 216;
      const s = D / 400;
      const img = { w: Math.round(724 * s), h: Math.round(1086 * s), x: Math.round(D / 2 - 362 * s), y: Math.round(D / 2 - 365 * s) };
      return `<style>${base}body{${NIGHT}}
.wrap{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);display:flex;justify-content:center;align-items:center;gap:56px}
.face{position:relative;width:${D}px;height:${D}px;border-radius:50%;overflow:hidden;flex:none;background:#eee;box-shadow:0 0 0 6px #0b0812,0 0 0 12px #3be0c6,0 14px 40px rgba(0,0,0,.55)}
.face img{position:absolute;width:${img.w}px;height:${img.h}px;left:${img.x}px;top:${img.y}px}
.card{width:1400px;box-sizing:border-box;padding:28px 40px 22px;background:rgba(14,9,22,.9);box-shadow:inset 8px 0 0 #3be0c6;color:#f4ecf7}
b{display:block;font-size:60px;margin-bottom:10px;letter-spacing:.02em}
p{margin:0;padding:12px 0;font-size:30px;font-weight:700;line-height:1.45;border-top:1px solid #33274f;color:#f4ecf7}
p:first-of-type{font-size:32px;font-weight:800;color:#fff}
p:last-of-type{font-size:24px;font-weight:600;color:#a493b6;white-space:nowrap}
</style><div class="wrap"><div class="face"><img src="${photoUrl("photo1.jpg")}"></div><div class="card"><b>${esc(text)}</b>${(extra ?? []).map((l) => `<p>${esc(l)}</p>`).join("")}</div></div>`;
    }
    case "note":
      // 図の下の一行（シーン2の最後）。図の箱（〜720px）と字幕（930px〜）の間に置く
      return `<style>${DOT_CSS}${base}body{display:flex;justify-content:center;align-items:flex-start}div{margin-top:772px;padding:10px 30px;background:rgba(14,9,22,.86);box-shadow:inset 6px 0 0 #ffb347;color:#ffd38a;font-family:${DOT};font-size:38px;letter-spacing:.04em}</style><div>${esc(text)}</div>`;
    case "label":
      // 左上の札（シーン0の「いま」「2050年」）
      return `<style>${DOT_CSS}${base}div{position:absolute;left:180px;top:104px;padding:10px 24px;background:rgba(14,9,22,.86);box-shadow:inset 6px 0 0 #ffb347;color:#ffd38a;font-family:${DOT};font-size:40px}</style><div>${esc(text)}</div>`;
    case "gap": {
      // 時間のずれの図（シーン2）。text は段："0"＝「抗菌薬を、正しく使う」だけ、"2"＝いまの箱・何年も先の箱・矢印。
      // 第7版：文字を3ブロック（正しく使う／いま：よくなる／何年も先：効かない細菌が増える）に減らした（初見の読み手役3人「6ブロックは速い声と同時に読めない」）
      const st = Number(text);
      const two = st >= 2;
      const head = st === 0 ? "耐性を広げないために、欠かせないこと" : "でも";
      return `<style>${DOT_CSS}${base}body{${NIGHT};color:#f4ecf7}
.k{position:absolute;left:140px;top:150px;font-family:${DOT};font-size:38px;color:#3be0c6;letter-spacing:.08em}
.one{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;font-family:${DOT};font-size:110px;color:#fff;letter-spacing:.06em;text-shadow:0 6px 30px rgba(59,224,198,.35);display:${st === 0 ? "block" : "none"}}
.box{position:absolute;top:250px;width:640px;height:470px;box-sizing:border-box;padding:40px 44px;background:#160f22;display:${st === 0 ? "none" : "block"}}
.now{left:140px;box-shadow:inset 0 0 0 4px #3be0c6}
.later{left:1140px;box-shadow:inset 0 0 0 4px #ff6352;opacity:${two ? 1 : 0.12}}
h2{margin:0 0 24px;font-family:${DOT};font-size:46px}
.now h2{color:#3be0c6}.later h2{color:#ff8a7a}
.mark{font-size:120px;line-height:1;font-weight:800;margin-bottom:18px}
.now .mark{color:#5ef0a0}.later .mark{color:#ff6352}
b{display:block;font-size:46px;font-weight:800;line-height:1.25}
small{display:block;margin-top:14px;font-size:30px;color:#cdbfe0;font-weight:600}
.arrow{position:absolute;left:800px;top:400px;width:320px;opacity:${two ? 1 : 0}}
.arrow i{position:relative;display:block;height:0;width:280px;border-top:8px dashed #ffb347;margin:30px 0 0}
.arrow i::after{content:"";position:absolute;right:-52px;top:-26px;border:22px solid transparent;border-left:30px solid #ffb347}
.arrow span{display:block;width:320px;text-align:center;font-family:${DOT};font-size:26px;color:#ffd38a;line-height:1.35;white-space:nowrap}
</style><p class="k">${head}</p><p class="one">抗菌薬を、正しく使う</p>
<div class="box now"><h2>いま</h2><div class="mark">✓</div><b>よくなる</b></div>
<div class="arrow"><span>使い方の影響が返るのは</span><i></i><span style="margin-top:30px">何年も先</span></div>
<div class="box later"><h2>何年も先</h2><div class="mark">✗</div><b>効かない細菌が増える</b></div>`;
    }
    case "speed":
      return speed(64);
    case "speedLow":
      // 拡大した教員用の画面では、右上に経過時間が出るので、その下に置く
      return speed(124);
    case "places":
      // 使っていく場面（シーン10）。タイトル画面の上に出すので、左のロゴに重ならないよう右の盤面の上に置く
      return `<style>${base}div{position:absolute;left:820px;top:250px;width:1000px;box-sizing:border-box;padding:30px 40px 24px;background:rgba(14,9,22,.9);box-shadow:inset 8px 0 0 #3be0c6;color:#fff}h2{margin:0 0 10px;font-size:30px;color:#3be0c6;letter-spacing:.08em}p{margin:0;padding:16px 0;font-size:50px;font-weight:800;border-top:1px solid #33274f}</style><div><h2>${esc(text)}</h2>${(extra ?? []).map((l) => `<p>${esc(l)}</p>`).join("")}</div>`;
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
      // シーン8：Claude が自分で見つけて直した数字（右下。字幕の上）。第5版の評価（審査員「大きな文字で」）を受けて数字を 48 → 66px に
      return `<style>${base}div{position:absolute;right:36px;bottom:160px;width:404px;box-sizing:border-box;padding:14px 18px;background:rgba(14,9,22,.92);box-shadow:inset 6px 0 0 #ffb347;color:#fff}h2{margin:0;font-size:24px;color:#ffb347;line-height:1.3}b{display:block;font-size:66px;font-weight:800;margin:6px 0;white-space:nowrap}p{margin:0;font-size:19px;color:#cdbfe0;line-height:1.45}</style><div><h2>${esc(text)}</h2><b>${esc(extra?.[0] ?? "")}</b><p>${esc(extra?.[1] ?? "")}</p></div>`;
    case "compare": {
      // シーン6の最後：1回目（切り札を連打）と2回目（その細菌に合う薬へ）の並べ比べ。text は JSON
      const cols = JSON.parse(text) as { head: string; rows: string[]; bad: boolean }[];
      const col = (c: { head: string; rows: string[]; bad: boolean }) =>
        `<section class="${c.bad ? "bad" : "good"}"><h2>${esc(c.head)}</h2>${c.rows.map((r) => `<p>${esc(r)}</p>`).join("")}</section>`;
      return `<style>${base}body{background:#0b0812;color:#f4ecf7;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:34px}h1{margin:0;font-size:46px;letter-spacing:.04em}div{display:flex;gap:40px}section{width:720px;padding:30px 36px;background:#160f22}section.bad{box-shadow:inset 0 0 0 4px #ff6352}section.good{box-shadow:inset 0 0 0 4px #3be0c6}h2{margin:0 0 18px;font-size:40px}section.bad h2{color:#ff8a7a}section.good h2{color:#3be0c6}p{margin:12px 0;font-size:32px;font-weight:700}</style><h1>同じ細菌、同じ手札。ちがうのは選び方だけ</h1><div>${cols.map(col).join("")}</div>`;
    }
    case "end":
      // エンドカード（第4版）：左に作品名・一般の人への一言・URL、右に学生用の URL の QR
      return `<style>${base}body{background:linear-gradient(135deg,#3b0a24,#7a1e45);color:#fff;display:flex;align-items:center;justify-content:center;gap:80px}.t{max-width:1180px;display:flex;flex-direction:column;gap:22px}h1{margin:0 0 6px;font-size:76px}p{margin:0;font-size:32px;opacity:.95}p:first-of-type{font-size:38px;font-weight:700;opacity:1;margin-bottom:10px;line-height:1.5}figure{margin:0;text-align:center}figure img{width:340px;height:340px;display:block;image-rendering:pixelated}figcaption{font-size:28px;margin-top:12px}</style><div class="t"><h1>${esc(text)}</h1>${(extra ?? []).map((l) => `<p>${esc(l)}</p>`).join("")}</div><figure><img src="${PLAY_QR}"><figcaption>あそぶ</figcaption></figure>`;
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
  writeFileSync(file, await page.png(!OPAQUE.includes(kind)));
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

/** 録画の from〜to 秒を speed 倍で切り出す。長さは (to - from) / speed（hold 秒あれば、最後のコマをその分止める）。crop は拡大する範囲（ffmpeg の crop。t は切り出した部品の中の秒） */
function clip(take: string, from: number, to: number, speed = 1, crop?: string, hold = 0): string {
  const out = join(TMP, `seg${++segCount}.mp4`);
  const vf = [`setpts=(PTS-STARTPTS)/${speed}`, "fps=30", ...(hold > 0 ? [`tpad=stop_mode=clone:stop_duration=${hold}`] : []), ...(crop ? [crop] : []), `scale=${W}:${H}:flags=lanczos:out_range=tv`, COLOR].join(",");
  ff(["-ss", String(from), "-t", String(to - from), "-i", join(REC, `${take}.mp4`), "-vf", vf, "-t", String((to - from) / speed + hold), ...ENC, out]);
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
/** 静止画を dur 秒の動画にし、ゆっくり寄る（写真の場面。2倍に広げてから寄せて、揺れを抑える） */
function stillZoom(png: string, dur: number, amount = 0.035): string {
  const out = join(TMP, `seg${++segCount}.mp4`);
  const frames = Math.round(dur * 30);
  const zp = `zoompan=z='1+${amount}*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=30`;
  ff(["-loop", "1", "-framerate", "30", "-t", String(dur), "-i", png, "-vf", `scale=${W * 2}:${H * 2},${zp},scale=${W}:${H}:out_range=tv,${COLOR}`, "-frames:v", String(frames), ...ENC, out]);
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
  [/一手/g, "いって"],
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
    execFileSync("say", ["-v", values.voice!, "-r", values.rate!, "-o", aiff, spoken]);
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
    // タイトル画面（後ろで適正ボットが遊ぶデモが動いている）。シーン3と10で別の場面を使う
    if (at("title", "タイトル → 遊び方") < 38) throw new Error("title の録画のタイトル画面が短い（scripts/record-demo.ts の title で撮り直す）");
    if (!existsSync(join(REC, "author", "photo1.jpg"))) throw new Error("作者の写真 recordings/author/photo1.jpg がない（作者が用意した写真を置く。Git に入れない）");

    // 台本 第7版（2026-11-06。第2〜6版を比べ直し、しくみの紙芝居をやめてゲームを 0:49 に出す。docs/DEMO.md・docs/eval/story/versions/）
    // 0 負ける（6.5秒、声なし）：乱用のステージ1の終わり（×8、2秒）→ 2050年に膀胱が破られる（等倍、4.5秒）。
    // 大きな字幕は1本「抗菌薬が効かない。楽勝だったはずなのに。」（作者の判断。第6版の2本は初見では読めない）。補足が3つあれば、3つめを上に小さく出す
    const sup0 = script.get(0)?.supplements ?? [];
    const main0 = script.get(0)?.main ?? "抗菌薬が効かない。楽勝だったはずなのに。";
    await scene({
      n: 0,
      dur: 6.5,
      screen: "乱用のステージ1の終わり（早送り ×8。切り札を連打して楽勝）→ 乱用の2050年、押し寄せる細菌に弾がはじかれ、膀胱が破られる（等倍）→ 負けの結果画面。声なし",
      parts: [clip(ABUSE, r1 - 16, r1, 8), clip(ABUSE, r2 - 4, r2 + 0.5)],
      overlays: [
        await ov("label", sup0[0] ?? "いま", 0, 2),
        await ov("label", sup0[1] ?? "2050年", 2, 6.5),
        { ...(await ov("hook", main0, 3.0, 6.5, sup0[2] ? [sup0[2]] : [])), text: sup0[2] ? `${sup0[2]} ／ ${main0}` : main0 },
      ],
    });
    // 1 問題：2050年の試算（12秒）：試算の図（9.5秒。scripts/make-hook-chart.ts）→ 最後の場面のまま
    const HOOK = join(REC, "hook", "hook.mp4");
    const HOOK_LAST = join(REC, "hook", "hook-last.png");
    if (!existsSync(HOOK)) throw new Error("試算の図がない（npx tsx scripts/make-hook-chart.ts で作る）");
    const DUR1 = 12;
    const hookDur = Math.min(probe(HOOK), DUR1);
    await scene({
      n: 1,
      dur: DUR1,
      screen: "図「薬剤耐性（AMR）に起因する死亡者数の推定（年間）」：2050年の棒が 1,000万人まで伸び、がんを超える（O'Neill 2014 p.5 の数値から描いた）",
      parts: [fileClip(HOOK, hookDur), ...(DUR1 - hookDur > 0.05 && existsSync(HOOK_LAST) ? [still(HOOK_LAST, DUR1 - hookDur)] : [])],
      overlays: [],
    });
    // 2 正しく使うことが大切・でも影響は何年も先・学ぶ機会が少ない（13秒）：時間のずれの図を2段で。
    //   「抗菌薬を、正しく使う」→「でも」で「いま：よくなる」「何年も先：効かない細菌が増える」の箱と矢印
    //   第7版：声を2文、図の文字を3ブロックに（第6版の5文・6ブロック・図の下の一行は、初見の読み手役3人が「読めない」）
    const gapBoth = ANCHORS[2]?.find((a) => a.word === "でも、")?.at ?? 4;
    const DUR2 = 13;
    await scene({
      n: 2,
      dur: DUR2,
      screen: "時間のずれの図（コードで描いた）：「抗菌薬を、正しく使う」→ いま「よくなる」／ 何年も先「効かない細菌が増える」と矢印「使い方の影響が返るのは、何年も先」",
      parts: [still(await render(page, "gap", "0"), gapBoth), still(await render(page, "gap", "2"), DUR2 - gapBoth)],
      overlays: [],
    });
    // 3 ゲームにした → 作ったのは誰か（18秒）：タイトル画面（後ろでボットが遊ぶデモ。上に作品の一言）→「作ったのは」で丸く小さく切った作者の写真と経歴のカード
    // 第6版：順を入れ替えた（作者の指摘：「作ったのは、薬剤師の沢田です」から始まるのは自己紹介として違和感がある）。
    // 第7版：タイトル画面に一行「抗菌薬の選び方を学ぶタワーディフェンス」（読み手役の審査員「最初に作品の一言説明がほしい」）
    const intro = script.get(3)?.intro ?? [];
    const sup3 = script.get(3)?.supplements[0];
    const toCard3 = ANCHORS[3]?.find((a) => a.word === "作ったのは")?.at ?? 7.5;
    const DUR3 = 19.5; // 第7版：仮の読み上げが 18秒では 0.8秒はみ出した（経歴の文をゆっくり読む）ので、シーン8・9・10から 0.5秒ずつ
    await scene({
      n: 3,
      dur: DUR3,
      screen: "タイトル画面（後ろでボットが遊ぶデモが動く。等倍。上に作品の一言）→ 作者の写真（顔を丸く小さく。白衣の1枚目）と右に経歴のカード",
      parts: [clip("title", 1, 1 + toCard3), still(await render(page, "intro", intro[0] ?? "沢田 佳祐", intro.slice(1)), DUR3 - toCard3)],
      overlays: sup3 ? [await ov("top", sup3, 0, toCard3)] : [],
    });
    built.at(-1)!.overlays.push({ kind: "intro", text: intro.join(" ／ "), start: toCard3, end: DUR3 });
    // 4 遊び方（17秒。第7版）：乱用のステージ1の始まりを等倍で 8秒（細菌が近づいて名前・効かない薬の札が出る。手札から薬を出す）→ 早送り 9秒。
    // 第3〜6版の「しくみ」の紙芝居（intro.html?present=1 の録画、26〜34秒）はやめ、ルール・薬ごとに効く細菌が違う・切り札を、ゲーム画面の上で声で言う
    // （第2〜6版の比べ直し：第4版以降はゲームが 1:24 まで遊ばれず、初見の読み手役3人が「紙芝居は講義の繰り返し」「いつゲームが始まるの？」）。
    // ステージ1（約183秒）は、等倍の 8秒のあとをシーン4の早送り 9秒とシーン5の早送り 8秒で同じ速さに分ける
    const LIVE4 = 8;
    const FF4 = 9;
    const FF5 = 8;
    const k45 = (r1 - (s1 + LIVE4)) / (FF4 + FF5);
    const mid45 = s1 + LIVE4 + FF4 * k45;
    const sup4 = script.get(4)?.supplements ?? [];
    const DUR4 = LIVE4 + FF4;
    await scene({
      n: 4,
      dur: DUR4,
      screen: `乱用のステージ1の始まり（等倍 ${LIVE4}秒。細菌が右から膀胱へ進み、近づくにつれ名前・効かない薬の札が出る。手札から薬を出す）→ 早送り ×${Math.round(k45)}`,
      parts: [clip(ABUSE, s1, s1 + LIVE4), clip(ABUSE, s1 + LIVE4, mid45, k45)],
      overlays: [await ov("speed", "等倍", 0, LIVE4), await speedBadge(k45, LIVE4, DUR4), ...(sup4[0] ? [await ov("top", sup4[0], 0.5, LIVE4)] : [])],
      cues: [...(sup4[1] ? [{ word: "手札の薬は", len: DUR4, png: await render(page, "top", sup4[1]), kind: "top" as Kind, text: sup4[1] }] : [])],
    });
    // 5 いま → 選択圧（20秒。第7版）：乱用のステージ1の続きを早送り（8秒。切り札を連打）→ 結果1（5秒。いちばん上に原因の一文）
    //   → 紙芝居の1コマ（7秒。「はじめての人へ」の見せ方の段5：細菌の列に薬をかけると効かない細菌だけが残って増える）。
    // 「ところが」を結果画面に、「これが選択圧」を紙芝居のコマに合わせる。残す紙芝居はこの1コマだけ（読み手役の審査員の案）
    const INTRO_TAKE = "intro";
    const RES5 = 5;
    const SEL5 = 7;
    const sup5 = script.get(5)?.supplements[0];
    const selParts = existsSync(join(REC, `${INTRO_TAKE}.mp4`))
      ? [clip(INTRO_TAKE, at(INTRO_TAKE, "段5：選択圧") + 2, at(INTRO_TAKE, "段5：選択圧") + 2 + SEL5)]
      : (warnings.push("シーン5：しくみの録画（recordings/intro.mp4）がないので、仮の絵にした（record-demo.ts --take intro で撮る）"),
        [still(await render(page, "card", "選択圧（仮の絵）", ["薬を使うと、効く細菌は倒れ、効かない細菌だけが残って増える"]), SEL5)]);
    await scene({
      n: 5,
      dur: FF5 + RES5 + SEL5,
      screen: `乱用のステージ1の続き（早送り ×${Math.round(k45)}。切り札のカルバペネム系を連打して勝つ）→ 結果画面（等倍。いちばん上に原因の一文）→ 紙芝居の1コマ（細菌の列に薬をかけると、効かない細菌だけが残って増える）`,
      parts: [clip(ABUSE, mid45, r1, k45), clip(ABUSE, r1, r1 + RES5), ...selParts],
      overlays: [await speedBadge(k45, 0, FF5)],
      cues: [...(sup5 ? [{ word: "これが選択圧", len: SEL5, png: await render(page, "top", sup5), kind: "top" as Kind, text: sup5 }] : [])],
    });
    // 6 2050年（14秒）：推移の表（4.5秒）→ 2050年を早送り（4.5秒）→ 膀胱が破られる（等倍、5秒。シーン0と同じ場面）。
    // 「最初の場面は」に合わせて大きな題「あなたの選択が…」と名前の由来
    const k6 = (r2 - 5 - s2) / 4.5;
    const sup6 = script.get(6)?.supplements[0];
    await scene({
      n: 6,
      dur: 14,
      screen: `2050年のブリーフィングと耐性率の推移の表（等倍）→ 乱用の2050年（早送り ×${Math.round(k6)}）→ 膀胱が破られる（等倍。シーン0と同じ場面）`,
      parts: [clip(ABUSE, b2, b2 + 4.5), clip(ABUSE, s2, r2 - 5, k6), clip(ABUSE, r2 - 5, r2)],
      overlays: [await speedBadge(k6, 4.5, 9)],
      cues: [
        { word: "動画冒頭の場面は", len: 4.6, png: await render(page, "big", "あなたの選択が、未来の敵をつくる"), kind: "big", text: "あなたの選択が、未来の敵をつくる" },
        ...(sup6 ? [{ word: "動画冒頭の場面は", len: 4.6, png: await render(page, "top", sup6), kind: "top" as Kind, text: sup6 }] : []),
      ],
    });
    // 7 やり直し 適正（25秒。第6版で「いま」の勝利と「2050年」の勝利を分けて見せる。作者の指摘）：
    //   ステージ1の始め（早送り 3.6秒）→ 合う薬に替える瞬間（等倍 1.8秒）→ ステージ1の続き（早送り 4.5秒）→ ステージ1の結果画面（3秒）
    //   → 2050年の説明（耐性率の推移の表、3秒）→ 2050年（早送り 2.5秒）→ 守り切った（1.5秒）→ 1回目と2回目の並べ比べ（5.1秒）。
    // 替える瞬間：録画（proper-seed570）の 18.8〜20.6秒。大腸菌に「効かない：ABPC CTRX CAZ CFDN」と出て、セフメタゾール（CMZ）の兵士を呼ぶ（2026-11-05 にコマを見て確かめた）。
    // 評価役4人の「何を変えたら勝てたのかが見えない」「並べ比べが1.5秒で消える」を受けて足した（docs/eval/story/）
    // 最後は結果画面ではなく、盤面に「守り切った！」の帯と紙吹雪が出る場面（2026-11-04 作者の判断「見せ方で対処」）。
    // 並べ比べの数字は、録画（種 570・モデル A）の結果画面の値（2026-11-05 に確かめた）：
    //   乱用：ステージ1の切り札（カルバペネム系）100% → 2050年に膀胱が破られた（手札のどの薬も効かない細菌 12%）
    //   適正：ステージ1の切り札 3% → 2050年も守り切った（膀胱 88／100、手札のどの薬も効かない細菌 0%）
    // 「守り切った！」の帯は結果画面の約1.2秒前から約1秒出る（2026-11-06 に録画のコマを見て確かめた。前の 3.1秒前からの切り出しでは帯が映っていなかった）
    const won2 = pr2 - 1.45;
    const SWITCH = [18.8, 20.6] as const;
    const pb2 = at(PROPER, "結果1 → ブリーフィング（2050年）");
    const PRE7 = 3.6; // ステージ1の始め（秒）
    const FF7A = 4.5; // ステージ1の続き（秒）
    const RES7 = 3; // ステージ1の結果画面（秒）
    const BRF7 = 3; // 2050年の説明（秒）
    const FF7B = 2.5; // 2050年（秒）
    const WON7 = 1.5; // 守り切った（秒）
    const CMP7 = 5.1; // 並べ比べ（秒。第5版の評価「読み終わる前に消える」で 5秒に。第6版で 3.6 にしたが、第7版で戻した）
    const k7p = (SWITCH[0] - p1) / PRE7;
    const k7a = (pr1 - SWITCH[1]) / FF7A;
    const k7b = (won2 - p2) / FF7B;
    const t7s = PRE7; // 替える瞬間（等倍）が始まる秒
    const t7a = t7s + 1.8; // ステージ1の続きが始まる秒
    const t7r = t7a + FF7A; // ステージ1の結果画面
    const t7f = t7r + RES7; // 2050年の説明
    const t7b = t7f + BRF7; // 2050年の早送り
    const t7w = t7b + FF7B; // 守り切った（等倍）
    const t7c = t7w + WON7; // 並べ比べ
    const DUR7 = t7c + CMP7;
    const sup7 = script.get(7)?.supplements[0];
    const COMPARE = [
      { head: "1回目：切り札を連打", rows: ["ステージ1で切り札（カルバペネム系）を 100%", "2050年：膀胱が破られた", "手札のどの薬も効かない細菌 12%"], bad: true },
      { head: "2回目：その細菌に合う薬へ", rows: ["ステージ1で切り札（カルバペネム系）を 3%", "2050年：守り切った（膀胱 88／100）", "手札のどの薬も効かない細菌 0%"], bad: false },
    ];
    await scene({
      n: 7,
      dur: DUR7,
      screen: `適正のステージ1の始め（早送り ×${Math.round(k7p)}）→ 大腸菌の正体が分かってセフメタゾールに替える瞬間（等倍）→ ステージ1の続き（早送り ×${Math.round(k7a)}）→ ステージ1の結果画面（守り切った。切り札 3%）→ 2050年の説明（耐性率の推移の表）→ 2050年（早送り ×${Math.round(k7b)}）→ 盤面の「守り切った！」（等倍）→ 1回目と2回目の並べ比べ`,
      parts: [
        clip(PROPER, p1, SWITCH[0], k7p),
        clip(PROPER, SWITCH[0], SWITCH[1]),
        clip(PROPER, SWITCH[1], pr1, k7a),
        clip(PROPER, pr1, pr1 + RES7),
        clip(PROPER, pb2, pb2 + BRF7),
        clip(PROPER, p2, won2, k7b),
        clip(PROPER, won2, won2 + WON7),
        still(await render(page, "compare", JSON.stringify(COMPARE)), CMP7),
      ],
      overlays: [
        await speedBadge(k7p, 0, t7s),
        await ov("speed", "等倍：合う薬に替える", t7s, t7a),
        await speedBadge(k7a, t7a, t7r),
        await speedBadge(k7b, t7b, t7w),
        ...(sup7 ? [await ov("top", sup7, t7a, t7r)] : []),
      ],
    });
    built.at(-1)!.overlays.push({ kind: "compare", text: COMPARE.map((c) => `${c.head}：${c.rows.join("／")}`).join(" ｜ "), start: t7c, end: DUR7 });
    // 8 教える側（24秒）：教員モードの録画（record-demo.ts の teacher。本物の Claude を動かした回）。
    // 入力（全体、3.5秒）→ Claude の作業を拡大（17.5秒。自分で見つけて直す場面は等倍 4.5秒）→ できたステージと承認・QR（3秒）。
    // 第7版：紙芝居をやめた分で 16 → 24秒に戻した（初見の読み手役3人「Claude の見せ場がいちばん薄い」「教員モードは22〜24秒」）
    // 作業の記録の時刻（録画の秒）：1回目のシミュレーションの合格が約40秒、「乱用の2050年の勝率 27% は上限 30% に近い」と書いて
    // 波を増やすのが約48秒、2回目（17%）が約72秒、提出が約78秒から（2026-11-05 に録画のコマを見て確かめた）
    const sup8 = script.get(8)?.supplements ?? [];
    const TEACHER = "teacher";
    const tReg = at(TEACHER, "地域：大阪府");
    const tGo = at(TEACHER, "ステージを作る");
    const tEnd = at(TEACHER, "設計の終わり：done");
    const tUrl = at(TEACHER, "学生用の URL");
    const w0 = 3.5; // 作業の場面が始まる秒（シーンの中）
    const kIn = (tGo + 1 - (tReg - 1)) / w0;
    // 作業の記録の欄を約1.33倍にして左に寄せ、右の約400px を工程の図と直した数字の欄にする
    // （約1.8倍で画面いっぱいにすると、右の図が Claude の書いた肝心の一文の右端を隠した。2026-11-05）
    const WORK = "crop=1080:608:730:93,scale=1440:810:flags=lanczos,pad=1920:1080:40:135:color=0x0d0915";
    // 作業の区切り（録画の秒の from・to と速さ）。合わせて WORKLEN 秒にする。
    // 第5版の評価（審査員・元臨床医「Claude の判断を等速で見たい」）を受けて、「27% は上限 30% に近いため、波を増やす」と書く場面
    // （録画の約48秒から。2026-11-06 にコマで確かめた）を等倍 4.5秒で見せる（作者の判断）。
    // 声の「切り札だけで守れてしまうなら、敵を強めて確かめ直す」は第6版で外し、等倍の場面と上の一行で見せる。「できたステージで遊ぶ」は省いた
    const SEGS: [number, number, number][] = [
      [tGo + 1, 44, 8], // データを読む → 案 → 1回目の試し
      [44, 47.5, 3], // 1回目の結果（合格）
      [47.5, 52, 1], // 「27% は上限 30% に近いため、波を増やす」（等倍）
      [52, 56, 3], // 直す
      [56, 78, 8], // 2回目の試し（17%）
    ];
    const WORKLEN = 17;
    const QRLEN = 3;
    const used = SEGS.reduce((a, [f, t, k]) => a + (t - f) / k, 0);
    const kD = (tEnd - 78) / (WORKLEN - used); // 提出
    const all8: [number, number, number][] = [...SEGS, [78, tEnd, kD]];
    // できたステージと QR の場面は、設計の終わりの 4秒あと（承認 → 学生用の URL と QR）から。前は終わりの直後からで、3秒のうち QR が映るのは最後の1秒だけだった
    const tQr = tEnd + 4;
    const kRes = (tUrl + 5 - tQr) / QRLEN;
    const at8 = (rec: number) => {
      // 録画の秒 → シーンの中の秒
      let t = w0;
      for (const [f, to, k] of all8) {
        if (rec <= to) return t + (rec - f) / k;
        t += (to - f) / k;
      }
      return w0 + WORKLEN;
    };
    const loopAt: [string, number, number][] = [
      ["1", at8(tGo + 1), at8(20)],
      ["2", at8(20), at8(37)],
      ["3", at8(37), at8(47)],
      ["4", at8(47), at8(58)],
      ["3+", at8(58), at8(77)],
      ["5", at8(77), w0 + WORKLEN],
    ];
    const factHead = "切り札を使い続けても、2050年を守れてしまう割合";
    const factNote = "目安は 30% 以下（低いほど、乱用では勝てない）。合格していたが、上限に近いので、AI が自分で敵を増やして確かめ直した";
    const badge8 = ([f, t, k]: [number, number, number]) =>
      k === 1 ? ov("speedLow", "等倍：Claude の判断", at8(f), at8(t)) : k < 4 ? ov("speedLow", `ゆっくり ×${k}`, at8(f), at8(t)) : speedBadge(k, at8(f), at8(t), "speedLow");
    const DUR8 = w0 + WORKLEN + QRLEN;
    await scene({
      n: 8,
      dur: DUR8,
      screen: `教員モード：地域と教えたいことを入力（全体）→ AI（Claude）の作業の記録を拡大（早送り ×${SEGS[0]![2]} → ×${SEGS[1]![2]} → 自分で判断する場面は等倍 ${SEGS[2]![1] - SEGS[2]![0]}秒 → ×${SEGS[3]![2]} → ×${SEGS[4]![2]} → ×${Math.round(kD)}）＋ 右に工程の図・右下に直した数字 → できたステージと承認・QR を拡大`,
      parts: [
        clip(TEACHER, tReg - 1, tGo + 1, kIn),
        ...all8.map(([f, t, k]) => clip(TEACHER, f, t, k, WORK)),
        clip(TEACHER, tQr, tUrl + 5, kRes, "crop=w=1280:h=720:x=630:y='min(360,90*t)'"),
      ],
      overlays: [
        ...(await seq(all8.map((seg) => () => badge8(seg)))),
        ...(await seq(loopAt.map(([k, a, b]) => () => ov("loop", k, a, b)))),
        { ...(await ov("fact", factHead, at8(48), at8(72), ["27% → ？", factNote])), text: `${factHead} 27%（上限 30% に近い）→ 敵を増やす` },
        { ...(await ov("fact", factHead, at8(72), w0 + WORKLEN, ["27% → 17%", factNote])), text: `${factHead} 27% → 17%` },
        // 補足は同時に1行だけ（第7版。初見の読み手役3人「補足3行はスマホでは読めない」）。
        // 第4版の直し：「数値は国の公開データのまま」は声から字幕に移した。データを読む場面で出す
        ...(sup8[0] ? [await ov("top", sup8[0], at8(SEGS[0]![0]), at8(SEGS[0]![1]))] : []),
        // 等倍の場面に、Claude の判断を一行で（第5版の評価の直し）
        ...(sup8[1] ? [await ov("top", sup8[1], at8(SEGS[2]![0]), at8(SEGS[2]![1]))] : []),
        // 最後は専門家が確かめること。できたステージと QR の場面
        ...(sup8[2] ? [await ov("top", sup8[2], w0 + WORKLEN, DUR8)] : []),
      ],
    });
    // 9 道のり（13秒）：scripts/make-scene7.ts の絵（Claude Code と作ったもの／作者が確かめた値 → スキルの評価）。
    // Git の記録の絵は、評価の直しの尺を作るため外した（期間中のコミット数は review.png に出る）。
    // 第7版：声に「この作品は、期間中に Claude Code と作りました」を足して 12.5秒
    const sc9: [string, number][] = [
      ["review.png", 7],
      ["eval.png", 5.5],
    ];
    const DUR9 = 12.5;
    const have9 = sc9.filter(([f]) => existsSync(join(REC, "scene7", f)));
    if (have9.length !== sc9.length) warnings.push(`シーン9：絵が足りない（${sc9.map(([f]) => f).filter((f) => !have9.some(([g]) => g === f)).join("・")}）。npx tsx scripts/make-scene7.ts で作る`);
    const scale9 = DUR9 / have9.reduce((a, [, d]) => a + d, 0);
    const name9: Record<string, string> = { "git.png": "Git の記録（期間中の開発）", "review.png": "Claude Code と作ったもの／作者が国の文書と照らして確かめた値", "eval.png": "スキル（知識のメモ）あり・なしの評価" };
    await scene({
      n: 9,
      dur: DUR9,
      screen: `開発の画面を順に：${have9.map(([f, d]) => `${name9[f]}（${(d * scale9).toFixed(1)}秒）`).join(" → ")}`,
      parts: have9.map(([f, d]) => still(join(REC, "scene7", f), d * scale9)),
      overlays: [],
    });
    // 10 締め（12秒）：タイトル画面（後ろのデモが動く。シーン3とは別の場面）の上に使っていく場面 →「いまの一手が」で大きな字。
    // 第5版：2枚目の写真はやめた（作者の判断。写真は名乗りの場面だけ）。第6版：尺のため「勉強会や実習、講義で使い始め、」を声から外した（使う場面は箱に残る）
    const PLACES = script.get(10)?.places?.length ? script.get(10)!.places! : ["院内の新人・若手の勉強会", "病院の実務実習の薬学生", "大学の講義・実習"];
    const toBig10 = ANCHORS[10]?.find((a) => a.word === "いまの一手が")?.at ?? 7.5;
    const main10 = script.get(10)?.main ?? "いまの一手が、未来をつくる。";
    const DUR10 = 11.5;
    await scene({
      n: 10,
      dur: DUR10,
      screen: "タイトル画面（後ろのデモが動く。シーン3とは別の場面）と右に使っていく場面 → 大きな字",
      parts: [clip("title", 22, 22 + DUR10)],
      overlays: [{ ...(await ov("places", "使っていく場面", 0.3, toBig10 - 0.1, PLACES)), text: `使っていく場面：${PLACES.join(" ／ ")}` }],
      cues: [{ word: "いまの一手が", len: DUR10 - toBig10, png: await render(page, "big", main10), kind: "big", text: main10 }],
    });
    // 11 エンドカード（4秒）。一般の人への一言（作者の方針。第3版の締めの声から移した）と、学生用の URL の QR
    const endLines = [
      "なぜ抗菌薬を正しく使うのか。知ることは、抗菌薬を受け取る人の理解にもつながる。",
      "ブラウザですぐ遊べる：ph1125ks.github.io/Built-with-Claude-Japan-2026",
      "はじめての人へ・Claude の作業記録：同じサイトの intro.html・replay.html",
      "コード：github.com/ph1125ks/Built-with-Claude-Japan-2026",
    ];
    await scene({ n: 11, dur: 4, screen: "エンドカード（右に学生用の URL の QR）", parts: [still(await render(page, "end", "センタクアツ（仮）", endLines), 4)], overlays: [] });
    built.at(-1)!.overlays.push({ kind: "card", text: ["センタクアツ（仮）", ...endLines, "QR：学生用の URL"].join(" ／ "), start: 0, end: 4 });
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
// 第7版：0 負ける（不穏）→ 1 試算（不穏）→ 2・3 なぜ・名乗り（落ち着いた分散和音）→ 4・5 遊び方・いま（明るい）→ 6 2050年（短調で刻む）→ 7 やり直し（長調）→ 8・9 教える側と道のり → 10・11 締め
const MOOD: Record<number, string> = { 0: "tension", 1: "hook", 2: "build", 3: "build", 4: "play", 5: "play", 6: "tension", 7: "hope", 8: "build", 9: "build", 10: "outro", 11: "outro" };

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
    // シーン0の中で、いまから2050年に切り替わるところ
    if (b.n === 0) {
      const cut = b.overlays.filter((o) => o.kind === "label")[1]?.start;
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
