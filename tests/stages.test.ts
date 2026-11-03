// 同梱のステージ（data/stages）の検査：エンジンの検査と、文章の決まり（SPEC.md 5.4・作者の方針）
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadGameData, validateScenario, type ScenarioDef } from "../src/engine/index.ts";

const data = loadGameData();
const files = readdirSync("data/stages").filter((f) => f.endsWith(".json"));
// 画面に出す文章に使わない言葉（SPEC.md 5.4：患者・症例。2026-11-03 作者の方針：病棟）
const banned = ["患者", "症例", "病棟"];

describe("同梱のステージ", () => {
  it("公開用の既定ステージ（uti-zenkoku）がある", () => {
    expect(files).toContain("uti-zenkoku.json");
  });

  for (const f of files) {
    const s = JSON.parse(readFileSync(`data/stages/${f}`, "utf8")) as ScenarioDef;

    it(`${f}：エンジンの検査を通り、id がファイル名と同じ`, () => {
      expect(validateScenario(data, s)).toEqual([]);
      expect(`${s.id}.json`).toBe(f);
    });

    it(`${f}：ブリーフィングは200字以内、振り返りは400字以内で、使わない言葉と投与量の数値を含まない`, () => {
      const texts = [s.present.briefing ?? "", s.future.briefing ?? "", s.debrief ?? ""];
      expect([...(s.present.briefing ?? "")].length).toBeLessThanOrEqual(200);
      expect([...(s.future.briefing ?? "")].length).toBeLessThanOrEqual(200);
      expect([...(s.debrief ?? "")].length).toBeLessThanOrEqual(400);
      for (const t of texts) {
        for (const w of banned) expect(t, w).not.toContain(w);
        expect(t).not.toMatch(/\d+\s*(mg|g|mL)\b/);
      }
    });
  }
});
