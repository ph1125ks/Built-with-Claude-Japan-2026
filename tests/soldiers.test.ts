import { describe, expect, it } from "vitest";
import { loadGameData } from "../src/engine/index.ts";
import { spectrumOf } from "../src/game/format.ts";
import { CLASS_LOOKS, drugSoldierSvg, lookOf } from "../src/game/soldiers.ts";

const data = loadGameData();

describe("兵士の姿（系統ごと。2026-11-03 作者の案と判断）", () => {
  it("すべての系統に姿があり、系統どうしは形（体・武器・鎧・盾）で見分けられる", () => {
    const shapes = new Map<string, string>();
    for (const c of data.classes) {
      const look = CLASS_LOOKS[c.id];
      expect(look, c.id).toBeDefined();
      const key = JSON.stringify(look);
      expect(shapes.get(key), `${c.id} と ${shapes.get(key)} が同じ形`).toBeUndefined();
      shapes.set(key, c.id);
    }
  });

  it("作者の例：ペニシリン系は鎧なし、合剤は盾、セフェム系は世代で鎧が上がり、カルバペネム系は機械兵", () => {
    const look = (id: string) => lookOf(data, data.drugById.get(id)!);
    expect(look("ABPC")).toMatchObject({ body: "human", weapon: "sword", armor: 0, shield: false });
    expect(look("TAZPIPC")).toMatchObject({ weapon: "sword", armor: 0, shield: true });
    expect([look("CEZ"), look("CMZ"), look("CTRX"), look("CFPM")].map((l) => l.armor)).toEqual([1, 2, 3, 4]);
    expect(look("CEX_PO").armor).toBe(look("CEZ").armor);
    expect(look("CFDN_PO").armor).toBe(look("CTRX").armor);
    expect(look("MEPM").body).toBe("mech");
    expect(look("IPMCS").body).toBe("mech");
    expect(look("AMK")).toMatchObject({ weapon: "hammer", armor: 0 });
    expect(look("LVFX_PO")).toMatchObject({ weapon: "bow", armor: 0 });
  });

  it("緑膿菌の紋章は、カードの「緑膿菌」の目安と全地域で一致する", () => {
    for (const region of data.janis.regions) {
      for (const d of data.drugs) {
        expect(lookOf(data, d).pseudomonas, `${region} ${d.id}`).toBe(spectrumOf(data, region, d.id).pseudomonas);
      }
    }
  });

  it("内服は足元がカプセルで、絵の面積が吸収率に比例する。注射は大きさ 1", () => {
    for (const d of data.drugs) {
      const look = lookOf(data, d);
      expect(look.oral, d.id).toBe(d.route === "po");
      const area = d.route === "po" ? (d.bioavailability ?? 1) : 1;
      expect(look.scale * look.scale, d.id).toBeCloseTo(area, 6);
    }
  });

  it("SVG は外部の素材を読まない（コードで描いた図形だけ）", () => {
    for (const d of data.drugs) {
      const svg = drugSoldierSvg(data, d, 64);
      expect(svg.startsWith("<svg"), d.id).toBe(true);
      expect(svg, d.id).not.toMatch(/<image|href=|url\(/);
    }
  });
});
