import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  appropriateBot,
  breadthOf,
  broadBot,
  cloneTable,
  createGame,
  gaugeModel,
  loadGameData,
  resistanceTableFor,
  runScenario,
  selectionModel,
  step,
  type GameData,
  type GameEvent,
  type GameState,
  type ResistanceModelId,
  type ScenarioDef,
  type StageDef,
} from "../src/engine/index.ts";

const base = loadGameData();
const withModel = (model: ResistanceModelId): GameData =>
  loadGameData({ rules: { resistance: { ...base.rules.resistance, model } } });
const scenario = JSON.parse(readFileSync("data/stages/dev-uti.json", "utf8")) as ScenarioDef;
const tps = base.rules.time.ticksPerSecond;

function stage(waves: StageDef["waves"], hand = ["CTRX", "CMZ", "MEPM", "LVFX_PO"]): StageDef {
  return { title: "テスト", budget: 100000, bladderHp: 1000, hand: hand.map((drug) => ({ drug })), waves };
}

function runToEnd(state: GameState, perTick: (s: GameState) => void = () => {}): GameEvent[] {
  const all: GameEvent[] = [];
  while (state.outcome === "playing" && state.tick < 100000) {
    perTick(state);
    all.push(...step(state));
  }
  return all;
}

describe("耐性モデル A（選択圧の再現）", () => {
  const data = withModel("A");

  it("さらされた薬の耐性率だけが上がる。自然耐性（100%）とさらされていない薬は変わらない", () => {
    // 大腸菌3匹がレーン0を通る。LVFX をずっと置いておく
    const s = createGame({ data, stage: stage([{ at: 0, lane: 0, species: "ecoli", count: 3, spacing: 0.5 }]), region: "全国", seed: 3 });
    const before = cloneTable(s.resistance);
    runToEnd(s, (st) => {
      if (st.tick % (tps * 24) === 0) step(st, [{ type: "summon", drug: "LVFX_PO", lane: 0 }]);
    });
    expect(s.resistance.ecoli!.LVFX_PO!).toBeGreaterThan(before.ecoli!.LVFX_PO!);
    for (const d of ["CTRX", "CMZ", "MEPM", "ABPC", "TAZPIPC"]) expect(s.resistance.ecoli![d], d).toBeCloseTo(before.ecoli![d]!, 12);
    // 出てこなかった菌は変わらない
    expect(s.resistance.kpneumoniae).toEqual(before.kpneumoniae);
  });

  it("上げ幅は logit で 誇張係数 × logitPerWave × さらされた割合", () => {
    const s = createGame({ data, stage: stage([{ at: 0, lane: 0, species: "ecoli", count: 1, spacing: 0 }]), region: "全国", seed: 1 });
    const r0 = s.resistance.ecoli!.CMZ!;
    // 菌を出してから、CMZ に十分さらされたことにして波を片付ける
    step(s);
    const b = s.bacteria[0]!;
    b.exposure.CMZ = data.rules.resistance.A.fullExposureSeconds * tps;
    selectionModel.onWaveCleared(s, 0, [b]);
    const logit = (r: number) => Math.log(r / (1 - r));
    const { exaggeration, A } = data.rules.resistance;
    expect(logit(s.resistance.ecoli!.CMZ!) - logit(r0)).toBeCloseTo(exaggeration * A.logitPerWave, 10);
  });

  it("変えたあと連動の下限をかけ直す（CTRX が上がれば、経口第3世代セフェムも CTRX 以上）", () => {
    const s = createGame({ data, stage: stage([{ at: 0, lane: 0, species: "ecoli", count: 4, spacing: 0.3 }], ["CTRX"]), region: "全国", seed: 5 });
    const events = runToEnd(s, (st) => {
      if (st.tick % (tps * 24) === 0) step(st, [{ type: "summon", drug: "CTRX", lane: 0 }]);
    });
    void events;
    const row = s.resistance.ecoli!;
    expect(row.CTRX!).toBeGreaterThan(s.startResistance.ecoli!.CTRX!);
    for (const d of ["ABPC", "CEZ", "CFDN_PO", "CFPM"]) expect(row[d]!, d).toBeGreaterThanOrEqual(row.CTRX!);
  });

  it("描画用に、波が片付いたときの変化をイベントで知らせる", () => {
    const s = createGame({ data, stage: stage([{ at: 0, lane: 0, species: "ecoli", count: 2, spacing: 0.5 }]), region: "全国", seed: 2, collectEvents: true });
    const events = runToEnd(s, (st) => {
      if (st.tick % (tps * 8) === 0) step(st, [{ type: "summon", drug: "MEPM", lane: 0 }]);
    });
    const ev = events.find((e) => e.type === "resistanceChanged");
    expect(ev).toMatchObject({ type: "resistanceChanged", cause: "wave", wave: 0 });
    if (ev?.type === "resistanceChanged") expect(ev.changes.some((c) => c.species === "ecoli" && c.drug === "MEPM" && c.to > c.from)).toBe(true);
  });
});

describe("耐性モデル B（耐性ゲージ）", () => {
  const data = withModel("B");

  it("召喚するたびに、系統のゲージに 広さ × 効いている日数 × 誇張係数 がたまる", () => {
    const s = createGame({ data, stage: stage([{ at: 100, lane: 0, species: "ecoli", count: 1, spacing: 0 }]), region: "全国", seed: 1 });
    step(s, [{ type: "summon", drug: "MEPM", lane: 0 }]);
    const mepm = data.drugById.get("MEPM")!;
    expect(s.gauge.carbapenem).toBeCloseTo((data.rules.resistance.exaggeration * breadthOf(s, "MEPM")) / mepm.dosesPerDay, 10);
    // 広いほどたまりやすい
    expect(breadthOf(s, "MEPM")).toBeGreaterThan(breadthOf(s, "CEZ"));
  });

  it("1段を超えると、その系統の薬について、まだ効いている菌の一定割合が耐性になる", () => {
    const s = createGame({ data, stage: stage([{ at: 100, lane: 0, species: "ecoli", count: 1, spacing: 0 }]), region: "全国", seed: 1, collectEvents: true });
    const r0 = cloneTable(s.resistance);
    const { gaugePerStep, risePerStep } = data.rules.resistance.B;
    s.gauge.ceph3 = gaugePerStep - 1e-6;
    const events = step(s, [{ type: "summon", drug: "CTRX", lane: 0 }]);
    for (const d of ["CTRX", "CFDN_PO"]) {
      // 経口第3世代セフェムは連動の下限（CTRX 以上）もかかる
      const expected = Math.max(1 - (1 - r0.ecoli![d]!) * (1 - risePerStep), 1 - (1 - r0.ecoli!.CTRX!) * (1 - risePerStep));
      expect(s.resistance.ecoli![d]!, d).toBeCloseTo(expected, 10);
    }
    // 自然耐性はそのまま、ほかの系統も変わらない
    expect(s.resistance.paeruginosa!.CTRX).toBe(1);
    expect(s.resistance.ecoli!.MEPM).toBeCloseTo(r0.ecoli!.MEPM!, 12);
    expect(events.some((e) => e.type === "resistanceChanged" && e.cause === "gauge" && e.drugClass === "ceph3")).toBe(true);
  });
});

describe("未来ステージへの引き継ぎ", () => {
  const data = withModel("A");
  const start = resistanceTableFor(data, "全国");

  it("変化しなかった値と自然耐性はそのまま、上がった値はさらに上がる", () => {
    const end = cloneTable(start);
    end.ecoli!.LVFX_PO = 0.6;
    const future = selectionModel.carryOver(data, start, end, 5);
    expect(future.ecoli!.LVFX_PO!).toBeGreaterThan(0.6);
    expect(future.ecoli!.CMZ!).toBeCloseTo(start.ecoli!.CMZ!, 12);
    expect(future.paeruginosa!.CTRX).toBe(1);
    // 0 年後なら終わりのまま
    expect(selectionModel.carryOver(data, start, end, 0).ecoli!.LVFX_PO).toBeCloseTo(0.6, 12);
  });

  it("A はオッズの対数で、ステージ1の変化を yearsLater × stagesPerYear 回分延ばす", () => {
    const end = cloneTable(start);
    end.ecoli!.LVFX_PO = 0.6;
    const logit = (r: number) => Math.log(r / (1 - r));
    const m = 5 * data.rules.resistance.carryOver.stagesPerYear;
    const future = selectionModel.carryOver(data, start, end, 5);
    expect(logit(future.ecoli!.LVFX_PO!)).toBeCloseTo(logit(0.6) + m * (logit(0.6) - logit(start.ecoli!.LVFX_PO!)), 8);
  });

  it("B は、まだ効いている割合の対数で延ばす", () => {
    const end = cloneTable(start);
    end.ecoli!.LVFX_PO = 0.6;
    const m = 5 * data.rules.resistance.carryOver.stagesPerYear;
    const future = gaugeModel.carryOver(data, start, end, 5);
    const s0 = 1 - start.ecoli!.LVFX_PO!;
    expect(1 - future.ecoli!.LVFX_PO!).toBeCloseTo(0.4 * Math.pow(0.4 / s0, m), 8);
  });

  it("延ばしたあとも連動の下限がかかる（MEPM が上がれば、CTRX・CMZ・TAZ/PIPC、さらに ABPC なども上がる）", () => {
    const end = cloneTable(start);
    end.ecoli!.MEPM = 0.05;
    const future = selectionModel.carryOver(data, start, end, 5);
    const row = future.ecoli!;
    for (const d of ["CTRX", "CMZ", "TAZPIPC", "ABPC", "CEZ", "CFDN_PO", "CFPM"]) expect(row[d]!, d).toBeGreaterThanOrEqual(row.MEPM!);
    // LVFX と AMK は連動させない
    expect(row.LVFX_PO).toBeCloseTo(start.ecoli!.LVFX_PO!, 12);
    expect(row.AMK).toBeCloseTo(start.ecoli!.AMK!, 12);
  });
});

describe("CRE の連動（個体の耐性の決め方）", () => {
  // MEPM の耐性率を 30% にした大腸菌を 4000 匹出す
  const t = resistanceTableFor(base, "全国");
  t.ecoli!.MEPM = 0.3;
  const s = createGame({
    data: base,
    stage: stage([{ at: 0, lane: 0, species: "ecoli", count: 4000, spacing: 0 }], ["CTRX", "CMZ", "TAZPIPC", "MEPM", "LVFX_PO", "AMK"]),
    region: "全国",
    seed: 11,
    resistance: t,
  });
  step(s);
  const bugs = s.bacteria;
  const table = s.startResistance.ecoli!;
  const rate = (drug: string) => bugs.filter((b) => b.resistant.has(drug)).length / bugs.length;

  it("MEPM に耐性の個体は、ほかの β-ラクタム系すべてに耐性", () => {
    const cre = bugs.filter((b) => b.resistant.has("MEPM"));
    expect(cre.length).toBeGreaterThan(1000);
    for (const b of cre) for (const d of ["CTRX", "CMZ", "TAZPIPC", "ABPC", "CEZ", "CFDN_PO", "CFPM"]) expect(b.resistant.has(d)).toBe(true);
  });

  it("LVFX と AMK は連動させない（MEPM に耐性でも、効く個体が多い）", () => {
    const cre = bugs.filter((b) => b.resistant.has("MEPM"));
    expect(cre.filter((b) => !b.resistant.has("AMK")).length / cre.length).toBeGreaterThan(0.9);
    expect(cre.filter((b) => !b.resistant.has("LVFX_PO")).length / cre.length).toBeGreaterThan(0.4);
  });

  it("連動させても、薬ごとの全体の耐性率は表の値のまま（±3%）", () => {
    for (const d of ["MEPM", "CTRX", "CMZ", "TAZPIPC", "ABPC", "CEZ", "CFDN_PO", "CFPM", "LVFX_PO"]) expect(Math.abs(rate(d) - table[d]!), d).toBeLessThan(0.03);
  });

  it("手札のどの薬にも耐性の個体を数える", () => {
    const pan = bugs.filter((b) => s.stage.hand.every((h) => b.resistant.has(h.drug))).length;
    expect(s.stats.panResistant).toBe(pan);
  });
});

describe("ボットの基準（SPEC.md 5.4 の目安。耐性モデル A・B とも）", () => {
  const runs = 20;
  for (const model of ["A", "B"] as const) {
    it(`モデル ${model}：適正ボットは未来も勝ち、乱用ボットは未来で負ける`, () => {
      const data = withModel(model);
      let apFuture = 0;
      let brPresent = 0;
      let brFuture = 0;
      for (let i = 0; i < runs; i++) {
        const ap = runScenario({ data, scenario, seed: 200 + i, bot: appropriateBot() });
        const br = runScenario({ data, scenario, seed: 200 + i, bot: broadBot() });
        apFuture += ap.future.outcome === "won" ? 1 : 0;
        brPresent += br.present.outcome === "won" ? 1 : 0;
        brFuture += br.future.outcome === "won" ? 1 : 0;
      }
      expect(apFuture / runs).toBeGreaterThanOrEqual(0.8);
      expect(brPresent / runs).toBeGreaterThanOrEqual(0.7);
      expect(brFuture / runs).toBeLessThanOrEqual(0.3);
    });
  }
});
