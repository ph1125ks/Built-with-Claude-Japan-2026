// 「はじめての人へ」のページ（intro.html）：文が前提の鎖（docs/PLAIN-LANGUAGE.md）のままか、表がデータから作られるか、
// 選択圧の動く絵の決まり、動画用の見せ方の時刻表を確かめる
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BANNED_WORDS, loadGameData, susceptibility } from "../src/engine/index.ts";
import { allTexts, CHAIN, effectTable, HIGH_AT, TABLE_BACTERIA, TABLE_DRUGS, TABLE_REGION } from "../src/intro/content.ts";
import { parseFrom, PRESENT_STEPS, presentTimeline } from "../src/intro/present-plan.ts";
import { regrow, SIEVE, startPopulation, tally, useDrug } from "../src/intro/sieve-model.ts";

const data = loadGameData();

describe("前提の鎖の文", () => {
  const doc = readFileSync(new URL("../docs/PLAIN-LANGUAGE.md", import.meta.url), "utf8");
  /** 文書の「1. 前提の鎖」の表の行：| 番号 | 見出し | 文 | */
  const rows = new Map(
    [...doc.matchAll(/^\|\s*(\d)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm)].map((m) => [Number(m[1]), { title: m[2]!, text: m[3]!.replace(/【作者確認】/g, "") }]),
  );

  it("1〜8 の見出しと文が、文書の表と1字も違わない", () => {
    expect(CHAIN.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const s of CHAIN) {
      const row = rows.get(s.n);
      expect(row, `段 ${s.n}`).toBeDefined();
      expect(s.title).toBe(row!.title);
      expect(s.sentences.join("")).toBe(row!.text.trim());
    }
  });

  it("ページの文に、使わない言葉・投与量・診療の指示がない", () => {
    for (const t of allTexts()) {
      for (const w of BANNED_WORDS) expect(t, `「${w}」`).not.toContain(w);
      expect(t).not.toMatch(/\d+(\.\d+)?\s*(mg|g|mL|ml|単位)(?![a-zA-Z])/);
      expect(t).not.toMatch(/(投与|処方|内服|点滴|飲)(して(ください|下さい)|しなさい|すべき|せよ|みましょう|ましょう)/);
    }
  });
});

describe("3. 効く相手が違う（公開データの表）", () => {
  const table = effectTable(data);

  it("どのマスも、ゲームと同じ公開データの感性率から決まる（数値を作らない）", () => {
    expect(table.map((r) => r.bacterium)).toEqual([...TABLE_BACTERIA]);
    for (const r of table) {
      expect(r.cells.map((c) => c.drug)).toEqual([...TABLE_DRUGS]);
      for (const c of r.cells) {
        const p = susceptibility(data, TABLE_REGION, r.bacterium, c.drug).p;
        expect(c.effect, `${r.bacterium} × ${c.drug}`).toBe(p >= HIGH_AT ? "high" : "low");
      }
    }
  });

  it("切り札のメロペネムは、ほとんどの細菌で高く、ねらいをしぼった薬は高い細菌が限られる（教えたいことが表に出ている）", () => {
    const highs = (drug: string) => table.filter((r) => r.cells.find((c) => c.drug === drug)?.effect === "high").length;
    const n = TABLE_BACTERIA.length;
    expect(highs("MEPM")).toBeGreaterThanOrEqual(n - 1);
    for (const d of TABLE_DRUGS.filter((d) => d !== "MEPM")) {
      expect(highs(d), d).toBeGreaterThanOrEqual(1);
      expect(highs(d), d).toBeLessThan(highs("MEPM"));
    }
    // 薬ごとに、効く見込みの高い細菌の組み合わせが違う
    const patterns = TABLE_DRUGS.map((d) => table.map((r) => r.cells.find((c) => c.drug === d)!.effect).join(","));
    expect(new Set(patterns).size).toBe(TABLE_DRUGS.length);
  });
});

describe("5. 選択圧の動く絵", () => {
  it("はじめは同じ種類の細菌が20体、そのうち効かない細菌は少しだけ。種が同じなら毎回同じ並び", () => {
    const a = startPopulation();
    expect(a).toHaveLength(SIEVE.count);
    expect(tally(a)).toEqual({ susceptible: SIEVE.count - SIEVE.resistant, resistant: SIEVE.resistant });
    expect(startPopulation()).toEqual(a);
    expect(SIEVE.resistant / SIEVE.count).toBeLessThanOrEqual(0.2);
  });

  it("効かない細菌は、隣り合わない（見て分かるように）", () => {
    const slots = startPopulation()
      .filter((b) => b.resistant)
      .map((b) => b.slot)
      .sort((x, y) => x - y);
    for (let i = 1; i < slots.length; i++) expect(slots[i]! - slots[i - 1]!).toBeGreaterThan(1);
  });

  it("薬を使うと、効く細菌だけが倒れ、効かない細菌だけが残る", () => {
    const { survivors, fallen } = useDrug(startPopulation());
    expect(survivors.every((b) => b.resistant)).toBe(true);
    expect(fallen.every((b) => !b.resistant)).toBe(true);
    expect(survivors).toHaveLength(SIEVE.resistant);
  });

  it("残った細菌が増えて、空いた場所を埋める。子は親と同じく効かないので、もう一度使っても倒れない", () => {
    const { survivors } = useDrug(startPopulation());
    const grown = regrow(survivors);
    expect(grown).toHaveLength(SIEVE.count);
    expect(new Set(grown.map((b) => b.slot)).size).toBe(SIEVE.count);
    expect(tally(grown).resistant).toBe(SIEVE.count);
    const kids = grown.filter((b) => b.from !== undefined);
    expect(kids).toHaveLength(SIEVE.count - SIEVE.resistant);
    // 親は残った細菌のどれか。生まれる順は 0 から重ならずに並ぶ
    for (const k of kids) expect(survivors.map((s) => s.slot)).toContain(k.from);
    expect(kids.map((k) => k.order).sort((x, y) => x! - y!)).toEqual(kids.map((_, i) => i));
    expect(useDrug(grown).fallen).toHaveLength(0);
    expect(regrow(survivors)).toEqual(grown);
  });
});

describe("動画用の見せ方の時刻表", () => {
  const { entries, total } = presentTimeline();

  it("前提の鎖の 1〜5 を順に、合わせて 30〜40 秒で見せる", () => {
    expect(entries.map((e) => e.step)).toEqual([1, 2, 3, 4, 5]);
    expect(total).toBeGreaterThanOrEqual(30);
    expect(total).toBeLessThanOrEqual(40);
    expect(entries[0]!.at).toBe(0);
    for (let i = 1; i < entries.length; i++) expect(entries[i]!.at).toBeGreaterThan(entries[i - 1]!.at);
  });

  it("1 は短く、2〜4 は 3.5〜8 秒、5 は動く絵の場面を含めて 14 秒まで（動画のナレーションの区切りに合わせる。台本 第4版で短くした）", () => {
    for (const s of PRESENT_STEPS) {
      if (s.step === 1) expect(s.dur).toBeLessThanOrEqual(6);
      else if (s.step === 5) expect(s.dur).toBeLessThanOrEqual(14);
      else {
        expect(s.dur).toBeGreaterThanOrEqual(3.5);
        expect(s.dur).toBeLessThanOrEqual(8);
      }
    }
  });

  it("見出しは前提の鎖の見出しと同じで、5 の場面は段の中で順に並ぶ", () => {
    for (const e of entries) expect(e.label).toBe(CHAIN.find((c) => c.n === e.step)!.title);
    const five = entries.find((e) => e.step === 5)!;
    expect(five.phases!.map((p) => p.key)).toEqual(["start", "drug", "grow", "again", "body"]);
    expect(five.phases![0]!.at).toBe(five.at);
    for (let i = 1; i < five.phases!.length; i++) expect(five.phases![i]!.at).toBeGreaterThan(five.phases![i - 1]!.at);
    expect(five.phases!.at(-1)!.at).toBeLessThan(total);
  });

  it("from で途中の段から始められる（おかしな値は 1 から）", () => {
    const t = presentTimeline(PRESENT_STEPS, 5);
    expect(t.entries.map((e) => e.step)).toEqual([5]);
    expect(t.entries[0]!.at).toBe(0);
    expect(parseFrom("5")).toBe(5);
    expect(parseFrom("9")).toBe(1);
    expect(parseFrom("abc")).toBe(1);
    expect(parseFrom(null)).toBe(1);
  });
});
