// 動画のシーン7「作り方：Claude Code を中心にした開発」の4枚の絵を作る（1920×1080 の PNG。recordings/scene7/）。
// どれも実際に動かした結果から作る：
//   git.png    ：このリポジトリの Git の記録（最初のコミットの日時、日ごとのコミット数、Claude との共同コミットの数、最初と最後のコミット）。
//                ハッカソンの期間中に作ったことを見せる（作るたびに git log から数え直すので、提出の直前に作り直す）
//   audit.png  ：サブエージェント data-auditor の報告の表（recordings/scene7/audit.md。報告の最後の表をそのまま写す）
//   models.png ：耐性モデル A／B をボットで比べた勝率（docs/DEVLOG.md「既定ステージを『そろう作り』の①＋③にするかの再試算」の「①だけ」の行。各200回・種1〜200）
//   hook.png   ：コミット前のフックが、見本のキーを含むコミットを止めたときの出力（recordings/scene7/hook.txt）
//   npx tsx scripts/make-scene7.ts
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openChrome, sleep } from "./lib/chrome.ts";

const OUT = "recordings/scene7";
const W = 1920;
const H = 1080;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// 下の 150px は動画の字幕のために空けておく（字幕が絵の下端に重ならないように）
const BASE = `
html,body{margin:0;width:${W}px;height:${H}px;background:#0b0812;color:#f4ecf7;font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif}
body{display:flex;flex-direction:column;padding:60px 110px 150px;box-sizing:border-box;background:radial-gradient(ellipse at 80% 0%,rgba(143,125,255,.14),transparent 55%),#0b0812}
.kicker{font-size:26px;font-weight:700;color:#3be0c6;letter-spacing:.08em;margin:0 0 10px}
h1{margin:0 0 26px;font-size:50px;font-weight:800;line-height:1.25}
h1 small{display:block;font-size:26px;font-weight:600;color:#cdbfe0;margin-top:10px}
.panel{flex:1;background:#160f22;box-shadow:inset 0 0 0 3px #3f2f5e;padding:28px 34px;box-sizing:border-box}
.bar{display:flex;align-items:center;gap:12px;font-size:20px;color:#a493b6;margin-bottom:18px}
.bar i{width:14px;height:14px;border-radius:50%;display:inline-block}
`;

/** data-auditor の報告の表（Markdown の表の行） */
function auditHtml(md: string): string {
  const rows = md
    .split("\n")
    .filter((l) => /^\s*\|/.test(l))
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim()),
    )
    .filter((r) => !r.every((c) => /^:?-+:?$/.test(c)));
  const [head, ...body] = rows;
  const cell = (c: string) => esc(c).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  return `<style>${BASE}
table{width:100%;border-collapse:collapse;font-size:20px;line-height:1.4}
th{text-align:left;font-size:19px;color:#ff8ab3;padding:7px 12px;border-bottom:2px solid #5d4a85}
td{padding:7px 12px;border-bottom:1px solid #33274f;vertical-align:top;color:#d9cce4}
td:nth-child(3){white-space:nowrap}
h1{font-size:44px;margin-bottom:18px}
.panel{padding:20px 28px}
td:first-child{color:#fff;font-weight:700;white-space:nowrap}
td:last-child{font-weight:700;color:#5ef0a0}
code{font-size:.85em;color:#b8fff3}
</style>
<p class="kicker">開発の中心は Claude Code ② データの照合</p>
<h1>サブエージェント <code style="font-size:42px;color:#b8fff3">data-auditor</code> が、公開データの元の表と照合<small>読み取り専用。データや文章を変えたら、そのたびに点検させた</small></h1>
<div class="panel"><div class="bar"><i style="background:#ff5f56"></i><i style="background:#ffbd2e"></i><i style="background:#27c93f"></i>　Claude Code ／ サブエージェントの報告（2026-11-05）</div>
<table><thead><tr>${(head ?? []).map((c) => `<th>${cell(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

/** 耐性モデル A／B の比較（勝率。small multiples。色は dataviz の検査を通した2色：いま #26a894、2050年 #9470e8） */
function modelsHtml(): string {
  const data = {
    A: { title: "モデル A：薬ごと（既定）", 適正: [100, 100], 乱用: [93.5, 24.0], ランダム: [62.0, 27.0] },
    B: { title: "モデル B：系統ごと", 適正: [100, 99.5], 乱用: [89.0, 0.0], ランダム: [61.5, 32.5] },
  } as const;
  const bots = ["適正", "乱用", "ランダム"] as const;
  const C = ["#26a894", "#9470e8"];
  const pw = 760;
  const ph = 470;
  const top = 92;
  const bottom = 70;
  const left = 70;
  const y = (v: number) => top + (ph - top - bottom) * (1 - v / 100);
  const panel = (k: "A" | "B") => {
    const d = data[k];
    const gw = (pw - left - 20) / 3;
    const bw = 70;
    let s = `<svg width="${pw}" height="${ph}" viewBox="0 0 ${pw} ${ph}" xmlns="http://www.w3.org/2000/svg" font-family="Hiragino Sans, sans-serif">`;
    s += `<text x="${left}" y="30" font-size="27" font-weight="700" fill="#f4ecf7">${esc(d.title)}</text>`;
    for (const g of [0, 25, 50, 75, 100]) {
      s += `<line x1="${left}" x2="${pw - 10}" y1="${y(g)}" y2="${y(g)}" stroke="#2a2040" stroke-width="1"/>`;
      s += `<text x="${left - 12}" y="${y(g) + 7}" font-size="18" fill="#8b7ba3" text-anchor="end">${g}%</text>`;
    }
    // 合格の目安（適正は 80% 以上、乱用の2050年は 30% 以下）
    s += `<line x1="${left}" x2="${pw - 10}" y1="${y(30)}" y2="${y(30)}" stroke="#ffb347" stroke-width="2" stroke-dasharray="8 6"/>`;
    bots.forEach((b, i) => {
      const [now, fut] = d[b];
      const cx = left + gw * i + gw / 2;
      [now, fut].forEach((v, j) => {
        const x = cx - bw - 1 + j * (bw + 2);
        const h = Math.max(0, y(0) - y(v));
        const r = Math.min(4, h);
        s += `<path d="M${x},${y(0)} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + bw - r} Q${x + bw},${y(v)} ${x + bw},${y(v) + r} V${y(0)} Z" fill="${C[j]}"/>`;
        s += `<text x="${x + bw / 2}" y="${y(v) - 10}" font-size="19" font-weight="700" fill="#f4ecf7" text-anchor="middle">${v}%</text>`;
      });
      s += `<text x="${cx}" y="${y(0) + 36}" font-size="24" font-weight="700" fill="#d9cce4" text-anchor="middle">${b}ボット</text>`;
    });
    s += `<line x1="${left}" x2="${pw - 10}" y1="${y(0)}" y2="${y(0)}" stroke="#5d4a85" stroke-width="2"/></svg>`;
    return s;
  };
  return `<style>${BASE}
.legend{display:flex;gap:34px;font-size:24px;font-weight:700;margin:0 0 14px 6px}
.legend span{display:flex;align-items:center;gap:10px}
.legend i{width:22px;height:22px;border-radius:4px;display:inline-block}
.legend .ref{color:#ffb347;font-weight:600;font-size:21px}
.legend .ref b{display:inline-block;width:34px;border-top:2px dashed #ffb347}
.charts{display:flex;justify-content:space-between}
.note{font-size:20px;color:#a493b6;margin-top:12px}
</style>
<p class="kicker">開発の中心は Claude Code ③ ゲームバランスの検証</p>
<h1>耐性の進み方を2通り作り、サブエージェント <code style="font-size:42px;color:#b8fff3">balance-tester</code> がボットで比べた<small>勝率（各200回）。乱用は「いま」は勝てても2050年に負け、適正は両方守り切る</small></h1>
<div class="panel"><div class="legend"><span><i style="background:${C[0]}"></i>いま</span><span><i style="background:${C[1]}"></i>2050年</span><span class="ref"><b></b>乱用ボットの2050年の目安（30%以下）</span></div>
<div class="charts">${panel("A")}${panel("B")}</div>
<p class="note">既定ステージ・全国・種 1〜200。数値は開発の記録（docs/DEVLOG.md）の実測。耐性化の速さはゲーム用に誇張している</p></div>`;
}

/** Git の記録：日ごとのコミット数（1系列なので凡例なし・棒に数を直接書く。色は models と同じ #26a894）と、最初と最後のコミット */
function gitHtml(): string {
  const SEP = "\u001f";
  const log = execFileSync("git", ["log", "--reverse", `--format=%h${SEP}%ad${SEP}%s${SEP}%(trailers:key=Co-Authored-By,valueonly,separator=;)`, "--date=format:%Y-%m-%d %H:%M"])
    .toString()
    .trim()
    .split("\n")
    .map((l) => {
      const [hash, date, subject, co] = l.split(SEP);
      return { hash: hash!, date: date!, subject: subject!, claude: /Claude/i.test(co ?? "") };
    });
  const days = new Map<string, number>();
  for (const c of log) days.set(c.date.slice(0, 10), (days.get(c.date.slice(0, 10)) ?? 0) + 1);
  const withClaude = log.filter((c) => c.claude).length;
  const first = log[0]!;
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  // 棒グラフ
  const entries = [...days.entries()];
  const max = Math.max(...entries.map(([, n]) => n));
  const cw = 700;
  const ch = 520;
  const top = 50;
  const bottom = 60;
  const left = 20;
  const gw = (cw - left * 2) / entries.length;
  const bw = Math.min(90, gw - 24);
  const y = (v: number) => top + (ch - top - bottom) * (1 - v / max);
  let svg = `<svg width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}" xmlns="http://www.w3.org/2000/svg" font-family="Hiragino Sans, sans-serif">`;
  entries.forEach(([d, n], i) => {
    const x = left + gw * i + (gw - bw) / 2;
    const h = y(0) - y(n);
    const r = Math.min(4, h);
    svg += `<path d="M${x},${y(0)} V${y(n) + r} Q${x},${y(n)} ${x + r},${y(n)} H${x + bw - r} Q${x + bw},${y(n)} ${x + bw},${y(n) + r} V${y(0)} Z" fill="#26a894"/>`;
    svg += `<text x="${x + bw / 2}" y="${y(n) - 12}" font-size="26" font-weight="700" fill="#f4ecf7" text-anchor="middle">${n}</text>`;
    svg += `<text x="${x + bw / 2}" y="${y(0) + 40}" font-size="26" font-weight="700" fill="#d9cce4" text-anchor="middle">${md(d)}</text>`;
  });
  svg += `<line x1="${left}" x2="${cw - left}" y1="${y(0)}" y2="${y(0)}" stroke="#5d4a85" stroke-width="2"/></svg>`;
  // 最初と最後のコミット（間は省く）
  const line = (c: (typeof log)[number]) => `<div class="c"><span class="h">${esc(c.hash)}</span> <span class="d">${esc(c.date.slice(5).replace("-", "/"))}</span> ${esc(c.subject.length > 26 ? `${c.subject.slice(0, 26)}…` : c.subject)}</div>`;
  const shown = log.length > 13 ? [...log.slice(0, 6).map(line), `<div class="gap">⋮　（ほか ${log.length - 13} 件）</div>`, ...log.slice(-7).map(line)] : log.map(line);
  return `<style>${BASE}
.wrap{display:flex;gap:40px;flex:1}
.chart{flex:none;width:740px;display:flex;flex-direction:column}
.chart h2{margin:0 0 6px;font-size:26px;color:#f4ecf7}
.chart p{margin:0;font-size:20px;color:#a493b6}
.panel{flex:1}
.term{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;line-height:1.75;color:#d9cce4}
.cmd{color:#b8fff3;margin-bottom:8px}
.h{color:#ffb347}.d{color:#8b7ba3}
.gap{color:#8b7ba3;padding-left:8px}
</style>
<p class="kicker">開発の中心は Claude Code ① 期間中の開発の記録</p>
<h1>${Number(first.date.slice(5, 7))}月${Number(first.date.slice(8, 10))}日の最初のコミットから、すべて期間中にこのリポジトリで作った<small>Git の記録：${log.length} コミット。うち ${withClaude} は Claude Code との共同コミット（Co-Authored-By: Claude）</small></h1>
<div class="wrap"><div class="chart"><h2>日ごとのコミット数</h2><p>最初のコミット：${esc(first.date)}</p>${svg}</div>
<div class="panel"><div class="bar"><i style="background:#ff5f56"></i><i style="background:#ffbd2e"></i><i style="background:#27c93f"></i>　git log --reverse（古い順）</div>
<div class="term"><div class="cmd">$ git log --reverse --format='%h %ad %s'</div>${shown.join("")}</div></div></div>`;
}

function hookHtml(text: string): string {
  const lines = text.trimEnd().split("\n");
  const body = lines
    .map((l, i) => {
      if (i === 0) return `<div class="cmd">${esc(l)}</div>`;
      if (i === 1) return `<div class="who">${esc(l)}</div>`;
      if (l.startsWith("コミットを止めました")) return `<div class="stop">✋ ${esc(l)}</div>`;
      return `<div class="out">${esc(l)}</div>`;
    })
    .join("");
  return `<style>${BASE}
.term{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:31px;line-height:1.8}
.panel{flex:none;padding:34px 40px 40px}
.cmd{color:#b8fff3}
.who{color:#8b7ba3;font-size:22px;margin:8px 0}
.stop{color:#fff;background:#6a1410;box-shadow:inset 6px 0 0 #ff6352;padding:10px 18px;margin:10px 0;font-weight:700;font-family:"Hiragino Sans",sans-serif}
.out{color:#ffd6c8}
.note{font-size:22px;color:#a493b6;margin-top:22px;font-family:"Hiragino Sans",sans-serif;line-height:1.6}
</style>
<p class="kicker">開発の中心は Claude Code ④ 鍵や個人情報の流出防止</p>
<h1>コミット前のフックが、API キーらしき文字列を見つけて止める<small>公開リポジトリなので、Claude のコマンドの前に必ず点検する（.claude/hooks/check-secrets.sh）</small></h1>
<div class="panel"><div class="bar"><i style="background:#ff5f56"></i><i style="background:#ffbd2e"></i><i style="background:#27c93f"></i>　Claude Code のコマンド（実演用の見本のキー。本物ではない）</div>
<div class="term">${body}</div>
<p class="note">実演で、1行で「ファイルを作ってコミット」するとフックの点検をすり抜けることが分かったので、コマンドの中身も調べるように直した（2026-11-05）</p></div>`;
}

const { page, close } = await openChrome({ width: W, height: H });
try {
  const shots: [string, string][] = [
    ["git.png", gitHtml()],
    ["models.png", modelsHtml()],
    ["hook.png", hookHtml(readFileSync(join(OUT, "hook.txt"), "utf8"))],
  ];
  try {
    shots.unshift(["audit.png", auditHtml(readFileSync(join(OUT, "audit.md"), "utf8"))]);
  } catch {
    console.log("audit.md がないので、データ監査の絵は作らない");
  }
  for (const [name, html] of shots) {
    await page.send("Page.navigate", { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` });
    await sleep(500);
    writeFileSync(join(OUT, name), await page.png());
    console.log(`→ ${join(OUT, name)}`);
  }
} finally {
  close();
}
