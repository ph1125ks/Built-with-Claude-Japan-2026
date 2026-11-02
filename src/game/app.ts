// 画面の流れ：タイトル → 遊び方 → ステージ1 → 結果1 → ステージ2（既定は「2050年」）→ 結果2 → まとめ（SPEC.md 3.1）。
// URL で選べるもの：?stage=<id>（ステージ）、?model=A|B|none（耐性モデル）、?cost=yakka|abstract（医療費の方式）、
// ?seed=<数>、?region=<地域>、
// ?auto=appropriate|broad|random（ボットに自動で遊ばせる。試遊・確認用）
import {
  appropriateBot,
  broadBot,
  getResistanceModel,
  loadGameData,
  randomBot,
  resistanceTableFor,
  stageResult,
  usedDrugsOf,
  validateScenario,
  type Bot,
  type GameData,
  type ResistanceModel,
  type ResistanceModelId,
  type ResistanceTable,
  type ScenarioDef,
  type StageResult,
} from "../engine/index.ts";
import type { BoardScene } from "./board.ts";
import { Hud } from "./hud.ts";
import { antibiogramBlock, biggestDrops, biggestRises, briefingScreen, dropsNote, finalScreen, howtoScreen, milestoneYears, resultScreen, risesTimeline, sourcesScreen, titleScreen, year2050Note } from "./screens.ts";
import { PlaySession } from "./session.ts";

const bundled = import.meta.glob<ScenarioDef>("../../data/stages/*.json", { eager: true, import: "default" });
const DEFAULT_STAGE = "dev-uti";

type Phase = "title" | "howto" | "brief1" | "play1" | "result1" | "brief2" | "play2" | "result2" | "final" | "sources";

export interface AppParams {
  stage: string;
  model?: ResistanceModelId;
  debug?: boolean;
  /** 医療費の方式（薬価の段階化／抽象コスト）。比べるとき用 */
  cost?: "yakka" | "abstract";
  seed: number;
  region?: string;
  auto?: string;
}

export function readParams(search: string): AppParams {
  const q = new URLSearchParams(search);
  const model = q.get("model");
  const cost = q.get("cost");
  return {
    stage: q.get("stage") ?? DEFAULT_STAGE,
    model: model === "A" || model === "B" || model === "none" ? model : undefined,
    cost: cost === "yakka" || cost === "abstract" ? cost : undefined,
    debug: q.has("debug"),
    seed: Number(q.get("seed") ?? 20261104) || 20261104,
    region: q.get("region") ?? undefined,
    auto: q.get("auto") ?? undefined,
  };
}

/** 同梱のステージ（data/stages）か、公開用のステージ（stages/<id>.json）を読む */
export async function loadScenario(id: string): Promise<ScenarioDef> {
  for (const [path, s] of Object.entries(bundled)) if (path.endsWith(`/${id}.json`)) return structuredClone(s);
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`ステージの名前が正しくない：${id}`);
  const res = await fetch(`stages/${id}.json`);
  if (!res.ok) throw new Error(`ステージ ${id} が見つからない`);
  return (await res.json()) as ScenarioDef;
}

export class App {
  readonly data: GameData;
  readonly model: ResistanceModel;
  /** 開発用の表示（耐性モデルの名前など）。?model= か ?debug のときだけ出す */
  private get showDev(): boolean {
    return this.params.model !== undefined || this.params.debug === true;
  }
  private phase: Phase = "title";
  private returnTo: Phase = "title";
  private session: PlaySession | null = null;
  private hud: Hud | null = null;
  private present: StageResult | null = null;
  private future: StageResult | null = null;
  private futureStart: ResistanceTable | null = null;
  private attempt = 0;
  /** 遊び方を一度見たか（初めての人は「はじめる」のあとに必ず一度出す） */
  private sawHowto = false;
  /** 速さ（×1・×2・×4）はステージをまたいで引き継ぐ */
  private speed = 1;

  constructor(
    private scenario: ScenarioDef,
    private params: AppParams,
    private board: BoardScene,
    private ui: { screen: HTMLElement; play: HTMLElement },
  ) {
    const base = loadGameData();
    const modelId = params.model ?? base.rules.resistance.model;
    this.data = loadGameData({
      rules: {
        resistance: { ...base.rules.resistance, model: modelId },
        cost: { ...base.rules.cost, mode: params.cost ?? base.rules.cost.mode },
      },
    });
    this.model = getResistanceModel(modelId);
    if (params.region) this.scenario.region = params.region;
    const errors = validateScenario(this.data, this.scenario);
    if (errors.length) throw new Error(`ステージの誤り：\n${errors.join("\n")}`);
    ui.screen.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
      if (btn) this.act(btn.dataset.action!);
    });
    board.events.on("update", () => this.hud?.frame());
    this.go("title");
  }

  /** 確認用：いまのステージを、実時間を待たずに seconds 秒ぶん進める（画面が隠れていると描画の時計が遅くなるため） */
  fastForward(seconds: number): number {
    const s = this.session;
    if (!s) return 0;
    let n = 0;
    const was = s.paused;
    s.paused = false;
    for (let t = 0; t < seconds * 1000 && !s.ended; t += 50) n += s.advance(50 / s.speed);
    s.paused = was;
    return n;
  }

  /** 確認用：いまの画面の名前 */
  get current(): string {
    return this.phase;
  }

  /** 確認用：ボタンと同じ操作 */
  press(action: string): void {
    this.act(action);
  }

  private autopilot(): Bot | undefined {
    switch (this.params.auto) {
      case "appropriate":
        return appropriateBot();
      case "broad":
        return broadBot();
      case "random":
        return randomBot(this.params.seed);
      default:
        return undefined;
    }
  }

  private act(action: string): void {
    switch (action) {
      case "start":
        this.go(this.sawHowto ? "brief1" : "howto");
        break;
      case "howto":
        this.go("howto");
        break;
      case "title":
        this.go("title");
        break;
      case "sources":
        this.returnTo = this.phase;
        this.go("sources");
        break;
      case "back":
        this.go(this.returnTo);
        break;
      case "play":
        this.go(this.phase === "brief2" ? "play2" : "play1");
        break;
      case "future":
        this.go("brief2");
        break;
      case "final":
        this.go("final");
        break;
      case "retry2":
        // ステージ1の結果はそのまま、ステージ2だけやり直す（展開は変える）
        this.future = null;
        this.attempt++;
        this.go("brief2");
        break;
      case "restart":
        this.present = this.future = this.futureStart = null;
        this.attempt++;
        this.go("brief1");
        break;
    }
  }

  private showScreen(html: string | null): void {
    this.ui.screen.innerHTML = html ?? "";
    this.ui.screen.classList.toggle("open", html !== null);
    this.ui.screen.scrollTop = 0;
  }

  private stopPlay(): void {
    if (this.session) this.speed = this.session.speed;
    this.hud?.destroy();
    this.hud = null;
    this.session = null;
    this.board.setSession(null);
  }

  private go(phase: Phase): void {
    this.phase = phase;
    document.body.dataset.phase = phase;
    const { data, scenario } = this;
    switch (phase) {
      case "title":
        this.stopPlay();
        this.showScreen(titleScreen(data, scenario, this.model.id, this.showDev));
        break;
      case "howto":
        this.sawHowto = true;
        this.showScreen(howtoScreen());
        break;
      case "sources":
        this.showScreen(sourcesScreen(data));
        break;
      case "brief1":
        this.stopPlay();
        this.showScreen(briefingScreen(data, scenario, "present", "", resistanceTableFor(data, scenario.region)));
        break;
      case "play1":
        this.startStage("present");
        break;
      case "result1":
        this.showScreen(resultScreen(data, scenario, "present", this.present!));
        break;
      case "brief2": {
        this.stopPlay();
        const p = this.present!;
        // ステージ1で一度も使わなかった薬は、実測で下がっていた組に限って下げる（rules.json の declineWhenUnused）
        const usedSet = usedDrugsOf(p.activeDays);
        this.futureStart = this.model.carryOver(data, p.resistanceStart, p.resistanceEnd, scenario.future.yearsLater, usedSet);
        const rises = biggestRises(data, p.resistanceStart, this.futureStart, scenario.future.hand.map((h) => h.drug));
        const used = Object.values(p.summons).reduce((a, b) => a + b, 0) > 0;
        // 節目の年ごとの耐性率（2030・2040・2050年など）。同じ延ばし方で途中の年を計算する
        const years = milestoneYears(data, scenario.future.yearsLater);
        const tables = years.map((y) => this.model.carryOver(data, p.resistanceStart, p.resistanceEnd, y, usedSet));
        const drops = biggestDrops(data, p.resistanceEnd, this.futureStart, scenario.future.hand.map((h) => h.drug));
        const extra = `${year2050Note(data, scenario.future.yearsLater)}<h3 class="rises-head">ゲーム内の耐性率の推移（予測ではありません）<small>ステージ1の開始時から大きく上がった組</small></h3>${risesTimeline(data, rises, years, tables, used, p.resistanceEnd)}${dropsNote(data, drops)}`;
        this.showScreen(briefingScreen(data, scenario, "future", extra, this.futureStart));
        break;
      }
      case "play2":
        this.startStage("future");
        break;
      case "result2":
        this.showScreen(resultScreen(data, scenario, "future", this.future!, this.present?.resistanceStart));
        break;
      case "final":
        this.stopPlay();
        this.showScreen(finalScreen(data, scenario, this.present!, this.future!));
        break;
    }
  }

  private startStage(phase: "present" | "future"): void {
    this.showScreen(null);
    this.stopPlay();
    const stage = phase === "present" ? this.scenario.present : this.scenario.future;
    // 同じ種なら毎回同じ展開になる（シミュレーターと同じく、未来は種をずらす）
    const seed = this.params.seed + this.attempt * 1000 + (phase === "future" ? 7919 : 0);
    const session = new PlaySession({
      data: this.data,
      stage,
      region: this.scenario.region,
      seed,
      resistance: phase === "future" ? (this.futureStart ?? undefined) : undefined,
      model: this.model,
      autopilot: this.autopilot(),
    });
    session.speed = this.speed;
    const firstPlay = phase === "present" && this.attempt === 0 && !this.params.auto;
    this.session = session;
    this.board.setSession(session);
    const label = phase === "present" ? `ステージ1　${stage.title}` : `ステージ2　${stage.title}`;
    this.hud = new Hud({
      root: this.ui.play,
      session,
      stageLabel: label,
      antibiogram: antibiogramBlock(this.data, this.scenario.region, session.state.startResistance, stage.hand.map((h) => h.drug), phase),
      keyOrder: [...this.scenario.present.hand, ...this.scenario.future.hand].map((h) => h.drug),
      showDev: this.showDev,
      onEnd: () => {
        const r = stageResult(session.state);
        if (phase === "present") {
          this.present = r;
          this.go("result1");
        } else {
          this.future = r;
          this.go("result2");
        }
      },
    });
    if (firstPlay) this.hud.pauseAtStart();
  }
}
