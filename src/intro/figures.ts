// 各段の図（HTML の文字列）。ふつうのページと動画用の見せ方で同じものを使い、大きさ（絵の倍率）だけ変える。
// 5. の動く絵は sieve.ts（DOM を直接動かす）。
import type { GameData } from "../engine/index.ts";
import { escapeHtml, genericName } from "../game/format.ts";
import { bladderHtml, bugHtml, iconHtml, shotHtml, soldierHead, soldierHtml, virusHtml } from "./art.ts";
import { AMR_2050, COMPARE, effectTable, LABELS, manNin, shortBacteriumName, TABLE_TEXT } from "./content.ts";

/** 図の大きさ：page＝ふつうのページ、present＝動画用（1920×1080） */
export type FigSize = "page" | "present";

const Z = {
  page: { bug: 3, soldier: 3, icon: 3, bladder: 3, head: 3, bugSmall: 2 },
  present: { bug: 5, soldier: 5, icon: 4, bladder: 5, head: 4, bugSmall: 3 },
} as const;

/** 1. 細菌：細菌が膀胱へ向かってくる。ウイルスは別のもの */
export function fig1(data: GameData, size: FigSize): string {
  const z = Z[size];
  const walkers = ["ecoli", "efaecalis", "kpneumoniae", "paeruginosa", "pmirabilis"]
    .map((id, i) => `<span class="walker" style="--i:${i}">${bugHtml(data, id, z.bug)}</span>`)
    .join("");
  return `<figure class="fig fig1">
    <div class="board f1-lane">
      <div class="f1-bladder">${bladderHtml(30, 52, z.bladder)}<span class="cap">${LABELS.bladder}</span></div>
      <div class="f1-march"><span class="tag">${LABELS.bacteria}</span>${walkers}</div>
    </div>
    <div class="f1-virus board">${virusHtml(z.bug)}<span><b>${LABELS.virus}</b>${LABELS.virusNote}</span></div>
  </figure>`;
}

/** 2. 抗菌薬：兵士（抗菌薬）の攻撃で細菌は倒れる。ウイルスには効かない */
export function fig2(data: GameData, size: FigSize): string {
  const z = Z[size];
  const row = (cls: string, target: string, label: string, result: string, good: boolean) => `
    <div class="board f2-row ${cls}">
      <div class="f2-who">${soldierHtml(data, "ABPC", z.soldier, "attack")}<span class="tag">抗菌薬</span></div>
      <div class="f2-path"><span class="f2-shot">${shotHtml(data, "ABPC", z.soldier - 1)}</span></div>
      <div class="f2-target">${target}<span class="tag">${label}</span></div>
      <div class="f2-result ${good ? "good" : "bad"}">${iconHtml(good ? "star" : "shield", z.icon - 1)}<b>${result}</b></div>
    </div>`;
  return `<figure class="fig fig2">
    ${row("hit", bugHtml(data, "efaecalis", z.bug), LABELS.bacteria, "倒れる", true)}
    ${row("miss", virusHtml(z.bug), LABELS.virus, "効きません", false)}
    <figcaption>ゲームでは、抗菌薬は兵士の姿です</figcaption>
  </figure>`;
}

/** 3. 効く相手が違う：公開データ（JANIS）から、細菌 × 薬の効く見込み（高い・低い）を色で */
export function fig3(data: GameData, size: FigSize): string {
  const z = Z[size];
  const rows = effectTable(data);
  const drugs = rows[0]?.cells.map((c) => data.drugById.get(c.drug)!) ?? [];
  const head = drugs
    .map((d) => {
      const trump = d.class === "carbapenem";
      return `<th class="${trump ? "trump" : ""}" style="--cls:${data.classById.get(d.class)?.color ?? "#888"}">
        <span class="eff-head">${soldierHead(data, d, z.head)}</span>
        <span class="eff-name"><b>${escapeHtml(genericName(d))}</b><small>${escapeHtml(data.classById.get(d.class)?.name ?? "")}</small></span>${trump ? `<em>${TABLE_TEXT.trumpBadge}</em>` : ""}</th>`;
    })
    .join("");
  const body = rows
    .map((r) => {
      const b = data.bacteriumById.get(r.bacterium)!;
      const cells = r.cells.map((c) => `<td class="${c.effect}"><span>${c.effect === "high" ? "高い" : "低い"}</span></td>`).join("");
      return `<tr><th class="${b.gram}"><span class="eff-bug">${bugHtml(data, b.id, z.bugSmall)}</span><span>${escapeHtml(shortBacteriumName(data, b.id))}</span></th>${cells}</tr>`;
    })
    .join("");
  return `<figure class="fig fig3">
    <div class="eff-wrap"><table class="eff"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="legend"><span><i class="high"></i>${TABLE_TEXT.high}</span><span><i class="low"></i>${TABLE_TEXT.low}</span><span class="note-short">${TABLE_TEXT.noteShort}</span></p>
    <p class="note note-long">${TABLE_TEXT.note}</p>
  </figure>`;
}

/** 4. 切り札が選ばれやすい理由：近づくほど分かる（ゲームの3つの区間）と、結果が出るまで数日かかること */
export function fig4(data: GameData, size: FigSize): string {
  const z = Z[size];
  const zone = (k: "near" | "mid" | "far", ico: "diskTest" | "dish" | "microscope") => {
    const l = LABELS[k];
    return `<div class="f4-h ${k}">${iconHtml(ico, z.icon)}<span><b>${l.zone}</b>${l.what}<small>（${l.term}）</small></span></div>`;
  };
  return `<figure class="fig fig4">
    <div class="f4-heads">${zone("near", "diskTest")}${zone("mid", "dish")}${zone("far", "microscope")}</div>
    <div class="board f4-lane">
      <div class="f4-band near"></div><div class="f4-band mid"></div><div class="f4-band far"></div>
      <div class="f4-bladder">${bladderHtml(24, 40, z.bladder - 1)}</div>
      <div class="f4-trump">${soldierHtml(data, "MEPM", z.soldier)}<em>${TABLE_TEXT.trumpBadge}</em></div>
      <div class="f4-mover">
        <span class="f4-look bare">${bugHtml(data, "ecoli", z.bug, true)}</span>
        <span class="f4-look full">${bugHtml(data, "ecoli", z.bug)}</span>
        <span class="f4-tag t-far">？</span>
        <span class="f4-tag t-mid">${escapeHtml(shortBacteriumName(data, "ecoli"))}</span>
        <span class="f4-tag t-near">効く薬が分かる</span>
      </div>
    </div>
    <div class="f4-days"><span class="arrow">◀</span>${iconHtml("hourglass", z.icon - 1)}<b>${LABELS.days}</b></div>
  </figure>`;
}

/** 6. 効く薬がなくなる：2050年の試算（出典つき） */
export function fig6(): string {
  const max = Math.max(...AMR_2050.bars.map((b) => b.value));
  const bars = AMR_2050.bars
    .map(
      (b) => `<div class="bar ${b.tone}"><span class="bl">${b.label}</span><span class="bt"><i style="--w:${(b.value / max).toFixed(3)}"></i></span><b>${manNin(b.value)}</b></div>`,
    )
    .join("");
  return `<figure class="fig fig6">
    <p class="unit">${AMR_2050.unit}</p>
    <div class="bars">${bars}</div>
    <p class="note">${AMR_2050.note}</p>
    <p class="src">${escapeHtml(AMR_2050.source)}</p>
  </figure>`;
}

/** 7. 適正使用：ゲームの中での並べ比べ（切り札ばかり ↔ 合う薬へ切り替える） */
export function fig7(data: GameData, size: FigSize): string {
  const z = Z[size];
  const who = {
    abuse: ["MEPM", "MEPM", "MEPM"],
    proper: ["CMZ", "ABPC", "CTRX"],
  } as const;
  const rows = COMPARE.rows
    .map((r) => {
      const soldiers = who[r.key].map((id) => soldierHtml(data, id, z.soldier - 1)).join("");
      const res = (win: boolean, text: string, stage: string) =>
        `<div class="cmp-res ${win ? "win" : "lose"}"><small class="cmp-stage">${stage}</small>${iconHtml(win ? "star" : "broken", z.icon)}<span>${text}</span>${win ? "" : `<span class="cmp-bug">${bugHtml(data, "ecoli", z.bugSmall)}${iconHtml("shield", 2, "ico cmp-shield")}</span>`}</div>`;
      return `<div class="cmp-row ${r.key}">
        <div class="cmp-who"><span class="cmp-soldiers">${soldiers}</span><b>${r.label}</b></div>
        ${res(r.win[0], r.present, COMPARE.stage1)}
        ${res(r.win[1], r.future, COMPARE.stage2)}
      </div>`;
    })
    .join("");
  return `<figure class="fig fig7">
    <p class="cmp-title">${COMPARE.title}</p>
    <div class="cmp-head"><span></span><span>${COMPARE.stage1}</span><span>${COMPARE.stage2}</span></div>
    ${rows}
  </figure>`;
}
