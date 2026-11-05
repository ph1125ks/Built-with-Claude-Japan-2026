// 教員モードの画面（作者の手元だけ。npm run teacher のサーバーにつなぐ）。SPEC.md 5・DEMO.md シーン6。
// 地域を選ぶと感性率の表が出る → 教えたいことを書いて「ステージを作る」→ Claude の作業の流れが出る → できたステージを確かめて承認する
import "@fontsource/dotgothic16/400.css";
import QRCode from "qrcode";
import { iconImg } from "../game/pixel/index.ts";
import "./style.css";
import { createLog, draftHtml, esc, regionTableHtml, type BacteriumMeta, type DesignEvent, type DraftRecord, type DrugMeta, type RegionTable } from "./view.ts";

interface Meta {
  regions: string[];
  audiences: string[];
  model: string;
  hasKey: boolean;
  drugs: DrugMeta[];
  bacteria: BacteriumMeta[];
}

const root = document.getElementById("teacher")!;

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
  const r = (await (await fetch(`/api/region?name=${encodeURIComponent(name)}`)).json()) as RegionTable;
  if (!r.susceptibilityPct || !meta) return;
  el.innerHTML = regionTableHtml(name, r, meta.drugs, meta.bacteria);
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

  const handle = createLog(log, showDraft);

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

function showDraft(rec: DraftRecord): void {
  const el = root.querySelector<HTMLElement>("#result")!;
  el.hidden = false;
  el.innerHTML = `${draftHtml(rec, meta?.drugs ?? [])}
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
