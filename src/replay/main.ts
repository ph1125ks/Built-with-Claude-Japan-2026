// 作業の記録の再生（公開サイトの replay.html）。教員モードで Claude がステージを設計したときの記録（public/replays/*.json）を、
// API キーなしで、記録した時間のとおりに再生する。教員モードの画面とサーバーは作者の手元でだけ動くので、公開サイトではこの記録で中身を見せる。
// 描き方は教員モードの画面と同じもの（src/teacher/view.ts）を使う。URL：replay.html?log=<public/replays/ の中のファイル名>（既定は osaka.json）
import "@fontsource/dotgothic16/400.css";
import { loadGameData, susceptibility, urineWeights } from "../engine/index.ts";
import { iconImg } from "../game/pixel/index.ts";
import "../teacher/style.css";
import { createLog, draftHtml, esc, regionTableHtml, type BacteriumMeta, type DraftRecord, type DrugMeta, type RegionTable } from "../teacher/view.ts";
import { formatSec, parseReplayLog, replayFile, schedule, type ReplayLog } from "./schedule.ts";
import "./style.css";

const root = document.getElementById("replay")!;
const data = loadGameData();
const drugs: DrugMeta[] = data.drugs.map((d) => ({ id: d.id, abbr: d.abbr, cls: d.class, color: data.classById.get(d.class)?.color }));
const bacteria: BacteriumMeta[] = data.bacteria.map((b) => ({ id: b.id, name: b.name, gram: b.gram }));
const SPEEDS = [1, 4, 16];

const pct = (x: number) => Math.round(x * 1000) / 10;
/** 地域の感性率の表の中身。教員モードのサーバーの regionData（server/tools.ts）と同じ作り方で、公開データ（JANIS 2025年報）から作る */
function regionTable(region: string): RegionTable {
  if (!data.janis.regions.includes(region)) return {};
  const w = urineWeights(data, region);
  const total = w.weights.reduce((a, b) => a + b, 0);
  const urineSharePct = Object.fromEntries(w.species.map((sp, i) => [sp, pct(w.weights[i]! / total)]));
  const susceptibilityPct: Record<string, Record<string, number | string>> = {};
  for (const b of data.bacteria) {
    const row: Record<string, number | string> = {};
    for (const d of data.drugs) {
      const v = susceptibility(data, region, b.id, d.id);
      row[d.id] = v.basis === "intrinsic" ? "自然耐性" : v.basis === "fixed" ? "効かない扱い" : v.basis === "proxy" ? `${pct(v.p)}（代用）` : pct(v.p);
    }
    susceptibilityPct[b.id] = row;
  }
  return { urineSharePct, susceptibilityPct };
}

/** できたステージが公開サイトで遊べるか（public/stages/<id>.json があるか）。ないときは「遊ぶ」のリンクを出さない */
async function isPublished(id: string): Promise<boolean> {
  if (!/^[a-z0-9-]+$/.test(id)) return false;
  try {
    const r = await fetch(`stages/${id}.json`);
    if (!r.ok) return false;
    // 開発サーバーは、ないファイルに index.html を返すことがあるので、中身の id まで確かめる
    const s = (await r.json()) as { id?: unknown };
    return s.id === id;
  } catch {
    return false;
  }
}

async function start(): Promise<void> {
  const file = replayFile(new URLSearchParams(location.search).get("log"));
  let log: ReplayLog | null = null;
  if (file) {
    try {
      const r = await fetch(file);
      if (r.ok) log = parseReplayLog(await r.json());
    } catch {
      log = null;
    }
  }
  if (!log) {
    root.innerHTML = `<div class="t-down">${iconImg("warn", 3)}<h1>記録を読み込めませんでした</h1><p>URL の <code>?log=</code> には、公開している記録のファイル名を指定します。</p><p><a href="./replay.html">はじめの記録を見る</a>　<a href="./">ゲームで遊ぶ</a></p></div>`;
    return;
  }
  const draft = log.events.find((x) => x.e.type === "draft")?.e as { record?: DraftRecord } | undefined;
  const stageId = draft?.record?.scenario?.id;
  render(log, stageId && (await isPublished(stageId)) ? stageId : null);
}

function render(rec: ReplayLog, playId: string | null): void {
  const made = new Date(rec.made);
  const day = Number.isNaN(made.getTime()) ? "" : made.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });
  const { items, total } = schedule(rec.events);
  const ticks = items
    .filter((x) => x.e.type === "tool_call" && (x.e.name === "simulate_stage" || x.e.name === "submit_stage"))
    .map((x) => {
      const e = x.e as { name: string; label: string };
      return `<i class="${e.name === "submit_stage" ? "sub" : "sim"}" style="left:${total > 0 ? (x.at / total) * 100 : 0}%" title="${esc(e.label)}"></i>`;
    })
    .join("");
  const region = regionTableHtml(rec.input.region, regionTable(rec.input.region), drugs, bacteria);
  document.title = `センタクアツ 教員モードの記録（${rec.input.region}）`;
  root.innerHTML = `
  <header class="t-head">
    <div class="t-logo"><h1>センタクアツ</h1><span class="t-badge">教員モードの記録</span></div>
    <p class="t-lead">教員モードで、Claude がステージを設計したときの作業の記録です。地域の公開データを読み、案を作り、シミュレーションで確かめて直し、提出するまでを、記録した時間のとおりに再生します。</p>
    <span class="t-model">${iconImg("info", 1)}${esc(rec.model)}${day ? `・${esc(day)}の記録` : ""}</span>
  </header>
  <p class="r-about">${iconImg("info", 1)}<span>この記録は、教員モードを実際に動かしたときのものをそのまま再生しています（API キーは不要）。教員モードは作者の手元でだけ動かす画面なので、公開サイトではこの記録で中身を見られるようにしています。<a href="./">ゲームで遊ぶ</a></span></p>
  <main class="t-main">
    <section class="t-panel t-form">
      <h2><span class="t-step">1</span>条件</h2>
      <div class="t-field"><span>地域</span><div class="r-value">${esc(rec.input.region)}</div></div>
      <div class="t-abg">${region}</div>
      <div class="t-field"><span>対象</span><div class="r-value">${esc(rec.input.audience)}</div></div>
      <div class="t-field"><span>教えたいこと</span><div class="r-value">${esc(rec.input.goal)}</div></div>
      <ul class="t-notes">
        <li>感受性の数値は公開データ（JANIS 2025年報）がもと。Claude には作らせません</li>
        <li>Claude は「乱用すると2050年に負け、適正に使えば勝てる」が成り立つまで、手札や敵の出し方を直します</li>
        <li>最後は教える人が確かめて承認してから、学生に配ります</li>
      </ul>
    </section>
    <section class="t-panel t-work">
      <h2><span class="t-step">2</span>Claude の作業</h2>
      <div class="r-controls">
        <button type="button" class="t-btn primary r-play" id="play"></button>
        <div class="r-speed" role="group" aria-label="再生の速さ">${SPEEDS.map((s) => `<button type="button" data-speed="${s}" aria-pressed="${s === 1}">${s}倍</button>`).join("")}</div>
        <button type="button" class="t-btn r-skip" id="skip">${iconImg("fast", 1)}最後まで飛ばす</button>
        <div class="r-bar">
          <div class="r-track"><input type="range" id="seek" min="0" max="${Math.max(1, Math.ceil(total * 10))}" step="1" value="0" aria-label="再生の位置"><div class="r-ticks" aria-hidden="true">${ticks}</div></div>
          <p class="r-clock"><span id="clock"></span><span class="r-legend"><i class="sim"></i>シミュレーション<i class="sub"></i>提出</span></p>
        </div>
      </div>
      <div class="t-log" id="log"><p class="t-empty">「再生」を押すと、ここに Claude の作業の経過が流れます。</p></div>
      <div class="t-result" id="result" hidden></div>
    </section>
  </main>`;

  const logEl = root.querySelector<HTMLElement>("#log")!;
  const resultEl = root.querySelector<HTMLElement>("#result")!;
  const playBtn = root.querySelector<HTMLButtonElement>("#play")!;
  const seekEl = root.querySelector<HTMLInputElement>("#seek")!;
  const clockEl = root.querySelector<HTMLElement>("#clock")!;

  // ---------- 再生の状態 ----------
  let clock = 0; // 再生の位置（秒）
  let idx = 0; // 次に描く知らせ
  let shown = 0; // 書いている途中の文の、描いた文字数
  let playing = false;
  let started = false;
  let speed = 1;
  let raf = 0;
  let last = 0;
  let dragging = false;
  let seeking = false;

  const showDraft = (d: DraftRecord) => {
    resultEl.hidden = false;
    // 位置を変えて描き直すときは、現れる動きを付けない（バーを動かすたびに点滅しないように）
    resultEl.style.animation = seeking ? "none" : "";
    resultEl.innerHTML = `${draftHtml(d, drugs)}${playId ? `<div class="t-actions"><a class="t-btn primary" href="./?stage=${encodeURIComponent(playId)}">${iconImg("play", 1)}できたステージを遊ぶ</a></div>` : ""}`;
  };
  let handle = createLog(logEl, showDraft);

  /** 再生の位置 to までの知らせを描く。書いている途中の文は、進んだ分だけ書き足す */
  const advance = (to: number) => {
    while (idx < items.length) {
      const it = items[idx]!;
      if (it.at > to) break;
      if (it.chars && (it.e.type === "text" || it.e.type === "thinking")) {
        const n = it.chars.length;
        const want = it.dur <= 0 || to >= it.at + it.dur ? n : Math.floor((n * (to - it.at)) / it.dur);
        if (want > shown) {
          handle({ type: it.e.type, text: it.chars.slice(shown, want).join("") });
          shown = want;
        }
        if (shown < n) break;
      } else handle(it.e);
      idx++;
      shown = 0;
    }
  };

  /** 描いたものを消して、位置 t まで一気に描き直す（バーで位置を変えたとき） */
  const seek = (t: number) => {
    started = true;
    logEl.innerHTML = "";
    resultEl.hidden = true;
    resultEl.innerHTML = "";
    handle = createLog(logEl, showDraft);
    idx = 0;
    shown = 0;
    clock = Math.min(total, Math.max(0, t));
    seeking = true;
    advance(clock);
    seeking = false;
    logEl.querySelectorAll<HTMLElement>(".t-ev").forEach((el) => (el.style.animation = "none"));
    ui();
  };

  let btnState = "";
  const ui = () => {
    const ended = started && clock >= total;
    const state = playing ? "playing" : ended ? "ended" : "paused";
    // ボタンの中身は、状態が変わったときだけ描き直す（毎コマ描き直すと押しにくくなる）
    if (state !== btnState) {
      btnState = state;
      playBtn.innerHTML = playing ? `${iconImg("pause", 1)}一時停止` : `${iconImg("play", 1)}${ended ? "もう一度" : "再生"}`;
      playBtn.setAttribute("aria-label", playing ? "一時停止" : ended ? "はじめから、もう一度再生" : "再生");
    }
    if (!dragging) seekEl.value = String(Math.round(clock * 10));
    seekEl.style.setProperty("--p", `${total > 0 ? (clock / total) * 100 : 0}%`);
    clockEl.textContent = `${formatSec(clock)} / ${formatSec(total)}`;
  };

  const frame = (now: number) => {
    if (!playing) return;
    // 別のタブにいて止まっていたあとに、一気に進まないようにする
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    clock = Math.min(total, clock + dt * speed);
    advance(clock);
    if (clock >= total) playing = false;
    ui();
    if (playing) raf = requestAnimationFrame(frame);
  };
  const play = () => {
    if (!started || clock >= total) seek(0);
    playing = true;
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    ui();
  };
  const pause = () => {
    playing = false;
    cancelAnimationFrame(raf);
    ui();
  };

  let touched = false;
  playBtn.addEventListener("click", () => {
    touched = true;
    if (playing) pause();
    else play();
  });
  root.querySelectorAll<HTMLButtonElement>(".r-speed button").forEach((b) =>
    b.addEventListener("click", () => {
      speed = Number(b.dataset.speed) || 1;
      root.querySelectorAll(".r-speed button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }),
  );
  root.querySelector("#skip")!.addEventListener("click", () => {
    touched = true;
    pause();
    seek(total);
    resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  seekEl.addEventListener("pointerdown", () => (dragging = true));
  seekEl.addEventListener("input", () => {
    touched = true;
    seek(Number(seekEl.value) / 10);
  });
  const release = () => {
    dragging = false;
    ui();
  };
  seekEl.addEventListener("change", release);
  seekEl.addEventListener("pointerup", release);
  seekEl.addEventListener("pointercancel", release);
  ui();

  // 作業の欄が画面に入ったら、ひとりでに再生を始める（スマホでは、条件の欄を読んでから下へ進んだとき）
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((x) => x.isIntersecting) && !touched && !started) {
        io.disconnect();
        window.setTimeout(() => {
          if (!touched && !started) play();
        }, 600);
      }
    },
    { threshold: 0.4 },
  );
  io.observe(logEl);
}

void start();
