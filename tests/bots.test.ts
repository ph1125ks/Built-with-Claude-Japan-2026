import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  appropriateBot,
  broadBot,
  createGame,
  expectedEffect,
  idleBot,
  knowledgeFor,
  loadGameData,
  randomBot,
  resistanceTableFor,
  runScenario,
  runStage,
  observe,
  step,
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

describe("適正ボットの選び方（AWaRe の順）", () => {
  it("腸球菌と分かったら、効く見込みの高い Access の ABPC を選ぶ", () => {
    const stage = { ...scenario.present, waves: [{ at: 0, lane: 0, species: "efaecalis", count: 1, spacing: 0 }] };
    const state = createGame({ data, stage, region: "全国", seed: 1 });
    const k = knowledgeFor(state);
    const bot = appropriateBot();
    // 出現させてから、菌名が分かる位置まで進める
    step(state);
    while (state.bacteria[0] && state.bacteria[0].level === "gram") step(state);
    expect(state.bacteria[0]?.level).toBe("species");
    const cmds = bot.decide(observe(state), k);
    expect(cmds).toEqual([{ type: "summon", drug: "ABPC", lane: 0 }]);
  });

  it("乱用ボットは、手札で最も温存すべき薬（MEPM）から使う", () => {
    const stage = { ...scenario.present, waves: [{ at: 0, lane: 1, species: "ecoli", count: 1, spacing: 0 }] };
    const state = createGame({ data, stage, region: "全国", seed: 1 });
    step(state);
    expect(broadBot().decide(observe(state), knowledgeFor(state))).toEqual([{ type: "summon", drug: "MEPM", lane: 1 }]);
  });
});

describe("適正ボットのデエスカレーションと温存", () => {
  /** 自然耐性だけを残し、ほかはすべて効く表 */
  const allS = () => {
    const t = resistanceTableFor(data, "全国");
    for (const [sp, row] of Object.entries(t)) {
      const intrinsic = data.bacteriumById.get(sp)!.intrinsicResistance;
      for (const d of Object.keys(row)) row[d] = intrinsic.includes(d) ? 1 : 0;
    }
    return t;
  };

  it("菌名が分かって、効いている薬より狭い薬で足りるなら、狭い薬に切り替える", () => {
    // すべて効く表なら、大腸菌には Access の ABPC が最も優先（CMZ は Watch）
    const stage = { ...scenario.present, waves: [{ at: 0, lane: 0, species: "ecoli", count: 1, spacing: 0 }] };
    const state = createGame({ data, stage, region: "全国", seed: 1, resistance: allS() });
    const k = knowledgeFor(state);
    step(state);
    while (state.bacteria[0] && state.bacteria[0].level === "gram") step(state);
    expect(state.bacteria[0]?.level).toBe("species");
    // CMZ が効いている状態をつくってから判断させる
    step(state, [{ type: "summon", drug: "CMZ", lane: 0 }]);
    expect(state.units.map((u) => u.drug)).toEqual(["CMZ"]);
    // Access の薬（ABPC・CEZ）のうち、カバー率の低い CEZ に切り替える
    expect(appropriateBot().decide(observe(state), k)).toEqual([{ type: "summon", drug: "CEZ", lane: 0 }]);
  });

  it("最適な薬がレーンに残っていて次を召喚できないあいだは、別の薬（キノロン系など）でつながずに待つ", () => {
    const stage = { ...scenario.present, waves: [{ at: 0, lane: 0, species: "paeruginosa", count: 1, spacing: 0 }] };
    const state = createGame({ data, stage, region: "全国", seed: 1 });
    const k = knowledgeFor(state);
    step(state, [{ type: "summon", drug: "TAZPIPC", lane: 0 }]);
    // TAZ/PIPC の量が少なくなり、まだ次を出せない時点まで進める
    while (state.units[0] && state.units[0].hp / data.rules.units.fullHp > 0.1) step(state);
    while (state.bacteria[0] && state.bacteria[0].level === "gram") step(state);
    const cmds = appropriateBot().decide(observe(state), k);
    expect(cmds.some((c) => c.drug === "LVFX_PO" || c.drug === "MEPM")).toBe(false);
  });
});
