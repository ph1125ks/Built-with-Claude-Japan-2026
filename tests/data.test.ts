import { describe, expect, it } from "vitest";
import { costPerDay, costPerDose, loadGameData, resistanceTableFor, stewardshipRank, susceptibility, yakkaTier } from "../src/engine/index.ts";

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

describe("公的な文書に沿った設定（抗微生物薬適正使用の手引き 第四版）", () => {
  it("投与回数は手引きの治療例の表のとおり", () => {
    const perDay = Object.fromEntries(data.drugs.map((d) => [d.id, d.dosesPerDay]));
    expect(perDay).toMatchObject({ MEPM: 3, CMZ: 3, CTRX: 1, CFPM: 3, TAZPIPC: 4, ABPC: 4, CEZ: 3, LVFX_PO: 1, AMK: 1 });
  });

  it("確かめた薬には、公的な文書の出典がある", () => {
    for (const d of data.drugs) {
      const raw = d as unknown as { sources?: Record<string, string>; review?: { status: string } };
      expect(raw.sources?.aware, `${d.id} の AWaRe の出典`).toMatch(/手引き/);
      if (raw.review?.status === "確認済み") expect(raw.sources?.dosing, `${d.id} の用法の出典`).toMatch(/手引き|JAID\/JSC|電子添文/);
      if (d.bioavailability !== null) expect(raw.sources?.bioavailability, `${d.id} の吸収率の出典`).toMatch(/手引き|インタビューフォーム/);
    }
  });

  it("AWaRe 分類：Access → Watch → 温存すべき系統（カルバペネム・キノロン）の順に優先する", () => {
    const rank = (id: string) => stewardshipRank(data, id);
    for (const a of ["ABPC", "CEZ", "AMK"]) for (const w of ["CMZ", "CTRX", "CFPM", "TAZPIPC", "LVFX_PO", "CFDN_PO"]) expect(rank(a)).toBeLessThan(rank(w));
    for (const w of ["CMZ", "CTRX", "CFPM", "TAZPIPC", "CFDN_PO"]) {
      expect(rank(w)).toBeLessThan(rank("MEPM"));
      expect(rank(w)).toBeLessThan(rank("LVFX_PO"));
    }
    // 手引きの表では CMZ と CTRX は同じ Watch（どちらが狭いかは決めない）
    expect(rank("CMZ")).toBe(rank("CTRX"));
  });

  it("ESBL の連動：腸内細菌目では、ABPC・CEZ・経口第3世代セフェム・CFPM の耐性率は CTRX 以上", () => {
    for (const region of data.janis.regions) {
      const t = resistanceTableFor(data, region);
      for (const sp of ["ecoli", "kpneumoniae", "pmirabilis"]) {
        for (const d of ["ABPC", "CEZ", "CFDN_PO", "CFPM"]) expect(t[sp]![d]!, `${region} ${sp} ${d}`).toBeGreaterThanOrEqual(t[sp]!.CTRX!);
        // セファマイシン系とカルバペネム系は連動させない（ESBL は分解しない）
        expect(t[sp]!.CMZ!).toBeCloseTo(1 - susceptibility(data, region, sp, "CMZ").p, 10);
        expect(t[sp]!.MEPM!).toBeCloseTo(1 - susceptibility(data, region, sp, "MEPM").p, 10);
      }
    }
  });
});

describe("AMK（作者の判断で JAID/JSC 感染症治療ガイド2023 に合わせた例外）", () => {
  const amk = data.drugById.get("AMK")! as unknown as {
    dosesPerDay: number;
    dosing: { label: string; unitsPerDay: number };
    price: { spec: string };
    sources: Record<string, string>;
  };

  it("用法の出典は JAID の尿路感染症の章", () => {
    expect(amk.sources.dosing).toMatch(/JAID\/JSC 感染症治療ガイド2023 Ⅺ 尿路感染症 E/);
    expect(amk.dosesPerDay).toBe(1);
  });

  it("1日量 15mg/kg × 体重60kg ＝ 900mg を、200mg 規格の単位数に直している", () => {
    expect(amk.dosing.label).toMatch(/15mg\/kg/);
    expect(amk.price.spec).toBe("200mg1管");
    expect(amk.dosing.unitsPerDay).toBeCloseTo((15 * 60) / 200, 10);
  });
});
