import { describe, expect, it } from "vitest";
import {
  canSummon,
  costPerDose,
  createGame,
  intervalTicks,
  loadGameData,
  observe,
  resistanceTableFor,
  revealLevelAt,
  step,
  validateScenario,
  type GameEvent,
  type GameState,
  type ResistanceTable,
  type StageDef,
} from "../src/engine/index.ts";

const data = loadGameData();
const tps = data.rules.time.ticksPerSecond;
const L = data.rules.board.laneLength;

/** 1匹だけ出る小さなステージ */
function oneBug(species: string, extra: Partial<StageDef> = {}): StageDef {
  return {
    title: "テスト",
    budget: 1000,
    bladderHp: 100,
    hand: [{ drug: "CTRX" }, { drug: "CMZ" }, { drug: "MEPM" }, { drug: "CFDN_PO" }, { drug: "LVFX_PO" }],
    waves: [{ at: 0, lane: 0, species, count: 1, spacing: 0 }],
    ...extra,
  };
}

/** すべて効く（自然耐性だけ残す）表 */
function allSusceptible(): ResistanceTable {
  const t = resistanceTableFor(data, "全国");
  for (const [sp, row] of Object.entries(t)) {
    const intrinsic = data.bacteriumById.get(sp)!.intrinsicResistance;
    for (const d of Object.keys(row)) row[d] = intrinsic.includes(d) ? 1 : 0;
  }
  return t;
}

function runUntilEnd(state: GameState, maxTicks = 100000): GameEvent[] {
  const all: GameEvent[] = [];
  while (state.outcome === "playing" && state.tick < maxTicks) all.push(...step(state));
  return all;
}

describe("召喚", () => {
  it("医療費が減り、同じレーンには投与間隔が過ぎるまで同じ薬を出せない", () => {
    const s = createGame({ data, stage: oneBug("ecoli"), region: "全国", seed: 1 });
    const before = s.budget;
    step(s, [{ type: "summon", drug: "CTRX", lane: 0 }]);
    expect(s.budget).toBeCloseTo(before - costPerDose(data, "CTRX"), 10);
    expect(canSummon(s, "CTRX", 0)).toBe("cooldown");
    expect(canSummon(s, "CTRX", 1)).toBeNull();
    expect(canSummon(s, "ABPC", 0)).toBe("notInHand");
  });

  it("待ち時間は投与間隔：1日1回の CTRX は1日分、1日3回の CMZ は1/3日分", () => {
    const day = data.rules.time.secondsPerGameDay * tps;
    expect(intervalTicks(data, "CTRX")).toBe(day);
    expect(intervalTicks(data, "CMZ")).toBe(day / 3);
  });

  it("内服薬は吸収率のぶん HP が削れて出て、早く消える", () => {
    const s = createGame({ data, stage: oneBug("ecoli"), region: "全国", seed: 1 });
    step(s, [
      { type: "summon", drug: "CFDN_PO", lane: 1 },
      { type: "summon", drug: "LVFX_PO", lane: 2 },
    ]);
    const full = data.rules.units.fullHp;
    const cfdn = s.units.find((u) => u.drug === "CFDN_PO")!;
    const lvfx = s.units.find((u) => u.drug === "LVFX_PO")!;
    // 1ティック分はもう減っている
    const ba = (id: string) => data.drugById.get(id)!.bioavailability!;
    expect(ba("CFDN_PO")).toBeLessThan(0.3);
    expect(ba("LVFX_PO")).toBeGreaterThan(0.9);
    expect(cfdn.hp + cfdn.decayPerTick).toBeCloseTo(full * ba("CFDN_PO"), 6);
    expect(lvfx.hp + lvfx.decayPerTick).toBeCloseTo(full * ba("LVFX_PO"), 6);
    // CFDN は投与間隔に吸収率を掛けた長さで消える
    const expectedLife = Math.ceil(intervalTicks(data, "CFDN_PO") * ba("CFDN_PO"));
    for (let i = 0; i < expectedLife + 1; i++) step(s);
    expect(s.units.some((u) => u.drug === "CFDN_PO")).toBe(false);
  });
});

describe("効く・効かない", () => {
  it("感受性の個体は倒れ、耐性の個体はダメージを受けず「耐性」が一度だけ出る", () => {
    // 効く場合
    const ok = createGame({ data, stage: oneBug("ecoli"), region: "全国", seed: 1, resistance: allSusceptible(), collectEvents: true });
    const ev1 = [...step(ok, [{ type: "summon", drug: "CTRX", lane: 0 }]), ...runUntilEnd(ok)];
    expect(ev1.some((e) => e.type === "killed" && e.drug === "CTRX")).toBe(true);
    expect(ok.outcome).toBe("won");

    // 自然耐性：緑膿菌に CTRX
    const ng = createGame({ data, stage: oneBug("paeruginosa"), region: "全国", seed: 1, resistance: allSusceptible(), collectEvents: true });
    const ev2: GameEvent[] = [...step(ng, [{ type: "summon", drug: "CTRX", lane: 0 }])];
    for (let i = 0; i < 200; i++) ev2.push(...step(ng));
    const resisted = ev2.filter((e) => e.type === "resisted");
    expect(resisted).toEqual([{ type: "resisted", uid: expect.any(Number), drug: "CTRX", intrinsic: true }]);
    expect(ng.bacteria[0]!.hp).toBe(ng.bacteria[0]!.maxHp);
  });

  it("獲得耐性（耐性率 100% にした個体）にも効かない", () => {
    const t = allSusceptible();
    t.ecoli!.CTRX = 1;
    const s = createGame({ data, stage: oneBug("ecoli"), region: "全国", seed: 1, resistance: t, collectEvents: true });
    const ev = [...step(s, [{ type: "summon", drug: "CTRX", lane: 0 }])];
    for (let i = 0; i < 100; i++) ev.push(...step(s));
    expect(ev.find((e) => e.type === "resisted")).toMatchObject({ drug: "CTRX", intrinsic: false });
    expect(s.bacteria[0]!.hp).toBe(s.bacteria[0]!.maxHp);
  });
});

describe("情報の見え方", () => {
  it("遠い：グラム染色だけ、中ほど：菌名、近い：感受性", () => {
    expect(revealLevelAt(data, L)).toBe("gram");
    expect(revealLevelAt(data, L * 0.7)).toBe("gram");
    expect(revealLevelAt(data, L * 0.5)).toBe("species");
    expect(revealLevelAt(data, L * 0.2)).toBe("susceptibility");
  });

  it("見えていない情報はプレイヤーに渡さない", () => {
    const s = createGame({ data, stage: oneBug("ecoli"), region: "全国", seed: 1 });
    step(s);
    const far = observe(s).bacteria[0]!;
    expect(far.level).toBe("gram");
    expect(far.gram).toBe("negative");
    expect(far.species).toBeUndefined();
    expect(far.resistantInHand).toBeUndefined();
    while (s.bacteria[0] && s.bacteria[0].level !== "susceptibility") step(s);
    const near = observe(s).bacteria[0]!;
    expect(near.species).toBe("ecoli");
    expect(Array.isArray(near.resistantInHand)).toBe(true);
  });
});

describe("勝敗", () => {
  it("菌が膀胱に着くと耐久が減り、0 で負け", () => {
    const stage = oneBug("ecoli", { bladderHp: 10, waves: [{ at: 0, lane: 0, species: "ecoli", count: 2, spacing: 1 }] });
    const s = createGame({ data, stage, region: "全国", seed: 1 });
    runUntilEnd(s);
    expect(s.outcome).toBe("lost");
    expect(s.bladderHp).toBe(0);
  });

  it("すべての菌が片付けば勝ち", () => {
    const s = createGame({ data, stage: oneBug("ecoli"), region: "全国", seed: 1, resistance: allSusceptible() });
    step(s, [{ type: "summon", drug: "MEPM", lane: 0 }]);
    runUntilEnd(s);
    expect(s.outcome).toBe("won");
    expect(s.stats.leaked).toBe(0);
  });
});

describe("再現性", () => {
  it("同じ種なら、出現の予定も個体の耐性もまったく同じ", () => {
    const stage = oneBug("ecoli", { waves: [{ at: 0, lane: "random", species: "auto", count: 30, spacing: 0.5 }] });
    const a = createGame({ data, stage, region: "大阪府", seed: 42 });
    const b = createGame({ data, stage, region: "大阪府", seed: 42 });
    expect(a.spawnPlan).toEqual(b.spawnPlan);
    for (let i = 0; i < 400; i++) {
      step(a);
      step(b);
    }
    expect(a.bacteria.map((x) => [x.species, [...x.resistant].sort()])).toEqual(b.bacteria.map((x) => [x.species, [...x.resistant].sort()]));
  });
});

describe("シナリオの検査", () => {
  it("存在しない薬や範囲外のレーンを見つける", () => {
    const bad = {
      id: "Bad_ID",
      title: "x",
      region: "火星",
      present: oneBug("ecoli", { hand: [{ drug: "XXX" }], waves: [{ at: 0, lane: 9, species: "ecoli", count: 1, spacing: 0 }] }),
      future: { ...oneBug("unknown-bug"), yearsLater: 5 },
    };
    const errors = validateScenario(data, bad);
    expect(errors.join("\n")).toMatch(/id は/);
    expect(errors.join("\n")).toMatch(/地域 火星/);
    expect(errors.join("\n")).toMatch(/XXX/);
    expect(errors.join("\n")).toMatch(/lane は/);
    expect(errors.join("\n")).toMatch(/unknown-bug/);
  });
});

describe("ESBL の連動（個体の耐性の決め方）", () => {
  // 大腸菌を一度に 4000 匹出して、個体の耐性を数える
  const stage = oneBug("ecoli", { waves: [{ at: 0, lane: 0, species: "ecoli", count: 4000, spacing: 0 }] });
  const s = createGame({ data, stage, region: "全国", seed: 7 });
  step(s);
  const bugs = s.bacteria;
  const table = resistanceTableFor(data, "全国").ecoli!;
  const rate = (drug: string) => bugs.filter((b) => b.resistant.has(drug)).length / bugs.length;

  it("CTRX に耐性の個体は、ABPC・CEZ・経口第3世代セフェム・CFPM にも必ず耐性", () => {
    const ctrxR = bugs.filter((b) => b.resistant.has("CTRX"));
    expect(ctrxR.length).toBeGreaterThan(800);
    for (const b of ctrxR) for (const d of ["ABPC", "CEZ", "CFDN_PO", "CFPM"]) expect(b.resistant.has(d)).toBe(true);
  });

  it("連動させても、薬ごとの全体の耐性率は表の値のまま（±3%）", () => {
    for (const d of ["CTRX", "ABPC", "CEZ", "CFDN_PO", "CFPM", "CMZ", "LVFX_PO"]) expect(Math.abs(rate(d) - table[d]!), d).toBeLessThan(0.03);
  });

  it("CMZ は連動しない（CTRX に耐性でも、ほとんどの個体に CMZ が効く）", () => {
    const ctrxR = bugs.filter((b) => b.resistant.has("CTRX"));
    expect(ctrxR.filter((b) => !b.resistant.has("CMZ")).length / ctrxR.length).toBeGreaterThan(0.9);
  });
});

describe("使用日数（DOT にならった数え方）", () => {
  it("内服薬も、吸収率によらず投与間隔の長さで数える（CFDN 1回 ＝ 1/3 日）", () => {
    const s = createGame({ data, stage: oneBug("ecoli", { waves: [{ at: 60, lane: 0, species: "ecoli", count: 1, spacing: 0 }] }), region: "全国", seed: 1 });
    step(s, [{ type: "summon", drug: "CFDN_PO", lane: 1 }]);
    for (let i = 0; i < intervalTicks(data, "CFDN_PO") + 5; i++) step(s);
    expect(s.stats.activeTicks.CFDN_PO).toBe(intervalTicks(data, "CFDN_PO"));
  });
});
