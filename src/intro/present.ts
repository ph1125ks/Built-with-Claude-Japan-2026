// 動画用の見せ方（intro.html?present=1）：1920×1080 の画面いっぱいに、前提の鎖の 1〜5 を自動で順に見せる。
// 画面の下 170px は空ける（動画で字幕を重ねるため）。文は短い見出しだけ（ナレーションは別に入る）。
// 終わったら最後の絵で止まり、window.__presentDone = true にする。各段の始まりの秒は window.__presentTimeline（字幕とナレーションを合わせるため）。
// ?present=1&from=5 で、その段から始める（確かめや撮り直し用）。
import type { GameData } from "../engine/index.ts";
import { CHAIN, LABELS, withPeriod } from "./content.ts";
import { fig1, fig2, fig3, fig4 } from "./figures.ts";
import { parseFrom, PRESENT_STEPS, presentTimeline, type TimelineEntry } from "./present-plan.ts";
import { createSieve } from "./sieve.ts";

declare global {
  interface Window {
    /** 見せ方が終わり、最後の絵で止まったら true */
    __presentDone?: boolean;
    /** 各段の始まりの秒（__presentT0 から） */
    __presentTimeline?: TimelineEntry[];
    /** 見せ方の長さ（秒） */
    __presentTotal?: number;
    /** 見せ方を始めた時刻（Date.now() のミリ秒）。録画の時刻と合わせる */
    __presentT0?: number;
  }
}

export const W = 1920;
export const H = 1080;
/** 字幕のために空ける下の高さ */
export const SUBTITLE_SPACE = 170;

const sentence = (n: number, i: number) => {
  const ss = CHAIN.find((s) => s.n === n)!.sentences;
  const s = ss[i]!;
  return i === ss.length - 1 ? withPeriod(s) : s;
};

/** 段ごとの大きな見出しと、下の短い文（前提の鎖の文から） */
const SCENES: Record<number, { head: string; sub?: string }> = {
  1: { head: sentence(1, 0), sub: sentence(1, 2) },
  2: { head: sentence(2, 0), sub: sentence(2, 1) },
  3: { head: sentence(3, 0) },
  4: { head: sentence(4, 0), sub: sentence(4, 2) },
  // 5. の文は、動く絵の下に場面ごとに出す（sieve.ts）。見出しは言い換えの表の「選択圧」の声の言い方
  5: { head: "効かない細菌だけが残る「ふるい」" },
};

export function renderPresent(root: HTMLElement, data: GameData): void {
  document.documentElement.classList.add("presenting");
  const from = parseFrom(new URLSearchParams(location.search).get("from"));
  const { entries, total } = presentTimeline(PRESENT_STEPS, from);
  window.__presentDone = false;
  window.__presentTimeline = entries;
  window.__presentTotal = total;

  const figs: Record<number, string> = {
    1: fig1(data, "present"),
    2: fig2(data, "present"),
    3: fig3(data, "present"),
    4: fig4(data, "present"),
    5: `<div class="sieve-slot present"></div>`,
  };
  const scenes = entries
    .map((e) => {
      const sc = SCENES[e.step]!;
      const title = e.step === 5 ? LABELS.selection : CHAIN.find((s) => s.n === e.step)!.title;
      return `<section class="p-scene s${e.step}" data-step="${e.step}">
        <header class="p-head"><span class="p-num">${e.step}</span><span class="p-title">${title}</span></header>
        <h2 class="p-big">${sc.head}</h2>
        <div class="p-fig">${figs[e.step]}</div>
        ${sc.sub ? `<p class="p-sub">${sc.sub}</p>` : ""}
      </section>`;
    })
    .join("");
  root.innerHTML = `<div id="present" style="width:${W}px;height:${H}px"><div class="p-area" style="height:${H - SUBTITLE_SPACE}px">${scenes}</div><div class="p-dots">${entries
    .map((e) => `<i data-step="${e.step}"></i>`)
    .join("")}</div></div>`;

  const stage = root.querySelector<HTMLElement>("#present")!;
  const fit = () => {
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  };
  window.addEventListener("resize", fit);
  fit();

  const sieveSlot = root.querySelector<HTMLElement>(".sieve-slot");
  const sieve = sieveSlot ? createSieve(data, { cols: 10, rows: 2, z: 5, soldierZ: 6, controls: false }) : null;
  if (sieve && sieveSlot) sieveSlot.appendChild(sieve.el);

  const show = (step: number) => {
    root.querySelectorAll<HTMLElement>(".p-scene").forEach((s) => s.classList.toggle("on", Number(s.dataset.step) === step));
    root.querySelectorAll<HTMLElement>(".p-dots i").forEach((d) => d.classList.toggle("on", Number(d.dataset.step) <= step));
  };

  const start = () => {
    const t0 = performance.now();
    window.__presentT0 = Date.now();
    // 段の切り替えは、始めた時刻からの秒で決める（少しずつずれないように）
    const at = (sec: number, f: () => void) => window.setTimeout(f, Math.max(0, t0 + sec * 1000 - performance.now()));
    for (const e of entries) {
      at(e.at, () => {
        show(e.step);
        if (e.step === 5) sieve?.phase("start");
      });
      for (const p of e.phases ?? []) if (p.key !== "start") at(p.at, () => sieve?.phase(p.key));
    }
    at(total, () => {
      window.__presentDone = true;
      document.documentElement.classList.add("present-done");
    });
  };

  // ドット絵のフォントと絵を読み込んでから始める（途中で字の形が変わらないように）
  void ready(root).then(() => requestAnimationFrame(() => requestAnimationFrame(start)));
}

async function ready(root: HTMLElement): Promise<void> {
  const text = root.textContent ?? "";
  const timeout = new Promise((r) => setTimeout(r, 4000));
  try {
    await Promise.race([Promise.all([document.fonts.load('64px "DotGothic16"', text), document.fonts.ready]), timeout]);
  } catch {
    // 読めなくても進める
  }
  const imgs = [...root.querySelectorAll("img")];
  await Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => undefined))), timeout]);
}
