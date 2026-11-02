// 耐性化のモデル。A（選択圧の再現）と B（耐性ゲージ）を作って比べ、11/5 に一つに決める（SPEC.md 4.7）。
// どのモデルも、波が片付いたときに state.resistance を更新し、未来ステージの開始時の表を作る。
import type { GameState } from "./game.ts";
import { cloneTable } from "./susceptibility.ts";
import type { Bacterium, ResistanceModelId, ResistanceTable } from "./types.ts";

export interface ResistanceModel {
  id: ResistanceModelId;
  /** 波の菌がすべて片付いたときに呼ぶ。resolved はその波の菌（倒れた・膀胱に着いた） */
  onWaveCleared(state: GameState, wave: number, resolved: Bacterium[]): void;
  /** ステージ1の終わりの表から、未来ステージの開始時の表を作る */
  carryOver(end: ResistanceTable, yearsLater: number): ResistanceTable;
}

/** 耐性化しない（比較の基準。エンジンの確認用） */
export const noResistanceModel: ResistanceModel = {
  id: "none",
  onWaveCleared() {},
  carryOver(end) {
    return cloneTable(end);
  },
};

export function getResistanceModel(id: ResistanceModelId): ResistanceModel {
  switch (id) {
    case "none":
      return noResistanceModel;
    case "A":
    case "B":
      throw new Error(`耐性モデル ${id} はまだ作っていない（11/4 に実装）`);
  }
}
