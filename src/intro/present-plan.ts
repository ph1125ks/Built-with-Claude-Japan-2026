// 動画用の見せ方（intro.html?present=1）の時刻表。DOM を使わない（tests/intro.test.ts で確かめる）。
// 前提の鎖の 1〜5 を自動で順に見せる（1 は短く）。字幕とナレーションを合わせるため、各段の始まりの秒を window.__presentTimeline に出す。

export interface PresentPhase {
  /** 5. の動く絵の場面（start・drug・grow・again・body） */
  key: "start" | "drug" | "grow" | "again" | "body";
  label: string;
  /** その段の始まりからの秒 */
  at: number;
}

export interface PresentStep {
  step: number;
  label: string;
  /** その段を見せる秒 */
  dur: number;
  phases?: PresentPhase[];
}

/**
 * 段ごとの秒（合わせて 30.5 秒）。動画のシーン4（しくみ）は 2. から使い、ナレーションの区切りに合わせた（2026-11-05。docs/DEMO.md 第4版。
 * 作者の読む速さ 1秒に約5.3字）：「抗菌薬、いわゆる…細菌を倒す薬。」→ 4.6秒後に「薬ごとに…」→ 3.8秒後に「はじめは…」→ 5.6秒後に「でも薬を使うと…」。
 * 第4版で、作者の物語の時間を作るため、「かぜの多くはウイルス」「検査にも数日かかる」を声から外し（画面の文には出ている）、段を短くした
 */
export const PRESENT_STEPS: PresentStep[] = [
  { step: 1, label: "細菌", dur: 4.5 },
  { step: 2, label: "抗菌薬", dur: 4.6 },
  { step: 3, label: "効く相手が違う", dur: 3.8 },
  { step: 4, label: "切り札が選ばれやすい理由", dur: 5.6 },
  {
    step: 5,
    label: "選択圧",
    dur: 12,
    phases: [
      { key: "start", label: "はじめ（効かない細菌が少しだけいる）", at: 0 },
      { key: "drug", label: "薬を使う（効く細菌が倒れる）", at: 1.5 },
      { key: "grow", label: "増える（効かない細菌ばかりになる）", at: 3.5 },
      { key: "again", label: "もう一度使う（倒れない）", at: 5.6 },
      { key: "body", label: "変わるのは細菌のほう", at: 6.8 },
    ],
  },
];

export interface TimelineEntry {
  step: number;
  label: string;
  /** 見せ方の始まり（window.__presentT0）からの秒 */
  at: number;
  /** 5. の動く絵の場面（見せ方の始まりからの秒） */
  phases?: { key: PresentPhase["key"]; label: string; at: number }[];
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/** 時刻表。from を渡すと、その段から始める（確かめや撮り直し用） */
export function presentTimeline(steps: readonly PresentStep[] = PRESENT_STEPS, from = 1): { entries: TimelineEntry[]; total: number } {
  let at = 0;
  const entries: TimelineEntry[] = [];
  for (const s of steps) {
    if (s.step < from) continue;
    const e: TimelineEntry = { step: s.step, label: s.label, at: round(at) };
    if (s.phases) e.phases = s.phases.map((p) => ({ key: p.key, label: p.label, at: round(at + p.at) }));
    entries.push(e);
    at += s.dur;
  }
  return { entries, total: round(at) };
}

/** URL の from（段の番号）を読む。おかしな値は 1 */
export function parseFrom(v: string | null): number {
  const n = Number(v);
  return Number.isInteger(n) && PRESENT_STEPS.some((s) => s.step === n) ? n : 1;
}
