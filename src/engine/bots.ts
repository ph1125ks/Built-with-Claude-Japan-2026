// シミュレーション用のボット。教員モードで Claude がステージを検証するときと、バランスの比較に使う。
// ボットは Observation（プレイヤーに見える情報）とアンチバイオグラムの知識だけで判断する。
import type { GameState } from "./game.ts";
import type { ObservedBacterium, Observation } from "./observe.ts";
import { createRng } from "./rng.ts";
import { stewardshipRank } from "./stewardship.ts";
import { urineWeights } from "./susceptibility.ts";
import type { Command, GameData } from "./types.ts";

/** プレイヤーが知っていてよいこと（教科書の知識と、その地域のアンチバイオグラム） */
export interface Knowledge {
  data: GameData;
  /** 菌 → 薬 → 効く確率（ステージ開始時の値） */
  pSusceptible(species: string, drug: string): number;
  /** 尿から分離される菌の重み */
  speciesWeights: { species: string[]; weights: number[] };
  /** この薬が、尿から出る菌全体（分離割合で重み付け）に効く見込み。「広く効く」の目安 */
  coverage(drug: string): number;
}

export function knowledgeFor(state: GameState): Knowledge {
  const table = state.startResistance;
  const pSusceptible = (species: string, drug: string) => 1 - (table[species]?.[drug] ?? 1);
  const speciesWeights = urineWeights(state.data, state.region);
  const total = speciesWeights.weights.reduce((s, w) => s + w, 0);
  return {
    data: state.data,
    pSusceptible,
    speciesWeights,
    coverage: (drug) =>
      speciesWeights.species.reduce((s, sp, i) => s + (speciesWeights.weights[i] ?? 0) * pSusceptible(sp, drug), 0) / total,
  };
}

export interface Bot {
  name: string;
  decide(obs: Observation, k: Knowledge): Command[];
}

/** 見えている情報から、この薬がこの個体に効く見込み */
export function expectedEffect(k: Knowledge, b: ObservedBacterium, drug: string): number {
  if (b.level === "susceptibility") return b.resistantInHand?.includes(drug) ? 0 : 1;
  if (b.level === "species" && b.species) return k.pSusceptible(b.species, drug);
  // グラム染色だけ：同じグラム染色性・形（球菌か桿菌か）の菌を、分離される割合で重み付けする
  const isCoccus = b.shape === "coccus";
  let sum = 0;
  let wsum = 0;
  k.speciesWeights.species.forEach((s, i) => {
    const def = k.data.bacteriumById.get(s);
    if (!def || def.gram !== b.gram || (def.look.shape === "coccus") !== isCoccus) return;
    const w = k.speciesWeights.weights[i] ?? 0;
    sum += w * k.pSusceptible(s, drug);
    wsum += w;
  });
  return wsum > 0 ? sum / wsum : 0;
}

function lanesWithBacteria(obs: Observation): ObservedBacterium[][] {
  const lanes: ObservedBacterium[][] = Array.from({ length: obs.lanes }, () => []);
  for (const b of obs.bacteria) lanes[b.lane]?.push(b);
  // 膀胱に近い順
  for (const l of lanes) l.sort((a, b) => a.x - b.x);
  return lanes;
}

const ACTIVE = 0.15;

/**
 * 適正ボット：見えている情報で効く見込みが基準以上の薬のうち、AWaRe の順で最も優先すべきもの
 * （Access → Watch → カルバペネム → Reserve）を選ぶ。同じ順位なら、カバー率（尿から出る菌全体に
 * 効く見込み。公開データから計算）が低いもの＝狭いもの、次に安いものの順。
 * 菌名・感受性が分かったら選び直す（デエスカレーション）
 */
export function appropriateBot(threshold = 0.8): Bot {
  return {
    name: "適正",
    decide(obs, k) {
      const cmds: Command[] = [];
      lanesWithBacteria(obs).forEach((bs, lane) => {
        const target = bs[0];
        if (!target) return;
        const units = obs.units.filter((u) => u.lane === lane);
        // 狭い順：AWaRe の順位、同じならカバー率が低いほう
        const narrower = (a: string, b: string) =>
          stewardshipRank(k.data, a) - stewardshipRank(k.data, b) || k.coverage(a) - k.coverage(b);
        // いまの情報で、手札の中で最も優先すべき薬（待ち時間中かどうかは問わない）
        const best = obs.hand
          .map((h) => h.drug)
          .filter((d) => expectedEffect(k, target, d) >= threshold)
          .sort(narrower)[0];
        const active = units.filter((u) => u.hpFraction > ACTIVE && expectedEffect(k, target, u.drug) >= threshold);
        if (active.length) {
          // 効いている薬がある。菌名・感受性が分かって、より狭い薬で足りるなら切り替える（デエスカレーション）
          if (!best || active.some((u) => u.drug === best)) return;
          const bestCard = obs.hand.find((h) => h.drug === best);
          if (active.every((u) => narrower(best, u.drug) < 0) && bestCard?.usable[lane]) cmds.push({ type: "summon", drug: best, lane });
          return;
        }
        // 最適な薬がこのレーンにまだ残っていて、次の投与（待ち時間）を待つだけなら、別の薬でつながない
        // （温存すべき薬を「つなぎ」に使わない）
        if (best && units.some((u) => u.drug === best) && !obs.hand.find((h) => h.drug === best)?.usable[lane]) return;
        const scored = obs.hand
          .filter((h) => h.usable[lane])
          .map((h) => ({ h, p: expectedEffect(k, target, h.drug), rank: stewardshipRank(k.data, h.drug) }));
        const ok = scored
          .filter((s) => s.p >= threshold)
          .sort((a, b) => a.rank - b.rank || k.coverage(a.h.drug) - k.coverage(b.h.drug) || a.h.cost - b.h.cost);
        const pick = ok[0] ?? scored.filter((s) => s.p > 0).sort((a, b) => b.p - a.p || a.rank - b.rank)[0];
        if (pick) cmds.push({ type: "summon", drug: pick.h.drug, lane });
      });
      return cmds;
    },
  };
}

/**
 * 乱用ボット：菌がいるレーンには、いつも「温存すべき順」で最も上の薬（カルバペネム系・キノロン系）を使う。
 * 同じ順位なら、尿から出る菌全体に広く効くものを選ぶ（MEPM → 待ち時間中は LVFX、のように使う）
 */
export function broadBot(): Bot {
  return {
    name: "乱用",
    decide(obs, k) {
      const cmds: Command[] = [];
      lanesWithBacteria(obs).forEach((bs, lane) => {
        if (bs.length === 0) return;
        if (obs.units.some((u) => u.lane === lane && u.hpFraction > ACTIVE)) return;
        const pick = obs.hand
          .filter((h) => h.usable[lane])
          .sort(
            (a, b) =>
              stewardshipRank(k.data, b.drug) - stewardshipRank(k.data, a.drug) || k.coverage(b.drug) - k.coverage(a.drug),
          )[0];
        if (pick) cmds.push({ type: "summon", drug: pick.drug, lane });
      });
      return cmds;
    },
  };
}

/** 偏りボット：一つの薬だけを使い続ける */
export function singleDrugBot(drug: string): Bot {
  return {
    name: `偏り（${drug}）`,
    decide(obs) {
      const cmds: Command[] = [];
      lanesWithBacteria(obs).forEach((bs, lane) => {
        if (bs.length === 0) return;
        if (obs.units.some((u) => u.lane === lane && u.drug === drug && u.hpFraction > ACTIVE)) return;
        if (obs.hand.find((h) => h.drug === drug)?.usable[lane]) cmds.push({ type: "summon", drug, lane });
      });
      return cmds;
    },
  };
}

/** ランダムボット：手札からでたらめに選ぶ（基準として） */
export function randomBot(seed: number): Bot {
  const rng = createRng(seed);
  return {
    name: "ランダム",
    decide(obs) {
      const cmds: Command[] = [];
      lanesWithBacteria(obs).forEach((bs, lane) => {
        if (bs.length === 0) return;
        if (obs.units.some((u) => u.lane === lane && u.hpFraction > ACTIVE)) return;
        const usable = obs.hand.filter((h) => h.usable[lane]);
        if (usable.length) cmds.push({ type: "summon", drug: rng.pick(usable).drug, lane });
      });
      return cmds;
    },
  };
}

/** 何もしないボット（基準として） */
export function idleBot(): Bot {
  return { name: "何もしない", decide: () => [] };
}
