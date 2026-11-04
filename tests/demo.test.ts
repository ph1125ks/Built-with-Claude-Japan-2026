import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { demoAbuseBot, demoProperBot, loadGameData, runScenario, type ScenarioDef } from "../src/engine/index.ts";

// 録画用の操作シナリオ（docs/DEMO.md のシーン3〜5）。録画は種 570・モデル A・既定ステージで撮る。
// ここが落ちたら、データやルールの変更で展開が変わったということ。scripts/demo-seeds.ts で種を選び直し、DEMO.md と record-demo.ts の種を直す
const SEED = 570;
const base = loadGameData();
const data = loadGameData({ rules: { resistance: { ...base.rules.resistance, model: "A" } } });
const scenario = JSON.parse(readFileSync("data/stages/uti-zenkoku.json", "utf8")) as ScenarioDef;

describe(`録画用の操作シナリオ（種 ${SEED}）`, () => {
  it("乱用：カルバペネム系だけを使い、ステージ1は勝ち、2050年は負ける", () => {
    const r = runScenario({ data, scenario, seed: SEED, bot: demoAbuseBot() });
    expect(r.present.outcome).toBe("won");
    expect(r.future.outcome).toBe("lost");
    for (const stage of [r.present, r.future])
      for (const d of Object.keys(stage.summons)) expect(data.drugById.get(d)?.class, d).toBe("carbapenem");
  });

  it("適正：両方守り切り、ステージ1で CTRX・CMZ・ABPC・内服 CFDN を使う（台本の流れ）", () => {
    const r = runScenario({ data, scenario, seed: SEED, bot: demoProperBot() });
    expect(r.present.outcome).toBe("won");
    expect(r.future.outcome).toBe("won");
    for (const d of ["CTRX", "CMZ", "ABPC", "CFDN_PO"]) expect(r.present.summons[d] ?? 0, d).toBeGreaterThan(0);
    // 内服 CFDN は1ステージに1回だけ
    expect(r.present.summons.CFDN_PO).toBe(1);
  });
});
