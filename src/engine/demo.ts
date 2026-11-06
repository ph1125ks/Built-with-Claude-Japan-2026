// 録画用の操作シナリオ（デモ動画のシーン3〜5。docs/DEMO.md）。手で遊ぶと尺がぶれるので、決まった考え方で自動に遊ぶ。
// 2026-11-04 作者の判断：
//   乱用＝ステージ1も2050年も、カルバペネム系（MEPM）を連打する（2026-11-06 までは 2050年の手札に IPM/CS もあり、MEPM の待ち時間中に使っていた。作者の判断で外した）
//   適正＝台本どおり。グラム陰性桿菌にはまず CTRX、CTRX が効かない大腸菌・肺炎桿菌には CMZ、腸球菌には ABPC、
//         緑膿菌には CAZ。途中で内服の CFDN を1回使う（吸収率が低く、薄く出ることを見せる）
// どちらも見えている情報（Observation）だけで判断する。乱数は使わないので、同じ種なら毎回同じ展開になる。
import type { Bot } from "./bots.ts";
import type { ObservedBacterium, Observation } from "./observe.ts";
import type { Command } from "./types.ts";

/** これより薬の量が多い兵士は、まだ働いているとみなす */
const ACTIVE = 0.15;

function nearestByLane(obs: Observation): (ObservedBacterium | undefined)[] {
  const lanes: (ObservedBacterium | undefined)[] = Array.from({ length: obs.lanes }, () => undefined);
  for (const b of obs.bacteria) {
    if (b.hpFraction <= 0) continue;
    const cur = lanes[b.lane];
    if (!cur || b.x < cur.x) lanes[b.lane] = b;
  }
  return lanes;
}

const usable = (obs: Observation, drug: string, lane: number) => obs.hand.find((h) => h.drug === drug)?.usable[lane] === true;

/** 乱用：菌のいるレーンに、MEPM を使えるたびに召喚する（手札に IPM/CS があれば、MEPM の待ち時間中はそれ） */
export function demoAbuseBot(): Bot {
  return {
    name: "録画：乱用",
    decide(obs) {
      const cmds: Command[] = [];
      nearestByLane(obs).forEach((target, lane) => {
        if (!target) return;
        const pick = ["MEPM", "IPMCS"].find((d) => usable(obs, d, lane));
        if (pick) cmds.push({ type: "summon", drug: pick, lane });
      });
      return cmds;
    },
  };
}

/** 適正：見えている段階（グラム染色 → 菌名 → 感受性）に合わせて、台本どおりの薬を選ぶ */
export function demoProperBot(): Bot {
  let cfdnUsed = false;
  let lastTick = -1;
  return {
    name: "録画：適正",
    decide(obs) {
      // ステージが変わったら（時刻が戻ったら）、内服 CFDN をまた1回使えるようにする
      if (obs.tick < lastTick) cfdnUsed = false;
      lastTick = obs.tick;
      const has = (d: string) => obs.hand.some((h) => h.drug === d);
      const cmds: Command[] = [];
      nearestByLane(obs).forEach((target, lane) => {
        if (!target) return;
        const units = obs.units.filter((u) => u.lane === lane && u.hpFraction > ACTIVE);
        const resisted = (d: string) => target.level === "susceptibility" && (target.resistantInHand ?? []).includes(d);
        // 使ってよい薬（好ましい順）
        let prefs: string[];
        if (target.level === "gram") {
          if (target.gram === "negative") prefs = ["CTRX", "CMZ", "TAZPIPC"];
          // 紫の連鎖球菌：同じレーンに働いている兵士がいれば、その弾が当たるのを待つ（セフェム系ならはじかれて「自然耐性」と出る）。
          // いなければ、腸球菌を考えて ABPC
          else if (units.length > 0) return;
          else prefs = ["ABPC", "AMPC_PO"];
        } else {
          switch (target.species) {
            case "efaecalis":
              prefs = ["ABPC", "AMPC_PO", "TAZPIPC"];
              break;
            case "paeruginosa":
              prefs = ["CAZ", "TAZPIPC", "MEPM"];
              break;
            default:
              // 大腸菌・肺炎桿菌・プロテウス：まず CTRX、効かなければ CMZ
              prefs = ["CTRX", "CMZ", "TAZPIPC", "MEPM"];
          }
        }
        const ok = prefs.filter((d) => has(d) && !resisted(d));
        if (ok.length === 0) return;
        // 効く薬の兵士がもう働いていれば、足さない
        if (units.some((u) => ok.includes(u.drug))) {
          // 内服 CFDN を1回だけ見せる：CTRX が働いている大腸菌のレーンに足す
          if (!cfdnUsed && target.species === "ecoli" && !resisted("CFDN_PO") && units.some((u) => u.drug === "CTRX") && usable(obs, "CFDN_PO", lane)) {
            cfdnUsed = true;
            cmds.push({ type: "summon", drug: "CFDN_PO", lane });
          }
          return;
        }
        const pick = ok.find((d) => usable(obs, d, lane));
        if (pick) cmds.push({ type: "summon", drug: pick, lane });
      });
      return cmds;
    },
  };
}
