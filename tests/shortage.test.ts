import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  appropriateBot,
  DEFAULT_KEEP_SUSCEPTIBLE,
  drawShortage,
  loadGameData,
  resistanceTableFor,
  runScenario,
  stageSpecies,
  validateStage,
  withShortage,
  type ScenarioDef,
  type StageDef,
} from "../src/engine/index.ts";

const data = loadGameData();
const scenario = JSON.parse(readFileSync("data/stages/dev-uti.json", "utf8")) as ScenarioDef;
const present = scenario.present;

describe("供給制限（遊ぶたびに手札の何枚かが使えない）", () => {
  it("種で決まる：同じ種なら同じ薬、種を変えると変わる", () => {
    const a = drawShortage(data, present, "全国", 1);
    expect(drawShortage(data, present, "全国", 1)).toEqual(a);
    const seen = new Set<string>();
    for (let s = 1; s <= 50; s++) seen.add(drawShortage(data, present, "全国", s).join(","));
    expect(seen.size).toBeGreaterThan(10);
  });

  it("決めた枚数だけ、候補の中から選ぶ（仮ステージでは MEPM と TAZ/PIPC は候補外）", () => {
    const candidates = present.shortage!.candidates!;
    for (let s = 1; s <= 100; s++) {
      const short = drawShortage(data, present, "全国", s);
      expect(short).toHaveLength(present.shortage!.count);
      for (const d of short) expect(candidates).toContain(d);
      expect(short).not.toContain("MEPM");
      expect(short).not.toContain("TAZPIPC");
    }
  });

  it("残った手札で、出てくる菌それぞれに、公開データで感性率 80% 以上の薬が1枚は残る", () => {
    const table = resistanceTableFor(data, "全国");
    const species = stageSpecies(data, present, "全国");
    expect(species.length).toBeGreaterThan(0);
    for (let s = 1; s <= 100; s++) {
      const left = withShortage(present, drawShortage(data, present, "全国", s)).hand.map((h) => h.drug);
      for (const sp of species) expect(left.some((d) => 1 - (table[sp]?.[d] ?? 1) >= DEFAULT_KEEP_SUSCEPTIBLE), `${sp} 種${s}`).toBe(true);
    }
  });

  it("条件を満たせないときは枚数を減らす（腸球菌だけのステージで、効く薬を全部候補にしても残す）", () => {
    const stage: StageDef = {
      title: "テスト",
      budget: 100,
      bladderHp: 100,
      hand: [{ drug: "ABPC" }, { drug: "CTRX" }, { drug: "CMZ" }],
      shortage: { count: 2 },
      waves: [{ at: 0, lane: 0, species: "efaecalis", count: 1, spacing: 0 }],
    };
    for (let s = 1; s <= 30; s++) expect(drawShortage(data, stage, "全国", s)).not.toContain("ABPC");
  });

  it("外したあとのステージは検査を通り、手札から消えている", () => {
    const short = drawShortage(data, present, "全国", 3);
    const st = withShortage(present, short);
    expect(validateStage(data, st)).toEqual([]);
    expect(st.hand.map((h) => h.drug)).not.toEqual(expect.arrayContaining(short));
    expect(st.shortage).toBeUndefined();
  });

  it("検査：枚数が手札以上・候補が手札にない・画面に9枚以上並ぶ、は誤り", () => {
    const bad = (shortage: StageDef["shortage"], hand = present.hand) => validateStage(data, { ...present, hand, shortage });
    expect(bad({ count: present.hand.length }).join()).toMatch(/shortage.count/);
    expect(bad({ count: 1, candidates: ["AMK"] }).join()).toMatch(/候補 AMK が手札にない/);
    expect(bad(undefined, [...present.hand]).join()).toMatch(/8枚まで/);
  });

  it("シミュレーターは使えなかった薬を返し、その薬は召喚されない", () => {
    for (let s = 1; s <= 10; s++) {
      const r = runScenario({ data, scenario, seed: s, bot: appropriateBot() });
      expect(r.shortage.present).toHaveLength(present.shortage!.count);
      expect(r.shortage.future).toHaveLength(scenario.future.shortage!.count);
      for (const d of r.shortage.present) expect(r.present.summons[d] ?? 0).toBe(0);
      for (const d of r.shortage.future) expect(r.future.summons[d] ?? 0).toBe(0);
    }
  });
});
