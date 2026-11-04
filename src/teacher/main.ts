// 教員モードの画面（作者の手元だけ。npm run teacher のサーバーにつなぐ）。SPEC.md 5・DEMO.md シーン6。
// 地域を選ぶと感性率の表が出る → 教えたいことを書いて「ステージを作る」→ Claude の作業の流れが出る → できたステージを確かめて承認する
import "@fontsource/dotgothic16/400.css";
import QRCode from "qrcode";
import { iconImg } from "../game/pixel/index.ts";
import type { IconName } from "../game/pixel/icons.ts";
import "./style.css";

interface Meta {
  regions: string[];
  audiences: string[];
  model: string;
  hasKey: boolean;
  drugs: { id: string; abbr: string; cls: string; color?: string }[];
  bacteria: { id: string; name: string; gram: "negative" | "positive" }[];
}
interface Check {
  ok: boolean;
  label: string;
  value: string;
  target: string;
}
type DesignEvent =
  | { type: "status"; text: string }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "block_end" }
  | { type: "tool_call"; name: string; label: string; detail?: string }
  | { type: "tool_result"; name: string; ok: boolean; summary: string; checks?: Check[]; errors?: string[] }
  | { type: "draft"; id: string; record: DraftRecord }
  | { type: "usage"; input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number; seconds: number }
  | { type: "done"; draftId: string | null; stopReason: string | null }
  | { type: "error"; message: string };
interface StageLike {
  title: string;
  briefing?: string;
  budget: number;
  budgetPerDay?: number;
  hand: { drug: string }[];
  shortage?: { count: number };
  waves: { count: number }[];
}
interface DraftRecord {
  id: string;
  scenario: { id: string; title: string; region: string; target?: string; learningGoal?: string; debrief?: string; present: StageLike; future: StageLike & { yearsLater: number } };
  evaluation: { passed: boolean; runsPerBot: number; checks: Check[]; appropriateUsageByClass: string[] };
  summary: string;
  model: string;
}

const root = document.getElementById("teacher")!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Claude のまとめの文の、簡単な書式（見出し・太字・コード・箇条書き・表）だけを HTML にする。中身はすべてエスケープしてから */
function miniMarkdown(src: string): string {
  const inline = (t: string) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const out: string[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*\|/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      out.push(`<table class="t-md">${rows.map((r, j) => `<tr>${r.map((c) => (j === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join("")}</tr>`).join("")}</table>`);
    } else if (/^#{1,4}\s/.test(l)) out.push(`<h5>${inline(l.replace(/^#+\s*/, ""))}</h5>`);
    else if (/^\s*([-*]|\d+\.)\s/.test(l)) out.push(`<p class="t-li">${inline(l.trim().replace(/^([-*])\s/, "・"))}</p>`);
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return out.join("");
}

const TOOL_ICON: Record<string, IconName> = { get_region_data: "chart", list_catalog: "dish", simulate_stage: "fast", validate_stage: "shield", submit_stage: "star" };

let meta: Meta | null = null;

async function start(): Promise<void> {
  try {
    const r = await fetch("/api/meta");
    if (!r.ok) throw new Error(String(r.status));
    meta = (await r.json()) as Meta;
  } catch {
    root.innerHTML = `<div class="t-down">${iconImg("warn", 3)}<h1>教員モードのサーバーが動いていません</h1><p>別のターミナルで <code>npm run teacher</code> を動かしてから、このページを開き直してください。</p></div>`;
    return;
  }
  render(meta);
}

function render(m: Meta): void {
  root.innerHTML = `
  <header class="t-head">
    <div class="t-logo"><h1>センタクアツ</h1><span class="t-badge">教員モード</span></div>
    <p class="t-lead">地域の公開サーベイランスデータと、教えたいことを入れると、Claude がステージを設計し、自分でシミュレーションして確かめます。</p>
    <span class="t-model">${iconImg("info", 1)}${esc(m.model)}${m.hasKey ? "" : "・API キー未設定"}</span>
  </header>
  <main class="t-main">
    <section class="t-panel t-form">
      <h2><span class="t-step">1</span>条件</h2>
      <label class="t-field"><span>地域</span><select id="region">${m.regions.map((r) => `<option${r === "全国" ? " selected" : ""}>${esc(r)}</option>`).join("")}</select></label>
      <div class="t-abg" id="abg"></div>
      <label class="t-field"><span>対象</span><select id="audience">${m.audiences.map((a) => `<option>${esc(a)}</option>`).join("")}</select></label>
      <label class="t-field"><span>教えたいこと</span><textarea id="goal" rows="4" maxlength="400" placeholder="例：第3世代セフェムが効かない大腸菌に、カルバペネムを使わずに勝つ経験をさせたい"></textarea></label>
      <button id="go" class="t-btn primary">${iconImg("play", 1)}ステージを作る</button>
      <ul class="t-notes">
        <li>感受性の数値は公開データ（JANIS 2025年報）がもと。Claude には作らせません</li>
        <li>Claude は「乱用すると2050年に負け、適正に使えば勝てる」が成り立つまで、手札や敵の出し方を直します</li>
        <li>最後は教える人が確かめて承認してから、学生に配ります</li>
      </ul>
    </section>
    <section class="t-panel t-work">
      <h2><span class="t-step">2</span>Claude の作業<span class="t-timer" id="timer"></span></h2>
      <div class="t-log" id="log"><p class="t-empty">「ステージを作る」を押すと、ここに Claude の作業の経過が流れます。</p></div>
      <div class="t-result" id="result" hidden></div>
    </section>
  </main>`;
  const region = root.querySelector<HTMLSelectElement>("#region")!;
  region.addEventListener("change", () => void showRegion(region.value));
  void showRegion(region.value);
  root.querySelector<HTMLButtonElement>("#go")!.addEventListener("click", () => void design());
}

/** 選んだ地域の感性率の表（菌 × 薬。公開データのまま） */
async function showRegion(name: string): Promise<void> {
  const el = root.querySelector<HTMLElement>("#abg")!;
  const r = (await (await fetch(`/api/region?name=${encodeURIComponent(name)}`)).json()) as { susceptibilityPct?: Record<string, Record<string, number | string>>; urineSharePct?: Record<string, number> };
  if (!r.susceptibilityPct || !meta) return;
  const drugs = meta.drugs;
  const head = drugs.map((d) => `<th style="--cls:${d.color ?? "#888"}">${esc(d.abbr)}</th>`).join("");
  const rows = meta.bacteria
    .map((b) => {
      const cells = drugs
        .map((d) => {
          const v = r.susceptibilityPct![b.id]?.[d.id];
          if (typeof v === "string" && !/^\d/.test(v)) return `<td class="na" title="${esc(v)}">—</td>`;
          const n = typeof v === "number" ? v : Number.parseFloat(String(v));
          const cls = n >= 80 ? "good" : n >= 50 ? "mid" : "poor";
          return `<td class="${cls}">${Math.round(n)}</td>`;
        })
        .join("");
      return `<tr><th class="${b.gram}">${esc(b.name.replace(/（.*）/, ""))}<small>${r.urineSharePct?.[b.id] ?? 0}%</small></th>${cells}</tr>`;
    })
    .join("");
  el.innerHTML = `<p class="t-cap">${esc(name)}の感性率（%）と、尿から分離される割合　<span class="good">80以上</span><span class="mid">50〜80</span><span class="poor">50未満</span><span class="na">— 自然耐性など</span></p><div class="t-abg-wrap"><table><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

let timer = 0;

async function design(): Promise<void> {
  const region = root.querySelector<HTMLSelectElement>("#region")!.value;
  const audience = root.querySelector<HTMLSelectElement>("#audience")!.value;
  const goal = root.querySelector<HTMLTextAreaElement>("#goal")!.value.trim();
  const go = root.querySelector<HTMLButtonElement>("#go")!;
  const log = root.querySelector<HTMLElement>("#log")!;
  const result = root.querySelector<HTMLElement>("#result")!;
  if (!goal) {
    root.querySelector<HTMLTextAreaElement>("#goal")!.focus();
    return;
  }
  go.disabled = true;
  go.classList.add("busy");
  log.innerHTML = "";
  result.hidden = true;
  const t0 = Date.now();
  const timerEl = root.querySelector<HTMLElement>("#timer")!;
  window.clearInterval(timer);
  timer = window.setInterval(() => (timerEl.textContent = `${Math.floor((Date.now() - t0) / 1000)}秒`), 500);

  let block: HTMLElement | null = null;
  let blockKind = "";
  const add = (html: string, cls: string) => {
    const el = document.createElement("div");
    el.className = `t-ev ${cls}`;
    el.innerHTML = html;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  };
  const stream = (kind: "thinking" | "text", text: string) => {
    if (!block || blockKind !== kind) {
      block = add(kind === "thinking" ? `<span class="t-tag">経過</span><span class="t-body"></span>` : `<span class="t-body"></span>`, kind === "thinking" ? "thinking" : "note");
      blockKind = kind;
    }
    block.querySelector(".t-body")!.textContent += text;
    log.scrollTop = log.scrollHeight;
  };

  const handle = (e: DesignEvent) => {
    switch (e.type) {
      case "status":
        add(esc(e.text), "status");
        break;
      case "thinking":
        stream("thinking", e.text);
        break;
      case "text":
        stream("text", e.text);
        break;
      case "block_end":
        // まとめの文は、書き終えたら簡単な書式に整える
        if (block && blockKind === "text") {
          const body = block.querySelector<HTMLElement>(".t-body")!;
          if (/[#|*`]/.test(body.textContent ?? "")) {
            body.innerHTML = miniMarkdown(body.textContent ?? "");
            block.classList.add("md");
          }
        }
        block = null;
        blockKind = "";
        break;
      case "tool_call":
        add(`${iconImg(TOOL_ICON[e.name] ?? "info", 2)}<b>${esc(e.label)}</b><code>${esc(e.name)}</code>`, "call");
        break;
      case "tool_result": {
        const checks = e.checks?.length
          ? `<ul class="t-checks">${e.checks.map((c) => `<li class="${c.ok ? "ok" : "ng"}">${c.ok ? "✓" : "✗"} ${esc(c.label)}<span>${esc(c.value)}（目安 ${esc(c.target)}）</span></li>`).join("")}</ul>`
          : "";
        const errors = e.errors?.length ? `<ul class="t-errors">${e.errors.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
        add(`<span class="t-mark">${e.ok ? "✓" : "!"}</span>${esc(e.summary)}${checks}${errors}`, `res ${e.ok ? "ok" : "ng"}`);
        break;
      }
      case "draft":
        showDraft(e.record);
        break;
      case "usage":
        add(`${iconImg("coin", 1)}トークン：入力 ${e.input.toLocaleString()}・出力 ${e.output.toLocaleString()}・キャッシュの読み出し ${e.cacheRead.toLocaleString()}　費用の目安 約 $${e.costUsd.toFixed(2)}　${e.seconds}秒`, "usage");
        break;
      case "error":
        add(`${iconImg("warn", 1)}${esc(e.message)}`, "error");
        break;
      case "done":
        if (!e.draftId) add("提出されたステージはありません。", "status");
        break;
    }
  };

  try {
    const res = await fetch("/api/design", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ region, audience, goal }) });
    if (!res.ok || !res.body) {
      const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
      handle({ type: "error", message: err.error ?? "うまく始められませんでした" });
    } else {
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (line) handle(JSON.parse(line.slice(6)) as DesignEvent);
        }
      }
    }
  } catch (e) {
    handle({ type: "error", message: `つながりが切れました：${(e as Error).message}` });
  } finally {
    window.clearInterval(timer);
    go.disabled = false;
    go.classList.remove("busy");
  }
}

function chips(s: StageLike): string {
  const by = new Map((meta?.drugs ?? []).map((d) => [d.id, d]));
  return s.hand.map((h) => `<span class="t-chip" style="--cls:${by.get(h.drug)?.color ?? "#888"}">${esc(by.get(h.drug)?.abbr ?? h.drug)}</span>`).join("");
}

function showDraft(rec: DraftRecord): void {
  const el = root.querySelector<HTMLElement>("#result")!;
  const s = rec.scenario;
  const stageFacts = (st: StageLike, label: string, extra = "") =>
    `<div class="t-stage"><h4>${esc(label)}${extra}</h4><div class="t-chips">${chips(st)}</div><p class="t-facts">医療費 はじめ ${st.budget}・1日ごとに +${st.budgetPerDay ?? 0}／供給制限 ${st.shortage?.count ?? 0}枚／敵の波 ${st.waves.length}（${st.waves.reduce((a, w) => a + w.count, 0)}体）</p>${st.briefing ? `<p class="t-brief">${esc(st.briefing)}</p>` : ""}</div>`;
  el.hidden = false;
  el.innerHTML = `
    <h3><span class="t-step">3</span>できたステージ：${esc(s.title)}<code>${esc(s.id)}</code></h3>
    <p class="t-sum">${esc(rec.summary)}</p>
    <ul class="t-checks big">${rec.evaluation.checks.map((c) => `<li class="${c.ok ? "ok" : "ng"}">${c.ok ? "✓" : "✗"} ${esc(c.label)}<span>${esc(c.value)}（目安 ${esc(c.target)}）</span></li>`).join("")}</ul>
    <p class="t-usage">適正ボットの系統の使い分け：${esc(rec.evaluation.appropriateUsageByClass.slice(0, 5).join("、"))}（各ボット ${rec.evaluation.runsPerBot} 回）</p>
    <div class="t-stages">${stageFacts(s.present, "ステージ1「いま」")}${stageFacts(s.future, "ステージ2「2050年」", `（${s.future.yearsLater}年後）`)}</div>
    ${s.debrief ? `<div class="t-debrief"><h4>振り返り</h4><p>${esc(s.debrief)}</p></div>` : ""}
    <div class="t-actions">
      <button class="t-btn" id="preview">${iconImg("play", 1)}プレビューで遊ぶ</button>
      <button class="t-btn primary" id="approve">${iconImg("star", 1)}確かめたので承認して公開する</button>
    </div>
    <div class="t-approved" id="approved" hidden></div>`;
  el.querySelector("#preview")!.addEventListener("click", () => window.open(`/?stage=${encodeURIComponent(rec.id)}&model=A`, "_blank"));
  el.querySelector("#approve")!.addEventListener("click", () => void approve(rec.id));
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function approve(id: string): Promise<void> {
  const box = root.querySelector<HTMLElement>("#approved")!;
  const btn = root.querySelector<HTMLButtonElement>("#approve")!;
  btn.disabled = true;
  box.hidden = false;
  box.innerHTML = `<p class="t-wait">もう一度、別の種で各100回確かめています…</p>`;
  const r = (await (await fetch("/api/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })).json()) as { error?: string; publicUrl?: string; localUrl?: string; file?: string };
  if (r.error || !r.publicUrl) {
    box.innerHTML = `<p class="t-error">${iconImg("warn", 1)}${esc(r.error ?? "承認できませんでした")}</p>`;
    btn.disabled = false;
    return;
  }
  const qr = await QRCode.toDataURL(r.publicUrl, { margin: 1, width: 168, color: { dark: "#0b0812", light: "#ffffff" } });
  box.innerHTML = `
    <div class="t-qr"><img src="${qr}" alt="学生用の URL の QR コード" width="168" height="168"></div>
    <div class="t-urls">
      <h4>${iconImg("star", 1)}承認しました。学生用の URL</h4>
      <p><a href="${esc(r.publicUrl)}" target="_blank" rel="noopener">${esc(r.publicUrl)}</a></p>
      <p class="t-small">手元で遊ぶ：<a href="${esc(r.localUrl ?? "")}" target="_blank" rel="noopener">${esc(r.localUrl ?? "")}</a></p>
      <p class="t-small">公開サイトで遊べるようにするには、<code>${esc(r.file ?? "")}</code> をコミットして push します（GitHub Pages に自動で載ります）。</p>
    </div>`;
}

void start();
