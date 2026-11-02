// 耐性化のモデル。A（選択圧の再現）と B（耐性ゲージ）を作って比べ、11/5 に一つに決める（SPEC.md 4.7）。
// どちらも state.resistance（菌 → 薬 → 効かない確率）を書き換えるだけ。連動の下限（ESBL・CRE）は
// エンジンがモデルを呼んだあとにかけ直す（game.ts の withModel）。係数はすべて data/rules.json の resistance。
import { drugOf } from "./data.ts";
import type { GameState } from "./game.ts";
import { applyLinkageFloor, cloneTable, urineWeights } from "./susceptibility.ts";
import type { Bacterium, GameData, ResistanceModelId, ResistanceTable } from "./types.ts";

export interface ResistanceModel {
  id: ResistanceModelId;
  /** 召喚したときに呼ぶ（B がゲージをためる） */
  onSummon?(state: GameState, drug: string): void;
  /** 波の菌がすべて片付いたときに呼ぶ。resolved はその波の菌（倒れた・膀胱に着いた） */
  onWaveCleared(state: GameState, wave: number, resolved: Bacterium[]): void;
  /**
   * ステージ1の開始時と終わりの表から、未来ステージの開始時の表を作る。
   * 「ステージ1と同じ使い方が未来の年（既定は2050年）まで続いた」とみなし、ステージ1での変化をモデルの伸び方のまま先へ延ばす（上限つき）
   */
  carryOver(data: GameData, start: ResistanceTable, end: ResistanceTable, yearsLater: number): ResistanceTable;
}

const EPS = 1e-6;
const clamp01 = (x: number) => Math.min(1 - EPS, Math.max(EPS, x));
const logit = (r: number) => {
  const x = clamp01(r);
  return Math.log(x / (1 - x));
};
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** 未来へ延ばす回数（ステージ1の何回分か）。速さはモデルごとに決めている（rules.json の carryOver） */
function repeats(data: GameData, yearsLater: number, model: "A" | "B"): number {
  return Math.max(0, yearsLater) * data.rules.resistance.carryOver.stagesPerYear[model];
}

/** 未来ステージの年（例：2025 ＋ 25 ＝ 2050） */
export function futureYear(data: GameData, yearsLater: number): number {
  return data.rules.resistance.carryOver.dataYear + yearsLater;
}

/**
 * 表の各値を、開始時 → 終わりの変化を「空間」の中でまっすぐ延ばす。
 * 自然耐性など 100% のものと、変化しなかったものはそのまま。
 * 上限（carryOver.maxLogitPerYear）：1年あたりの上がり方を、オッズの対数で「公的な実測でいちばん速く上がった組の傾き
 * × ゲーム用の誇張の倍率」までに抑える
 */
function extrapolate(
  data: GameData,
  model: "A" | "B",
  start: ResistanceTable,
  end: ResistanceTable,
  yearsLater: number,
  forward: (r: number) => number,
  back: (z: number) => number,
  startValue: (r: number) => number = (r) => r,
): ResistanceTable {
  const m = repeats(data, yearsLater, model);
  const { observed, exaggeration } = data.rules.resistance.carryOver.maxLogitPerYear;
  const maxLogit = Math.max(0, yearsLater) * observed * exaggeration;
  const out = cloneTable(end);
  for (const [sp, row] of Object.entries(out)) {
    for (const [d, r1] of Object.entries(row)) {
      const r0 = start[sp]?.[d] ?? r1;
      if (r1 >= 1 || r1 <= r0) continue;
      const z1 = forward(r1);
      const z0 = forward(startValue(r0));
      const extrapolated = Math.min(1, Math.max(r1, back(z1 + m * (z1 - z0))));
      // 上限：1年あたりの上がり方は、オッズの対数で maxLogitPerYear まで（どのモデルでも同じ物差しで比べる）
      row[d] = Math.min(extrapolated, sigmoid(logit(r1) + maxLogit));
    }
  }
  return applyLinkageFloor(data, out);
}

/**
 * 系統の偏りの倍率。ステージのこれまでの使用日数のうち、その系統が占める割合が referenceShare を超えると 1 より大きく、
 * 下回ると 1 より小さくなる。考え方は AHI（抗菌薬選択圧指数：系統を偏らせずに使う）にならう（rules.json の balance）
 */
export function balanceFactor(state: GameState, drugClass: string): number {
  const { referenceShare, exponent, minFactor, maxFactor, minDays } = state.data.rules.resistance.balance;
  if (!(exponent > 0)) return 1;
  const ticksPerDay = state.data.rules.time.ticksPerSecond * state.data.rules.time.secondsPerGameDay;
  let total = 0;
  let mine = 0;
  for (const [drug, ticks] of Object.entries(state.stats.activeTicks)) {
    total += ticks;
    if (drugOf(state.data, drug).class === drugClass) mine += ticks;
  }
  if (total <= 0 || total < minDays * ticksPerDay) return 1;
  const f = Math.pow(mine / total / referenceShare, exponent);
  return Math.min(maxFactor, Math.max(minFactor, f));
}

/** 耐性化しない（比較の基準。エンジンの確認用） */
export const noResistanceModel: ResistanceModel = {
  id: "none",
  onWaveCleared() {},
  carryOver(_data, _start, end) {
    return cloneTable(end);
  },
};

/**
 * A：選択圧の再現。
 * 波が片付くたびに、その波の菌について、薬ごとに「さらされた量」（波の中のその菌のうち、その薬に
 * さらされた割合。短い時間なら割合で数える）を出し、耐性のオッズの対数（logit）を
 * 誇張係数 × logitPerWave × さらされた量 だけ上げる。
 * 耐性の個体が少ないうちは生き残る耐性菌も少ないのでゆっくり増え、多くなると速く増える（S 字）。
 * 同じ薬に偏るほど、その薬の耐性率が早く上がる。広域薬は多くの菌種がさらされるので、多くの菌種で上がる
 */
export const selectionModel: ResistanceModel = {
  id: "A",
  onWaveCleared(state, _wave, resolved) {
    const { data } = state;
    const { exaggeration, A } = data.rules.resistance;
    const fullTicks = Math.max(1, A.fullExposureSeconds * data.rules.time.ticksPerSecond);
    const bySpecies = new Map<string, Bacterium[]>();
    for (const b of resolved) {
      const list = bySpecies.get(b.species);
      if (list) list.push(b);
      else bySpecies.set(b.species, [b]);
    }
    for (const [sp, bugs] of bySpecies) {
      const row = state.resistance[sp];
      if (!row) continue;
      for (const d of data.drugs) {
        const r = row[d.id] ?? 1;
        if (r >= 1) continue; // 自然耐性・効かない扱い
        let exposed = 0;
        for (const b of bugs) exposed += Math.min(1, (b.exposure[d.id] ?? 0) / fullTicks);
        if (exposed <= 0) continue;
        const shift = exaggeration * A.logitPerWave * (exposed / bugs.length) * balanceFactor(state, d.class);
        row[d.id] = sigmoid(logit(Math.max(r, A.minRate)) + shift);
      }
    }
  },
  carryOver(data, start, end, yearsLater) {
    const minRate = data.rules.resistance.A.minRate;
    return extrapolate(data, "A", start, end, yearsLater, logit, sigmoid, (r) => Math.max(r, minRate));
  },
};

/** 薬の広さ：尿から出る菌全体（分離割合で重み付け）に、ステージ開始時に効く見込み（カバー率） */
export function breadthOf(state: GameState, drug: string): number {
  const { species, weights } = urineWeights(state.data, state.region);
  let sum = 0;
  let wsum = 0;
  species.forEach((sp, i) => {
    const w = weights[i] ?? 0;
    sum += w * (1 - (state.startResistance[sp]?.[drug] ?? 1));
    wsum += w;
  });
  return wsum > 0 ? sum / wsum : 0;
}

/**
 * B：耐性ゲージ。
 * 系統ごとにゲージを持つ。召喚するたびに「広さ（カバー率）× 1回の投与が効いている日数 × 誇張係数」がたまる。
 * ゲージが1段（gaugePerStep）を超えるたびに、その系統の薬について、まだ効いている菌の
 * risePerStep の割合を耐性にする（自然耐性の菌はもともと 100%）
 */
export const gaugeModel: ResistanceModel = {
  id: "B",
  onSummon(state, drugId) {
    const { data } = state;
    const { exaggeration, B } = data.rules.resistance;
    const drug = drugOf(data, drugId);
    const before = state.gauge[drug.class] ?? 0;
    const after = before + ((exaggeration * breadthOf(state, drugId)) / drug.dosesPerDay) * balanceFactor(state, drug.class);
    state.gauge[drug.class] = after;
    const steps = Math.floor(after / B.gaugePerStep) - Math.floor(before / B.gaugePerStep);
    if (steps <= 0) return;
    const keep = Math.pow(1 - B.risePerStep, steps);
    const sameClass = data.drugs.filter((d) => d.class === drug.class).map((d) => d.id);
    for (const row of Object.values(state.resistance)) {
      for (const d of sameClass) {
        const r = row[d] ?? 1;
        if (r < 1) row[d] = 1 - (1 - r) * keep;
      }
    }
  },
  onWaveCleared() {},
  carryOver(data, start, end, yearsLater) {
    // まだ効いている割合（1 − 耐性率）の対数で延ばす（ゲージ1段ごとに同じ割合ずつ減る、の続き）
    return extrapolate(
      data,
      "B",
      start,
      end,
      yearsLater,
      (r) => Math.log(1 - clamp01(r)),
      (z) => 1 - Math.exp(z),
    );
  },
};

export function getResistanceModel(id: ResistanceModelId): ResistanceModel {
  switch (id) {
    case "none":
      return noResistanceModel;
    case "A":
      return selectionModel;
    case "B":
      return gaugeModel;
  }
}

/** 2つの表の違い（変化した組だけ） */
export function diffTables(before: ResistanceTable, after: ResistanceTable): { species: string; drug: string; from: number; to: number }[] {
  const out: { species: string; drug: string; from: number; to: number }[] = [];
  for (const [sp, row] of Object.entries(after)) {
    for (const [d, to] of Object.entries(row)) {
      const from = before[sp]?.[d] ?? to;
      if (Math.abs(to - from) > 1e-9) out.push({ species: sp, drug: d, from, to });
    }
  }
  return out;
}
