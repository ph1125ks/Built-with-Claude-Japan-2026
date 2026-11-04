// engine.js の型（使うものだけ）
export type RGB = [number, number, number];
/** ドットの絵。px は長さ w*h で、各ドットは [r,g,b] か null（透明） */
export interface Sprite {
  w: number;
  h: number;
  px: (RGB | null)[];
}
/** エンジンに渡す薬：color は系統の色、pa は緑膿菌の紋章、ba は吸収率（注射は null） */
export interface PixelDrug {
  id: string;
  abbr: string;
  cls: string;
  color: string;
  route: string;
  ba: number | null;
  pa: boolean;
}
export interface PixelBug {
  id: string;
  gram: "negative" | "positive";
  shape: string;
}
export interface PixelStyle {
  id: string;
  name: string;
  note?: string;
  size: number;
  laneScale: number;
  cardScale: number;
  bugScale?: number;
  cardCrop?: { x: number; y: number; w: number; h: number };
  soldiers: Record<string, unknown>;
  bacteria: Record<string, { frames: string[][]; bare?: string[][] }>;
}
export function hexToRgb(hex: string): RGB;
export function makeRamp(hex: string, opt?: { shift?: number }): string[];
export function soldierSprite(style: PixelStyle, drug: PixelDrug, which?: string, opt?: { color?: string; noOral?: boolean }): Sprite;
export function cardSprite(style: PixelStyle, drug: PixelDrug, which?: string, opt?: { color?: string; noOral?: boolean }): Sprite;
export function bugSprite(style: PixelStyle, bug: PixelBug, frame?: number, bare?: boolean): Sprite;
export function ditherKeep(s: Sprite, keep: number, edgeKeep?: boolean): Sprite;
export function isEdge(s: Sprite, x: number, y: number): boolean;
export function crop(s: Sprite, r: { x: number; y: number; w: number; h: number }): Sprite;
