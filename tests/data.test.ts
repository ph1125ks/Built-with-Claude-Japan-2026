import { describe, expect, it } from "vitest";
import { costPerDay, costPerDose, loadGameData, resistanceTableFor, susceptibility, yakkaTier } from "../src/engine/index.ts";

const data = loadGameData();

describe("公開データの取り込み", () => {
  it("全国と近畿7府県がある", () => {
    expect(data.janis.regions).toEqual(["全国", "福井県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"]);
  });

  it("全国の大腸菌の CTRX 感性率が年報の値（68.1%）と一致する", () => {
    const v = susceptibility(data, "全国", "ecoli", "CTRX");
    expect(v.basis).toBe("data");
    expect(v.p * 100).toBeCloseTo(68.1, 1);
    expect(v.n).toBeGreaterThan(300000);
  });

  it("京都府の大腸菌の CTRX 感性率が年報の値（63.7%）と一致する", () => {
    expect(susceptibility(data, "京都府", "ecoli", "CTRX").p * 100).toBeCloseTo(63.7, 1);
  });
});

describe("効く確率の決め方", () => {
  it("自然耐性は、データにかかわらず効かない", () => {
    for (const [sp, drug] of [
      ["paeruginosa", "CTRX"],
      ["paeruginosa", "CEZ"],
      ["efaecalis", "CEZ"],
      ["efaecalis", "CTRX"],
      ["kpneumoniae", "ABPC"],
    ] as const) {
      const v = susceptibility(data, "全国", sp, drug);
      expect(v.basis, `${sp} × ${drug}`).toBe("intrinsic");
      expect(v.p).toBe(0);
    }
  });

  it("経口第3世代セフェムは CTX の値で代用する", () => {
    const v = susceptibility(data, "全国", "ecoli", "CFDN_PO");
    expect(v.basis).toBe("proxy");
    const c = data.janis.susceptibility["全国"]!.ecoli!.CTX!;
    expect(v.p).toBeCloseTo(c.S! / c.total!, 10);
  });

  it("腸球菌の MEPM は固定値（値がないため）", () => {
    expect(susceptibility(data, "全国", "efaecalis", "MEPM")).toMatchObject({ basis: "fixed", p: 0 });
  });

  it("どの地域でも、すべての菌×薬の組み合わせの扱いが決まっている（値がない組み合わせを残さない）", () => {
    for (const region of data.janis.regions) {
      for (const b of data.bacteria) {
        for (const d of data.drugs) {
          const v = susceptibility(data, region, b.id, d.id);
          expect(v.basis, `${region} ${b.id} × ${d.id}`).not.toBe("missing");
          expect(v.p).toBeGreaterThanOrEqual(0);
          expect(v.p).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("耐性率の表は 1 − 効く確率", () => {
    const t = resistanceTableFor(data, "全国");
    expect(t.ecoli!.CTRX).toBeCloseTo(1 - susceptibility(data, "全国", "ecoli", "CTRX").p, 10);
    expect(t.paeruginosa!.CTRX).toBe(1);
  });
});

describe("医療費（薬価の段階化）", () => {
  it("内服の LVFX は最も安い段、MEPM は最も高い段", () => {
    expect(yakkaTier(data, "LVFX_PO")).toBe(1);
    expect(yakkaTier(data, "MEPM")).toBe(5);
  });

  it("1回の召喚のコストは、1日のコストを1日の投与回数で割ったもの", () => {
    for (const d of data.drugs) expect(costPerDose(data, d.id)).toBeCloseTo(costPerDay(data, d.id) / d.dosesPerDay, 10);
  });
});
