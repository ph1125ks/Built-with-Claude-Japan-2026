import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGame, loadGameData, type Bacterium, type ScenarioDef } from "../src/engine/index.ts";
import { effectiveTag, nearestRevealed, TAG_MAX } from "../src/game/bugs.ts";

const data = loadGameData();
const abbr = (d: string) => data.drugById.get(d)?.abbr ?? d;
const scenario = JSON.parse(readFileSync("data/stages/uti-zenkoku.json", "utf8")) as ScenarioDef;

// 2026-11-06 作者の判断：正体が分かった細菌の札は、効かない薬ではなく「効く薬」を出す
describe("盤面の札：手札のうち効く薬", () => {
  const hand = ["ABPC", "CMZ", "CTRX", "CAZ", "CFDN_PO", "LVFX_PO", "TAZPIPC", "MEPM"];

  it("効く薬を手札の並び順で出し、効かない薬は出さない", () => {
    const t = effectiveTag(hand, new Set(["ABPC", "CTRX", "CAZ", "CFDN_PO"]), abbr);
    expect(t.kind).toBe("some");
    expect(t.text).toBe("効く：CMZ LVFX TAZ/PIPC MEPM");
    expect(t.drugs).toEqual(["CMZ", "LVFX_PO", "TAZPIPC", "MEPM"]);
    expect(t.text).not.toContain("効かない");
  });

  it(`${TAG_MAX}つを超える分は「ほかN」にまとめる`, () => {
    const t = effectiveTag(hand, new Set(["ABPC"]), abbr);
    expect(t.text).toBe("効く：CMZ CTRX CAZ CFDN ほか3");
    expect(t.drugs).toHaveLength(7);
  });

  it("手札すべてが効く・効かないときは、その一言にする", () => {
    expect(effectiveTag(hand, new Set(), abbr)).toMatchObject({ kind: "all", text: "手札すべて効く" });
    expect(effectiveTag(hand, new Set(hand), abbr)).toMatchObject({ kind: "none", text: "手札すべて効かない", drugs: [] });
  });

  it("もともと効かない薬（自然耐性）も、効く薬の側には入らない", () => {
    // 緑膿菌に ABPC・CTRX は自然耐性（resistant に入って届く）
    const t = effectiveTag(["ABPC", "CTRX", "CAZ"], new Set(["ABPC", "CTRX"]), abbr);
    expect(t.text).toBe("効く：CAZ");
  });
});

describe("手札の補助：膀胱にいちばん近い、正体の分かった細菌", () => {
  const stage = scenario.present;
  const bug = (uid: number, x: number, level: Bacterium["level"], hp = 10): Bacterium => ({
    uid,
    species: "ecoli",
    lane: 0,
    x,
    hp,
    maxHp: 10,
    wave: 0,
    resistant: new Set(),
    level,
    met: new Set(),
    exposure: {},
  });

  it("感受性まで分かった細菌のうち、x がいちばん小さいもの。いなければ undefined", () => {
    const s = createGame({ data, stage, region: scenario.region, seed: 1 });
    expect(nearestRevealed(s)).toBeUndefined();
    s.bacteria.push(bug(1, 0.5, "species"), bug(2, 0.6, "susceptibility"), bug(3, 0.3, "susceptibility"), bug(4, 0.1, "susceptibility", 0));
    expect(nearestRevealed(s)?.uid).toBe(3);
  });
});
