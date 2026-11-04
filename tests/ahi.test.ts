import { describe, expect, it } from "vitest";
import { ahi } from "../src/engine/index.ts";

// 偏りの指標 AHI（2026-11-04 作者が指定した式）：AHI ＝ 1 −｛n /［2 ×（n − 1）］｝× Σ｜ai − bi｜
describe("偏りの指標 AHI", () => {
  const classes = ["penicillin", "ceph3", "carbapenem", "fluoroquinolone"];

  it("手札の系統を同じ割合ずつ使うと 1", () => {
    expect(ahi(classes, { penicillin: 0.25, ceph3: 0.25, carbapenem: 0.25, fluoroquinolone: 0.25 })).toBeCloseTo(1, 10);
  });

  it("1つの系統だけを使うと 0", () => {
    expect(ahi(classes, { carbapenem: 1 })).toBeCloseTo(0, 10);
  });

  it("式どおりの値になる（3系統のうち2つを半分ずつ：Σ＝2/3、係数 3/4 → 0.5）", () => {
    expect(ahi(["a", "b", "c"], { a: 0.5, b: 0.5 })).toBeCloseTo(0.5, 10);
  });

  it("使用比率の合計が 1 でなくても、比べる系統の中の割合に直して計算する", () => {
    expect(ahi(["a", "b"], { a: 3, b: 1 })).toBeCloseTo(ahi(["a", "b"], { a: 0.75, b: 0.25 })!, 10);
    expect(ahi(["a", "b"], { a: 0.75, b: 0.25 })).toBeCloseTo(0.5, 10);
  });

  it("系統が2つ未満か、まだ使っていないときは null", () => {
    expect(ahi(["a"], { a: 1 })).toBeNull();
    expect(ahi(classes, {})).toBeNull();
  });
});
