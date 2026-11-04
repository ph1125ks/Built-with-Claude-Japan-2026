// ステージの合格の検査（src/engine/stagecheck.ts）：教員モードで Claude が作った案も、同じ検査を通る
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkScenario, coverageProblems, evaluateScenario, loadGameData, textProblems, type ScenarioDef } from "../src/engine/index.ts";

const data = loadGameData();
const base = JSON.parse(readFileSync("data/stages/uti-zenkoku.json", "utf8")) as ScenarioDef;
const clone = (): ScenarioDef => structuredClone(base);

describe("文章の決まり", () => {
  it("既定ステージは通る", () => {
    expect(textProblems(base)).toEqual([]);
  });

  it("使わない言葉・投与量の数値・診療の指示・字数を見つける", () => {
    const s = clone();
    s.present.briefing = "患者さんを守ろう。CTRX 2g を投与してください。";
    s.debrief = "あ".repeat(401);
    const e = textProblems(s);
    expect(e.some((x) => x.includes("患者"))).toBe(true);
    expect(e.some((x) => x.includes("投与量"))).toBe(true);
    expect(e.some((x) => x.includes("診療の指示"))).toBe(true);
    expect(e.some((x) => x.includes("400字"))).toBe(true);
  });
});

describe("ステージ1の手札の効き目", () => {
  it("既定ステージは、出てくる各菌に効く薬が手札にある", () => {
    expect(coverageProblems(data, base)).toEqual([]);
  });

  it("腸球菌に効く薬がない手札を見つける", () => {
    const s = clone();
    // 腸球菌に効く ABPC・AMPC・TAZ/PIPC（ABPC で代用）・LVFX（公開データで感性率 80% 以上）を外す
    s.present.hand = s.present.hand.filter((h) => !["ABPC", "AMPC_PO", "TAZPIPC", "LVFX_PO"].includes(h.drug));
    s.present.shortage = { count: 2 };
    expect(coverageProblems(data, s).some((x) => x.includes("腸球菌"))).toBe(true);
  });

  it("エンジンの検査に通らない案は、そこで止める", () => {
    const s = clone();
    s.present.hand = [{ drug: "XYZ" }];
    expect(checkScenario(data, s).some((x) => x.includes("XYZ"))).toBe(true);
  });
});

describe("シミュレーションによる合格の目安", () => {
  it("既定ステージは目安をすべて満たす（教えたい場面：CTRX が効かない大腸菌）", () => {
    const ev = evaluateScenario(data, base, { runs: 30, focus: { species: "ecoli", resistantTo: ["CTRX"] } });
    for (const c of ev.checks) expect(c.ok, `${c.label} ${c.value}（目安 ${c.target}）`).toBe(true);
    expect(ev.passed).toBe(true);
    expect(ev.focusPerStage).toBeGreaterThan(0);
  });

  it("広域薬がない手札では、乱用ボットが「いま」勝てず、目安に届かない", () => {
    const s = clone();
    const broad = ["MEPM", "TAZPIPC", "LVFX_PO", "CFPM", "CAZ"];
    s.present.hand = s.present.hand.filter((h) => !broad.includes(h.drug));
    s.present.shortage = { count: 0 };
    s.future.hand = s.future.hand.filter((h) => !broad.includes(h.drug) && h.drug !== "IPMCS");
    s.future.shortage = { count: 0 };
    const ev = evaluateScenario(data, s, { runs: 20 });
    expect(ev.passed).toBe(false);
  });
});
