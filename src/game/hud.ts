// 遊んでいる最中の DOM：上の帯（膀胱の耐久・医療費・波）、情報の見え方の帯、レーンの選択、手札のカード、知らせ。
import { canSummon, costPerDose, type GameEvent, type ResistanceChange } from "../engine/index.ts";
import { LAYOUT, laneTopY } from "./board.ts";
import { escapeHtml, genericName, intervalShort, modelLabel, pct, rejectLabel, routeLabel, SPECTRUM_LABELS, spectrumOf, waitSeconds, yen } from "./format.ts";
import type { PlaySession } from "./session.ts";

export interface HudOptions {
  root: HTMLElement;
  session: PlaySession;
  stageLabel: string;
  /** 遊んでいる途中に開けるアンチバイオグラム（開始時の感性率） */
  antibiogram: string;
  onEnd: () => void;
}

export class Hud {
  private root: HTMLElement;
  private session: PlaySession;
  private selected: string | null = null;
  private els: {
    wave: HTMLElement;
    bladderBar: HTMLElement;
    bladderNum: HTMLElement;
    budget: HTMLElement;
    pause: HTMLButtonElement;
    speed: HTMLButtonElement;
    lanes: HTMLElement[];
    cards: Map<string, { el: HTMLElement; dots: HTMLElement[]; gauge?: HTMLElement; gaugeLabel?: HTMLElement }>;
    ticker: HTMLElement;
  };
  private cache = new Map<string, string>();
  private unsub: () => void;
  private keyHandler: (e: KeyboardEvent) => void;
  private ended = false;

  constructor(private opts: HudOptions) {
    this.root = opts.root;
    this.session = opts.session;
    const s = this.session.state;
    const data = s.data;
    const region = s.region;
    const lanesCount = data.rules.board.lanes;
    const zoneW = (LAYOUT.x1 - LAYOUT.x0) / 3;

    const cardHtml = s.stage.hand
      .map((h, i) => {
        const d = data.drugById.get(h.drug)!;
        const cls = data.classById.get(d.class)!;
        const sp = spectrumOf(data, region, d.id);
        const spec = SPECTRUM_LABELS.map(
          (x) => `<span class="${sp[x.key] ? "on" : "off"}" title="ゲーム内の目安：${x.label}に${sp[x.key] ? "効く見込みあり" : "効く見込みなし（自然耐性・効かない扱い）"}">${x.label}</span>`,
        ).join("");
        const gauge = s.model.id === "B" ? `<div class="gauge"><div class="gbar"><i></i></div><span class="glabel"></span></div>` : "";
        return `<button class="card" data-drug="${d.id}" style="--cls:${cls.color}" title="${escapeHtml(d.name)}">
          <span class="key">${i + 1}</span>
          <div class="abbr${d.abbr.length > 5 ? " long" : ""}">${escapeHtml(d.abbr)}</div>
          <div class="gname">${escapeHtml(genericName(d))}</div>
          <div class="tags"><span class="aware ${d.aware.toLowerCase()}">${d.aware}</span><span class="route ${d.route}">${routeLabel(d)}</span></div>
          <div class="cls">${escapeHtml(cls.name)}</div>
          <div class="meta"><span>医療費 <b>${yen(costPerDose(data, d.id))}</b></span><span>待ち <b>${waitSeconds(data, d).toFixed(0)}秒</b></span></div>
          <div class="interval">${escapeHtml(intervalShort(d))}${d.bioavailability != null ? `・吸収率 <b>${Math.round(d.bioavailability * 100)}%</b>` : ""}</div>
          <div class="spec">${spec}</div>
          ${gauge}
          <div class="dots" title="レーン1〜3ごとの待ち時間（緑＝召喚できる）"><span>レーン</span>${Array.from({ length: lanesCount }, (_, l) => `<i><b></b><em>${l + 1}</em></i>`).join("")}</div>
        </button>`;
      })
      .join("");

    this.root.innerHTML = `
      <div class="hud">
        <div class="hud-stage"><div><b>${escapeHtml(opts.stageLabel)}</b><span class="wave"></span></div><small>${escapeHtml(modelLabel(s.model.id))}・耐性化の速さはゲーム用に誇張</small></div>
        <div class="hud-bladder"><span>膀胱の耐久</span><div class="bar"><i></i></div><b class="num"></b></div>
        <div class="hud-budget"><span>医療費 残り</span><b class="budget"></b><small>/ ${yen(s.stage.budget)}</small></div>
        <div class="hud-ctrl"><button class="abg-open" title="アンチバイオグラム（A キー）。開いている間は一時停止">アンチバイオグラム</button><button class="pause" title="一時停止（スペース）">一時停止</button><button class="speed" title="速さ">×${opts.session.speed}</button></div>
      </div>
      <div class="zones" style="left:${LAYOUT.x0}px;width:${LAYOUT.x1 - LAYOUT.x0}px">
        <span style="width:${zoneW}px">◀ 近い：効かない薬が分かる<small>（薬剤感受性試験）</small></span>
        <span style="width:${zoneW}px">中ほど：菌名が分かる<small>（培養・同定）</small></span>
        <span style="width:${zoneW}px">遠い：グラム染色像だけ<small>（<b class="gn">ピンク＝陰性</b>・<b class="gp">紫＝陽性</b>）</small></span>
      </div>
      <div class="lanes">${Array.from(
        { length: lanesCount },
        (_, i) => `<div class="lane" data-lane="${i}" style="top:${laneTopY(i)}px;height:${LAYOUT.laneH}px;left:${LAYOUT.x0}px;width:${1280 - LAYOUT.x0}px"><span class="lane-msg"></span></div>`,
      ).join("")}</div>
      <div class="ticker" style="top:${LAYOUT.msgTop}px;left:${LAYOUT.x0}px;width:${1280 - LAYOUT.x0}px;height:${LAYOUT.msgH}px"></div>
      <div class="hand" style="top:${LAYOUT.cardsTop}px">${cardHtml}</div>
      <div class="abg-panel" hidden><div class="abg-head"><b>アンチバイオグラム（このステージの開始時）</b><button class="abg-close">閉じる（A）</button></div>${opts.antibiogram}</div>
    `;

    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    const cards = new Map<string, { el: HTMLElement; dots: HTMLElement[]; gauge?: HTMLElement; gaugeLabel?: HTMLElement }>();
    this.root.querySelectorAll<HTMLElement>(".card").forEach((el) => {
      cards.set(el.dataset.drug!, {
        el,
        dots: [...el.querySelectorAll<HTMLElement>(".dots i b")],
        gauge: el.querySelector<HTMLElement>(".gbar i") ?? undefined,
        gaugeLabel: el.querySelector<HTMLElement>(".glabel") ?? undefined,
      });
      el.addEventListener("click", () => this.select(el.dataset.drug!));
    });
    this.els = {
      wave: q(".wave"),
      bladderBar: q(".hud-bladder .bar i"),
      bladderNum: q(".hud-bladder .num"),
      budget: q(".budget"),
      pause: q(".pause"),
      speed: q(".speed"),
      lanes: [...this.root.querySelectorAll<HTMLElement>(".lane")],
      cards,
      ticker: q(".ticker"),
    };
    this.els.lanes.forEach((el, i) => {
      el.addEventListener("click", () => this.place(i));
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.select(null);
      });
    });
    this.els.pause.addEventListener("click", () => this.togglePause());
    q(".abg-open").addEventListener("click", () => this.toggleAntibiogram());
    q(".abg-close").addEventListener("click", () => this.toggleAntibiogram());
    this.els.speed.addEventListener("click", () => {
      const next = this.session.speed === 1 ? 2 : this.session.speed === 2 ? 4 : 1;
      this.session.speed = next;
      this.els.speed.textContent = `×${next}`;
    });
    this.keyHandler = (e) => {
      if (e.key === " ") {
        e.preventDefault();
        this.togglePause();
      } else if (e.key === "a" || e.key === "A") this.toggleAntibiogram();
      else if (e.key === "Escape") {
        if (this.abgOpen) this.toggleAntibiogram();
        else this.select(null);
      }
      else if (/^[1-9]$/.test(e.key)) {
        const h = this.session.state.stage.hand[Number(e.key) - 1];
        if (h) this.select(h.drug);
      }
    };
    window.addEventListener("keydown", this.keyHandler);
    this.unsub = this.session.onEvents((events) => this.handle(events));
    this.message("① 下のカードを選ぶ（数字キーでも可）→ ② レーンをクリックして召喚。スペースで一時停止", "hint", 0);
    this.frame();
  }

  destroy(): void {
    this.unsub();
    window.removeEventListener("keydown", this.keyHandler);
    this.root.innerHTML = "";
  }

  private abgOpen = false;
  private pausedBeforeAbg = false;

  /** アンチバイオグラムを開け閉めする。開いている間は一時停止する */
  private toggleAntibiogram(): void {
    const panel = this.root.querySelector<HTMLElement>(".abg-panel")!;
    this.abgOpen = !this.abgOpen;
    panel.hidden = !this.abgOpen;
    if (this.abgOpen) {
      this.pausedBeforeAbg = this.session.paused;
      this.session.paused = true;
    } else {
      this.session.paused = this.pausedBeforeAbg;
    }
    this.els.pause.textContent = this.session.paused ? "再開" : "一時停止";
  }

  private togglePause(): void {
    // アンチバイオグラムを開いている間は止めたまま（閉じると元に戻る）
    if (this.abgOpen) return;
    this.session.paused = !this.session.paused;
    this.els.pause.textContent = this.session.paused ? "再開" : "一時停止";
    this.root.classList.toggle("paused", this.session.paused);
  }

  private select(drug: string | null): void {
    this.selected = this.selected === drug ? null : drug;
    for (const [id, c] of this.els.cards) c.el.classList.toggle("selected", id === this.selected);
    this.root.classList.toggle("choosing", this.selected !== null);
    this.frame();
  }

  private place(lane: number): void {
    if (!this.selected) return;
    const reason = canSummon(this.session.state, this.selected, lane);
    if (reason) {
      this.message(`${this.session.state.data.drugById.get(this.selected)?.abbr}：${rejectLabel(reason)}`, "warn");
      return;
    }
    this.session.summon(this.selected, lane);
  }

  private set(key: string, el: HTMLElement, prop: "text" | "width" | "class", value: string): void {
    const k = `${key}:${prop}`;
    if (this.cache.get(k) === value) return;
    this.cache.set(k, value);
    if (prop === "text") el.textContent = value;
    else if (prop === "width") el.style.width = value;
    else el.className = value;
  }

  /** 毎フレーム呼ぶ（値が変わったところだけ書き換える） */
  frame(): void {
    const s = this.session.state;
    const data = s.data;
    const tps = data.rules.time.ticksPerSecond;
    const startedWaves = s.spawnIndex > 0 ? (s.spawnPlan[s.spawnIndex - 1]?.wave ?? 0) + 1 : 0;
    const cleared = s.waveRemaining.filter((r) => r === 0).length;
    this.set("wave", this.els.wave, "text", `波 ${startedWaves} / ${s.stage.waves.length}（片付いた ${cleared}）`);
    const frac = s.bladderHp / s.stage.bladderHp;
    this.set("bb", this.els.bladderBar, "width", `${(frac * 100).toFixed(1)}%`);
    this.set("bbc", this.els.bladderBar, "class", frac < 0.3 ? "low" : frac < 0.6 ? "mid" : "");
    this.set("bn", this.els.bladderNum, "text", `${Math.ceil(s.bladderHp)} / ${s.stage.bladderHp}`);
    this.set("budget", this.els.budget, "text", yen(s.budget));

    const B = data.rules.resistance.B;
    for (const [drug, c] of this.els.cards) {
      let anyReady = false;
      c.dots.forEach((dot, lane) => {
        const r = canSummon(s, drug, lane);
        anyReady ||= r === null;
        let w = "100%";
        let cls = "ready";
        if (r === "cooldown") {
          const ready = s.readyAt.get(`${drug}:${lane}`) ?? 0;
          const total = Math.max(1, (data.rules.time.secondsPerGameDay / data.drugById.get(drug)!.dosesPerDay) * tps);
          w = `${(100 * (1 - (ready - s.tick) / total)).toFixed(0)}%`;
          cls = "cool";
        } else if (r) cls = "blocked";
        this.set(`d${drug}${lane}`, dot, "width", w);
        this.set(`dc${drug}${lane}`, dot, "class", cls);
      });
      c.el.classList.toggle("unusable", !anyReady);
      if (c.gauge && c.gaugeLabel) {
        const cls = data.drugById.get(drug)!.class;
        const g = s.gauge[cls] ?? 0;
        const step = Math.floor(g / B.gaugePerStep);
        this.set(`g${drug}`, c.gauge, "width", `${(((g % B.gaugePerStep) / B.gaugePerStep) * 100).toFixed(0)}%`);
        this.set(`gl${drug}`, c.gaugeLabel, "text", `耐性ゲージ 段${step}`);
      }
    }

    this.els.lanes.forEach((el, lane) => {
      const msg = el.firstElementChild as HTMLElement;
      if (!this.selected) {
        this.set(`lane${lane}`, el, "class", "lane");
        this.set(`lanem${lane}`, msg, "text", "");
        return;
      }
      const r = canSummon(s, this.selected, lane);
      const abbr = data.drugById.get(this.selected)?.abbr ?? "";
      let text = `ここに ${abbr} を召喚`;
      if (r === "cooldown") {
        const left = ((s.readyAt.get(`${this.selected}:${lane}`) ?? 0) - s.tick) / tps;
        text = `${abbr}：待ち ${left.toFixed(1)}秒（投与間隔）`;
      } else if (r) text = `${abbr}：${rejectLabel(r)}`;
      this.set(`lane${lane}`, el, "class", r ? "lane target blocked" : "lane target");
      this.set(`lanem${lane}`, msg, "text", text);
    });
  }

  private handle(events: GameEvent[]): void {
    const data = this.session.state.data;
    for (const e of events) {
      if (e.type === "rejected" && e.reason !== "ended") this.message(`${data.drugById.get(e.drug)?.abbr}：${rejectLabel(e.reason)}`, "warn");
      else if (e.type === "resistanceChanged") {
        const head =
          e.cause === "wave"
            ? `波${(e.wave ?? 0) + 1}が片付いた。使った薬に耐性の菌が残り（選択圧）、耐性率が上がった`
            : `耐性ゲージ（${data.classById.get(e.drugClass ?? "")?.name ?? e.drugClass}）が1段上がった`;
        const lines = this.topChanges(e.changes);
        if (lines.length) this.message(`${head}：${lines.join("、")}`, "res");
      } else if (e.type === "end" && !this.ended) {
        this.ended = true;
        window.setTimeout(() => this.opts.onEnd(), 1400);
      }
    }
  }

  /** 手札の薬について、上がり幅の大きい順に2つ（0.5ポイント未満は出さない） */
  private topChanges(changes: ResistanceChange[]): string[] {
    const s = this.session.state;
    const hand = new Set(s.stage.hand.map((h) => h.drug));
    return changes
      .filter((c) => hand.has(c.drug) && c.to - c.from >= 0.005)
      .sort((a, b) => b.to - b.from - (a.to - a.from))
      .slice(0, 2)
      .map((c) => `${escapeHtml(s.data.bacteriumById.get(c.species)?.name ?? c.species)}の ${escapeHtml(s.data.drugById.get(c.drug)?.abbr ?? c.drug)} 耐性 ${pct(c.from)} → <b>${pct(c.to)}</b>`);
  }

  private messageTimer = 0;

  /** レーンの下の帯に知らせを出す。新しい知らせが来るまで残し、しばらくしたら薄くする（ms が 0 なら薄くしない） */
  message(html: string, kind: "warn" | "res" | "hint" = "res", ms = 8000): void {
    const el = this.els.ticker;
    el.innerHTML = html;
    el.className = `ticker ${kind}`;
    window.clearTimeout(this.messageTimer);
    if (ms > 0) this.messageTimer = window.setTimeout(() => el.classList.add("old"), ms);
  }
}
