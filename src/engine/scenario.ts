// ステージ（シナリオ）の検査。教員モードで Claude が作った案もここを通す。
import { hasRegion } from "./susceptibility.ts";
import type { GameData, ScenarioDef, StageDef } from "./types.ts";

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function validateStage(data: GameData, stage: StageDef, label = "ステージ"): string[] {
  const e: string[] = [];
  const lanes = data.rules.board.lanes;
  if (!stage.title) e.push(`${label}：title がない`);
  if (!isNum(stage.budget) || stage.budget <= 0) e.push(`${label}：budget は正の数`);
  if (!isNum(stage.bladderHp) || stage.bladderHp <= 0) e.push(`${label}：bladderHp は正の数`);
  if (!Array.isArray(stage.hand) || stage.hand.length === 0) e.push(`${label}：hand が空`);
  const seen = new Set<string>();
  for (const h of stage.hand ?? []) {
    if (!data.drugById.has(h.drug)) e.push(`${label}：手札の薬 ${h.drug} がカタログにない`);
    if (seen.has(h.drug)) e.push(`${label}：手札の薬 ${h.drug} が重複`);
    seen.add(h.drug);
    if (h.stock !== undefined && h.stock !== null && (!isInt(h.stock) || h.stock < 0)) e.push(`${label}：${h.drug} の stock は0以上の整数`);
  }
  if (!Array.isArray(stage.waves) || stage.waves.length === 0) e.push(`${label}：waves が空`);
  (stage.waves ?? []).forEach((w, i) => {
    const at = `${label}：波${i + 1}`;
    if (!isNum(w.at) || w.at < 0) e.push(`${at}：at は0以上`);
    if (w.lane !== "random" && (!isInt(w.lane) || w.lane < 0 || w.lane >= lanes)) e.push(`${at}：lane は 0〜${lanes - 1} か "random"`);
    if (w.species !== "auto" && !data.bacteriumById.has(w.species)) e.push(`${at}：菌 ${w.species} がカタログにない`);
    if (!isInt(w.count) || w.count < 1) e.push(`${at}：count は1以上の整数`);
    if (!isNum(w.spacing) || w.spacing < 0) e.push(`${at}：spacing は0以上`);
  });
  return e;
}

export function validateScenario(data: GameData, s: ScenarioDef): string[] {
  const e: string[] = [];
  if (!s.id || !/^[a-z0-9-]+$/.test(s.id)) e.push("id は英小文字・数字・ハイフンだけ");
  if (!s.title) e.push("title がない");
  if (!hasRegion(data, s.region)) e.push(`地域 ${s.region} のデータがない（${data.janis.regions.join("、")}）`);
  if (!s.present) e.push("present がない");
  else e.push(...validateStage(data, s.present, "いま"));
  if (!s.future) e.push("future がない");
  else {
    e.push(...validateStage(data, s.future, "未来"));
    if (!isNum(s.future.yearsLater) || s.future.yearsLater < 0) e.push("未来：yearsLater は0以上");
  }
  return e;
}
