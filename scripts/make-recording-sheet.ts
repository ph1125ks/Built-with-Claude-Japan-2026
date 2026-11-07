// 作者がナレーションを録音するときに読む原稿（1枚の HTML）を作る。台本（docs/DEMO.md）のナレーションと、
// 仮の動画の書き出しの記録（recordings/draft-video.json）のシーンの長さから、シーンごとに
// 「枠の秒数・読み終える上限・字数・ファイル名・画面に合わせてあける間・読み方」を並べる。
//   npx tsx scripts/make-recording-sheet.ts
//   → recordings/recording-sheet/index.html（Git に入れない。作者には Artifact で見せる）
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ANCHORS, chunks, VOICE_FROM } from "./lib/video-cues.ts";

const PACE = 6.1; // 読む速さの目安（1秒あたりの字数。2026-11-07 の作者の仮の録音10本で測った値（756字を 123.5秒）。第7版までは 5.3。DEMO.md の「語り手」）
/** 声に合わせて長さが伸び縮みするシーンと、その上限（秒）。make-draft-video.ts の fit と同じ値。ほかのシーンは枠が決まっている */
const FIT: Record<number, number> = { 1: 12, 2: 13, 3: 19.5, 9: 16, 10: 16 };
const OUT = join("recordings", "recording-sheet");
mkdirSync(OUT, { recursive: true });

const md = readFileSync("docs/DEMO.md", "utf8");
const report = JSON.parse(readFileSync(join("recordings", "draft-video.json"), "utf8")) as { total: number; scenes: { n: number; dur: number; screen: string }[] };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** 読み違えやすい語の読み（原稿に添える） */
const READINGS: [RegExp, string][] = [
  [/AST/, "AST＝エーエスティー"],
  [/Claude Code/, "Claude Code＝クロード コード"],
  [/Claude(?! Code)/, "Claude＝クロード"],
  [/JANIS/, "JANIS＝ジャニス"],
  [/2050年/, "2050年＝にせんごじゅうねん"],
  [/第3世代/, "第3世代＝だいさんせだい"],
  [/入職/, "入職＝にゅうしょく"],
  [/10年/, "10年＝じゅうねん"],
  [/膀胱炎/, "膀胱炎＝ぼうこうえん"],
  [/一手/, "一手＝いって"],
  [/選択圧/, "選択圧＝せんたくあつ"],
  [/1,000万人/, "1,000万人＝いっせんまんにん"],
  [/沢田/, "沢田＝さわだ"],
];

interface Row {
  n: number;
  name: string;
  dur: number;
  text: string;
  screen: string;
}
const rows: Row[] = [];
for (const part of md.split(/\n### シーン/).slice(1)) {
  const n = Number(part.match(/^(\d+)/)?.[1]);
  const name = part.match(/^\d+　(.+?)（/)?.[1] ?? "";
  const text = part.match(/\*\*ナレーション\*\*[^\n]*\n\s*>\s*(.+)/)?.[1]?.trim();
  const sc = report.scenes.find((s) => s.n === n);
  if (text && sc) rows.push({ n, name, dur: sc.dur, text, screen: sc.screen });
}
const totalChars = rows.reduce((a, r) => a + r.text.length, 0);

const cards = rows
  .map((r) => {
    const fitMax = FIT[r.n];
    const limit = fitMax ? fitMax - VOICE_FROM - 1.5 : r.dur - VOICE_FROM * 2;
    const need = r.text.length / PACE;
    const lines = chunks(r.text);
    // t：シーンの頭からの秒。間をあけたら、そのあとの文はその分だけ遅れて始まる（2026-11-05 第4版：間が2つ以上あるシーンで、
    // 前の間を足さずに数えていたので、間を多く見積もっていた）
    let t = VOICE_FROM;
    let pauseTotal = 0;
    const body = lines
      .map((line) => {
        let html = "";
        const a = (ANCHORS[r.n] ?? []).find((x) => line.startsWith(x.word));
        if (a && a.at > t) {
          const pause = a.at - t;
          pauseTotal += pause;
          t = a.at;
          if (pause > 0.3) html += `<p class="pause"><span>間</span>ここで約${(Math.round(pause * 2) / 2).toFixed(1)}秒あける（${esc(a.why)}）</p>`;
        }
        t += line.length / PACE;
        return `${html}<p class="line">${esc(line)}</p>`;
      })
      .join("");
    const reads = READINGS.filter(([re]) => re.test(r.text)).map(([, s]) => s);
    const slack = limit - need - pauseTotal;
    return `<article class="card" id="scene${r.n}">
  <header>
    <span class="no">${r.n}</span>
    <div class="hd"><h2>${esc(r.name)}</h2><p class="file">ファイル名 <code>scene${r.n}.m4a</code></p></div>
    <label class="done"><input type="checkbox" id="done${r.n}" data-n="${r.n}"> 録った</label>
  </header>
  <dl class="stats">
    <div><dt>枠</dt><dd>${fitMax ? `声に合わせる（上限 ${fitMax}秒）` : `${r.dur}秒`}</dd></div>
    <div><dt>読み終える上限</dt><dd>${limit.toFixed(1)}秒</dd></div>
    <div><dt>字数</dt><dd>${r.text.length}字</dd></div>
    <div><dt>1秒に${PACE}字なら</dt><dd>${need.toFixed(1)}秒${pauseTotal >= 0.05 ? `＋間 ${pauseTotal.toFixed(1)}秒` : ""}</dd></div>
    <div class="${slack < 1 ? "tight" : ""}"><dt>余り</dt><dd>${slack.toFixed(1)}秒</dd></div>
  </dl>
  <p class="screen"><span>画面</span>${esc(r.screen)}</p>
  <div class="text">${body}</div>
  ${reads.length ? `<p class="reads"><span>読み</span>${reads.map(esc).join("　")}</p>` : ""}
</article>`;
  })
  .join("\n");

const page = `<title>センタクアツ 録音原稿</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DotGothic16&family=BIZ+UDPGothic:wght@400;700&display=swap">
<style>
/* 読み上げる紙の原稿。1段で、シーンごとに大きな字の本文。数字は等幅でそろえる */
:root{
  --bg:#f6f3f8; --card:#ffffff; --ink:#1d1424; --ink2:#4d4058; --muted:#7a6d86; --line:#e2dbe8;
  --accent:#a3214f; --teal:#0f7d6c; --warn:#a65400; --pause-bg:#fff1d6; --pause-ink:#6b3d00; --chip:#efe9f3;
  --display:"DotGothic16","Hiragino Sans",sans-serif;
  --body:"BIZ UDPGothic","Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#0f0b15; --card:#18121f; --ink:#f4ecf7; --ink2:#cdbfe0; --muted:#9a8ab1; --line:#33274f;
  --accent:#ff7fb0; --teal:#3be0c6; --warn:#ffb347; --pause-bg:#3a2a10; --pause-ink:#ffd48a; --chip:#241b30; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#0f0b15; --card:#18121f; --ink:#f4ecf7; --ink2:#cdbfe0; --muted:#9a8ab1; --line:#33274f;
  --accent:#ff7fb0; --teal:#3be0c6; --warn:#ffb347; --pause-bg:#3a2a10; --pause-ink:#ffd48a; --chip:#241b30; color-scheme:dark}
body{background:var(--bg);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.7}
.wrap{max-width:860px;margin:0 auto;padding-block:28px 72px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:20px}
h1{font-family:var(--display);font-weight:400;font-size:clamp(26px,5vw,36px);margin:0;line-height:1.25;text-wrap:balance}
h1 small{display:block;font-size:.48em;color:var(--teal);letter-spacing:.1em;margin-bottom:4px}
.meta{margin:6px 0 0;color:var(--ink2)}
.meta b{font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--ink)}
.how{background:var(--card);border:1px solid var(--line);padding:16px 20px}
.how h2{font-size:15px;margin:0 0 6px;color:var(--accent);letter-spacing:.06em}
.how ol{margin:0;padding-left:1.4em;display:flex;flex-direction:column;gap:4px;color:var(--ink2)}
.how code,.file code{font-family:var(--mono);font-size:.92em;background:var(--chip);padding:1px 6px}
.card{background:var(--card);border:1px solid var(--line);padding:18px 20px 20px;display:flex;flex-direction:column;gap:12px;scroll-margin-top:12px}
.card.is-done{opacity:.6}
.card header{display:flex;align-items:center;gap:14px}
.no{font-family:var(--display);font-size:28px;width:52px;height:52px;display:grid;place-items:center;background:var(--accent);color:#fff;flex:none}
.hd{flex:1;min-width:0}
.hd h2{margin:0;font-size:19px;text-wrap:balance}
.file{margin:0;color:var(--muted);font-size:14px}
.done{display:flex;align-items:center;gap:6px;font-size:14px;color:var(--ink2);cursor:pointer;white-space:nowrap}
.done input{width:20px;height:20px;accent-color:var(--teal)}
.stats{display:flex;flex-wrap:wrap;gap:6px 18px;margin:0}
.stats div{display:flex;gap:6px;align-items:baseline}
.stats dt{font-size:13px;color:var(--muted)}
.stats dd{margin:0;font-family:var(--mono);font-variant-numeric:tabular-nums;font-weight:700}
.stats .tight dd{color:var(--warn)}
.screen,.reads{margin:0;font-size:14px;color:var(--ink2)}
.screen span,.reads span{display:inline-block;font-size:12px;font-weight:700;color:var(--muted);border:1px solid var(--line);padding:0 6px;margin-right:8px}
.text{display:flex;flex-direction:column;gap:2px;padding:6px 0 2px}
.line{margin:0;font-size:clamp(20px,3.2vw,25px);line-height:1.75;font-weight:700;letter-spacing:.02em}
.pause{margin:6px 0;padding:6px 12px;background:var(--pause-bg);color:var(--pause-ink);font-weight:700;font-size:16px;display:flex;align-items:center;gap:10px}
.pause span{font-family:var(--display);font-size:20px}
input:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
</style>
<div class="wrap">
  <header>
    <h1><small>Built with Claude: Japan 2026 ／ デモ動画</small>センタクアツ　録音原稿</h1>
    <p class="meta">ナレーション <b>${rows.length}</b> シーン・合計 <b>${totalChars}</b> 字（1秒に${PACE}字で約 <b>${Math.round(totalChars / PACE)}</b> 秒）。動画は全体 <b>${Math.floor(report.total / 60)}:${String(Math.round(report.total % 60)).padStart(2, "0")}</b></p>
  </header>
  <section class="how">
    <h2>録り方</h2>
    <ol>
      <li><b>台本 第8版</b>（2026-11-07。第7版の文に、シーン2「薬学生や新人が」、シーン4「実際の検査の結果が、時間差で届くのと同じです。」、シーン8「数値は公開データのまま、Claude には作らせません。」、シーン10「まず、私の病院の新人の勉強会と、実務実習の薬学生から。」を足した）。第8版の続き（11/8 未明）で作者の指摘によりシーン1・2・3・5・7・8・9の文も変わった。シーン0（負ける場面）とシーン11（エンドカード）は声がないので、録るのはシーン1〜10の10本。<b>11/7 の仮の録音は文が変わる前のものなので、10本とも録り直す</b>。読む速さは、仮の録音で測った<b>1秒に約${PACE}字</b>で計算している（仮の録音と同じ速さでよい）</li>
      <li><b>枠が「声に合わせる」のシーン（1・2・3・9・10）</b>は、声の長さに合わせて場面が伸び縮みする（上限まで）。ゲームの場面（4〜8）は枠が決まっているので、「読み終える上限」より前に読み終える</li>
      <li><b>シーン3と10は、スマホで自分を撮る</b>（横向き・約20秒。顔は画面の中ほど。撮り始めて1秒待ってから読み、読み終えてからも2秒ほど待って止める）。声はその映像から取るので、<code>scene3.m4a</code>・<code>scene10.m4a</code> は要らない。映像は <code>recordings/author/self.mp4</code>（シーン3）と <code>self10.mp4</code>（シーン10）に置く（Git には入らない）。シーン10は、左にスマホの縦画面の写し、右にこの映像と「使っていく場面」のカードが並ぶ</li>
      <li>シーン3（名乗り）と10（締め）は作者自身の言葉。気持ちを込めて、少しゆっくりでよい</li>
      <li>シーンごとに1つのファイルに録る。ファイル名は <code>scene1.m4a</code> のようにシーンの番号で（wav・m4a・aiff・mp3 のどれでもよい）</li>
      <li>録ったファイルは、リポジトリの <code>recordings/voice/</code> に置く</li>
      <li>録り始めと終わりの無音は自動で切るので、気にしなくてよい</li>
      <li>「間」の印のところは、画面の切り替わりを待つ。字幕は声の中の無音に合わせて出るので、間ははっきりあける</li>
      <li>置き終えたら、Claude に「録音を置いた」と伝える（書き出して、はみ出しや字幕のずれを確かめる）</li>
    </ol>
  </section>
  ${cards}
</div>
<script>
(() => {
  const KEY = "sentakuatsu.recorded";
  let done = {};
  try { done = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { done = {}; }
  const apply = (box) => box.closest(".card").classList.toggle("is-done", box.checked);
  document.querySelectorAll(".done input").forEach((box) => {
    box.checked = !!done[box.dataset.n];
    apply(box);
    box.addEventListener("change", () => {
      done[box.dataset.n] = box.checked;
      try { localStorage.setItem(KEY, JSON.stringify(done)); } catch {}
      apply(box);
    });
  });
})();
</script>
`;
writeFileSync(join(OUT, "index.html"), page);
console.log(`→ ${join(OUT, "index.html")}（${rows.length} シーン・${totalChars} 字）`);
