// ブラウザなしでステージを最後まで動かす。教員モードの検証とバランスの比較に使う。
import { knowledgeFor, type Bot } from "./bots.ts";
import { createGame, step, type GameState } from "./game.ts";
import { observe } from "./observe.ts";
import { getResistanceModel, type ResistanceModel } from "./resistance.ts";
import { stageResult, type StageResult } from "./results.ts";
import type { GameData, ResistanceTable, ScenarioDef, StageDef } from "./types.ts";

export interface RunStageOptions {
  data: GameData;
  stage: StageDef;
  region: string;
  seed: number;
  bot: Bot;
  resistance?: ResistanceTable;
  model?: ResistanceModel;
  /** ボットが判断する間隔（ティック）。人の操作の速さに近づけるため毎ティックにはしない */
  decideEvery?: number;
  /** 打ち切り（秒）。通常は菌が膀胱に着くか倒れるので、ここまで来ない */
  maxSeconds?: number;
}

export function runStage(opts: RunStageOptions): { result: StageResult; state: GameState } {
  const state = createGame({ ...opts, collectEvents: false });
  const k = knowledgeFor(state);
  const every = opts.decideEvery ?? 5;
  const maxTicks = (opts.maxSeconds ?? 1200) * opts.data.rules.time.ticksPerSecond;
  while (state.outcome === "playing" && state.tick < maxTicks) {
    const cmds = state.tick % every === 0 ? opts.bot.decide(observe(state), k) : [];
    step(state, cmds);
  }
  return { result: stageResult(state), state };
}

export interface ScenarioRun {
  present: StageResult;
  future: StageResult;
  /** 未来ステージの開始時の表（ステージ1の終わりに、未来の年（既定は2050年）までの進みを足したもの） */
  futureStart: ResistanceTable;
}

/** いま → 未来（既定は2050年）、を続けて動かす。未来の開始時の耐性率はモデルの carryOver で作る */
export function runScenario(opts: {
  data: GameData;
  scenario: ScenarioDef;
  seed: number;
  bot: Bot;
  futureBot?: Bot;
  model?: ResistanceModel;
}): ScenarioRun {
  const model = opts.model ?? getResistanceModel(opts.data.rules.resistance.model);
  const { scenario } = opts;
  const present = runStage({ data: opts.data, stage: scenario.present, region: scenario.region, seed: opts.seed, bot: opts.bot, model });
  const futureStart = model.carryOver(opts.data, present.result.resistanceStart, present.result.resistanceEnd, scenario.future.yearsLater);
  const future = runStage({
    data: opts.data,
    stage: scenario.future,
    region: scenario.region,
    seed: opts.seed + 7919,
    bot: opts.futureBot ?? opts.bot,
    resistance: futureStart,
    model,
  });
  return { present: present.result, future: future.result, futureStart };
}
