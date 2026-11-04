// 見た目の決まり（色とフォント）。盤面（Phaser）で使う値。DOM の色は style.css の :root にそろえて書く。
// 2026-11-04 作者の依頼「最近のインディーゲームらしく」：暗い盤面に、グラム染色の色の細菌と系統の色の兵士が光って見える作り。

/** ドット絵のフォント（DotGothic16。SIL OFL 1.1。@fontsource/dotgothic16 で同梱） */
export const PIXEL_FONT = '"DotGothic16", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
/** 長い文の読みやすいフォント（端末に入っているもの） */
export const BODY_FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';

export const COLORS = {
  /** 盤面のいちばん奥 */
  void: 0x0b0812,
  /** レーンの床（上 → 下） */
  laneTop: 0x1a1430,
  laneBottom: 0x120d22,
  laneAltTop: 0x1c1532,
  laneAltBottom: 0x140e25,
  /** 分かることが増える3つの区間の色（遠い・中ほど・近い） */
  zoneFar: 0x6d5bd0,
  zoneMid: 0x2fb5a3,
  zoneNear: 0xf2b632,
  /** 文字 */
  ink: "#f4ecf7",
  inkDim: "#b7a6c6",
  outline: "#0b0712",
  good: "#5ef0a0",
  /** 耐性・危険の赤（グラム陰性菌のピンクと見分けるため朱に寄せる） */
  bad: "#ff6352",
  intrinsic: "#c4a3ff",
  gold: "#ffcf3f",
  teal: "#3be0c6",
  accent: "#ff4f8b",
} as const;

/** CSS の色（#rrggbb）を Phaser の数値に */
export const hexNum = (s: string) => Number.parseInt(s.replace("#", ""), 16);
