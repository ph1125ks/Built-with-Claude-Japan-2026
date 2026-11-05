// 教員モードの画面（main.ts）と、作業の記録の再生（src/replay/）で共通に使う描き方。
// 教員モードはサーバーから届く DesignEvent を、再生は記録の JSON の DesignEvent を、同じ createLog に渡して描く
import { iconImg } from "../game/pixel/index.ts";
import type { IconName } from "../game/pixel/icons.ts";

export interface Check {
  ok: boolean;
  label: string;
  value: string;
  target: string;
}
/** Claude の作業の知らせ（server/agent.ts の DesignEvent と同じ形） */
export type DesignEvent =
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
export interface StageLike {
  title: string;
  briefing?: string;
  budget: number;
  budgetPerDay?: number;
  hand: { drug: string }[];
  shortage?: { count: number };
  waves: { count: number }[];
}
export interface DraftRecord {
  id: string;
  scenario: { id: string; title: string; region: string; target?: string; learningGoal?: string; debrief?: string; present: StageLike; future: StageLike & { yearsLater: number } };
  evaluation: { passed: boolean; runsPerBot: number; checks: Check[]; appropriateUsageByClass: string[] };
  summary: string;
  model: string;
}
/** 画面に出す薬（略号と系統の色）と菌 */
export interface DrugMeta {
  id: string;
  abbr: string;
  cls: string;
  color?: string;
}
export interface BacteriumMeta {
  id: string;
  name: string;
  gram: "negative" | "positive";
}
/** 地域の感性率（菌 × 薬。公開データのまま）と、尿から分離される割合 */
export interface RegionTable {
  susceptibilityPct?: Record<string, Record<string, number | string>>;
  urineSharePct?: Record<string, number>;
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Claude のまとめの文の、簡単な書式（見出し・太字・コード・箇条書き・表）だけを HTML にする。中身はすべてエスケープしてから */
export function miniMarkdown(src: string): string {
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

export const TOOL_ICON: Record<string, IconName> = { get_region_data: "chart", list_catalog: "dish", simulate_stage: "fast", validate_stage: "shield", submit_stage: "star" };

/** 選んだ地域の感性率の表（菌 × 薬。公開データのまま） */
export function regionTableHtml(name: string, r: RegionTable, drugs: DrugMeta[], bacteria: BacteriumMeta[]): string {
  if (!r.susceptibilityPct) return "";
  const head = drugs.map((d) => `<th style="--cls:${d.color ?? "#888"}">${esc(d.abbr)}</th>`).join("");
  const rows = bacteria
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
  return `<p class="t-cap">${esc(name)}の感性率（%）と、尿から分離される割合　<span class="good">80以上</span><span class="mid">50〜80</span><span class="poor">50未満</span><span class="na">— 自然耐性など</span></p><div class="t-abg-wrap"><table><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function checksHtml(checks: Check[], cls = "t-checks"): string {
  return `<ul class="${cls}">${checks.map((c) => `<li class="${c.ok ? "ok" : "ng"}">${c.ok ? "✓" : "✗"} ${esc(c.label)}<span>${esc(c.value)}（目安 ${esc(c.target)}）</span></li>`).join("")}</ul>`;
}

/**
 * 作業の記録の欄（log）に、届いた知らせを順に描く。返り値に知らせを1つずつ渡す。
 * 考えの知らせ（thinking）とまとめの文（text）は、少しずつ届いた分を同じ欄に書き足す。できたステージ（draft）は onDraft に渡す
 */
export function createLog(log: HTMLElement, onDraft: (rec: DraftRecord) => void): (e: DesignEvent) => void {
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

  return (e: DesignEvent) => {
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
        const checks = e.checks?.length ? checksHtml(e.checks) : "";
        const errors = e.errors?.length ? `<ul class="t-errors">${e.errors.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
        add(`<span class="t-mark">${e.ok ? "✓" : "!"}</span>${esc(e.summary)}${checks}${errors}`, `res ${e.ok ? "ok" : "ng"}`);
        break;
      }
      case "draft":
        onDraft(e.record);
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
}

/** できたステージの欄の中身（見出し・合否・手札・波・ブリーフィング・振り返り）。ボタンは呼ぶ側が後ろに足す */
export function draftHtml(rec: DraftRecord, drugs: DrugMeta[]): string {
  const by = new Map(drugs.map((d) => [d.id, d]));
  const chips = (s: StageLike) => s.hand.map((h) => `<span class="t-chip" style="--cls:${by.get(h.drug)?.color ?? "#888"}">${esc(by.get(h.drug)?.abbr ?? h.drug)}</span>`).join("");
  const s = rec.scenario;
  const stageFacts = (st: StageLike, label: string, extra = "") =>
    `<div class="t-stage"><h4>${esc(label)}${extra}</h4><div class="t-chips">${chips(st)}</div><p class="t-facts">医療費 はじめ ${st.budget}・1日ごとに +${st.budgetPerDay ?? 0}／供給制限 ${st.shortage?.count ?? 0}枚／敵の波 ${st.waves.length}（${st.waves.reduce((a, w) => a + w.count, 0)}体）</p>${st.briefing ? `<p class="t-brief">${esc(st.briefing)}</p>` : ""}</div>`;
  return `
    <h3><span class="t-step">3</span>できたステージ：${esc(s.title)}<code>${esc(s.id)}</code></h3>
    <p class="t-sum">${esc(rec.summary)}</p>
    ${checksHtml(rec.evaluation.checks, "t-checks big")}
    <p class="t-usage">適正ボットの系統の使い分け：${esc(rec.evaluation.appropriateUsageByClass.slice(0, 5).join("、"))}（各ボット ${rec.evaluation.runsPerBot} 回）</p>
    <div class="t-stages">${stageFacts(s.present, "ステージ1「いま」")}${stageFacts(s.future, "ステージ2「2050年」", `（${s.future.yearsLater}年後）`)}</div>
    ${s.debrief ? `<div class="t-debrief"><h4>振り返り</h4><p>${esc(s.debrief)}</p></div>` : ""}`;
}
