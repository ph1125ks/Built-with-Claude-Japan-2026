// 抗菌薬の兵士の姿の決まり（系統ごとの装備）。絵そのものはドット絵（pixel/。2026-11-04 作者が作風 C を選んだ）。
// 非医療従事者にも系統の違いが伝わるように、系統ごとに姿を変える（2026-11-03 作者の案と判断）。
//   ペニシリン系＝剣だけ（鎧なし）／β-ラクタマーゼ阻害薬との合剤＝剣＋盾／
//   セフェム系＝世代が上がるほど鎧が豪華（セファマイシン系の CMZ は第2世代）／カルバペネム系＝機械兵／
//   アミノグリコシド系（AMK）＝槌、キノロン系（LVFX）＝弓（どちらも鎧なし。鎧はセフェム系の世代だけに使う）／
//   緑膿菌に効く薬＝胸（盾）に緑膿菌の紋章／内服＝足元がカプセルの台
// 吸収率は絵の大きさでは表さない（2026-11-04 作者の判断）。体内の薬の量を兵士の濃さ（点描）で見せる（board.ts）。
import type { DrugDef, GameData } from "../engine/index.ts";

/** 鎧の段階：0 なし、1 第1世代（革の胸当て）、2 第2世代（鉄の胸当て＋帽子形の兜）、3 第3世代（全身の鉄の鎧）、4 第4世代（金の縁取り・羽飾り・マント） */
export type ArmorTier = 0 | 1 | 2 | 3 | 4;

export interface SoldierLook {
  body: "human" | "mech";
  weapon: "sword" | "hammer" | "bow";
  armor: ArmorTier;
  shield: boolean;
  /** 緑膿菌にも効く印（胸か盾に、緑膿菌の形の紋章） */
  pseudomonas: boolean;
  /** 内服：足元をカプセルの形の台にする */
  oral: boolean;
}

/** 系統ごとの姿。ここにない系統は、鎧なしの剣の兵士にする。ドット絵の作風（pixel/styles/）は、この決まりどおりに描く */
export const CLASS_LOOKS: Record<string, Pick<SoldierLook, "body" | "weapon" | "armor" | "shield">> = {
  penicillin: { body: "human", weapon: "sword", armor: 0, shield: false },
  "bl-bli": { body: "human", weapon: "sword", armor: 0, shield: true },
  ceph1: { body: "human", weapon: "sword", armor: 1, shield: false },
  cephamycin: { body: "human", weapon: "sword", armor: 2, shield: false },
  ceph3: { body: "human", weapon: "sword", armor: 3, shield: false },
  ceph4: { body: "human", weapon: "sword", armor: 4, shield: false },
  carbapenem: { body: "mech", weapon: "sword", armor: 0, shield: false },
  aminoglycoside: { body: "human", weapon: "hammer", armor: 0, shield: false },
  fluoroquinolone: { body: "human", weapon: "bow", armor: 0, shield: false },
};

/** 薬の姿。緑膿菌の印は、緑膿菌に自然耐性でない薬に付ける（カードの「緑膿菌」の目安と同じ考え方。地域によらない） */
export function lookOf(data: GameData, drug: DrugDef): SoldierLook {
  const base = CLASS_LOOKS[drug.class] ?? { body: "human", weapon: "sword", armor: 0, shield: false };
  const pa = data.bacteriumById.get("paeruginosa");
  const pseudomonas = pa ? !pa.intrinsicResistance.includes(drug.id) : false;
  return { ...base, pseudomonas, oral: drug.route === "po" };
}
