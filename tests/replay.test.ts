// 作業の記録の再生（replay.html）の時刻表と、URL の記録の名前の確かめ
import { describe, expect, it } from "vitest";
import { CHARS_PER_SEC, formatSec, MIN_TYPE_SEC, parseReplayLog, replayFile, schedule, type LoggedEvent } from "../src/replay/schedule.ts";

const ev = (t: number, e: LoggedEvent["e"]): LoggedEvent => ({ t, e });

describe("schedule", () => {
  it("知らせの順を変えず、文でない知らせは記録の時刻のまま", () => {
    const { items, total } = schedule([ev(0, { type: "status", text: "始め" }), ev(2.7, { type: "tool_call", name: "get_region_data", label: "読む" }), ev(5, { type: "done", draftId: null, stopReason: "end_turn" })]);
    expect(items.map((x) => x.at)).toEqual([0, 2.7, 5]);
    expect(items.every((x) => x.dur === 0)).toBe(true);
    expect(total).toBe(5);
  });

  it("文は、ふつうの速さで書き、次の中身のある知らせまでの間に収める（区切りと状況の知らせは飛ばして見る）", () => {
    const text = "あ".repeat(80); // ふつうなら 2 秒
    const { items } = schedule([
      ev(10, { type: "thinking", text }),
      ev(10, { type: "block_end" }),
      ev(10, { type: "status", text: "案を書いています…" }),
      ev(30, { type: "tool_call", name: "simulate_stage", label: "シミュレーション" }),
    ]);
    expect(items[0]!.dur).toBeCloseTo(80 / CHARS_PER_SEC);
    // 区切りと状況の知らせは、文を書き終えてから出す
    expect(items[1]!.at).toBeCloseTo(10 + 80 / CHARS_PER_SEC);
    expect(items[2]!.at).toBeCloseTo(10 + 80 / CHARS_PER_SEC);
    expect(items[3]!.at).toBe(30);
  });

  it("間が短いときは、その間で書き切る（長いまとめを速く書く）", () => {
    const text = "あ".repeat(1600);
    const { items, total } = schedule([ev(146.5, { type: "text", text }), ev(150.6, { type: "usage", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0.7, seconds: 151 })]);
    expect(items[0]!.dur).toBeCloseTo(4.1);
    expect(items[1]!.at).toBeCloseTo(150.6);
    expect(total).toBeCloseTo(150.6);
  });

  it("間がまったくないときも、最短の時間をかけて書き、後ろの知らせを少し遅らせる", () => {
    const text = "あ".repeat(200);
    const { items } = schedule([ev(15, { type: "thinking", text }), ev(15, { type: "tool_call", name: "simulate_stage", label: "シミュレーション" }), ev(40, { type: "done", draftId: null, stopReason: null })]);
    expect(items[0]!.dur).toBeCloseTo(MIN_TYPE_SEC);
    expect(items[1]!.at).toBeCloseTo(15 + MIN_TYPE_SEC);
    // 遅れは長い間で取り戻す
    expect(items[2]!.at).toBe(40);
  });

  it("文字はサロゲートペアを割らずに分ける", () => {
    const { items } = schedule([ev(0, { type: "text", text: "𠮷野家" })]);
    expect(items[0]!.chars).toEqual(["𠮷", "野", "家"]);
  });
});

describe("replayFile", () => {
  it("public/replays/ の中のファイル名だけを認める", () => {
    expect(replayFile(null)).toBe("replays/osaka.json");
    expect(replayFile("skill-1.json")).toBe("replays/skill-1.json");
    expect(replayFile("skill-1")).toBe("replays/skill-1.json");
    expect(replayFile("../stages/x.json")).toBeNull();
    expect(replayFile("a/b.json")).toBeNull();
    expect(replayFile("https://example.com/x.json")).toBeNull();
    expect(replayFile(".json")).toBeNull();
  });
});

describe("parseReplayLog", () => {
  it("形の合わない記録は読まない", () => {
    expect(parseReplayLog(null)).toBeNull();
    expect(parseReplayLog({ model: "m", made: "2026-11-05", input: { region: "大阪府", goal: "g" } })).toBeNull();
    const ok = parseReplayLog({ model: "m", made: "2026-11-05", input: { region: "大阪府", audience: "a", goal: "g" }, events: [{ t: 0, e: { type: "status", text: "x" } }, { bad: 1 }] });
    expect(ok?.events).toHaveLength(1);
  });
});

describe("formatSec", () => {
  it("1分を超えたら分と秒で書く", () => {
    expect(formatSec(37.4)).toBe("37秒");
    expect(formatSec(150.6)).toBe("2分31秒");
    expect(formatSec(65)).toBe("1分05秒");
  });
});
