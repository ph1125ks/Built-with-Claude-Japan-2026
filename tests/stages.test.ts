// 同梱のステージ（data/stages）と、教員モードで承認して書き出したステージ（public/stages）の検査：
// エンジンの検査と、文章の決まり（SPEC.md 5.4・作者の方針。src/engine/stagecheck.ts と同じ決まり）
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BANNED_WORDS, checkScenario, loadGameData, textProblems, validateScenario, type ScenarioDef } from "../src/engine/index.ts";

const data = loadGameData();
const files = readdirSync("data/stages").filter((f) => f.endsWith(".json"));
const published = existsSync("public/stages") ? readdirSync("public/stages").filter((f) => f.endsWith(".json")) : [];
// 画面に出す文章に使わない言葉（SPEC.md 5.4：患者・症例。2026-11-03 作者の方針：病棟）
const banned = BANNED_WORDS;

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

describe("教員モードで承認したステージ（public/stages）", () => {
  it("書き出したステージがあれば、規則の検査（エンジン・文章・手札の効き目）を通る", () => {
    for (const f of published) {
      const st = JSON.parse(readFileSync(`public/stages/${f}`, "utf8")) as ScenarioDef;
      expect(checkScenario(data, st), f).toEqual([]);
      expect(textProblems(st), f).toEqual([]);
      expect(`${st.id}.json`, f).toBe(f);
    }
  });
});
