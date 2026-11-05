// ふつうに読むページ：前提の鎖の 1〜8 を、1段ずつ、ドット絵と短い文で。最後にゲームと記録へのリンクと注意書き。
import type { GameData } from "../engine/index.ts";
import { bugHtml, iconHtml, personHtml } from "./art.ts";
import { CHAIN, IN_GAME, PAGE, withPeriod } from "./content.ts";
import { fig1, fig2, fig3, fig4, fig6, fig7 } from "./figures.ts";
import { createSieve, type Sieve } from "./sieve.ts";

/** 強めて見せる文（その段のいちばん大事な一文） */
const KEY_SENTENCES = new Set([
  "抗菌薬は、薬ごとに効く細菌が違います。",
  "外して悪くなるのが怖いので、「ほとんどに効く切り札」が選ばれやすくなります",
  "変わるのは人の体ではなく、細菌のほうです。",
  "切り札は、本当に必要なときのために取っておきます。",
]);

function sentencesHtml(ss: string[]): string {
  return ss
    .map((s, i) => {
      const t = i === ss.length - 1 ? withPeriod(s) : s;
      return KEY_SENTENCES.has(s) ? `<mark>${t}</mark>` : t;
    })
    .join("");
}

function figureFor(data: GameData, n: number): string {
  switch (n) {
    case 1:
      return fig1(data, "page");
    case 2:
      return fig2(data, "page");
    case 3:
      return fig3(data, "page");
    case 4:
      return fig4(data, "page");
    case 5:
      return `<div class="sieve-slot"></div>`;
    case 6:
      return fig6();
    case 7:
      return fig7(data, "page");
    case 8:
      return `<figure class="fig fig8"><div class="board">${personHtml(4)}<span class="f8-q">？</span></div></figure>`;
    default:
      return "";
  }
}

export function renderPage(root: HTMLElement, data: GameData): void {
  const toc = CHAIN.map((s) => `<a href="#s${s.n}"><span>${s.n}</span>${s.title}</a>`).join("");
  const steps = CHAIN.map(
    (s) => `
    <section class="i-step" id="s${s.n}" aria-labelledby="h${s.n}">
      <header class="i-step-head"><span class="i-num">${s.n}</span><h2 id="h${s.n}">${s.title}</h2></header>
      <p class="i-text">${sentencesHtml(s.sentences)}</p>
      ${figureFor(data, s.n)}
      ${IN_GAME[s.n] ? `<p class="i-game">${iconHtml("play", 2)}<span>${IN_GAME[s.n]}</span></p>` : ""}
    </section>`,
  ).join("");

  root.innerHTML = `
  <header class="i-head">
    <div class="i-logo"><span class="i-logo-name">${PAGE.logo}</span><span class="i-logo-sub">${PAGE.logoSub}</span></div>
    <h1>${PAGE.title}</h1>
    <p class="i-lead">${PAGE.lead}</p>
    <div class="i-head-art" aria-hidden="true">${bugHtml(data, "ecoli", 3)}${bugHtml(data, "efaecalis", 3)}${bugHtml(data, "kpneumoniae", 3)}</div>
    <nav class="i-toc" aria-label="8つの段">${toc}</nav>
  </header>
  <main class="i-main">${steps}
    <section class="i-end" aria-label="このあと">
      <div class="i-links">
        <a class="i-btn primary big" href="./">${iconHtml("play", 3)}${PAGE.play}</a>
        <a class="i-btn big" href="./replay.html">${iconHtml("chart", 3)}${PAGE.replay}</a>
      </div>
      <p class="i-replay-note">${PAGE.replayNote}</p>
      <div class="i-caution">${iconHtml("warn", 3)}<div>${PAGE.caution.map((c) => `<p>${c}</p>`).join("")}</div></div>
      <p class="i-data">${iconHtml("info", 2)}<span>${PAGE.dataNote}</span></p>
    </section>
  </main>`;

  // 5. の動く絵：幅に合わせて並べ方を変える（幅が変わったら作り直す）
  const slot = root.querySelector<HTMLElement>(".sieve-slot")!;
  let sieve: Sieve | null = null;
  let layout = "";
  const mount = () => {
    const w = slot.clientWidth;
    const next = w >= 760 ? "wide" : w >= 520 ? "mid" : "narrow";
    if (next === layout) return;
    layout = next;
    sieve?.destroy();
    const opt =
      next === "wide"
        ? { cols: 10, rows: 2, z: 3, soldierZ: 3 }
        : next === "mid"
          ? { cols: 5, rows: 4, z: 3, soldierZ: 3 }
          : { cols: 4, rows: 5, z: 2, soldierZ: 2 };
    sieve = createSieve(data, { ...opt, controls: true });
    slot.className = `sieve-slot ${next}`;
    slot.appendChild(sieve.el);
  };
  mount();
  new ResizeObserver(() => mount()).observe(slot);
}
