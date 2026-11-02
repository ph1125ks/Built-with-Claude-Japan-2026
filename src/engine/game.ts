// ゲームの本体。1ティックずつ進める。描画はこの状態とイベントを読むだけにする。
import { costPerDose } from "./cost.ts";
import { bacteriumOf, drugOf } from "./data.ts";
import { getResistanceModel, type ResistanceModel } from "./resistance.ts";
import { createRng, type Rng } from "./rng.ts";
import { validateStage } from "./scenario.ts";
import { applyLinkageFloor, cloneTable, resistanceTableFor, urineWeights } from "./susceptibility.ts";
import type {
  Bacterium,
  Command,
  GameData,
  GameEvent,
  GameStats,
  Outcome,
  RejectReason,
  ResistanceTable,
  RevealLevel,
  SpawnPlan,
  StageDef,
  Unit,
} from "./types.ts";

export interface GameOptions {
  data: GameData;
  stage: StageDef;
  region: string;
  seed: number;
  /** 開始時の耐性率。省略すると地域のデータから作る（未来ステージでは引き継いだ表を渡す） */
  resistance?: ResistanceTable;
  model?: ResistanceModel;
  /** 描画用のイベントを集めるか（シミュレーションでは集めない） */
  collectEvents?: boolean;
}

export interface GameState {
  data: GameData;
  stage: StageDef;
  region: string;
  rng: Rng;
  model: ResistanceModel;
  tick: number;
  outcome: Outcome;
  budget: number;
  bladderHp: number;
  bacteria: Bacterium[];
  units: Unit[];
  spawnPlan: SpawnPlan[];
  spawnIndex: number;
  /** 波ごとの、まだ片付いていない菌の数 */
  waveRemaining: number[];
  waveResolved: Bacterium[][];
  /** 薬 → 残りの召喚回数（null は上限なし） */
  stock: Map<string, number | null>;
  /** "薬:レーン" → 次に召喚できるティック */
  readyAt: Map<string, number>;
  resistance: ResistanceTable;
  startResistance: ResistanceTable;
  stats: GameStats;
  collectEvents: boolean;
  nextUid: number;
}

const NO_EVENTS: GameEvent[] = [];

export function ticksPerSecond(data: GameData): number {
  return data.rules.time.ticksPerSecond;
}

/** 投与間隔をティックにしたもの（＝召喚の待ち時間＝1回の投与が効いている長さ） */
export function intervalTicks(data: GameData, drugId: string): number {
  const { ticksPerSecond, secondsPerGameDay } = data.rules.time;
  return Math.round((secondsPerGameDay / drugOf(data, drugId).dosesPerDay) * ticksPerSecond);
}

export function revealLevelAt(data: GameData, x: number): RevealLevel {
  const { laneLength, revealSpeciesBelow, revealSusceptibilityBelow } = data.rules.board;
  const f = x / laneLength;
  if (f < revealSusceptibilityBelow) return "susceptibility";
  if (f < revealSpeciesBelow) return "species";
  return "gram";
}

const LEVEL_ORDER: Record<RevealLevel, number> = { gram: 0, species: 1, susceptibility: 2 };

function emptyStats(): GameStats {
  return { summons: {}, activeTicks: {}, kills: {}, costSpent: 0, spawned: 0, leaked: 0 };
}

function inc(rec: Record<string, number>, key: string, by = 1): void {
  rec[key] = (rec[key] ?? 0) + by;
}

export function createGame(opts: GameOptions): GameState {
  const { data, stage, region, seed } = opts;
  const errors = validateStage(data, stage);
  if (errors.length) throw new Error(`ステージの誤り：\n${errors.join("\n")}`);
  const rng = createRng(seed);
  const tps = ticksPerSecond(data);
  const resistance = applyLinkageFloor(data, cloneTable(opts.resistance ?? resistanceTableFor(data, region)));

  // 敵の出現予定を最初に決める（同じ種なら毎回同じ）
  const auto = stage.waves.some((w) => w.species === "auto") ? urineWeights(data, region) : null;
  const plan: SpawnPlan[] = [];
  stage.waves.forEach((w, wave) => {
    for (let i = 0; i < w.count; i++) {
      plan.push({
        tick: Math.round((w.at + i * w.spacing) * tps),
        lane: w.lane === "random" ? rng.int(data.rules.board.lanes) : w.lane,
        species: w.species === "auto" ? rng.weighted(auto!.species, auto!.weights) : w.species,
        wave,
      });
    }
  });
  plan.sort((a, b) => a.tick - b.tick || a.wave - b.wave);

  return {
    data,
    stage,
    region,
    rng,
    model: opts.model ?? getResistanceModel(data.rules.resistance.model),
    tick: 0,
    outcome: "playing",
    budget: stage.budget,
    bladderHp: stage.bladderHp,
    bacteria: [],
    units: [],
    spawnPlan: plan,
    spawnIndex: 0,
    waveRemaining: stage.waves.map((w) => w.count),
    waveResolved: stage.waves.map(() => []),
    stock: new Map(stage.hand.map((h) => [h.drug, h.stock ?? null])),
    readyAt: new Map(),
    resistance,
    startResistance: cloneTable(resistance),
    stats: emptyStats(),
    collectEvents: opts.collectEvents ?? false,
    nextUid: 1,
  };
}

/** 召喚できるか。できないときは理由を返す */
export function canSummon(state: GameState, drug: string, lane: number): RejectReason | null {
  if (state.outcome !== "playing") return "ended";
  if (!Number.isInteger(lane) || lane < 0 || lane >= state.data.rules.board.lanes) return "badLane";
  if (!state.stock.has(drug)) return "notInHand";
  if (state.stock.get(drug) === 0) return "noStock";
  if ((state.readyAt.get(`${drug}:${lane}`) ?? 0) > state.tick) return "cooldown";
  if (state.units.filter((u) => u.lane === lane).length >= state.data.rules.board.maxUnitsPerLane) return "laneFull";
  if (costPerDose(state.data, drug) > state.budget + 1e-9) return "budget";
  return null;
}

function summon(state: GameState, cmd: Command, events: GameEvent[]): void {
  const reason = canSummon(state, cmd.drug, cmd.lane);
  if (reason) {
    if (state.collectEvents) events.push({ type: "rejected", drug: cmd.drug, lane: cmd.lane, reason });
    return;
  }
  const { data } = state;
  const drug = drugOf(data, cmd.drug);
  const full = data.rules.units.fullHp;
  const interval = intervalTicks(data, drug.id);
  const cost = costPerDose(data, drug.id);
  const unit: Unit = {
    uid: state.nextUid++,
    drug: drug.id,
    lane: cmd.lane,
    // 内服は吸収率のぶん削れた状態で出る
    hp: full * (drug.bioavailability ?? 1),
    // 投与間隔の長さで 0 になる速さで減る
    decayPerTick: full / interval,
    bornTick: state.tick,
  };
  state.units.push(unit);
  state.budget -= cost;
  const stock = state.stock.get(drug.id);
  if (stock !== null && stock !== undefined) state.stock.set(drug.id, stock - 1);
  state.readyAt.set(`${drug.id}:${cmd.lane}`, state.tick + interval);
  state.stats.costSpent += cost;
  inc(state.stats.summons, drug.id);
  if (state.collectEvents) events.push({ type: "summon", unit: unit.uid, drug: drug.id, lane: cmd.lane, cost, hp: unit.hp });
}

function spawn(state: GameState, p: SpawnPlan, events: GameEvent[]): void {
  const { data, rng } = state;
  const def = bacteriumOf(data, p.species);
  const row = state.resistance[p.species] ?? {};
  const resistant = new Set<string>();
  // 個体ごとに、薬ごとの感受性・耐性を決める（いまの耐性率に従う。自然耐性は確率 1）
  const links = data.rules.linkedResistance.filter((l) => l.bacteria.includes(p.species));
  const dependent = new Set(links.flatMap((l) => l.alsoResistant));
  for (const d of data.drugs) if (!dependent.has(d.id) && rng.next() < (row[d.id] ?? 1)) resistant.add(d.id);
  // 連動（例：ESBL）。trigger に耐性なら必ず耐性。そうでなければ、全体の耐性率が表の値になるように
  // 条件付きの確率 (r_d − r_t) / (1 − r_t) で決める（表は applyLinkageFloor で r_d ≥ r_t にしてある）
  for (const link of links) {
    const rt = row[link.trigger] ?? 0;
    for (const d of link.alsoResistant) {
      const rd = row[d] ?? 1;
      const q = resistant.has(link.trigger) || rt >= 1 ? 1 : Math.max(0, (rd - rt) / (1 - rt));
      if (rng.next() < q) resistant.add(d);
    }
  }
  const x = data.rules.board.laneLength;
  const b: Bacterium = {
    uid: state.nextUid++,
    species: p.species,
    lane: p.lane,
    x,
    hp: def.hp,
    maxHp: def.hp,
    wave: p.wave,
    resistant,
    level: revealLevelAt(data, x),
    met: new Set(),
    exposure: {},
  };
  state.bacteria.push(b);
  state.stats.spawned++;
  if (state.collectEvents) events.push({ type: "spawn", uid: b.uid, species: b.species, lane: b.lane });
}

function resolve(state: GameState, b: Bacterium, events: GameEvent[]): void {
  const w = b.wave;
  state.waveResolved[w]?.push(b);
  state.waveRemaining[w] = (state.waveRemaining[w] ?? 1) - 1;
  if (state.waveRemaining[w] === 0) {
    const resolved = state.waveResolved[w] ?? [];
    state.model.onWaveCleared(state, w, resolved);
    state.waveResolved[w] = [];
    if (state.collectEvents) events.push({ type: "waveCleared", wave: w });
  }
}

/** 1ティック進める。返り値はこのティックのイベント（collectEvents が false なら空） */
export function step(state: GameState, commands: readonly Command[] = []): GameEvent[] {
  if (state.outcome !== "playing") return NO_EVENTS;
  const events: GameEvent[] = state.collectEvents ? [] : NO_EVENTS;
  const { data } = state;
  const { rules } = data;
  const tps = rules.time.ticksPerSecond;

  // 1. 召喚
  for (const c of commands) summon(state, c, events);

  // 2. 出現
  while (state.spawnIndex < state.spawnPlan.length) {
    const p = state.spawnPlan[state.spawnIndex]!;
    if (p.tick > state.tick) break;
    spawn(state, p, events);
    state.spawnIndex++;
  }

  // 3. 抗菌薬の効果（同じレーンの菌すべてに効く。耐性の個体には効かない）
  const full = rules.units.fullHp;
  for (const u of state.units) {
    const drug = drugOf(data, u.drug);
    const dmg = (rules.units.power * (u.hp / full) * drug.urineFactor) / tps;
    for (const b of state.bacteria) {
      if (b.lane !== u.lane || b.hp <= 0) continue;
      b.exposure[u.drug] = (b.exposure[u.drug] ?? 0) + 1;
      if (b.resistant.has(u.drug)) {
        if (!b.met.has(u.drug)) {
          b.met.add(u.drug);
          if (state.collectEvents) {
            const intrinsic = bacteriumOf(data, b.species).intrinsicResistance.includes(u.drug);
            events.push({ type: "resisted", uid: b.uid, drug: u.drug, intrinsic });
          }
        }
        continue;
      }
      b.hp -= dmg;
      if (b.hp <= 0) {
        inc(state.stats.kills, u.drug);
        if (state.collectEvents) events.push({ type: "killed", uid: b.uid, drug: u.drug });
      }
    }
  }
  if (state.bacteria.some((b) => b.hp <= 0)) {
    const alive: Bacterium[] = [];
    for (const b of state.bacteria) {
      if (b.hp > 0) alive.push(b);
      else resolve(state, b, events);
    }
    state.bacteria = alive;
  }

  // 4. 抗菌薬の量が減る（投与間隔の長さで 0 になる）
  const remaining: Unit[] = [];
  for (const u of state.units) {
    inc(state.stats.activeTicks, u.drug);
    u.hp -= u.decayPerTick;
    if (u.hp > 1e-9) remaining.push(u);
    else if (state.collectEvents) events.push({ type: "expired", unit: u.uid });
  }
  state.units = remaining;

  // 5. 菌が進む。近づくほど情報が分かる。膀胱に着いたら耐久を削る
  const stillAlive: Bacterium[] = [];
  for (const b of state.bacteria) {
    b.x -= bacteriumOf(data, b.species).speed / tps;
    const level = revealLevelAt(data, Math.max(b.x, 0));
    if (LEVEL_ORDER[level] > LEVEL_ORDER[b.level]) {
      b.level = level;
      if (state.collectEvents) events.push({ type: "reveal", uid: b.uid, level });
    }
    if (b.x <= 0) {
      const damage = bacteriumOf(data, b.species).bladderDamage;
      state.bladderHp = Math.max(0, state.bladderHp - damage);
      state.stats.leaked++;
      if (state.collectEvents) events.push({ type: "leaked", uid: b.uid, damage });
      resolve(state, b, events);
    } else {
      stillAlive.push(b);
    }
  }
  state.bacteria = stillAlive;

  // 6. 勝敗
  if (state.bladderHp <= 0) state.outcome = "lost";
  else if (state.spawnIndex >= state.spawnPlan.length && state.bacteria.length === 0) state.outcome = "won";
  if (state.outcome !== "playing" && state.collectEvents) events.push({ type: "end", outcome: state.outcome });

  state.tick++;
  return events;
}
