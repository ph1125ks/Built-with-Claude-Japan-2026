import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  appropriateBot,
  balanceFactor,
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

  it("代用の組（内服 AMPC と ABPC など）は、どちらにさらされても同じだけ上がる（代用している菌だけ。2026-11-03 作者の判断）", () => {
    const s = createGame({
      data,
      stage: stage([{ at: 0, lane: 0, species: "ecoli", count: 3, spacing: 0.5 }], ["AMPC_PO", "ABPC", "CEX_PO", "CEZ", "CTX", "CFDN_PO"]),
      region: "全国",
      seed: 3,
    });
    const before = cloneTable(s.resistance);
    expect(before.ecoli!.AMPC_PO).toBeCloseTo(before.ecoli!.ABPC!, 12);
    runToEnd(s, (st) => {
      if (st.tick % (tps * 8) === 0) step(st, [{ type: "summon", drug: "AMPC_PO", lane: 0 }]);
    });
    // AMPC だけを使っても、ABPC も同じだけ上がる
    expect(s.resistance.ecoli!.AMPC_PO!).toBeGreaterThan(before.ecoli!.AMPC_PO!);
    expect(s.resistance.ecoli!.ABPC!).toBeCloseTo(s.resistance.ecoli!.AMPC_PO!, 12);
    // ほかの組は変わらない
    for (const d of ["CEZ", "CEX_PO", "CTX", "CFDN_PO"]) expect(s.resistance.ecoli![d], d).toBeCloseTo(before.ecoli![d]!, 12);
  });

  it("代用の組は、susceptibility.proxies で代用している組でなければ読み込みで止まる", () => {
    const bad = { ...base.rules.resistance, A: { ...base.rules.resistance.A, sharedSelection: [{ drugs: ["ABPC", "AMPC_PO"] as [string, string], bacteria: ["kpneumoniae"] }] } };
    expect(() => loadGameData({ rules: { resistance: bad } })).toThrow(/代用の組/);
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

  // 式の確かめは、上限（carryOver.ceiling）にかからない小さな変化と短い年数で行う
  it("A はオッズの対数で、ステージ1の変化を yearsLater × stagesPerYear 回分延ばす", () => {
    const end = cloneTable(start);
    end.ecoli!.LVFX_PO = 0.5;
    const logit = (r: number) => Math.log(r / (1 - r));
    const m = 2 * data.rules.resistance.carryOver.stagesPerYear.A;
    const future = selectionModel.carryOver(data, start, end, 2);
    expect(logit(future.ecoli!.LVFX_PO!)).toBeCloseTo(logit(0.5) + m * (logit(0.5) - logit(start.ecoli!.LVFX_PO!)), 8);
  });

  it("B は、まだ効いている割合の対数で延ばす", () => {
    const end = cloneTable(start);
    end.ecoli!.LVFX_PO = 0.45;
    const m = 1 * data.rules.resistance.carryOver.stagesPerYear.B;
    const future = gaugeModel.carryOver(data, start, end, 1);
    const s0 = 1 - start.ecoli!.LVFX_PO!;
    expect(1 - future.ecoli!.LVFX_PO!).toBeCloseTo(0.55 * Math.pow(0.55 / s0, m), 8);
  });

  it("上限：1年あたりの上がり方は、オッズの対数で「実測でいちばん速い傾き × 誇張の倍率」まで（どのモデルでも）", () => {
    const { observed, exaggeration } = data.rules.resistance.carryOver.maxLogitPerYear;
    const logit = (r: number) => Math.log(r / (1 - r));
    const end = cloneTable(start);
    end.ecoli!.LVFX_PO = 0.95; // とても大きく上がった組（上限がなければ数年でほぼ 100% になる。A の延ばし方を 0.1 にした 2026-11-04 からは、5年でも上限に届く大きさにしている）
    for (const model of [selectionModel, gaugeModel]) {
      for (const years of [5, 10, 25]) {
        const r = model.carryOver(data, start, end, years).ecoli!.LVFX_PO!;
        expect(logit(r) - logit(0.95), `${model.id} ${years}年`).toBeCloseTo(years * observed * exaggeration, 6);
      }
    }
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

  it("使わなかった薬：実測で下がっていた組に限り、その組の傾きで下がる（実測で上がった組・使った薬は下げない）", () => {
    const logit = (r: number) => Math.log(r / (1 - r));
    const { logitPerYear } = data.rules.resistance.carryOver.declineWhenUnused;
    const end = cloneTable(start);
    for (const model of [selectionModel, gaugeModel]) {
      const f = model.carryOver(data, start, end, 25, new Set(["AMK"]));
      // 緑膿菌の MEPM：使っていない・実測で下がった → 傾き × 25年
      expect(logit(f.paeruginosa!.MEPM!) - logit(start.paeruginosa!.MEPM!), model.id).toBeCloseTo(25 * logitPerYear.paeruginosa!.MEPM!, 6);
      // 緑膿菌の AMK：実測で下がったが、使った → 下げない
      expect(f.paeruginosa!.AMK, model.id).toBeCloseTo(start.paeruginosa!.AMK!, 12);
      // 大腸菌の LVFX：実測で上がった → 下げない
      expect(f.ecoli!.LVFX_PO, model.id).toBeCloseTo(start.ecoli!.LVFX_PO!, 12);
      // 自然耐性はそのまま
      expect(f.paeruginosa!.CTRX, model.id).toBe(1);
      // used を渡さなければ下げない（ステージ1の中の表などに使う）
      expect(model.carryOver(data, start, end, 25).paeruginosa!.MEPM, model.id).toBeCloseTo(start.paeruginosa!.MEPM!, 12);
    }
  });

  it("使わなかった薬でも、ステージ1の中で上がった組は下げずに延ばす", () => {
    const end = cloneTable(start);
    end.paeruginosa!.LVFX_PO = start.paeruginosa!.LVFX_PO! + 0.05;
    const f = selectionModel.carryOver(data, start, end, 25, new Set());
    expect(f.paeruginosa!.LVFX_PO!).toBeGreaterThan(end.paeruginosa!.LVFX_PO!);
  });

  it("下がり方の上限：どの組も、実測でいちばん速く下がった組より速くは下げない", () => {
    const { logitPerYear, maxLogitPerYear } = data.rules.resistance.carryOver.declineWhenUnused;
    const all = Object.values(logitPerYear).flatMap((row) => Object.values(row));
    expect(all.length).toBeGreaterThan(0);
    for (const v of all) expect(-v).toBeLessThanOrEqual(maxLogitPerYear + 1e-12);
    expect(Math.max(...all.map((v) => -v))).toBeCloseTo(maxLogitPerYear, 12);
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

  it("MEPM に耐性の個体は、ほかの β-ラクタム系すべてに耐性（IPM/CS を含む：作者の決定 2026-11-03）", () => {
    const cre = bugs.filter((b) => b.resistant.has("MEPM"));
    expect(cre.length).toBeGreaterThan(1000);
    for (const b of cre)
      for (const d of ["IPMCS", "CTRX", "CMZ", "TAZPIPC", "ABPC", "AMPC_PO", "CEZ", "CEX_PO", "CTX", "CAZ", "CFDN_PO", "CFPM"]) expect(b.resistant.has(d), d).toBe(true);
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

describe("系統の偏りの倍率（AHI の考え方）", () => {
  const data = withModel("A");
  const s = createGame({ data, stage: stage([{ at: 100, lane: 0, species: "ecoli", count: 1, spacing: 0 }], ["CMZ", "CTRX", "MEPM", "LVFX_PO"]), region: "全国", seed: 1 });
  const { referenceShare, exponent, minFactor, maxFactor } = data.rules.resistance.balance;

  it("まだ何も使っていなければ 1", () => {
    expect(balanceFactor(s, "cephamycin")).toBe(1);
  });

  it("使用日数の合計が minDays に届くまでは 1（最初の波だけで倍率が上がらない）", () => {
    s.stats.activeTicks = { CMZ: 10 };
    expect(balanceFactor(s, "cephamycin")).toBe(1);
  });

  it("基準の割合を超えて使った系統は強まり、あまり使っていない系統は弱まる（上限・下限つき）", () => {
    // 合計を minDays より多くする（1日 ＝ 毎秒のティック数 × 1日の秒数）
    const day = data.rules.time.ticksPerSecond * data.rules.time.secondsPerGameDay;
    s.stats.activeTicks = { CMZ: 6 * day, CTRX: 2 * day, MEPM: 2 * day };
    const expected = (share: number) => Math.min(maxFactor, Math.max(minFactor, Math.pow(share / referenceShare, exponent)));
    expect(balanceFactor(s, "cephamycin")).toBeCloseTo(expected(0.6), 10);
    expect(balanceFactor(s, "ceph3")).toBeCloseTo(expected(0.2), 10);
    expect(balanceFactor(s, "cephamycin")).toBeGreaterThan(1);
    expect(balanceFactor(s, "ceph3")).toBeLessThan(1);
    // 使っていない系統は下限
    expect(balanceFactor(s, "fluoroquinolone")).toBe(minFactor);
  });
});

describe("菌を混ぜる波（{ mix }）", () => {
  it("重みのとおりに菌が出る（検査も通る）", () => {
    const st = stage([{ at: 0, lane: 0, species: { mix: { ecoli: 3, efaecalis: 1 } }, count: 4000, spacing: 0 }]);
    const g = createGame({ data: base, stage: st, region: "全国", seed: 9 });
    const ecoli = g.spawnPlan.filter((p) => p.species === "ecoli").length / g.spawnPlan.length;
    expect(Math.abs(ecoli - 0.75)).toBeLessThan(0.03);
    expect(g.spawnPlan.every((p) => p.species === "ecoli" || p.species === "efaecalis")).toBe(true);
  });
});
