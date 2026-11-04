// 遊んでいる1ステージ。エンジンの状態と時計を持ち、描画（Phaser）と操作（DOM）の両方から使う。
// 操作は命令の列に積み、次のティックでエンジンに渡す。ボット（自動操作）も同じ列を使う。
import {
  createGame,
  knowledgeFor,
  observe,
  step,
  type Bot,
  type Command,
  type GameData,
  type GameEvent,
  type GameState,
  type Knowledge,
  type ResistanceModel,
  type ResistanceTable,
  type StageDef,
} from "../engine/index.ts";

export interface SessionOptions {
  data: GameData;
  stage: StageDef;
  region: string;
  seed: number;
  resistance?: ResistanceTable;
  model: ResistanceModel;
  /** 自動で遊ぶボット（試遊・録画用） */
  autopilot?: Bot;
}

export type SessionListener = (events: GameEvent[], session: PlaySession) => void;

export class PlaySession {
  readonly state: GameState;
  readonly tickMs: number;
  speed = 1;
  paused = false;
  private queue: Command[] = [];
  private acc = 0;
  private listeners: SessionListener[] = [];
  private autopilot?: Bot;
  private knowledge?: Knowledge;
  /** 直前のティックの菌の位置（描画のなめらかさのため） */
  readonly prevX = new Map<number, number>();

  constructor(opts: SessionOptions) {
    this.state = createGame({ ...opts, collectEvents: true });
    this.tickMs = 1000 / opts.data.rules.time.ticksPerSecond;
    this.autopilot = opts.autopilot;
    if (opts.autopilot) this.knowledge = knowledgeFor(this.state);
  }

  get ended(): boolean {
    return this.state.outcome !== "playing";
  }

  onEvents(fn: SessionListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  summon(drug: string, lane: number): void {
    this.queue.push({ type: "summon", drug, lane });
  }

  /** まだ行われていない召喚（一時停止中の予約）。盤面と知らせの帯に出す */
  get pending(): { drug: string; lane: number }[] {
    return this.queue.flatMap((c) => (c.type === "summon" ? [{ drug: c.drug, lane: c.lane }] : []));
  }

  /** 実時間を進める。戻り値は進めたティック数 */
  advance(ms: number): number {
    if (this.paused || this.ended) return 0;
    this.acc += Math.min(ms, 250) * this.speed;
    let n = 0;
    while (this.acc >= this.tickMs && !this.ended) {
      this.acc -= this.tickMs;
      this.tick();
      n++;
    }
    return n;
  }

  /** 次のティックまでの割合（0〜1）。描画で位置を補間する */
  get alpha(): number {
    return Math.min(1, this.acc / this.tickMs);
  }

  private tick(): void {
    const s = this.state;
    if (this.autopilot && this.knowledge && s.tick % 5 === 0) this.queue.push(...this.autopilot.decide(observe(s), this.knowledge));
    this.prevX.clear();
    for (const b of s.bacteria) this.prevX.set(b.uid, b.x);
    const events = step(s, this.queue.splice(0));
    if (events.length) for (const l of this.listeners) l(events, this);
  }

  /** 波の数と、片付いた波の数 */
  waves(): { total: number; cleared: number } {
    const total = this.state.stage.waves.length;
    return { total, cleared: this.state.waveRemaining.filter((r) => r === 0).length };
  }
}
