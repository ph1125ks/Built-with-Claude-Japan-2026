import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  appropriateBot,
  createGame,
  expectedEffect,
  idleBot,
  knowledgeFor,
  loadGameData,
  randomBot,
  runScenario,
  runStage,
  validateScenario,
  type ScenarioDef,
} from "../src/engine/index.ts";

const data = loadGameData();
const scenario = JSON.parse(readFileSync("data/stages/dev-uti.json", "utf8")) as ScenarioDef;

describe("開発用シナリオ", () => {
  it("検査を通る", () => {
    expect(validateScenario(data, scenario)).toEqual([]);
  });
});

describe("ボットの知識", () => {
  it("グラム陰性桿菌しか見えないときは、陰性桿菌4種を分離割合で重み付けした見込みになる", () => {
    const state = createGame({ data, stage: scenario.present, region: "全国", seed: 1 });
    const k = knowledgeFor(state);
    const gnr = { uid: 1, lane: 0, x: 900, level: "gram" as const, gram: "negative" as const, shape: "rod" as const, arrangement: "single" as const, hpFraction: 1 };
    // CMZ は緑膿菌に自然耐性なので、腸内細菌3種の感性率 × 割合の合計になる
    const w = data.janis.urineIsolation["全国"]!;
    const p = (sp: string) => k.pSusceptible(sp, "CMZ");
    const expected =
      (w.ecoli! * p("ecoli") + w.kpneumoniae! * p("kpneumoniae") + w.pmirabilis! * p("pmirabilis")) /
      (w.ecoli! + w.kpneumoniae! + w.pmirabilis! + w.paeruginosa!);
    expect(expectedEffect(k, gnr, "CMZ")).toBeCloseTo(expected, 10);
    // 腸球菌（陽性球菌）は混ざらない
    expect(expectedEffect(k, { ...gnr, gram: "positive", shape: "coccus" }, "ABPC")).toBeCloseTo(k.pSusceptible("efaecalis", "ABPC"), 10);
  });
});

describe("ボットの強さの順序（エンジンの健全性の確認）", () => {
  const runs = 20;
  const winRate = (make: (seed: number) => ReturnType<typeof appropriateBot>) => {
    let wins = 0;
    for (let i = 0; i < runs; i++) if (runScenario({ data, scenario, seed: 100 + i, bot: make(100 + i) }).present.outcome === "won") wins++;
    return wins / runs;
  };

  it("適正ボット ≥ ランダムボット > 何もしないボット", () => {
    const appropriate = winRate(() => appropriateBot());
    const random = winRate((s) => randomBot(s));
    const idle = winRate(() => idleBot());
    expect(appropriate).toBeGreaterThanOrEqual(random);
    expect(random).toBeGreaterThan(idle);
    expect(idle).toBe(0);
  });
});

describe("速さ", () => {
  it("1ステージのシミュレーションは平均 50ms 以内（教員モードで何百回も回すため）", () => {
    const n = 10;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) runStage({ data, stage: scenario.present, region: scenario.region, seed: i, bot: appropriateBot() });
    expect((performance.now() - t0) / n).toBeLessThan(50);
  });
});
