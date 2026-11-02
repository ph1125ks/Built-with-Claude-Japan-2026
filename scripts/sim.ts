// ボットでシナリオを何度も動かし、勝率などをまとめる。
// 使い方：npm run sim -- --scenario data/stages/dev-uti.json --runs 100 --bot all --model none
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  appropriateBot,
  broadBot,
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
    seed: { type: "string", default: "1" },
    region: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

const base = loadGameData();
const modelId = (values.model ?? base.rules.resistance.model) as ResistanceModelId;
const data = loadGameData({ rules: { resistance: { ...base.rules.resistance, model: modelId } } });
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
};
const botIds = values.bot === "all" ? Object.keys(botMakers) : values.bot!.split(",");

interface Summary {
  bot: string;
  presentWin: number;
  futureWin: number;
  presentBladder: number;
  futureBladder: number;
  presentCost: number;
  presentUsage: Record<string, number>;
  presentAccess: number;
  /** 未来ステージで、手札のどの薬にも耐性だった個体の割合 */
  futurePanResistant: number;
  msPerRun: number;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;

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
    presentUsage: usage,
    presentAccess: mean(present.map((r) => r.usageByAware.Access)),
    futurePanResistant: mean(future.map((r) => r.panResistantFraction)),
    msPerRun: ms,
  });
}

if (values.json) {
  console.log(JSON.stringify({ scenario: scenario.id, region: scenario.region, model: modelId, runs, summaries }, null, 2));
} else {
  console.log(`シナリオ ${scenario.id}（${scenario.region}）／耐性モデル ${modelId}／各 ${runs} 回`);
  console.log("ボット\tいま勝率\t未来勝率\tいま膀胱\t未来膀胱\tいま医療費\tAccess割合\t未来の全耐性\t1回(ms)\tいまの系統別使用割合");
  for (const s of summaries) {
    const usage = Object.entries(s.presentUsage)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${data.classById.get(k)?.name ?? k} ${pct(v)}`)
      .join("、");
    console.log(
      [s.bot, pct(s.presentWin), pct(s.futureWin), pct(s.presentBladder), pct(s.futureBladder), s.presentCost.toFixed(0), pct(s.presentAccess), pct(s.futurePanResistant), s.msPerRun.toFixed(1), usage].join("\t"),
    );
  }
}
