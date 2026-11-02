import { describe, expect, it } from "vitest";
import { loadGameData } from "../src/engine/index.ts";
import { cardKeys, intervalLabel, intervalShort, pct, spectrumOf } from "../src/game/format.ts";

const data = loadGameData();

describe("カードの表示（SPEC.md 7.1：用量は出さない）", () => {
  it("投与間隔の表示に、用量（mg・g・mg/kg）が入らない", () => {
    for (const d of data.drugs) {
      for (const s of [intervalShort(d), intervalLabel(d)]) {
        expect(s, d.id).not.toMatch(/\d\s*(mg|g|ｍｇ)/i);
        expect(s, d.id).toMatch(/時間毎|1日\d回/);
      }
    }
  });

  it("スペクトラムの目安：自然耐性・効かない扱いの菌には届かない", () => {
    expect(spectrumOf(data, "全国", "CTRX")).toEqual({ entero: true, pseudomonas: false, enterococcus: false });
    expect(spectrumOf(data, "全国", "MEPM")).toEqual({ entero: true, pseudomonas: true, enterococcus: false });
    expect(spectrumOf(data, "全国", "TAZPIPC")).toEqual({ entero: true, pseudomonas: true, enterococcus: true });
  });

  it("数字キー：ステージ1と2で同じ薬に同じ数字を割り当てる", () => {
    const present = ["ABPC", "CEZ", "CMZ", "CTRX", "CFDN_PO", "LVFX_PO", "TAZPIPC", "MEPM"];
    const future = ["ABPC", "CMZ", "CTRX", "LVFX_PO", "TAZPIPC", "MEPM", "AMK"];
    const all = [...present, ...future];
    const k1 = cardKeys(present, all);
    const k2 = cardKeys(future, all);
    for (const d of future) if (k1.has(d)) expect(k2.get(d), d).toBe(k1.get(d));
    expect(k2.get("AMK")).toBe(9);
    // 合わせて9種類を超えるときは手札の順
    const many = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    expect([...cardKeys(["j", "a"], many).values()]).toEqual([1, 2]);
  });

  it("1% 未満の耐性率を 0% に見せない", () => {
    expect(pct(0.001)).toBe("0.1%");
    expect(pct(0.319)).toBe("32%");
    expect(pct(0)).toBe("0%");
    expect(pct(1)).toBe("100%");
  });
});
