// ボットでシナリオを何度も動かし、勝率などをまとめる。
// 使い方：npm run sim -- --scenario data/stages/dev-uti.json --runs 100 --bot all --model none [--cost yakka|abstract]
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  appropriateBot,
  costPerDose,
  broadBot,
  demoAbuseBot,
  demoProperBot,
  idleBot,
  loadGameData,
  randomBot,
  runScenario,
  singleDrugBot,
  validateScenario,
  type Bot,
  type ResistanceModelId,
  type ScenarioDef,
  type StageResult,
} from "../src/engine/index.ts";

const { values } = parseArgs({
  options: {
    scenario: { type: "string", default: "data/stages/dev-uti.json" },
    runs: { type: "string", default: "100" },
    bot: { type: "string", default: "all" },
    model: { type: "string" },
    cost: { type: "string" },
    seed: { type: "string", default: "1" },
    region: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

const base = loadGameData();
const modelId = (values.model ?? base.rules.resistance.model) as ResistanceModelId;
const costMode = (values.cost ?? base.rules.cost.mode) as "yakka" | "abstract";
if (costMode !== "yakka" && costMode !== "abstract") throw new Error(`--cost は yakka か abstract（${costMode}）`);
const data = loadGameData({
  rules: { resistance: { ...base.rules.resistance, model: modelId }, cost: { ...base.rules.cost, mode: costMode } },
});
const scenario = JSON.parse(await readFile(values.scenario!, "utf8")) as ScenarioDef;
if (values.region) scenario.region = values.region;
const errors = validateScenario(data, scenario);
if (errors.length) {
  console.error(`シナリオの誤り：\n${errors.join("\n")}`);
  process.exit(1);
}

const runs = Number(values.runs);
const seed0 = Number(values.seed);
const botMakers: Record<string, (seed: number) => Bot> = {
  appropriate: () => appropriateBot(),
  broad: () => broadBot(),
  single: () => singleDrugBot("LVFX_PO"),
  random: (s) => randomBot(s),
  idle: () => idleBot(),
  "demo-abuse": () => demoAbuseBot(),
  "demo-proper": () => demoProperBot(),
};
const botIds = values.bot === "all" ? Object.keys(botMakers) : values.bot!.split(",");

interface Summary {
  bot: string;
  presentWin: number;
  futureWin: number;
  presentBladder: number;
  futureBladder: number;
  presentCost: number;
  futureCost: number;
  /** 使った医療費の最大（予算が効いているかを見る） */
  presentCostMax: number;
  futureCostMax: number;
  /** 薬ごとの召喚回数の平均（いま・未来） */
  presentSummons: Record<string, number>;
  futureSummons: Record<string, number>;
  /** 予算の残りが、手札でいちばん安い1回分に届かなくなった回の割合（予算切れ） */
  presentBudgetOut: number;
  futureBudgetOut: number;
  /** 医療費が手札でいちばん安い1回分に届かなかった秒数の平均（医療費が時間で増えるステージで、待った長さ） */
  presentBudgetShortSec: number;
  futureBudgetShortSec: number;
  presentUsage: Record<string, number>;
  presentAccess: number;
  presentAhi: number;
  /** 未来ステージで、手札のどの薬にも耐性だった個体の割合 */
  futurePanResistant: number;
  msPerRun: number;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const meanCounts = (rs: Record<string, number>[]) => {
  const out: Record<string, number> = {};
  for (const r of rs) for (const [k, v] of Object.entries(r)) out[k] = (out[k] ?? 0) + v / rs.length;
  return out;
};

/** 予算の残りで、手札のどれも召喚できない（予算切れ） */
const budgetOut = (r: StageResult, hand: { drug: string }[]) =>
  r.budgetStart + r.budgetIncome - r.costSpent + 1e-9 < Math.min(...hand.map((h) => costPerDose(data, h.drug)));

const summaries: Summary[] = [];
for (const id of botIds) {
  const make = botMakers[id];
  if (!make) throw new Error(`ボット ${id} はない（${Object.keys(botMakers).join(", ")}）`);
  const present: StageResult[] = [];
  const future: StageResult[] = [];
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) {
    const r = runScenario({ data, scenario, seed: seed0 + i, bot: make(seed0 + i) });
    present.push(r.present);
    future.push(r.future);
  }
  const ms = (performance.now() - t0) / runs;
  const usage: Record<string, number> = {};
  for (const r of present) for (const [k, v] of Object.entries(r.usageByClass)) usage[k] = (usage[k] ?? 0) + v / runs;
  summaries.push({
    bot: make(0).name,
    presentWin: mean(present.map((r) => (r.outcome === "won" ? 1 : 0))),
    futureWin: mean(future.map((r) => (r.outcome === "won" ? 1 : 0))),
    presentBladder: mean(present.map((r) => r.bladderHp / r.bladderMaxHp)),
    futureBladder: mean(future.map((r) => r.bladderHp / r.bladderMaxHp)),
    presentCost: mean(present.map((r) => r.costSpent)),
    futureCost: mean(future.map((r) => r.costSpent)),
    presentCostMax: Math.max(...present.map((r) => r.costSpent)),
    futureCostMax: Math.max(...future.map((r) => r.costSpent)),
    presentSummons: meanCounts(present.map((r) => r.summons)),
    futureSummons: meanCounts(future.map((r) => r.summons)),
    presentBudgetOut: mean(present.map((r) => (budgetOut(r, scenario.present.hand) ? 1 : 0))),
    futureBudgetOut: mean(future.map((r) => (budgetOut(r, scenario.future.hand) ? 1 : 0))),
    presentBudgetShortSec: mean(present.map((r) => r.budgetShortSeconds)),
    futureBudgetShortSec: mean(future.map((r) => r.budgetShortSeconds)),
    presentUsage: usage,
    presentAccess: mean(present.map((r) => r.usageByAware.Access)),
    // 偏りの指標 AHI（2026-11-04 作者の式）。使わなかった回（null）は除く
    presentAhi: ((xs) => (xs.length ? mean(xs) : Number.NaN))(present.flatMap((r) => (r.ahi === null ? [] : [r.ahi]))),
    futurePanResistant: mean(future.map((r) => r.panResistantFraction)),
    msPerRun: ms,
  });
}

if (values.json) {
  console.log(JSON.stringify({ scenario: scenario.id, region: scenario.region, model: modelId, cost: costMode, runs, seed: seed0, summaries }, null, 2));
} else {
  console.log(`シナリオ ${scenario.id}（${scenario.region}）／耐性モデル ${modelId}／医療費 ${costMode}／各 ${runs} 回（種 ${seed0}〜${seed0 + runs - 1}）`);
  console.log("ボット\tいま勝率\t未来勝率\tいま膀胱\t未来膀胱\tいま医療費\t未来医療費\t医療費の最大（いま/未来）\t予算待ち秒（いま/未来）\tAccess割合\tいまのAHI\t未来の全耐性\t1回(ms)\tいまの系統別使用割合");
  for (const s of summaries) {
    const usage = Object.entries(s.presentUsage)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${data.classById.get(k)?.name ?? k} ${pct(v)}`)
      .join("、");
    console.log(
      [
        s.bot,
        pct(s.presentWin),
        pct(s.futureWin),
        pct(s.presentBladder),
        pct(s.futureBladder),
        s.presentCost.toFixed(0),
        s.futureCost.toFixed(0),
        `${s.presentCostMax.toFixed(0)}/${s.futureCostMax.toFixed(0)}`,
        `${s.presentBudgetShortSec.toFixed(0)}/${s.futureBudgetShortSec.toFixed(0)}`,
        pct(s.presentAccess),
        Number.isNaN(s.presentAhi) ? "—" : s.presentAhi.toFixed(2),
        pct(s.futurePanResistant),
        s.msPerRun.toFixed(1),
        usage,
      ].join("\t"),
    );
  }
}
