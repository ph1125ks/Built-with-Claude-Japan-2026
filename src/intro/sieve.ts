// 5. 選択圧の動く絵（DOM）。中身の決まり（誰が倒れ、誰が増えるか）は sieve-model.ts。
// ふつうのページではボタンで1場面ずつ進め、動画用の見せ方（present.ts）では時刻表のとおりに進める。
import { createRng, type GameData } from "../engine/index.ts";
import { bugHtml, iconHtml, personHtml, soldierPoses } from "./art.ts";
import { LABELS, SIEVE_TEXT } from "./content.ts";
import { regrow, SIEVE, startPopulation, tally, useDrug, type SieveBug } from "./sieve-model.ts";

export type SievePhase = "start" | "drug" | "grow" | "again" | "body";

export interface SieveOptions {
  cols: number;
  rows: number;
  /** 細菌の絵の倍率 */
  z: number;
  /** 兵士の絵の倍率 */
  soldierZ: number;
  /** ボタンで進める（ふつうのページ） */
  controls: boolean;
}

export interface Sieve {
  el: HTMLElement;
  phase(p: SievePhase): void;
  /** 動きを止めて片付ける */
  destroy(): void;
}

/** 並べる細菌（大腸菌）と、使う薬の兵士。兵士には薬の名前を出さず「抗菌薬」とだけ書く */
const SPECIES = "ecoli";
const DRUG = "CTRX";
/** 薬の波が左端から右端まで通る秒 */
const SWEEP = 1.0;
/** 生まれる間隔（秒） */
const BIRTH_GAP = 0.06;

const CAPTION: Record<SievePhase, string> = {
  start: SIEVE_TEXT.start,
  drug: SIEVE_TEXT.drug,
  grow: SIEVE_TEXT.grown,
  again: SIEVE_TEXT.again,
  body: SIEVE_TEXT.body,
};

/** 並びの場所 → 盤の中の位置（0〜1）。蛇行の順（行ごとに向きを変える）なので、番号が近いほど隣り合う */
function slotPos(slot: number, cols: number, rows: number): { x: number; y: number } {
  const row = Math.floor(slot / cols);
  const c = slot % cols;
  const col = row % 2 === 1 ? cols - 1 - c : c;
  const rng = createRng(SIEVE.seed + 100 + slot);
  // 少しずらして、生き物らしく（横に詰まる並べ方では、横のずれを小さく）
  const jx = (rng.next() - 0.5) * (cols >= 8 ? 0.1 : 0.2);
  const jy = (rng.next() - 0.5) * 0.24;
  return { x: (col + 0.5 + jx) / cols, y: (row + 0.5 + jy) / rows };
}

export function createSieve(data: GameData, opt: SieveOptions): Sieve {
  const el = document.createElement("div");
  el.className = "sv";
  el.innerHTML = `
    <div class="sv-board">
      <div class="sv-soldier">${soldierPoses(data, DRUG, opt.soldierZ)}<span class="sv-tag">抗菌薬</span></div>
      <div class="sv-field"><div class="sv-wave"></div></div>
    </div>
    <div class="sv-tally">
      <span class="sv-count s">${bugHtml(data, SPECIES, 1, false, "mini")}<span>${LABELS.susceptible}</span><b>0</b></span>
      <span class="sv-count r">${iconHtml("shield", 2)}<span>${LABELS.resistant}</span><b>0</b></span>
    </div>
    <p class="sv-caption" aria-live="polite"></p>
    <div class="sv-change" hidden>
      <div>${personHtml(opt.soldierZ)}<span>${SIEVE_TEXT.bodySame}</span></div>
      <div><span class="sv-bug res still">${bugHtml(data, SPECIES, Math.max(2, opt.z - 1))}<span class="sv-shield">${iconHtml("shield", 2)}</span></span><span>${SIEVE_TEXT.bugsChanged}</span></div>
    </div>
    ${
      opt.controls
        ? `<div class="sv-controls"><button type="button" class="i-btn primary sv-next"></button><button type="button" class="i-btn sv-reset">${iconHtml("play", 2)}${SIEVE_TEXT.buttons.reset}</button></div>`
        : ""
    }
    <p class="sv-mark">${iconHtml("shield", 2)}${SIEVE_TEXT.mark}</p>`;

  const board = el.querySelector<HTMLElement>(".sv-board")!;
  const field = el.querySelector<HTMLElement>(".sv-field")!;
  const wave = el.querySelector<HTMLElement>(".sv-wave")!;
  const soldier = el.querySelector<HTMLElement>(".sv-soldier")!;
  const caption = el.querySelector<HTMLElement>(".sv-caption")!;
  const change = el.querySelector<HTMLElement>(".sv-change")!;
  const countS = el.querySelector<HTMLElement>(".sv-count.s b")!;
  const countR = el.querySelector<HTMLElement>(".sv-count.r b")!;
  const nextBtn = el.querySelector<HTMLButtonElement>(".sv-next");
  const resetBtn = el.querySelector<HTMLButtonElement>(".sv-reset");

  let bugs: SieveBug[] = [];
  let timers: number[] = [];
  const later = (sec: number, f: () => void) => timers.push(window.setTimeout(f, sec * 1000));
  const clearTimers = () => {
    timers.forEach((t) => window.clearTimeout(t));
    timers = [];
  };

  const setCounts = (b: readonly SieveBug[]) => {
    const t = tally(b);
    countS.textContent = String(t.susceptible);
    countR.textContent = String(t.resistant);
  };

  const bugNode = (b: SieveBug, at: number): HTMLElement => {
    const n = document.createElement("div");
    const p = slotPos(at, opt.cols, opt.rows);
    n.className = `sv-bug${b.resistant ? " res" : ""}`;
    n.style.left = `${p.x * 100}%`;
    n.style.top = `${p.y * 100}%`;
    n.style.setProperty("--d", `${(0.08 + p.x * SWEEP).toFixed(3)}s`);
    n.innerHTML = `${bugHtml(data, SPECIES, opt.z)}${b.resistant ? `<span class="sv-shield">${iconHtml("shield", 2)}</span>` : ""}`;
    return n;
  };

  /** 薬の波を通す（drugged か again の印を付け直して、動きをはじめから） */
  const sweep = (cls: "drugged" | "again") => {
    board.classList.remove("drugged", "again");
    void board.offsetWidth;
    board.classList.add(cls);
    soldier.classList.add("attacking");
    later(SWEEP + 0.3, () => soldier.classList.remove("attacking"));
    wave.style.setProperty("--sweep", `${SWEEP}s`);
  };

  const setButton = (label: string | null, next: SievePhase | null) => {
    if (!nextBtn) return;
    nextBtn.hidden = !label;
    nextBtn.disabled = true;
    if (!label || !next) return;
    nextBtn.innerHTML = `${iconHtml(next === "grow" ? "up" : "fast", 2)}${label}`;
    nextBtn.dataset.next = next;
  };
  const enable = (sec: number) => later(sec, () => nextBtn && (nextBtn.disabled = false));

  const phase = (p: SievePhase) => {
    caption.textContent = CAPTION[p];
    caption.classList.remove("show");
    void caption.offsetWidth;
    caption.classList.add("show");
    switch (p) {
      case "start": {
        clearTimers();
        board.classList.remove("drugged", "again");
        soldier.classList.remove("attacking");
        change.hidden = true;
        field.querySelectorAll(".sv-bug").forEach((n) => n.remove());
        bugs = startPopulation();
        for (const b of bugs) field.appendChild(bugNode(b, b.slot));
        setCounts(bugs);
        setButton(SIEVE_TEXT.buttons.drug, "drug");
        enable(0.2);
        break;
      }
      case "drug": {
        sweep("drugged");
        const { survivors } = useDrug(bugs);
        later(SWEEP + 0.5, () => setCounts(survivors));
        bugs = survivors;
        setButton(SIEVE_TEXT.buttons.grow, "grow");
        enable(SWEEP + 0.7);
        break;
      }
      case "grow": {
        // 倒れた細菌を片付けてから、残った細菌が分かれて増える
        field.querySelectorAll<HTMLElement>(".sv-bug:not(.res)").forEach((n) => {
          n.classList.add("gone");
          later(0.35, () => n.remove());
        });
        const all = regrow(bugs);
        const kids = all.filter((b) => b.from !== undefined);
        let shown = bugs.slice();
        for (const k of kids) {
          const n = bugNode(k, k.from!);
          n.classList.add("newborn");
          field.appendChild(n);
          const t = 0.3 + (k.order ?? 0) * BIRTH_GAP;
          later(t, () => {
            const p = slotPos(k.slot, opt.cols, opt.rows);
            n.classList.remove("newborn");
            n.style.left = `${p.x * 100}%`;
            n.style.top = `${p.y * 100}%`;
            n.style.setProperty("--d", `${(0.08 + p.x * SWEEP).toFixed(3)}s`);
            shown = [...shown, k];
            setCounts(shown);
          });
        }
        bugs = all;
        setButton(SIEVE_TEXT.buttons.again, "again");
        enable(0.3 + kids.length * BIRTH_GAP + 0.5);
        break;
      }
      case "again": {
        sweep("again");
        setButton(null, null);
        // ボタンで進めるときは、波が通ったあとに「変わるのは細菌のほう」を出す
        if (opt.controls) later(SWEEP + 0.9, () => phase("body"));
        break;
      }
      case "body": {
        change.hidden = false;
        change.classList.remove("show");
        void change.offsetWidth;
        change.classList.add("show");
        setButton(null, null);
        break;
      }
    }
  };

  nextBtn?.addEventListener("click", () => {
    const next = nextBtn.dataset.next as SievePhase | undefined;
    if (next && !nextBtn.disabled) phase(next);
  });
  resetBtn?.addEventListener("click", () => phase("start"));

  phase("start");
  return {
    el,
    phase,
    destroy: () => {
      clearTimers();
      el.remove();
    },
  };
}
