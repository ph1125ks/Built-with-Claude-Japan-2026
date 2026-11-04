// 教員モードで Claude が使うツールの中身（SPEC.md 5.3）。どれもエンジンとデータを読むだけで、感受性や薬の性質は変えられない。
// 結果は Claude が読みやすいよう、数値を丸めた JSON の文字列で返す。
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  checkScenario,
  costPerDose,
  evaluateScenario,
  loadGameData,
  susceptibility,
  TARGETS,
  urineWeights,
  type Evaluation,
  type Focus,
  type GameData,
  type ScenarioDef,
} from "../src/engine/index.ts";

export const data: GameData = loadGameData();
export const DRAFT_DIR = ".drafts";
/** シミュレーションの回数の上限（SPEC.md 5.3：案を作る → 確かめる → 直す、を8回まで） */
export const MAX_SIMULATIONS = 8;

const pct = (x: number) => Math.round(x * 1000) / 10;

/** 1日あたりの投与回数から「6時間毎」などの言い方 */
function interval(dosesPerDay: number): string {
  if (dosesPerDay === 1) return "1日1回";
  const h = 24 / dosesPerDay;
  return Number.isInteger(h) ? `${h}時間毎` : `1日${dosesPerDay}回`;
}

export function regions(): string[] {
  return data.janis.regions;
}

/** 地域の公開データ：尿から分離される菌の割合と、菌 × 薬の感性率（%）。自然耐性・効かない扱い・代用は印を付ける */
export function regionData(region: string) {
  if (!data.janis.regions.includes(region)) return { error: `地域「${region}」のデータはありません。使える地域：${data.janis.regions.join("、")}` };
  const w = urineWeights(data, region);
  const total = w.weights.reduce((a, b) => a + b, 0);
  const urineShare = Object.fromEntries(w.species.map((sp, i) => [sp, pct(w.weights[i]! / total)]));
  const susceptibilityPct: Record<string, Record<string, number | string>> = {};
  for (const b of data.bacteria) {
    const row: Record<string, number | string> = {};
    for (const d of data.drugs) {
      const v = susceptibility(data, region, b.id, d.id);
      row[d.id] = v.basis === "intrinsic" ? "自然耐性" : v.basis === "fixed" ? "効かない扱い" : v.basis === "proxy" ? `${pct(v.p)}（代用）` : pct(v.p);
    }
    susceptibilityPct[b.id] = row;
  }
  return {
    region,
    source: "厚生労働省 院内感染対策サーベイランス（JANIS）検査部門 2025年報（全集計対象医療機関・入院検体）を加工",
    urineSharePct: urineShare,
    susceptibilityPct,
    note: "感性率は S の株の割合（CLSI 2012 の判定基準）。感性率は、その地域の入院検体のすべての検査材料の集計で、尿だけの値ではない（尿の値は urineSharePct の菌の割合だけ）。また菌全体の値で、「CTRX が効かない大腸菌のうち CMZ が効く割合」のような、ほかの薬に耐性の株だけの値ではない。文章に書くときは「大阪府の大腸菌（すべての検査材料）の CTRX 感性率」のように書く。この値は変えられない",
  };
}

export function catalog() {
  return {
    drugs: data.drugs.map((d) => ({
      id: d.id,
      abbr: d.abbr,
      name: d.name,
      class: data.classById.get(d.class)?.name ?? d.class,
      aware: d.aware,
      route: d.route === "po" ? "内服" : "注射",
      interval: interval(d.dosesPerDay),
      waitSeconds: Math.round((data.rules.time.secondsPerGameDay / d.dosesPerDay) * 10) / 10,
      costPerDose: Math.round(costPerDose(data, d.id)),
      bioavailabilityPct: d.bioavailability != null ? Math.round(d.bioavailability * 100) : null,
    })),
    bacteria: data.bacteria.map((b) => ({
      id: b.id,
      name: b.name,
      gram: b.gram === "negative" ? "陰性" : "陽性",
      shape: b.look.shape,
      intrinsicResistance: b.intrinsicResistance,
    })),
    rules: {
      lanes: data.rules.board.lanes,
      secondsPerGameDay: data.rules.time.secondsPerGameDay,
      maxCardsOnScreen: 8,
      revealSpeciesBelow: data.rules.board.revealSpeciesBelow,
      revealSusceptibilityBelow: data.rules.board.revealSusceptibilityBelow,
      resistanceModel: data.rules.resistance.model,
    },
    targets: TARGETS,
    example: JSON.parse(readFileSync("data/stages/uti-zenkoku.json", "utf8")) as ScenarioDef,
  };
}

/** 評価を Claude と画面に返す形に（数値を丸める） */
export function compactEvaluation(ev: Evaluation) {
  const bot = (b: Evaluation["bots"]["appropriate"]) => ({
    presentWinPct: pct(b.presentWin),
    futureWinPct: pct(b.futureWin),
    futureAllResistantPct: pct(b.futurePanResistant),
    presentAhi: b.presentAhi === null ? null : Math.round(b.presentAhi * 100) / 100,
    presentAccessPct: pct(b.presentAccess),
  });
  const usage = Object.entries(ev.bots.appropriate.presentUsageByClass)
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => `${data.classById.get(c)?.name ?? c} ${pct(v)}%`);
  return {
    passed: ev.passed,
    runsPerBot: ev.runs,
    checks: ev.checks.map((c) => ({ ok: c.ok, label: c.label, value: c.value, target: c.target })),
    bots: { appropriate: bot(ev.bots.appropriate), broad: bot(ev.bots.broad), random: bot(ev.bots.random), idle: bot(ev.bots.idle) },
    appropriateUsageByClass: usage,
    focusPerStage: ev.focusPerStage === null ? null : Math.round(ev.focusPerStage * 10) / 10,
  };
}

export interface DraftRecord {
  id: string;
  scenario: ScenarioDef;
  evaluation: ReturnType<typeof compactEvaluation>;
  focus?: Focus;
  input: { region: string; audience: string; goal: string };
  model: string;
  createdAt: string;
  summary: string;
  log: string[];
  /** 1回のステージ作成のトークンと費用（終わってから足す） */
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number; seconds: number };
}

export function draftPath(id: string): string {
  return join(DRAFT_DIR, `${id}.json`);
}

export function saveDraft(rec: DraftRecord): void {
  mkdirSync(DRAFT_DIR, { recursive: true });
  writeFileSync(draftPath(rec.id), JSON.stringify(rec, null, 2));
}

export function loadDraft(id: string): DraftRecord | null {
  if (!/^draft-[a-z0-9-]+$/.test(id)) return null;
  const p = draftPath(id);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as DraftRecord) : null;
}

/** 規則の検査（エンジンの検査・文章・手札の効き目） */
export function validate(s: ScenarioDef): string[] {
  try {
    return checkScenario(data, s);
  } catch (e) {
    return [`検査できませんでした：${(e as Error).message}`];
  }
}

/** シミュレーション。規則の検査に通らない案は動かさない */
export function simulate(s: ScenarioDef, focus: Focus | undefined, runs: number, seed: number) {
  const errors = validate(s);
  if (errors.length) return { errors };
  if (focus) {
    if (!data.bacteriumById.has(focus.species)) return { errors: [`focus の菌 ${focus.species} がカタログにない`] };
    for (const d of focus.resistantTo) if (!data.drugById.has(d)) return { errors: [`focus の薬 ${d} がカタログにない`] };
  }
  const ev = evaluateScenario(data, s, { runs, seed, focus });
  return { evaluation: compactEvaluation(ev) };
}
