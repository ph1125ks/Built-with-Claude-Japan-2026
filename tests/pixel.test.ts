import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadGameData } from "../src/engine/index.ts";
import { ditherKeep, isEdge, soldierSprite, type Sprite } from "../src/game/pixel/engine.js";
import { FRAMES, LEVELS, STYLE, bugFrame, levelOf, pixelDrug, soldierFrame } from "../src/game/pixel/index.ts";

const data = loadGameData();
const count = (s: Sprite) => s.px.filter(Boolean).length;
const diff = (a: Sprite, b: Sprite) => a.px.filter((p, i) => JSON.stringify(p) !== JSON.stringify(b.px[i])).length;

describe("ドット絵の兵士（作風 C。2026-11-04 作者が選んだ）", () => {
  it("すべての薬で、待機2コマ・攻撃2コマが描ける（絵の大きさは作風の大きさ）", () => {
    for (const d of data.drugs) {
      for (const f of FRAMES) {
        const s = soldierFrame(data, d, f);
        expect([s.w, s.h], `${d.id} ${f}`).toEqual([STYLE.size, STYLE.size]);
        expect(count(s), `${d.id} ${f}`).toBeGreaterThan(80);
      }
    }
  });

  it("緑膿菌の紋章は、紋章を付ける薬だけ絵が変わる", () => {
    for (const d of data.drugs) {
      const pd = pixelDrug(data, d);
      const changed = diff(soldierSprite(STYLE, pd), soldierSprite(STYLE, { ...pd, pa: !pd.pa })) > 0;
      expect(changed, d.id).toBe(true);
    }
  });

  it("内服薬だけ、足元にカプセルの台がある", () => {
    for (const d of data.drugs) {
      const pd = pixelDrug(data, d);
      const withBase = diff(soldierSprite(STYLE, pd), soldierSprite(STYLE, pd, "idle0", { noOral: true })) > 0;
      expect(withBase, d.id).toBe(d.route === "po");
    }
  });

  it("同じ系統の薬は、紋章と台を除いて同じ姿", () => {
    const bare = (id: string) => soldierSprite(STYLE, { ...pixelDrug(data, data.drugById.get(id)!), pa: false }, "idle0", { noOral: true });
    expect(diff(bare("CTRX"), bare("CAZ"))).toBe(0);
    expect(diff(bare("CTRX"), bare("CFDN_PO"))).toBe(0);
    expect(diff(bare("MEPM"), bare("IPMCS"))).toBe(0);
    expect(diff(bare("CTRX"), bare("CFPM"))).toBeGreaterThan(0);
  });
});

describe("兵士の濃さ（体内の薬の量。点描）", () => {
  it("段は 0〜8。少しでも薬が残っていれば 1 以上、満タンで 8", () => {
    expect(levelOf(0)).toBe(0);
    expect(levelOf(0.001)).toBe(1);
    expect(levelOf(0.5)).toBe(4);
    expect(levelOf(1)).toBe(LEVELS);
    expect(levelOf(1.2)).toBe(LEVELS);
  });

  it("段が下がるほど点が減り、輪郭（外周）は残る", () => {
    const d = data.drugById.get("CTRX")!;
    const full = soldierFrame(data, d, "idle0", LEVELS);
    let prev = count(full);
    for (let l = LEVELS - 1; l >= 1; l--) {
      const s = soldierFrame(data, d, "idle0", l);
      expect(count(s), `段 ${l}`).toBeLessThanOrEqual(prev);
      prev = count(s);
    }
    const thin = ditherKeep(full, 0, true);
    full.px.forEach((p, i) => {
      if (p && isEdge(full, i % full.w, Math.floor(i / full.w))) expect(thin.px[i]).toEqual(p);
    });
  });
});

describe("ドット絵の細菌", () => {
  it("5種類とも2コマあり、べん毛のある菌（プロテウス・緑膿菌）は、菌名が分かるまでべん毛のない絵", () => {
    for (const def of data.bacteria) {
      const full = bugFrame(def, 0, false);
      const bare = bugFrame(def, 0, true);
      expect([bare.w, bare.h], def.id).toEqual([full.w, full.h]);
      if (def.look.flagella) expect(count(bare), def.id).toBeLessThan(count(full));
      else expect(diff(bare, full), def.id).toBe(0);
      expect(count(bugFrame(def, 1, false)), def.id).toBeGreaterThan(0);
    }
  });
});

describe("外部の素材を使わない", () => {
  it("ドット絵の仕組みと作風のファイルは、画像や URL を読み込まない（すべてコードで書いたドット）", () => {
    for (const f of ["src/game/pixel/engine.js", "src/game/pixel/styles/c32.js", "src/game/pixel/index.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/https?:\/\/|url\(|<image|fetch\(|new Image\(/);
    }
  });
});
