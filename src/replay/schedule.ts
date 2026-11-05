// 作業の記録（scripts/eval-skill.ts が書く JSON）を、再生の時刻表にする。画面には触らない（tests/replay.test.ts で確かめる）。
// 記録では、少しずつ届いた文（text）と考えの知らせ（thinking）は、続いているあいだ1つにまとめてある。
// 再生では、まとまった文を少しずつ表示する（タイプライター風）。かける時間は、次の中身のある知らせまでの間に収める
import type { DesignEvent } from "../teacher/view.ts";

export interface LoggedEvent {
  /** 開始からの秒 */
  t: number;
  e: DesignEvent;
}
export interface ReplayLog {
  model: string;
  input: { region: string; audience: string; goal: string };
  condition?: string;
  n?: number;
  /** 記録した日時（ISO 8601） */
  made: string;
  events: LoggedEvent[];
}
export interface Scheduled {
  /** 再生での開始の秒 */
  at: number;
  /** 文を書き終えるまでの秒（文でない知らせは 0） */
  dur: number;
  e: DesignEvent;
  /** 文と考えの知らせの中身を1文字ずつに分けたもの（サロゲートペアを割らない） */
  chars?: string[];
}

/** 文をふつうに書く速さ（1秒あたりの文字数） */
export const CHARS_PER_SEC = 40;
/** 次の知らせまで間がなくても、文を書くのにかける最短の秒（文がそれより短く書けるときは、その秒） */
export const MIN_TYPE_SEC = 1.2;

/** 時刻を進めない知らせ（区切りと、短い状況の知らせ）。文を書く時間を決めるときは飛ばして、その先の知らせまでの間を見る */
const isMarker = (e: DesignEvent) => e.type === "block_end" || e.type === "status";
const isStream = (e: DesignEvent): e is Extract<DesignEvent, { type: "text" | "thinking" }> => e.type === "text" || e.type === "thinking";

/**
 * 再生の時刻表を作る。知らせの順は変えない。文を書くのに間が足りないときだけ、後ろの知らせを少し遅らせる
 * （遅れは、次に Claude が考えている長い間で取り戻す）
 */
export function schedule(events: LoggedEvent[]): { items: Scheduled[]; total: number } {
  const items: Scheduled[] = [];
  let cursor = 0;
  for (let i = 0; i < events.length; i++) {
    const { t, e } = events[i]!;
    const at = Math.max(Number.isFinite(t) ? t : 0, cursor);
    if (isStream(e)) {
      const chars = Array.from(e.text);
      let next = events.length > i + 1 ? events.at(-1)!.t : at;
      for (let j = i + 1; j < events.length; j++)
        if (!isMarker(events[j]!.e)) {
          next = events[j]!.t;
          break;
        }
      const gap = Math.max(0, next - at);
      const natural = chars.length / CHARS_PER_SEC;
      const dur = Math.min(natural, Math.max(gap, Math.min(natural, MIN_TYPE_SEC)));
      items.push({ at, dur, e, chars });
      cursor = at + dur;
    } else {
      items.push({ at, dur: 0, e });
      cursor = at;
    }
  }
  return { items, total: cursor };
}

/** 再生の位置（秒）を「1分05秒」のように書く */
export function formatSec(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return s < 60 ? `${s}秒` : `${Math.floor(s / 60)}分${String(s % 60).padStart(2, "0")}秒`;
}

/** 記録の JSON の形を確かめる（公開に置くのは作者が選んだ記録だけだが、壊れた記録で画面が止まらないように） */
export function parseReplayLog(x: unknown): ReplayLog | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Partial<ReplayLog>;
  if (typeof o.model !== "string" || typeof o.made !== "string" || !o.input || typeof o.input.region !== "string" || typeof o.input.goal !== "string") return null;
  if (!Array.isArray(o.events)) return null;
  const events = o.events.filter((v): v is LoggedEvent => Boolean(v) && typeof v.t === "number" && Boolean(v.e) && typeof v.e.type === "string");
  return { model: o.model, input: { region: o.input.region, audience: String(o.input.audience ?? ""), goal: o.input.goal }, condition: o.condition, n: o.n, made: o.made, events };
}

/** URL の ?log= の値を、public/replays/ の中のファイル名にする。ほかの場所を指すものは認めない */
export function replayFile(param: string | null): string | null {
  const name = (param ?? "osaka.json").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*(\.json)?$/.test(name)) return null;
  return `replays/${name.endsWith(".json") ? name : `${name}.json`}`;
}
