// 画面の流れ：タイトル → 遊び方 → ステージ1 → 結果1 → ステージ2（既定は「2050年」）→ 結果2 → まとめ（SPEC.md 3.1）。
// URL で選べるもの：?stage=<id>（ステージ）、?model=A|B|none（耐性モデル。タイトル画面でも A/B を選べる）、?cost=yakka|abstract（医療費の方式）、
// ?budget=<はじめ>,<1日ごと>[,<上限>]（医療費の増え方）、
// ?seed=<数>、?region=<地域>、
// ?auto=appropriate|broad|random（ボットに自動で遊ばせる。試遊・確認用）
import {
  appropriateBot,
  broadBot,
  drawShortage,
  getResistanceModel,
  loadGameData,
  randomBot,
  demoAbuseBot,
  demoProperBot,
  resistanceTableFor,
  stageResult,
  usedDrugsOf,
  validateScenario,
  withShortage,
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
import { antibiogramBlock, biggestDrops, biggestRises, briefingScreen, dropsNote, finalScreen, howtoScreen, milestoneYears, resultScreen, risesTimeline, showHowtoSlide, sourcesScreen, titleScreen, year2050Note } from "./screens.ts";
import { PlaySession } from "./session.ts";

const bundled = import.meta.glob<ScenarioDef>("../../data/stages/*.json", { eager: true, import: "default" });

/** タイトル画面で選んだ耐性モデルを、このブラウザで覚えておく（見る人ごとの便利機能。読めなくても動く） */
const MODEL_KEY = "sentakuatsu.model";
function storedModel(): ResistanceModelId | undefined {
  try {
    const v = localStorage.getItem(MODEL_KEY);
    return v === "A" || v === "B" ? v : undefined;
  } catch {
    return undefined;
  }
}
function storeModel(id: ResistanceModelId): void {
  try {
    localStorage.setItem(MODEL_KEY, id);
  } catch {
    // 保存できない環境（プライベートブラウズなど）では覚えない
  }
}
/** URL でステージを指定しないときに開くステージ（公開用。開発用の仮ステージは ?stage=dev-uti） */
const DEFAULT_STAGE = "uti-zenkoku";

type Phase = "title" | "howto" | "brief1" | "play1" | "result1" | "brief2" | "play2" | "result2" | "final" | "sources";

export interface AppParams {
  stage: string;
  model?: ResistanceModelId;
  debug?: boolean;
  /** 医療費の上書き：はじめの額・1日ごとに増える額・上限（?budget=100,200 や ?budget=100,200,600）。遊び比べる用 */
  budget?: { start: number; perDay: number; max?: number };
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
    budget: parseBudget(q.get("budget")),
    seed: Number(q.get("seed") ?? 20261104) || 20261104,
    region: q.get("region") ?? undefined,
    auto: q.get("auto") ?? undefined,
  };
}

function parseBudget(v: string | null): AppParams["budget"] {
  if (!v) return undefined;
  const [start, perDay, max] = v.split(",").map(Number);
  if (!(start! > 0) || !(perDay! >= 0)) return undefined;
  return { start: start!, perDay: perDay!, max: max! > 0 ? max : undefined };
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
  data!: GameData;
  model!: ResistanceModel;
  /** 開発用の表示（ステージの名前など）。?debug のときだけ出す */
  private get showDev(): boolean {
    // 耐性モデルはタイトル画面で選べる学生向けの選択なので、?model= では開発用の表示を出さない（録画で ?model= を固定しても画面がきれいなまま）
    return this.params.debug === true;
  }
  private phase: Phase = "title";
  private returnTo: Phase = "title";
  private session: PlaySession | null = null;
  private hud: Hud | null = null;
  private present: StageResult | null = null;
  private future: StageResult | null = null;
  private futureStart: ResistanceTable | null = null;
  /** 供給制限で今回は使えない薬（ブリーフィングで種から決める） */
  private short: { present: string[]; future: string[] } = { present: [], future: [] };

  /** ステージの種。同じ種なら毎回同じ展開・同じ供給制限になる（シミュレーターと同じく、未来は種をずらす） */
  private stageSeed(phase: "present" | "future"): number {
    return this.params.seed + this.attempt * 1000 + (phase === "future" ? 7919 : 0);
  }
  private attempt = 0;
  /** 遊び方を一度見たか（初めての人は「はじめる」のあとに必ず一度出す） */
  private sawHowto = false;
  /** 遊び方の絵の何枚目か（0 から。「次へ」「前へ」で切り替える） */
  private howtoSlide = 0;
  /** 速さ（×1・×2・×4）はステージをまたいで引き継ぐ */
  private speed = 1;
  /** タイトル画面の後ろで、ボットが遊んでいる盤面（見せるだけ。結果はどこにも残さない） */
  private attract: PlaySession | null = null;
  private attractRound = 0;

  constructor(
    private scenario: ScenarioDef,
    private params: AppParams,
    private board: BoardScene,
    private ui: { screen: HTMLElement; play: HTMLElement },
  ) {
    // 耐性モデル：URL の指定 → タイトル画面で前に選んだもの → rules.json の既定
    this.setModel(params.model ?? storedModel() ?? loadGameData().rules.resistance.model);
    if (params.region) this.scenario.region = params.region;
    if (params.budget) {
      for (const st of [this.scenario.present, this.scenario.future]) {
        st.budget = params.budget.start;
        st.budgetPerDay = params.budget.perDay;
        st.budgetMax = params.budget.max;
      }
    }
    const errors = validateScenario(this.data, this.scenario);
    if (errors.length) throw new Error(`ステージの誤り：\n${errors.join("\n")}`);
    ui.screen.addEventListener("scroll", this.updateScrollHint, { passive: true });
    // 遊び方の「アンチバイオグラムを見る」などで高さが変わったときも確かめ直す
    ui.screen.addEventListener("toggle", this.updateScrollHint, true);
    ui.screen.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
      if (btn) this.act(btn.dataset.action!);
    });
    // 遊び方の絵は、左右の矢印キーでもめくれる。「くわしい数字」のポップアップは Esc で閉じる
    window.addEventListener("keydown", (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "Escape") {
        const popup = this.ui.screen.querySelector<HTMLElement>(".detail-popup");
        if (popup && !popup.hidden) this.act("detail");
        return;
      }
      if (this.phase !== "howto") return;
      if (e.key === "ArrowRight") this.act("howto-next");
      else if (e.key === "ArrowLeft") this.act("howto-prev");
    });
    board.events.on("update", () => this.hud?.frame());
    board.events.on("wave", () => this.hud?.waveFlash());
    this.go("title");
  }

  /** 耐性モデルを切り替える（タイトル画面で選んだとき）。データとモデルを作り直す */
  private setModel(id: ResistanceModelId): void {
    const base = loadGameData();
    this.data = loadGameData({
      rules: {
        resistance: { ...base.rules.resistance, model: id },
        cost: { ...base.rules.cost, mode: this.params.cost ?? base.rules.cost.mode },
      },
    });
    this.model = getResistanceModel(id);
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
      // 録画用の操作シナリオ（docs/DEMO.md のシーン3〜5）
      case "demo-abuse":
        return demoAbuseBot();
      case "demo-proper":
        return demoProperBot();
      default:
        return undefined;
    }
  }

  private act(action: string): void {
    switch (action) {
      case "start":
        this.go(this.sawHowto ? "brief1" : "howto");
        break;
      case "model-A":
      case "model-B": {
        const id = action === "model-A" ? "A" : "B";
        this.setModel(id);
        storeModel(id);
        // 後ろの盤面も、選んだ耐性の進み方で遊び直す
        this.stopPlay();
        this.go("title");
        break;
      }
      case "howto":
        this.go("howto");
        break;
      case "howto-next":
      case "howto-prev":
        if (this.phase === "howto") this.howtoSlide = showHowtoSlide(this.ui.screen, this.howtoSlide + (action === "howto-next" ? 1 : -1));
        break;
      case "detail": {
        // 結果・まとめ画面の「くわしい数字」（教える人・専門家向け）のポップアップを開け閉めする（2026-11-06）
        const popup = this.ui.screen.querySelector<HTMLElement>(".detail-popup");
        if (popup) {
          popup.hidden = !popup.hidden;
          if (!popup.hidden) popup.scrollTop = 0;
        }
        break;
      }
      case "howto-more": {
        // 「くわしく」を開いて、そこまで送る（録画の操作用。画面では summary を押す）
        const more = this.ui.screen.querySelector<HTMLDetailsElement>(".howto-more");
        if (more) {
          more.open = true;
          more.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        break;
      }
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
    this.updateScrollHint();
  }

  /** 画面の下にまだ続きがあるとき、ボタンの帯の上に合図を出す（style.css の can-scroll。試遊の指摘） */
  private updateScrollHint = (): void => {
    const el = this.ui.screen;
    el.classList.toggle("can-scroll", el.classList.contains("open") && el.scrollHeight - el.scrollTop - el.clientHeight > 40);
  };

  private stopPlay(): void {
    if (this.session) this.speed = this.session.speed;
    this.hud?.destroy();
    this.hud = null;
    this.session = null;
    this.attract = null;
    this.board.setSession(null);
  }

  /**
   * タイトル画面の後ろの盤面で、適正ボットに遊ばせる（最近のゲームによくある「デモ画面」。2026-11-04）。
   * 学生の結果や耐性率には何も残さない。ステージが終わったら、少し待って次の回を始める
   */
  private startAttract(): void {
    if (this.attract || this.session) return;
    const seed = 4242 + this.attractRound * 17;
    const stage = withShortage(this.scenario.present, drawShortage(this.data, this.scenario.present, this.scenario.region, seed));
    const s = new PlaySession({ data: this.data, stage, region: this.scenario.region, seed, model: this.model, autopilot: appropriateBot() });
    // 待ち時間を短く見せる（試遊の指摘：何も起きない時間が長い）
    s.speed = 2;
    this.attract = s;
    this.board.setSession(s);
    s.onEvents((events) => {
      if (!events.some((e) => e.type === "end")) return;
      window.setTimeout(() => {
        if (this.attract !== s) return;
        this.attract = null;
        this.attractRound++;
        this.startAttract();
      }, 2600);
    });
  }

  private go(phase: Phase): void {
    this.phase = phase;
    document.body.dataset.phase = phase;
    const { data, scenario } = this;
    switch (phase) {
      case "title":
        if (this.session) this.stopPlay();
        this.showScreen(titleScreen(data, scenario, this.model.id, this.showDev));
        this.startAttract();
        break;
      case "howto":
        this.sawHowto = true;
        this.howtoSlide = 0;
        this.showScreen(howtoScreen(data, scenario));
        this.startAttract();
        break;
      case "sources":
        this.showScreen(sourcesScreen(data));
        break;
      case "brief1":
        this.stopPlay();
        this.short.present = drawShortage(data, scenario.present, scenario.region, this.stageSeed("present"));
        this.showScreen(briefingScreen(data, scenario, "present", "", resistanceTableFor(data, scenario.region), this.short.present));
        break;
      case "play1":
        this.startStage("present");
        break;
      case "result1":
        this.showScreen(resultScreen(data, scenario, "present", this.present!, undefined, this.short.present));
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
        this.short.future = drawShortage(data, scenario.future, scenario.region, this.stageSeed("future"));
        this.showScreen(briefingScreen(data, scenario, "future", extra, this.futureStart, this.short.future));
        break;
      }
      case "play2":
        this.startStage("future");
        break;
      case "result2":
        this.showScreen(resultScreen(data, scenario, "future", this.future!, this.present?.resistanceStart, this.short.future, this.present ?? undefined));
        break;
      case "final":
        this.stopPlay();
        this.showScreen(finalScreen(data, scenario, this.present!, this.future!, this.short));
        break;
    }
  }

  private startStage(phase: "present" | "future"): void {
    this.showScreen(null);
    this.stopPlay();
    // 供給制限で使えない薬を外した手札で遊ぶ
    const stage = withShortage(phase === "present" ? this.scenario.present : this.scenario.future, this.short[phase]);
    const seed = this.stageSeed(phase);
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
    // ステージ1の最初の回と、ステージ2は止めた状態で始める（試遊の指摘：ステージ2が、変わった手札を読む前に始まっていた）
    const firstPlay = (phase === "future" || this.attempt === 0) && !this.params.auto;
    const presentHand = new Set(this.scenario.present.hand.map((h) => h.drug));
    const newDrugs = phase === "future" ? stage.hand.map((h) => h.drug).filter((d) => !presentHand.has(d)) : [];
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
      shortDrugs: this.short[phase],
      newDrugs,
      onPreview: (drug, lane) => {
        this.board.preview(drug, lane);
        return this.board.nextSlot(lane);
      },
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
    if (firstPlay) this.hud.pauseAtStart(newDrugs.length ? "。手札が変わっています（新しい薬のカードに「追加」）" : "");
    this.board.banner(phase === "present" ? "ステージ1　" + stage.title : "ステージ2　" + stage.title, phase === "present" ? "細菌から膀胱を守る" : "自分が育てた耐性菌と戦う", phase === "present" ? "#3be0c6" : "#ff6352", 1500);
  }
}
