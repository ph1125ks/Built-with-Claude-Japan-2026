// 画面に出す文字と数値の書き方。医学的な値はエンジンとデータから読むだけにする。
import { susceptibility, type DrugDef, type GameData, type RejectReason, type ResistanceModelId } from "../engine/index.ts";

/** 0〜1 を % にする。1% 未満は小数1桁まで出す（MEPM の 0.1% などを 0% に見せないため） */
export function pct(x: number): string {
  const v = x * 100;
  if (v > 0 && v < 1) return `${v.toFixed(1)}%`;
  if (v > 99 && v < 100) return `${v.toFixed(1)}%`;
  return `${Math.round(v)}%`;
}

export function yen(n: number): string {
  return Math.round(n).toLocaleString("ja-JP");
}

/** 「アンピシリン」のように、括弧の補足を除いた一般名 */
export function genericName(drug: DrugDef): string {
  return drug.name.replace(/（.*?）/g, "");
}

export function routeLabel(drug: DrugDef): string {
  return drug.route === "po" ? "内服" : "注射";
}

/** 投与間隔（用量の数値は出さない：SPEC.md 7.1） */
export function intervalLabel(drug: DrugDef): string {
  if (drug.dosesPerDay === 1) return "1日1回";
  const hours = 24 / drug.dosesPerDay;
  return Number.isInteger(hours) ? `${hours}時間毎（1日${drug.dosesPerDay}回）` : `1日${drug.dosesPerDay}回`;
}

/** カードに出す短い投与間隔（データの用法の後半。例：「6時間毎」「1日3回」） */
export function intervalShort(drug: DrugDef): string {
  const part = drug.dosing.label.split("・")[1] ?? "";
  return part.replace(/（.*?）/g, "") || intervalLabel(drug);
}

/** 召喚の待ち時間（秒）＝投与間隔 */
export function waitSeconds(data: GameData, drug: DrugDef): number {
  return data.rules.time.secondsPerGameDay / drug.dosesPerDay;
}

export interface Spectrum {
  entero: boolean;
  pseudomonas: boolean;
  enterococcus: boolean;
}

/** スペクトラムの目安：その地域のデータで、少しでも効く見込みがあるか（自然耐性・効かない扱いは届かない） */
export function spectrumOf(data: GameData, region: string, drugId: string): Spectrum {
  const reach = (sp: string) => susceptibility(data, region, sp, drugId).p > 0;
  return {
    entero: ["ecoli", "kpneumoniae", "pmirabilis"].some(reach),
    pseudomonas: reach("paeruginosa"),
    enterococcus: reach("efaecalis"),
  };
}

/**
 * 手札のカードの数字キー。ステージ1と2で同じ薬に同じ数字を割り当てる（ステージ2で対応が変わらないように）。
 * 2つの手札を合わせた薬（ステージ1の順、続いてステージ2にだけある薬）が9種類を超えるときは、手札の順にする。
 */
export function cardKeys(hand: string[], allDrugs: string[]): Map<string, number> {
  const order = [...new Set(allDrugs)];
  const useAll = order.length <= 9 && hand.every((d) => order.includes(d));
  return new Map(hand.map((d, i) => [d, useAll ? order.indexOf(d) + 1 : i + 1]));
}

/** 切り札の系統（カードの「切り札」の札と、結果画面の原因の一文。2026-11-05 作者の判断：MEPM・IPM/CS） */
export const TRUMP_CLASS = "carbapenem";

/**
 * WHO の AWaRe 分類の、カードに添える一言（2026-11-05 作者の判断。docs/PLAIN-LANGUAGE.md 2章：Access＝まず使う薬、Watch＝使いすぎ注意）。
 * Reserve はいまのカードにないが、用語の説明（ほかの薬が効かないときのために取っておく薬）に合わせる
 */
export const AWARE_WORDS: Record<string, string> = {
  Access: "まず使う薬",
  Watch: "使いすぎ注意",
  Reserve: "取っておく薬",
};

export const SPECTRUM_LABELS: { key: keyof Spectrum; label: string }[] = [
  { key: "entero", label: "大腸菌など" },
  { key: "pseudomonas", label: "緑膿菌" },
  { key: "enterococcus", label: "腸球菌" },
];

export function rejectLabel(reason: RejectReason): string {
  switch (reason) {
    case "cooldown":
      return "待ち時間中（＝投与間隔）";
    case "budget":
      return "医療費が足りない（時間がたつと増えます）";
    case "laneFull":
      return "このレーンは満杯（3つまで）";
    case "noStock":
      return "在庫がない";
    case "notInHand":
      return "手札にない";
    case "badLane":
      return "レーンを選び直す";
    case "ended":
      return "ステージは終わった";
  }
}

export function modelLabel(id: ResistanceModelId): string {
  switch (id) {
    case "A":
      return "耐性の進み方 A（薬ごと：選択圧の再現）";
    case "B":
      return "耐性の進み方 B（系統ごと：耐性ゲージ）";
    case "none":
      return "耐性化なし（確認用）";
  }
}

/** 遊んでいる途中に出す短い名前 */
export function modelShort(id: ResistanceModelId): string {
  return id === "A" ? "耐性 A（薬ごと）" : id === "B" ? "耐性 B（系統ごと）" : "耐性化なし";
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
