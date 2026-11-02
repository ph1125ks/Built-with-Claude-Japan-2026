// プレイヤー（人・ボット）から見える情報。まだ明らかになっていない情報は入れない。
import { costPerDose } from "./cost.ts";
import { canSummon, type GameState } from "./game.ts";
import { bacteriumOf } from "./data.ts";
import type { Arrangement, Gram, Outcome, RevealLevel, Shape } from "./types.ts";

export interface ObservedBacterium {
  uid: number;
  lane: number;
  x: number;
  level: RevealLevel;
  /** グラム染色で分かること（いつでも見える） */
  gram: Gram;
  shape: Shape;
  arrangement: Arrangement;
  /** 菌名（level が species 以上のとき） */
  species?: string;
  /** 手札の中で、この個体に効かない薬（level が susceptibility のとき） */
  resistantInHand?: string[];
  hpFraction: number;
}

export interface ObservedCard {
  drug: string;
  stock: number | null;
  cost: number;
  /** レーンごとに、いま召喚できるか */
  usable: boolean[];
}

export interface ObservedUnit {
  uid: number;
  drug: string;
  lane: number;
  /** 満量に対する、いまの薬の量 */
  hpFraction: number;
}

export interface Observation {
  tick: number;
  budget: number;
  bladderHp: number;
  bladderMaxHp: number;
  lanes: number;
  outcome: Outcome;
  bacteria: ObservedBacterium[];
  hand: ObservedCard[];
  units: ObservedUnit[];
}

export function observe(state: GameState): Observation {
  const { data } = state;
  const lanes = data.rules.board.lanes;
  const handDrugs = state.stage.hand.map((h) => h.drug);
  return {
    tick: state.tick,
    budget: state.budget,
    bladderHp: state.bladderHp,
    bladderMaxHp: state.stage.bladderHp,
    lanes,
    outcome: state.outcome,
    bacteria: state.bacteria.map((b) => {
      const def = bacteriumOf(data, b.species);
      const o: ObservedBacterium = {
        uid: b.uid,
        lane: b.lane,
        x: b.x,
        level: b.level,
        gram: def.gram,
        shape: def.look.shape,
        arrangement: def.look.arrangement,
        hpFraction: b.hp / b.maxHp,
      };
      if (b.level !== "gram") o.species = b.species;
      if (b.level === "susceptibility") o.resistantInHand = handDrugs.filter((d) => b.resistant.has(d));
      return o;
    }),
    hand: state.stage.hand.map((h) => ({
      drug: h.drug,
      stock: state.stock.get(h.drug) ?? null,
      cost: costPerDose(data, h.drug),
      usable: Array.from({ length: lanes }, (_, lane) => canSummon(state, h.drug, lane) === null),
    })),
    units: state.units.map((u) => ({ uid: u.uid, drug: u.drug, lane: u.lane, hpFraction: u.hp / data.rules.units.fullHp })),
  };
}
