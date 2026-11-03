// 抗菌薬の兵士の絵（すべてコードで書いた SVG）。カード（DOM）ではそのまま、盤面（Phaser）ではテクスチャにして使う。
// 非医療従事者にも系統の違いが伝わるように、系統ごとに姿を変える（2026-11-03 作者の案と判断）。
//   ペニシリン系＝剣だけ（鎧なし）／β-ラクタマーゼ阻害薬との合剤＝剣＋盾／
//   セフェム系＝世代が上がるほど鎧が豪華（セファマイシン系の CMZ は第2世代）／カルバペネム系＝機械兵／
//   アミノグリコシド系（AMK）＝槌、キノロン系（LVFX）＝弓（どちらも鎧なし。鎧はセフェム系の世代だけに使う）／
//   緑膿菌に効く薬＝胸（盾）に緑膿菌の紋章／内服＝足元がカプセルの台で、絵の面積を吸収率に合わせて縮める
// 色だけに頼らず、武器・盾・鎧・兜・体の形で見分けられるようにする。色は系統の色（classes.json）を服などに使う。
// 絵は向かって右（菌が来る側）を向く。座標は 64×64。
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
  /** 絵の大きさ（1 ＝ 注射と同じ） */
  scale: number;
}

/** 系統ごとの姿。ここにない系統は、鎧なしの剣の兵士にする */
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

/**
 * 薬の姿。緑膿菌の印は、緑膿菌に自然耐性でない薬に付ける（カードの「緑膿菌」の目安と同じ考え方。地域によらない）。
 * 内服は、絵の面積が吸収率に比例するように縮める（内服は吸収率のぶん弱く出る：rules.json の units）
 */
export function lookOf(data: GameData, drug: DrugDef): SoldierLook {
  const base = CLASS_LOOKS[drug.class] ?? { body: "human", weapon: "sword", armor: 0, shield: false };
  const pa = data.bacteriumById.get("paeruginosa");
  const pseudomonas = pa ? !pa.intrinsicResistance.includes(drug.id) : false;
  const oral = drug.route === "po";
  const scale = oral && drug.bioavailability != null ? Math.sqrt(drug.bioavailability) : 1;
  return { ...base, pseudomonas, oral, scale };
}

/** 盤面のテクスチャの名前 */
export const soldierKey = (drugId: string) => `soldier-${drugId}`;

// ---------- 色 ----------

const INK = "#2a1720";
const SKIN = "#f6d5b8";
const SKIN_LINE = "#8a5a44";
const HAIR = "#5b3a29";
const STEEL = "#d5dde6";
const STEEL_DARK = "#8796a6";
const STEEL_LINE = "#3f4a56";
const GOLD = "#f2c14e";
const GOLD_LINE = "#9a6b00";
const LEATHER = "#b9854f";
const LEATHER_LINE = "#6b4423";
const WOOD = "#8b5a2b";
const PANTS = "#4a3b46";
const BOOT = "#5b3a29";
const MECH = "#dfe6ee";
const MECH_DARK = "#94a3b8";
const MECH_LINE = "#334155";
const GLOW = "#22d3ee";
const GN_PINK = "#e0528a";

function mix(hex: string, to: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  const a = p(hex);
  const b = p(to);
  return `#${a.map((v, i) => Math.round(v + ((b[i] ?? v) - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

// ---------- 部品 ----------

/** 緑膿菌の紋章：白い丸に、細長い桿菌と1本のべん毛 */
function pseudomonasBadge(cx: number, cy: number, r = 4.6): string {
  return `<g class="badge-pa">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="${INK}" stroke-width="1"/>
    <rect x="${cx - r * 0.72}" y="${cy - r * 0.24}" width="${r * 1.05}" height="${r * 0.48}" rx="${r * 0.24}" fill="${GN_PINK}" stroke="#9d1f52" stroke-width="0.5"/>
    <path d="M${cx + r * 0.33} ${cy} q${r * 0.12} ${-r * 0.22} ${r * 0.24} 0 t${r * 0.24} 0" fill="none" stroke="#9d1f52" stroke-width="0.6"/>
  </g>`;
}

function ground(look: SoldierLook, color: string): string {
  if (!look.oral) return `<ellipse cx="30" cy="60.5" rx="15" ry="2.4" fill="#000" opacity="0.13"/>`;
  // 内服：カプセルの形の台（左半分が白、右半分が系統の色）
  return `<g class="capsule">
    <rect x="12.5" y="57" width="35" height="6.4" rx="3.2" fill="${color}" stroke="${INK}" stroke-width="1"/>
    <path d="M30 57 L15.7 57 A3.2 3.2 0 0 0 15.7 63.4 L30 63.4 Z" fill="#fff" stroke="${INK}" stroke-width="1"/>
    <line x1="30" y1="57" x2="30" y2="63.4" stroke="${INK}" stroke-width="1"/>
  </g>`;
}

function legs(look: SoldierLook): string {
  const greaves = look.armor >= 3;
  const trim = look.armor >= 4 ? GOLD_LINE : STEEL_LINE;
  return `<g class="legs">
    <rect x="22.5" y="44" width="6" height="12" fill="${PANTS}" stroke="${INK}" stroke-width="0.8"/>
    <rect x="31.5" y="44" width="6" height="12" fill="${PANTS}" stroke="${INK}" stroke-width="0.8"/>
    ${greaves ? `<rect x="21.8" y="46.5" width="7.4" height="8.5" rx="1.6" fill="${STEEL}" stroke="${trim}" stroke-width="0.9"/><rect x="30.8" y="46.5" width="7.4" height="8.5" rx="1.6" fill="${STEEL}" stroke="${trim}" stroke-width="0.9"/>` : ""}
    <rect x="21" y="54" width="8.4" height="5" rx="2" fill="${BOOT}" stroke="${INK}" stroke-width="0.8"/>
    <rect x="30.5" y="54" width="10" height="5" rx="2" fill="${BOOT}" stroke="${INK}" stroke-width="0.8"/>
  </g>`;
}

function cape(look: SoldierLook, color: string): string {
  if (look.armor < 4) return "";
  return `<path class="cape" d="M21 29 Q14 42 11.5 56 Q20 58.5 27 55.5 L30 31 Z" fill="${mix(color, "#000000", 0.25)}" stroke="${INK}" stroke-width="1"/>`;
}

function torso(look: SoldierLook, color: string): string {
  const tunic = `<rect x="20" y="28" width="20" height="19" rx="5" fill="${color}" stroke="${INK}" stroke-width="1"/>`;
  const belt = `<rect x="20" y="41.5" width="20" height="3.6" fill="${BOOT}"/><rect x="28.4" y="41.3" width="3.4" height="4" rx="0.6" fill="${GOLD}" stroke="${GOLD_LINE}" stroke-width="0.6"/>`;
  const plate = (fill: string, line: string, lw: number) =>
    `<path d="M21.3 30 Q30 27 38.7 30 L38.3 39.8 Q30 43.2 21.7 39.8 Z" fill="${fill}" stroke="${line}" stroke-width="${lw}"/>`;
  let armor = "";
  switch (look.armor) {
    case 1:
      // 革の胸当て（縫い目つき）
      armor = `${plate(LEATHER, LEATHER_LINE, 1)}<path d="M23.5 31.2 Q30 29.2 36.5 31.2 M23.6 38.4 Q30 41 36.4 38.4" fill="none" stroke="#f3dcc0" stroke-width="0.7" stroke-dasharray="1.4 1.2"/>`;
      break;
    case 2:
      // 鉄の胸当て
      armor = `${plate(STEEL, STEEL_LINE, 1)}<path d="M23.5 31.5 Q26 30.4 28.5 30.2" fill="none" stroke="#fff" stroke-width="1.2" opacity="0.9"/>`;
      break;
    case 3:
    case 4: {
      const line = look.armor === 4 ? GOLD_LINE : STEEL_LINE;
      const lw = look.armor === 4 ? 1.6 : 1;
      armor = `${plate(STEEL, look.armor === 4 ? GOLD : line, lw)}
        <path d="M30 29 L30 41.5" stroke="${STEEL_DARK}" stroke-width="0.9"/>
        <path d="M23.5 31.5 Q26 30.4 28.5 30.2" fill="none" stroke="#fff" stroke-width="1.2" opacity="0.9"/>
        <path d="M16.2 32.8 Q16.5 27 22.5 27.4 L24.2 32.6 Z" fill="${STEEL}" stroke="${line}" stroke-width="${lw}"/>
        <path d="M43.8 32.8 Q43.5 27 37.5 27.4 L35.8 32.6 Z" fill="${STEEL}" stroke="${line}" stroke-width="${lw}"/>`;
      if (look.armor === 4) armor += `<path d="M30 32.3 l1.3 2.6 2.9 0.4 -2.1 2 0.5 2.9 -2.6 -1.4 -2.6 1.4 0.5 -2.9 -2.1 -2 2.9 -0.4 z" fill="${GOLD}" stroke="${GOLD_LINE}" stroke-width="0.6"/>`;
      break;
    }
    default:
      break;
  }
  return `<g class="torso">${tunic}${belt}${armor}</g>`;
}

function head(look: SoldierLook, color: string): string {
  const face = `<circle cx="30" cy="17" r="10.2" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width="1"/>`;
  const eyes = (y = 17.6) =>
    `<ellipse cx="30.4" cy="${y}" rx="1.15" ry="1.55" fill="${INK}"/><ellipse cx="36.4" cy="${y}" rx="1.15" ry="1.55" fill="${INK}"/><circle cx="38.4" cy="${y + 3.2}" r="1.5" fill="#f08a9b" opacity="0.45"/>`;
  const hair = `<path d="M19.8 18.5 Q19 6.2 30.5 6.6 Q40.6 7 40.4 14.2 Q35 10.8 28 12.6 Q24.4 14 23.2 19.6 Z" fill="${HAIR}" stroke="${INK}" stroke-width="0.8"/>`;
  switch (look.armor) {
    case 0:
      // 鉢巻き（系統の色）
      return `<g class="head">${face}${hair}<path d="M19.9 13.6 Q30 9.2 40.3 12.4 L40.5 15 Q30 11.8 20.1 16.4 Z" fill="${color}" stroke="${INK}" stroke-width="0.7"/><path d="M20.4 14.6 l-4.4 2.4 l1 2.6 l4 -1.8" fill="${color}" stroke="${INK}" stroke-width="0.7"/>${eyes()}</g>`;
    case 1:
      return `<g class="head">${face}${hair}${eyes()}</g>`;
    case 2:
      // 帽子形の兜（つば付き）
      return `<g class="head">${face}${hair}${eyes()}
        <path d="M19.6 14.8 Q19.8 5.2 30 5.2 Q40.2 5.2 40.4 14.8 Z" fill="${STEEL}" stroke="${STEEL_LINE}" stroke-width="1"/>
        <rect x="17.4" y="13.6" width="25.2" height="2.6" rx="1.3" fill="${STEEL}" stroke="${STEEL_LINE}" stroke-width="1"/>
        <path d="M30 5.4 L30 13.4" stroke="${STEEL_DARK}" stroke-width="0.9"/></g>`;
    default: {
      // 顔の窓と鼻あてのある兜。第4世代は金の縁と羽飾り
      const line = look.armor === 4 ? GOLD_LINE : STEEL_LINE;
      const lw = look.armor === 4 ? 1.5 : 1;
      const plume =
        look.armor === 4
          ? `<path d="M29 6.2 C27.6 1.2 20.6 -0.4 12.6 2.6 C17.6 2.8 21.6 4.6 23.4 8.6 Z" fill="${color}" stroke="${INK}" stroke-width="0.9"/><path d="M27.5 5 C24 2.8 19.5 2.6 15.5 3.4" fill="none" stroke="${mix(color, "#ffffff", 0.45)}" stroke-width="0.8"/>`
          : "";
      return `<g class="head">${plume}
        <rect x="18.6" y="5.6" width="22.8" height="21.6" rx="10" fill="${STEEL}" stroke="${line}" stroke-width="${lw}"/>
        <rect x="26.4" y="13" width="13" height="11.6" rx="3.2" fill="${SKIN}" stroke="${line}" stroke-width="0.9"/>
        ${eyes(18.2)}
        <rect x="32.3" y="10.2" width="2.2" height="10.6" rx="1" fill="${STEEL}" stroke="${line}" stroke-width="0.8"/>
        ${look.armor === 4 ? `<path d="M19.8 11.4 Q30 7.6 40.2 11.4" fill="none" stroke="${GOLD}" stroke-width="1.6"/>` : `<path d="M20.2 11.6 Q30 8 39.8 11.6" fill="none" stroke="${STEEL_DARK}" stroke-width="0.9"/>`}
      </g>`;
    }
  }
}

/** 腕（太い線）と手。鎧が第3世代以上なら鉄の小手 */
function arm(x1: number, y1: number, x2: number, y2: number, look: SoldierLook, color: string): string {
  const hand = look.armor >= 3 ? STEEL : SKIN;
  const handLine = look.armor >= 3 ? STEEL_LINE : SKIN_LINE;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-width="6.4" stroke-linecap="round"/>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${look.armor >= 3 ? STEEL : color}" stroke-width="4.6" stroke-linecap="round"/>
    <circle cx="${x2}" cy="${y2}" r="2.8" fill="${hand}" stroke="${handLine}" stroke-width="0.9"/>`;
}

function sword(x: number, y: number, look: SoldierLook): string {
  const guard = look.armor >= 4 ? GOLD : WOOD;
  const guardLine = look.armor >= 4 ? GOLD_LINE : LEATHER_LINE;
  return `<g class="sword" transform="translate(${x} ${y}) rotate(25)">
    <rect x="-1.2" y="-1" width="2.4" height="6.6" rx="1" fill="${WOOD}" stroke="${LEATHER_LINE}" stroke-width="0.6"/>
    <circle cx="0" cy="6.4" r="1.6" fill="${guard}" stroke="${guardLine}" stroke-width="0.6"/>
    <path d="M-2.1 -3.2 L-2.1 -24 L0 -28.2 L2.1 -24 L2.1 -3.2 Z" fill="#eef2f6" stroke="#475569" stroke-width="0.9"/>
    <line x1="0" y1="-5" x2="0" y2="-23" stroke="#9aa7b4" stroke-width="0.7"/>
    <rect x="-5.2" y="-4" width="10.4" height="2.6" rx="1.1" fill="${guard}" stroke="${guardLine}" stroke-width="0.7"/>
  </g>`;
}

function hammer(x: number, y: number): string {
  return `<g class="hammer" transform="translate(${x} ${y}) rotate(14)">
    <rect x="-1.4" y="-24" width="2.8" height="30" rx="1.2" fill="${WOOD}" stroke="${LEATHER_LINE}" stroke-width="0.7"/>
    <rect x="-8" y="-32" width="16" height="9.6" rx="1.8" fill="${STEEL}" stroke="${STEEL_LINE}" stroke-width="1"/>
    <rect x="-8" y="-29" width="16" height="1.6" fill="${STEEL_DARK}"/>
    <rect x="-2.6" y="-33" width="5.2" height="11.6" rx="1" fill="${STEEL_DARK}" stroke="${STEEL_LINE}" stroke-width="0.8"/>
  </g>`;
}

function bow(): string {
  return `<g class="bow">
    <path d="M44.5 12 Q60 34 44.5 56" fill="none" stroke="${INK}" stroke-width="4"/>
    <path d="M44.5 12 Q60 34 44.5 56" fill="none" stroke="${WOOD}" stroke-width="2.4"/>
    <polyline points="44.5,12 36.5,34 44.5,56" fill="none" stroke="#e7e2d8" stroke-width="0.9"/>
    <line x1="35" y1="34" x2="58" y2="34" stroke="${LEATHER_LINE}" stroke-width="1.6"/>
    <path d="M57.4 31.2 L62.4 34 L57.4 36.8 Z" fill="${STEEL}" stroke="${STEEL_LINE}" stroke-width="0.8"/>
    <path d="M35 34 L32.6 31.4 L37.6 31.6 Z M35 34 L32.6 36.6 L37.6 36.4 Z" fill="#f4f1ea" stroke="${LEATHER_LINE}" stroke-width="0.5"/>
  </g>`;
}

function shield(color: string, badge: boolean): string {
  return `<g class="shield">
    <path d="M7.6 29.6 L25.4 29.6 L25.4 40.4 Q25.4 49 16.5 53.4 Q7.6 49 7.6 40.4 Z" fill="${color}" stroke="${INK}" stroke-width="1.2"/>
    <path d="M9.8 31.6 L23.2 31.6 L23.2 40.2 Q23.2 47.2 16.5 51 Q9.8 47.2 9.8 40.2 Z" fill="none" stroke="${STEEL}" stroke-width="1.4"/>
    ${badge ? pseudomonasBadge(16.5, 40.6, 5) : `<circle cx="16.5" cy="40.6" r="3.2" fill="${STEEL}" stroke="${STEEL_LINE}" stroke-width="0.9"/>`}
  </g>`;
}

function human(look: SoldierLook, color: string): string {
  const parts: string[] = [cape(look, color)];
  // 奥の腕（盾を持つ、または弓の弦を引く）
  if (look.weapon === "bow") parts.push(arm(21.5, 31.5, 35.5, 34, look, color));
  else parts.push(arm(21.5, 31.5, 16.5, 41, look, color));
  parts.push(legs(look), torso(look, color), head(look, color));
  // 武器を持つ腕
  if (look.weapon === "sword") parts.push(arm(38.5, 31.5, 45.5, 38.5, look, color), sword(45.5, 38.5, look));
  else if (look.weapon === "hammer") parts.push(arm(38.5, 31.5, 46, 38, look, color), hammer(46, 38));
  else parts.push(bow(), arm(38.5, 31.5, 51.6, 34, look, color));
  if (look.shield) parts.push(shield(color, look.pseudomonas));
  else if (look.pseudomonas) parts.push(pseudomonasBadge(30, 35.6));
  return parts.join("");
}

function mech(look: SoldierLook, color: string): string {
  const rivet = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="0.8" fill="${MECH_DARK}"/>`;
  return `
    <g class="mech-legs">
      <rect x="22" y="44" width="6.4" height="11" rx="1.2" fill="${MECH_DARK}" stroke="${MECH_LINE}" stroke-width="0.9"/>
      <rect x="31.6" y="44" width="6.4" height="11" rx="1.2" fill="${MECH_DARK}" stroke="${MECH_LINE}" stroke-width="0.9"/>
      <circle cx="25.2" cy="49.5" r="2" fill="${MECH}" stroke="${MECH_LINE}" stroke-width="0.8"/>
      <circle cx="34.8" cy="49.5" r="2" fill="${MECH}" stroke="${MECH_LINE}" stroke-width="0.8"/>
      <path d="M19.6 59 L20.6 54 L29.4 54 L30.2 59 Z" fill="#64748b" stroke="${MECH_LINE}" stroke-width="0.9"/>
      <path d="M30.2 59 L31.2 54 L40.4 54 L42.4 59 Z" fill="#64748b" stroke="${MECH_LINE}" stroke-width="0.9"/>
    </g>
    <rect x="12.6" y="30.4" width="5.6" height="12" rx="2" fill="${MECH_DARK}" stroke="${MECH_LINE}" stroke-width="0.9"/>
    <path d="M12.4 42 L18.4 42 L17.4 45.4 L13.4 45.4 Z" fill="#64748b" stroke="${MECH_LINE}" stroke-width="0.8"/>
    <g class="mech-body">
      <path d="M17 26.6 L43 26.6 L40.4 46 L19.6 46 Z" fill="${MECH}" stroke="${MECH_LINE}" stroke-width="1.1"/>
      <path d="M19.4 41 L40.8 41" stroke="${MECH_DARK}" stroke-width="0.9"/>
      <rect x="18.6" y="27.8" width="22.8" height="3" fill="${color}" stroke="${MECH_LINE}" stroke-width="0.6"/>
      ${rivet(20.4, 33)}${rivet(39.6, 33)}${rivet(21.2, 43.5)}${rivet(38.8, 43.5)}
      ${look.pseudomonas ? pseudomonasBadge(30, 35.6) : `<circle cx="30" cy="35.6" r="3.8" fill="${GLOW}" stroke="#0e7490" stroke-width="1"/>`}
      <rect x="27.6" y="42.4" width="4.8" height="2.4" rx="1" fill="${GLOW}" stroke="#0e7490" stroke-width="0.6"/>
    </g>
    <circle cx="17.2" cy="29.4" r="4.4" fill="${MECH_DARK}" stroke="${MECH_LINE}" stroke-width="1"/>
    <g class="mech-head">
      <line x1="24" y1="6.6" x2="21.6" y2="1.8" stroke="${MECH_LINE}" stroke-width="1.1"/>
      <circle cx="21.4" cy="1.9" r="1.7" fill="${color}" stroke="${MECH_LINE}" stroke-width="0.8"/>
      <rect x="19.4" y="6" width="22" height="18" rx="4" fill="${MECH}" stroke="${MECH_LINE}" stroke-width="1.1"/>
      <rect x="26.6" y="11.2" width="13.6" height="6.6" rx="2.2" fill="#1e293b" stroke="${MECH_LINE}" stroke-width="0.8"/>
      <rect x="30.4" y="13.2" width="8" height="2.6" rx="1.3" fill="${GLOW}"/>
      <circle cx="22.8" cy="15" r="2.3" fill="${MECH_DARK}" stroke="${MECH_LINE}" stroke-width="0.8"/>
      <path d="M27 21 L39 21" stroke="${MECH_DARK}" stroke-width="0.9"/>
    </g>
    <g class="mech-blade" transform="translate(46 38.5) rotate(25)">
      <rect x="-1.6" y="-1.2" width="3.2" height="7" rx="1" fill="#64748b" stroke="${MECH_LINE}" stroke-width="0.7"/>
      <path d="M-3 -3.4 L-3 -24.4 L0 -29.6 L3 -24.4 L3 -3.4 Z" fill="#e2e8f0" stroke="${MECH_LINE}" stroke-width="1"/>
      <path d="M1.6 -4.6 L1.6 -24 L0 -27.2" fill="none" stroke="${GLOW}" stroke-width="1.1"/>
      <path d="M-3 -10 L-1 -10 M-3 -16 L-1 -16 M-3 -22 L-1 -22" stroke="${MECH_DARK}" stroke-width="0.8"/>
      <rect x="-5.6" y="-4.6" width="11.2" height="3" rx="0.8" fill="#64748b" stroke="${MECH_LINE}" stroke-width="0.7"/>
    </g>
    <line x1="40" y1="31" x2="46" y2="38.5" stroke="${MECH_LINE}" stroke-width="6.4" stroke-linecap="round"/>
    <line x1="40" y1="31" x2="46" y2="38.5" stroke="${MECH_DARK}" stroke-width="4.6" stroke-linecap="round"/>
    <circle cx="42.8" cy="29.4" r="4.4" fill="${MECH_DARK}" stroke="${MECH_LINE}" stroke-width="1"/>`;
}

/** 兵士の SVG（文字列）。size は表示の大きさ（ピクセル）。title を渡すと、読み上げ用の名前を付ける */
export function soldierSvg(look: SoldierLook, color: string, size = 64, title?: string): string {
  const s = look.scale;
  const body = look.body === "mech" ? mech(look, color) : human(look, color);
  // 大きさを変えるときは、足元（30, 59）を中心に縮める
  const inner = s === 1 ? body : `<g transform="translate(${30 * (1 - s)} ${59 * (1 - s)}) scale(${s})">${body}</g>`;
  const a11y = title ? `role="img" aria-label="${title}"` : `aria-hidden="true"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" ${a11y}>${ground(look, color)}${inner}</svg>`;
}

/** 薬の兵士の SVG（データから姿と色を決める） */
export function drugSoldierSvg(data: GameData, drug: DrugDef, size = 64): string {
  const color = data.classById.get(drug.class)?.color ?? "#64748b";
  return soldierSvg(lookOf(data, drug), color, size);
}
