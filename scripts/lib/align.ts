// 作者の録音に字幕の時刻を合わせる（scripts/make-draft-video.ts が使う）。
// 録音では、区切りごとの時刻が分からない。そこで声の中の無音（ffmpeg の silencedetect）を見つけ、
// 「どの無音を字幕の区切りにすると、各字幕の話す長さ（無音を除く）が、声になる字の数に最もよく合うか」を全体で選ぶ（動的計画法）。
// 画面に合わせて作者があけた「間」（シーン3・4）や、句読点・「……」のように声にならない字で、字幕がずれないようにするため。
// 区切りで間をあけなかったところは、無音のない点も区切りの候補にして（少し不利にして）選ぶ。
import { spawnSync } from "node:child_process";

export interface Span {
  start: number;
  end: number;
}

/** 声のファイルの中の無音の区間（noise より小さい音が min 秒以上続くところ） */
export function silences(file: string, noise = "-40dB", min = 0.25): Span[] {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", `silencedetect=noise=${noise}:d=${min}`, "-f", "null", "-"], { encoding: "utf8" });
  const out: Span[] = [];
  let start: number | undefined;
  for (const line of r.stderr.split("\n")) {
    const a = line.match(/silence_start: (-?[\d.]+)/);
    if (a) start = Math.max(0, Number(a[1]));
    const b = line.match(/silence_end: ([\d.]+)/);
    if (b && start !== undefined) {
      out.push({ start, end: Number(b[1]) });
      start = undefined;
    }
  }
  return out;
}

/** 声になる量の目安：句読点・かっこ・「……」・空白は 0、英字は 0.7（Claude ≒ クロード）、数字は 1.5（2050 ≒ にせんごじゅう）、ほかは 1 */
export function spokenWeight(text: string): number {
  let w = 0;
  for (const c of text) w += /[、。「」『』（）()…\s・,.!?！？]/.test(c) ? 0 : /[A-Za-z]/.test(c) ? 0.7 : /[0-9]/.test(c) ? 1.5 : 1;
  return w;
}

/**
 * 字幕の区切り texts を、長さ dur の声の中に置く（sil は声の中の無音）。
 * 区切りの候補は、無音（そのまま）と、話している途中の 0.1 秒ごとの点（無音のない区切り。virtualPenalty だけ不利にする）。
 * 各字幕の「話す長さ（無音を除く）− 見込み（声になる字の量の割合）」の2乗の和が最小になる候補の組を選ぶ。
 * 不利の重み 1.5 は、仮の声で区切りの正しい時刻と比べて決めた（2026-11-05。ずれは最大 0.24 秒、間が短い場合も最大 0.9 秒）
 */
export function alignChunks(texts: string[], dur: number, sil: Span[], virtualPenalty = 1.5): { start: number; end: number; text: string }[] {
  const k = texts.length;
  if (k <= 1) return texts.map((text) => ({ text, start: 0, end: dur }));
  const inner = sil.filter((s) => s.start > 0.05 && s.end < dur - 0.05);
  const silentIn = (a: number, b: number) => inner.reduce((acc, s) => acc + Math.max(0, Math.min(b, s.end) - Math.max(a, s.start)), 0);
  const speech = (a: number, b: number) => Math.max(0, b - a - silentIn(a, b));
  const w = texts.map(spokenWeight);
  const W = w.reduce((a, b) => a + b, 0) || 1;
  const S = speech(0, dur);
  const expect = w.map((x) => (S * x) / W);

  // 区切りの候補（時刻の順）
  const cand: (Span & { penalty: number })[] = inner.map((s) => ({ ...s, penalty: 0 }));
  for (let x = 0.2; x < dur - 0.2; x += 0.1) if (!inner.some((s) => x >= s.start - 0.05 && x <= s.end + 0.05)) cand.push({ start: x, end: x, penalty: virtualPenalty });
  cand.sort((a, b) => a.start - b.start);
  const m = cand.length;
  const MIN = 0.3; // 字幕1つの最短の話す長さ
  const INF = Number.POSITIVE_INFINITY;
  // cost[j][i]：j 個目の区切りを候補 i に置いたときの、そこまでの費用
  const cost = Array.from({ length: k }, () => new Array<number>(m).fill(INF));
  const prev = Array.from({ length: k }, () => new Array<number>(m).fill(-1));
  for (let i = 0; i < m; i++) if (cand[i]!.start >= MIN) cost[1]![i] = (speech(0, cand[i]!.start) - expect[0]!) ** 2 + cand[i]!.penalty;
  for (let j = 2; j <= k - 1; j++)
    for (let i = 0; i < m; i++)
      for (let p = 0; p < i; p++) {
        if (cost[j - 1]![p] === INF || cand[i]!.start - cand[p]!.end < MIN) continue;
        const c = cost[j - 1]![p]! + (speech(cand[p]!.end, cand[i]!.start) - expect[j - 1]!) ** 2 + cand[i]!.penalty;
        if (c < cost[j]![i]!) {
          cost[j]![i] = c;
          prev[j]![i] = p;
        }
      }
  let best = INF;
  let bi = -1;
  for (let i = 0; i < m; i++) {
    if (cost[k - 1]![i] === INF || dur - cand[i]!.end < MIN) continue;
    const c = cost[k - 1]![i]! + (speech(cand[i]!.end, dur) - expect[k - 1]!) ** 2;
    if (c < best) {
      best = c;
      bi = i;
    }
  }
  if (bi < 0) {
    // 声が短すぎて置けないとき：長さを字の量の割合で分ける
    let t = 0;
    return texts.map((text, i) => {
      const d = (dur * w[i]!) / W;
      const r = { text, start: t, end: t + d };
      t += d;
      return r;
    });
  }
  const idx: number[] = [];
  for (let j = k - 1, i = bi; j >= 1; j--) {
    idx.unshift(i);
    i = prev[j]![i]!;
  }
  return texts.map((text, c) => ({ text, start: c === 0 ? 0 : cand[idx[c - 1]!]!.end, end: c === k - 1 ? dur : cand[idx[c]!]!.start }));
}
