// 遊んでいる最中の DOM：上の帯（膀胱の耐久・医療費・波）、情報の見え方の帯、レーンの選択、手札のカード、知らせ、「？」のパネル。
// 2026-11-06 作者の判断「画面の文字が多すぎる」：遊んでいる間に目に入る文字を減らし、細かい説明は「？」のパネルと、触れたときの吹き出し（title）に移した
import { canSummon, costPerDose, MAX_CARDS, type GameData, type GameEvent, type ResistanceChange } from "../engine/index.ts";
import { H, LAYOUT, laneTopY, zoneBounds } from "./board.ts";
import { effectiveTag, nearestRevealed } from "./bugs.ts";
import { AWARE_WORDS, cardKeys, escapeHtml, genericName, intervalShort, modelShort, pct, rejectLabel, routeLabel, SPECTRUM_LABELS, spectrumOf, TRUMP_CLASS, waitSeconds, yen } from "./format.ts";
import type { PlaySession } from "./session.ts";
import { iconImg, soldierImg } from "./pixel/index.ts";
import type { IconName } from "./pixel/icons.ts";

const pauseLabel = (paused: boolean) => (paused ? `${iconImg("play", 1)}<span>再開</span>` : `${iconImg("pause", 1)}<span>一時停止</span>`);
const speedLabel = (n: number) => `${iconImg("fast", 1)}<span>×${n}</span>`;
type TickerKind = "warn" | "res" | "hint" | "pause";
const TICKER_ICON: Record<TickerKind, IconName> = { warn: "warn", res: "up", hint: "info", pause: "pause" };
/** 遊び方の案内（最初に召喚するまで出しておく）。数字キーなどの細かい操作は「？」のパネルで */
const START_HINT = "① 下のカードを選ぶ → ② レーンをクリックで呼び出す";
const PAUSE_HINT = "一時停止中（スペースで再開）。止めたままカードを選ぶと予約になります";

/** 手札の補助（効く薬のカードを光らせる）をオンにしたか、このブラウザで覚えておく（作者の判断：補助機能として、オンにしたときだけ） */
const ASSIST_KEY = "sentakuatsu.assist";
export function assistOn(): boolean {
  try {
    return localStorage.getItem(ASSIST_KEY) === "1";
  } catch {
    return false;
  }
}
function storeAssist(on: boolean): void {
  try {
    localStorage.setItem(ASSIST_KEY, on ? "1" : "0");
  } catch {
    // 保存できない環境では覚えない
  }
}

/**
 * 「？」のパネル：遊び方の要点（操作・近づくほど分かる・カードの見かた・耐性）と、手札の補助のスイッチ。
 * 前は上の帯・区間の帯・知らせの帯・カードに書いていた説明を、ここにまとめた
 */
function helpPanel(data: GameData, modelId: string, assist: boolean): string {
  const [near, far] = zoneBounds();
  const B = data.rules.board;
  return `
    <div class="help-cols">
      <section>
        <h4>${iconImg("play", 1)}操作</h4>
        <ul>
          <li><b>カードを選ぶ</b>：クリックか、数字キー <b>1〜9</b>（カードの絵の左下の数字。2つのステージで同じ薬に同じ数字）</li>
          <li><b>レーンをクリック</b>で呼び出す。右クリックか <b>Esc</b> で選び直し</li>
          <li><b>スペース</b>：一時停止。止めている間にレーンを選ぶと<b>予約</b>になり、再開した瞬間に呼び出す</li>
          <li><b>A</b>：アンチバイオグラム（細菌ごとに薬が効く割合の表）。<b>H</b>：このパネル</li>
        </ul>
      </section>
      <section>
        <h4>${iconImg("microscope", 1)}近づくほど分かる</h4>
        <ul>
          <li><b class="hz far">遠い</b>：顕微鏡で見た色と形（グラム染色）だけ。<i class="gn">ピンク＝陰性</i>・<i class="gp">紫＝陽性</i></li>
          <li><b class="hz mid">中ほど</b>（膀胱から ${Math.round(far * 100)}% より近く）：細菌の名前（培養検査）</li>
          <li><b class="hz near">近い</b>（${Math.round(near * 100)}% より近く）：手札のうち<b class="ok">効く薬</b>（効く薬を調べる検査＝薬剤感受性試験）</li>
          <li>名前が分かる前は、アンチバイオグラムで効く見込みの高い薬を選べます</li>
        </ul>
      </section>
      <section>
        <h4>${iconImg("coin", 1)}カードの見かた</h4>
        <ul>
          <li>大きな字＝薬の一般名、上＝略号。<b class="access">Access</b>＝まず使う薬、<b class="watch">Watch</b>＝使いすぎ注意（WHO の AWaRe 分類）。<b class="trump-word">切り札</b>＝カルバペネム系（ほとんどの細菌に効く）</li>
          <li>${iconImg("coin", 1)}＝1回の医療費（時間とともに増える）。${iconImg("hourglass", 1)}＝待ち時間＝投与間隔（ゲームの1日は ${data.rules.time.secondsPerGameDay}秒）</li>
          <li>「大腸菌など・緑膿菌・腸球菌」＝効く見込みのある細菌（ゲーム内の目安）。下の3つの枠＝レーンごとの待ち時間（緑＝呼べる）</li>
          <li>内服薬は、体に届く割合（吸収率）のぶん薄い兵士で出ます。カードに触れると系統と投与間隔が出ます</li>
        </ul>
      </section>
      <section>
        <h4>${iconImg("up", 1)}効かない細菌が残る</h4>
        <ul>
          <li>薬を使うと効く細菌は倒れ、効かない細菌だけが残って増えます（<b>選択圧</b>）。波が片付くたびに、使った薬が効かない割合が上がります</li>
          <li>効かなくなる速さは、ゲーム用に大げさにしています</li>
          <li>耐性の進み方：<b>${escapeHtml(modelShort(modelId as "A"))}</b>（タイトル画面で A／B を選べます）。1レーンに兵士は ${B.maxUnitsPerLane} 人まで</li>
        </ul>
        <label class="assist-switch"><input type="checkbox" class="assist-check"${assist ? " checked" : ""}><span><b>補助：効く薬のカードを光らせる</b><small>膀胱にいちばん近い、正体の分かった細菌に効くカードを緑の縁で</small></span></label>
      </section>
    </div>`;
}

export interface HudOptions {
  root: HTMLElement;
  session: PlaySession;
  stageLabel: string;
  /** 遊んでいる途中に開けるアンチバイオグラム（開始時の感性率） */
  antibiogram: string;
  /** 数字キーを割り当てる薬の順（ステージ1と2の手札を合わせたもの）。ステージをまたいで同じ薬に同じ数字を出す */
  keyOrder: string[];
  /** 開発用の表示（耐性モデルの名前） */
  showDev?: boolean;
  /** 供給制限で今回は使えない薬（手札の右に札で出す） */
  shortDrugs?: string[];
  /** 前のステージになかった薬（カードに「追加」の札を付ける） */
  newDrugs?: string[];
  /** カードを選んでレーンにかざしたとき、兵士が立つ場所の見本を出す（board.ts の preview）。戻り値は立つ場所（0〜） */
  onPreview?: (drug: string | null, lane: number) => number;
  onEnd: () => void;
}

/** 供給制限で使えない薬の札（カードの列の右端）。カードが8枚並ぶときは、カードを少し細くして細い札にする */
function shortCard(data: GameData, short: string[], cards: number): string {
  if (short.length === 0) return "";
  const chips = short.map((d) => `<span>${escapeHtml(data.drugById.get(d)?.abbr ?? d)}</span>`).join("");
  const title = "供給制限：薬が手に入りにくく、今回は使えません。どの薬が使えないかは、遊ぶたびに変わります";
  if (cards >= MAX_CARDS) return `<div class="card short-card compact" style="--i:${cards}" title="${title}">${iconImg("warn", 1)}<b>供給制限</b><small>今回は<br>使えない</small><div class="short-list">${chips}</div></div>`;
  return `<div class="card short-card" style="--i:${cards}" title="${title}">${iconImg("warn", 2)}<b>供給制限</b><small>今回は使えない</small><div class="short-list">${chips}</div></div>`;
}

export class Hud {
  private root: HTMLElement;
  private session: PlaySession;
  private selected: string | null = null;
  private els: {
    wave: HTMLElement;
    pips: HTMLElement[];
    bladderBox: HTMLElement;
    budgetBox: HTMLElement;
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
  /** 数字キー → 薬 */
  private drugByKey: Map<number, string>;
  private ended = false;

  constructor(private opts: HudOptions) {
    this.root = opts.root;
    this.session = opts.session;
    const s = this.session.state;
    this.lastHp = s.bladderHp;
    this.lastBudget = s.budget;
    const data = s.data;
    const region = s.region;
    const lanesCount = data.rules.board.lanes;
    const [near, far] = zoneBounds();
    const laneW = LAYOUT.x1 - LAYOUT.x0;
    const keys = cardKeys(s.stage.hand.map((h) => h.drug), opts.keyOrder);
    this.drugByKey = new Map([...keys].map(([d, k]) => [k, d]));

    const cardHtml = s.stage.hand
      .map((h, i) => {
        const d = data.drugById.get(h.drug)!;
        const cls = data.classById.get(d.class)!;
        const sp = spectrumOf(data, region, d.id);
        const spec = SPECTRUM_LABELS.map(
          (x) => `<span class="${sp[x.key] ? "on" : "off"}" title="ゲーム内の目安：${x.label}に${sp[x.key] ? "効く見込みあり" : "効く見込みなし（自然耐性・効かない扱い）"}">${x.label}</span>`,
        ).join("");
        const gauge = s.model.id === "B" ? `<div class="gauge"><div class="gbar"><i></i></div><span class="glabel"></span></div>` : "";
        // 2026-11-05 作者の判断「すべての人に伝わるように」：一般名を大きく（略号だけで判断させない）、切り札（カルバペネム系）の札、
        // Access＝まず使う薬・Watch＝使いすぎ注意の一言（docs/PLAIN-LANGUAGE.md 3章）。
        // 2026-11-06 作者の判断「文字が多すぎる」：系統名と投与間隔・吸収率の行はカードから外し、触れたときの説明（title）と「？」のパネルへ
        const gname = genericName(d);
        const trump = d.class === TRUMP_CLASS;
        const word = AWARE_WORDS[d.aware] ?? "";
        const ba = d.bioavailability != null ? `。吸収率 ${Math.round(d.bioavailability * 100)}%（体に届く割合。そのぶん薄い兵士で出る）` : "";
        const tip = `${gname}（${d.abbr}）｜${cls.name}｜${routeLabel(d)}・${intervalShort(d)}${ba}${trump ? "｜切り札：ほとんどの細菌に効く薬" : ""}｜${word}（WHO の AWaRe 分類で ${d.aware}）`;
        return `<button class="card${trump ? " trump" : ""}${gauge ? " has-gauge" : ""}" data-drug="${d.id}" style="--cls:${cls.color};--i:${i}" title="${escapeHtml(tip)}">
          <span class="card-shine"></span>${opts.newDrugs?.includes(d.id) ? `<span class="new-tag">追加</span>` : ""}<span class="fit-tag">効く</span>
          <div class="card-head">
            <div class="portrait">${soldierImg(data, d, "card")}<span class="key">${keys.get(d.id)}</span></div>
            <div class="card-head-text">
              <div class="abbr${d.abbr.length > 5 ? " long" : ""}">${escapeHtml(d.abbr)}</div>
              <div class="tags"><span class="route ${d.route}">${routeLabel(d)}</span>${trump ? `<span class="trump-tag">切り札</span>` : ""}</div>
            </div>
          </div>
          <div class="gname${gname.length > 9 ? " long" : ""}">${escapeHtml(gname).replace(/・/g, "・<wbr>")}</div>
          <div class="aware-row"><span class="aware ${d.aware.toLowerCase()}">${d.aware}</span><span class="aware-word ${d.aware.toLowerCase()}">${escapeHtml(word)}</span></div>
          <div class="meta"><span class="cost" title="1回の医療費">${iconImg("coin", 1)}<b>${yen(costPerDose(data, d.id))}</b></span><span class="wait" title="待ち時間＝投与間隔（${escapeHtml(intervalShort(d))}）">${iconImg("hourglass", 1)}<b>${waitSeconds(data, d).toFixed(0)}秒</b></span></div>
          <div class="spec">${spec}</div>
          ${gauge}
          <div class="dots" title="レーン1〜3ごとの待ち時間（緑＝呼べる）">${Array.from({ length: lanesCount }, (_, l) => `<i><b></b><em>${l + 1}</em></i>`).join("")}</div>
        </button>`;
      })
      .join("");

    const assist = assistOn();
    this.assist = assist;
    const dev = opts.showDev ? `<small class="dev">${escapeHtml(modelShort(s.model.id))}</small>` : "";
    this.root.innerHTML = `
      <div class="hud">
        <div class="hud-stage" title="${escapeHtml(modelShort(s.model.id))}。効かなくなる速さはゲーム用に大げさにしています"><div><b>${escapeHtml(opts.stageLabel)}</b><span class="wave"></span></div><div class="wave-pips">${s.stage.waves.map(() => "<i></i>").join("")}</div>${dev}</div>
        <div class="hud-bladder" title="膀胱の耐久。細菌が膀胱に入ると減り、0 になると負け">${iconImg("bladder", 2)}<div class="hb-col"><span>膀胱</span><div class="bar"><i></i></div></div><b class="num"></b></div>
        <div class="hud-budget" title="${s.stage.budgetPerDay ? `医療費。1日（${data.rules.time.secondsPerGameDay}秒）ごとに +${yen(s.stage.budgetPerDay)} 増える` : `医療費の予算 ${yen(s.stage.budget)}`}">${iconImg("coin", 2)}<div class="hb-col"><span>医療費</span><small>${s.stage.budgetPerDay ? `+${yen(s.stage.budgetPerDay)}／日` : `／${yen(s.stage.budget)}`}</small></div><b class="budget"></b></div>
        <div class="hud-ctrl"><button class="abg-open" title="アンチバイオグラム：細菌ごとに薬が効く割合の表（A キー）。開いている間は一時停止">${iconImg("chart", 1)}<span>アンチバイオグラム</span></button><button class="help-open" title="遊び方の要点（H キー）。開いている間は一時停止"><span>？</span></button><button class="pause" title="一時停止（スペース）">${pauseLabel(false)}</button><button class="speed" title="速さ（×1・×2・×4）">${speedLabel(opts.session.speed)}</button></div>
      </div>
      <div class="zones" style="left:${LAYOUT.x0}px;width:${LAYOUT.x1 - LAYOUT.x0}px">
        <span class="z-near" style="width:${laneW * near}px" title="膀胱に近い細菌は、手札のうち効く薬が分かる（効く薬を調べる検査＝薬剤感受性試験）">${iconImg("diskTest", 1)}<b>◀ 効く薬が分かる</b></span>
        <span class="z-mid" style="width:${laneW * (far - near)}px" title="中ほどまで来た細菌は、名前が分かる（培養検査）">${iconImg("dish", 1)}<b>名前が分かる</b></span>
        <span class="z-far" style="width:${laneW * (1 - far)}px" title="遠い細菌は、顕微鏡で見た色と形（グラム染色）だけ。ピンク＝陰性、紫＝陽性">${iconImg("microscope", 1)}<b>色と形だけ</b></span>
      </div>
      <div class="lanes">${Array.from(
        { length: lanesCount },
        (_, i) => `<div class="lane" data-lane="${i}" style="top:${laneTopY(i)}px;height:${LAYOUT.laneH}px;left:${LAYOUT.x0}px;width:${1280 - LAYOUT.x0}px"><span class="lane-msg"></span></div>`,
      ).join("")}</div>
      <div class="ticker" style="bottom:${H - LAYOUT.cardsTop}px;left:${LAYOUT.x0}px;width:${1280 - LAYOUT.x0}px;min-height:${LAYOUT.msgH}px"></div>
      <div class="hand${(opts.shortDrugs ?? []).length && s.stage.hand.length >= MAX_CARDS ? " tight" : ""}" style="top:${LAYOUT.cardsTop}px">${cardHtml}${shortCard(data, opts.shortDrugs ?? [], s.stage.hand.length)}</div>
      <div class="abg-panel" hidden><div class="abg-head">${iconImg("chart", 2)}<b>アンチバイオグラム（このステージの開始時）</b><button class="abg-close">閉じる（A）</button></div>${opts.antibiogram}</div>
      <div class="abg-panel help-panel" hidden><div class="abg-head">${iconImg("info", 2)}<b>遊び方の要点</b><button class="help-close">閉じる（H）</button></div>${helpPanel(data, s.model.id, assist)}</div>
    `;

    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    const cards = new Map<string, { el: HTMLElement; dots: HTMLElement[]; gauge?: HTMLElement; gaugeLabel?: HTMLElement }>();
    // 薬のカードだけ（供給制限の札は除く）
    this.root.querySelectorAll<HTMLElement>(".card[data-drug]").forEach((el) => {
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
      pips: [...this.root.querySelectorAll<HTMLElement>(".wave-pips i")],
      bladderBox: q(".hud-bladder"),
      budgetBox: q(".hud-budget"),
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
      el.addEventListener("mouseenter", () => {
        this.hoverLane = i;
        this.frame();
      });
      el.addEventListener("mouseleave", () => {
        if (this.hoverLane === i) this.hoverLane = null;
        this.frame();
      });
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.select(null);
      });
    });
    this.els.pause.addEventListener("click", () => this.togglePause());
    q(".abg-open").addEventListener("click", () => this.togglePanel("abg"));
    q(".abg-close").addEventListener("click", () => this.togglePanel("abg"));
    q(".help-open").addEventListener("click", () => this.togglePanel("help"));
    q(".help-close").addEventListener("click", () => this.togglePanel("help"));
    q<HTMLInputElement>(".assist-check").addEventListener("change", (e) => {
      this.assist = (e.target as HTMLInputElement).checked;
      storeAssist(this.assist);
      this.frame();
    });
    this.els.speed.addEventListener("click", () => {
      const next = this.session.speed === 1 ? 2 : this.session.speed === 2 ? 4 : 1;
      this.session.speed = next;
      this.els.speed.innerHTML = speedLabel(next);
    });
    // キーは e.code でも見る。試遊で「数字キーでカードを選べない」と指摘された（2026-11-05。手元の英字入力では再現しなかった）。
    // 日本語入力がオンのときは e.key が "Process" や全角の「１」になり、前の判定（e.key が半角の 1〜9）では選べなかった
    // 数字キーとスペース・A キーを、e.code（キーの位置）でも受ける
    this.keyHandler = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9１-９]$/.test(e.key) ? String("123456789１２３４５６７８９".indexOf(e.key) % 9 + 1) : undefined);
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        this.togglePause();
      } else if (e.code === "KeyA" || e.key === "a" || e.key === "A") this.togglePanel("abg");
      else if (e.code === "KeyH" || e.key === "h" || e.key === "H" || e.key === "?") this.togglePanel("help");
      else if (e.key === "Escape") {
        if (this.panel) this.togglePanel(this.panel);
        else this.select(null);
      } else if (digit) {
        const drug = this.drugByKey.get(Number(digit));
        if (drug) {
          e.preventDefault();
          this.select(drug);
        }
      }
    };
    window.addEventListener("keydown", this.keyHandler);
    // カードを配り終えたら、配る動きを外す（選び直したときに、もう一度配られないように）
    this.dealTimer = window.setTimeout(() => this.root.querySelector(".hand")?.classList.add("dealt"), 1400);
    this.unsub = this.session.onEvents((events) => this.handle(events));
    this.message(START_HINT, "hint", 0);
    this.frame();
  }

  /** かざしているレーン（兵士の立つ場所の見本を出す） */
  private hoverLane: number | null = null;
  /** このステージで一度でも召喚したか（それまでは遊び方の案内を出しておく） */
  private summoned = false;

  /** 新しい波が始まった：上の帯の波の表示を光らせる（board.ts の "wave"） */
  waveFlash(): void {
    const box = this.root.querySelector<HTMLElement>(".hud-stage");
    if (box) this.pulse(box, "wave-new");
  }

  private dealTimer = 0;

  destroy(): void {
    window.clearTimeout(this.dealTimer);
    for (const t of this.badgeTimers.values()) window.clearTimeout(t);
    this.opts.onPreview?.(null, 0);
    this.unsub();
    window.removeEventListener("keydown", this.keyHandler);
    this.root.innerHTML = "";
  }

  /** 開いているパネル（アンチバイオグラムか「？」）。開いている間は一時停止する */
  private panel: "abg" | "help" | null = null;
  private pausedBeforePanel = false;
  /** 手札の補助（効く薬のカードを光らせる）がオンか */
  private assist = false;

  /** 確認用：「？」のパネルが開いているか */
  get helpOpen(): boolean {
    return this.panel === "help";
  }

  /** アンチバイオグラムか「？」のパネルを開け閉めする。片方を開くともう片方は閉じる。開いている間は一時停止する */
  private togglePanel(which: "abg" | "help"): void {
    const next = this.panel === which ? null : which;
    const abg = this.root.querySelector<HTMLElement>(".abg-panel:not(.help-panel)")!;
    const help = this.root.querySelector<HTMLElement>(".help-panel")!;
    abg.hidden = next !== "abg";
    help.hidden = next !== "help";
    if (next && !this.panel) {
      this.pausedBeforePanel = this.session.paused;
      this.session.paused = true;
    } else if (!next && this.panel) {
      this.session.paused = this.pausedBeforePanel;
    }
    this.panel = next;
    this.els.pause.innerHTML = pauseLabel(this.session.paused);
  }

  private togglePause(): void {
    // パネルを開いている間は止めたまま（閉じると元に戻る）
    if (this.panel) return;
    this.session.paused = !this.session.paused;
    this.els.pause.innerHTML = pauseLabel(this.session.paused);
    this.root.classList.toggle("paused", this.session.paused);
    if (this.session.paused) {
      // 一時停止の知らせは、知らせの帯に出す（前は帯の上に重ねていて、遊び方の案内を隠していた。試遊の指摘）。
      // ただし、まだ新しい耐性・警告の知らせは消さない（止めて読もうとしたら消えた。試遊の指摘）。止まっていることは金の枠とボタンで分かる
      const t = this.els.ticker;
      const fresh = (t.classList.contains("res") || t.classList.contains("warn")) && !t.classList.contains("old");
      if (!this.root.classList.contains("reserving") && !fresh) this.message(PAUSE_HINT, "pause", 0);
      if (fresh) window.clearTimeout(this.messageTimer);
    } else {
      // 再開したら、止めている間だけの案内（「準備ができたら…」「予約：…」）を消す（試遊の指摘：再開後も残っていた）。
      // まだ一度も召喚していなければ、遊び方の案内に戻す
      this.root.classList.remove("reserving");
      if (this.els.ticker.classList.contains("hint") || this.els.ticker.classList.contains("pause")) {
        if (!this.summoned && this.session.pending.length === 0) this.message(START_HINT, "hint", 0);
        else {
          this.els.ticker.innerHTML = "";
          this.els.ticker.className = "ticker";
        }
      }
    }
  }

  private select(drug: string | null): void {
    this.selected = this.selected === drug ? null : drug;
    if (!this.selected) this.opts.onPreview?.(null, 0);
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
    this.summoned = true;
    // 一時停止中の召喚は、再開した瞬間に行われる（予約）。盤面には半透明の兵士で出し（board.ts）、帯には予約をまとめて出す。
    // 一時停止の帯は、予約があるあいだは隠して、この知らせを見せる（試遊の指摘：一時停止の帯に隠れていた）
    if (this.session.paused) {
      const data = this.session.state.data;
      const list = this.session.pending.map((p) => `${data.drugById.get(p.drug)?.abbr ?? p.drug} → レーン${p.lane + 1}`).join("、");
      this.root.classList.add("reserving");
      this.message(`一時停止中・予約：${list}。再開すると呼び出します`, "hint", 0);
    }
  }

  /**
   * ステージを止めた状態で始める（試遊の指摘：操作を知る前に菌が来る。ステージ2も、変わった手札を読む前に始まっていた）。
   * 遊び方の案内（①②）も同じ帯に入れる（試遊の指摘：一時停止の帯に隠れて読めなかった）
   */
  pauseAtStart(extra = ""): void {
    if (this.session.paused) return;
    this.togglePause();
    this.message(`スペースか「再開」で始まります。① 下のカードを選ぶ → ② レーンをクリック${extra}`, "hint", 0);
  }

  private lastHp = Infinity;
  private lastBudget = Infinity;

  /** 値が動いたときの短い合図（CSS のアニメーションを付け直し、終わったら外す） */
  private pulse(el: HTMLElement, cls: string, autoRemove = true): void {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    if (!autoRemove) return;
    const done = (e: AnimationEvent) => {
      if (e.target !== el && !el.contains(e.target as Node)) return;
      el.classList.remove(cls);
      el.removeEventListener("animationend", done);
    };
    el.addEventListener("animationend", done);
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
    // 片付いた波の数は、帯の下の目盛り（緑）で分かるので、文字では書かない（2026-11-06「文字が多すぎる」）
    this.set("wave", this.els.wave, "text", `波 ${startedWaves} / ${s.stage.waves.length}`);
    this.els.wave.title = `片付いた波 ${cleared} / ${s.stage.waves.length}`;
    this.els.pips.forEach((pip, i) => this.set(`pip${i}`, pip, "class", s.waveRemaining[i] === 0 && i < startedWaves ? "done" : i < startedWaves ? "on" : ""));
    if (s.bladderHp < this.lastHp - 1e-6) this.pulse(this.els.bladderBox, "hit");
    this.lastHp = s.bladderHp;
    if (s.budget > this.lastBudget + 0.5) this.pulse(this.els.budgetBox, "gain");
    else if (s.budget < this.lastBudget - 0.5) this.pulse(this.els.budgetBox, "spend");
    this.lastBudget = s.budget;
    const frac = s.bladderHp / s.stage.bladderHp;
    this.set("bb", this.els.bladderBar, "width", `${(frac * 100).toFixed(1)}%`);
    this.set("bbc", this.els.bladderBar, "class", frac < 0.3 ? "low" : frac < 0.6 ? "mid" : "");
    this.els.bladderBox.classList.toggle("low", frac < 0.3);
    // 耐久が2割を切ったら、盤面の縁を赤く脈打たせる（style.css）
    document.body.classList.toggle("danger", frac < 0.2 && !this.ended);
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
      c.el.classList.toggle("poor", costPerDose(data, drug) > s.budget + 1e-9);
      if (c.gauge && c.gaugeLabel) {
        const cls = data.drugById.get(drug)!.class;
        const g = s.gauge[cls] ?? 0;
        const step = Math.floor(g / B.gaugePerStep);
        this.set(`g${drug}`, c.gauge, "width", `${(((g % B.gaugePerStep) / B.gaugePerStep) * 100).toFixed(0)}%`);
        this.set(`gl${drug}`, c.gaugeLabel, "text", `耐性ゲージ 段${step}`);
      }
    }

    // 手札の補助（「？」でオンにしたときだけ）：正体が分かっている細菌のうち膀胱にいちばん近い1匹に効くカードに、緑の縁と「効く」の札
    const target = this.assist ? nearestRevealed(s) : undefined;
    const fit = target ? new Set(effectiveTag(s.stage.hand.map((h) => h.drug), target.resistant, (d) => d).drugs) : null;
    for (const [drug, c] of this.els.cards) c.el.classList.toggle("fits", fit?.has(drug) ?? false);
    const hand = this.root.querySelector<HTMLElement>(".hand");
    if (hand) {
      // 札は膀胱の下の狭い場所（幅 140px）に出すので短く（レーンは、盤面の札と緑の縁で分かる）
      const label = target ? `${(data.bacteriumById.get(target.species)?.name ?? target.species).replace(/（.*?）/g, "")}に効く` : "";
      hand.classList.toggle("assisting", label !== "");
      if (hand.dataset.assist !== label) hand.dataset.assist = label;
    }

    // カードを選んでいるとき：かざしたレーンだけを光らせ、兵士が立つ場所に見本と札を出す（試遊の指摘：3本ともピンクに光り、立つ場所も分からなかった）
    let previewed = false;
    this.els.lanes.forEach((el, lane) => {
      const msg = el.firstElementChild as HTMLElement;
      if (!this.selected) {
        this.set(`lane${lane}`, el, "class", "lane");
        this.set(`lanem${lane}`, msg, "text", "");
        return;
      }
      const r = canSummon(s, this.selected, lane);
      const abbr = data.drugById.get(this.selected)?.abbr ?? "";
      let text = this.session.paused ? `ここに ${abbr} を予約（クリック）` : `ここに ${abbr} を呼び出す（クリック）`;
      if (r === "cooldown") {
        const left = ((s.readyAt.get(`${this.selected}:${lane}`) ?? 0) - s.tick) / tps;
        text = `${abbr}：待ち ${left.toFixed(1)}秒（投与間隔）`;
      } else if (r) text = `${abbr}：${rejectLabel(r)}`;
      const hover = this.hoverLane === lane;
      this.set(`lane${lane}`, el, "class", `lane target${r ? " blocked" : ""}${hover ? " hover" : ""}`);
      this.set(`lanem${lane}`, msg, "text", text);
      if (hover) {
        const slot = this.opts.onPreview?.(r ? null : this.selected, lane) ?? 0;
        // 札は、兵士が立つ場所の右に出す（レーンの左端からの位置）
        this.set(`lanex${lane}`, msg, "class", `lane-msg at${Math.min(2, slot)}`);
        previewed = true;
      }
    });
    if (!previewed) this.opts.onPreview?.(null, 0);
  }

  /** 耐性率が上がった薬のカードに、しばらく「↑ 効かない細菌」の札を出す（style.css の res-up） */
  private badgeTimers = new Map<string, number>();
  private badge(drug: string): void {
    const el = this.els.cards.get(drug)?.el;
    if (!el) return;
    this.pulse(el, "res-up", false);
    window.clearTimeout(this.badgeTimers.get(drug));
    this.badgeTimers.set(drug, window.setTimeout(() => el.classList.remove("res-up"), 6000));
  }

  private handle(events: GameEvent[]): void {
    const data = this.session.state.data;
    for (const e of events) {
      if (e.type === "rejected" && e.reason !== "ended") this.message(`${data.drugById.get(e.drug)?.abbr}：${rejectLabel(e.reason)}`, "warn");
      else if (e.type === "resistanceChanged") {
        // 2行にする：1行目に何が起きたか（選択圧の仕組みを平易な言葉で）、2行目に効かない割合の変化。
        // 2026-11-05 作者の判断（docs/PLAIN-LANGUAGE.md 3章）。前は1行で、ステージ2では右端が切れていた（試遊の指摘）
        // 2026-11-06「文字が多すぎる」：1行目を短く、2行目は「効かない割合」を頭に一度だけ書く
        const head =
          e.cause === "wave"
            ? `波${(e.wave ?? 0) + 1}が片付いた：効く細菌は減り、効かない細菌が残った（選択圧）`
            : `耐性ゲージ（${escapeHtml(data.classById.get(e.drugClass ?? "")?.name ?? e.drugClass ?? "")}）が1段上がった：この系統がまとめて効きにくくなった`;
        const note = this.anyLinked(e.changes) ? "　※まだ使っていない薬（耐性の連動）" : "";
        const lines = this.topChanges(e.changes);
        if (lines.length) {
          // 耐性の知らせは、ほかの知らせより長く出す（試遊の指摘：8秒で薄くなり読み逃す）
          this.message(`<span class="tk-line">${head}</span><span class="tk-line">効かない割合　${lines.join("　")}${note}</span>`, "res", 12000);
          for (const c of this.pickChanges(e.changes)) this.badge(c.drug);
        }
      } else if (e.type === "end" && !this.ended) {
        this.ended = true;
        window.setTimeout(() => this.opts.onEnd(), 1400);
      }
    }
  }

  /** 上がった組（topChanges と同じもの）に、このステージでまだ使っていない薬があるか */
  private anyLinked(changes: ResistanceChange[]): boolean {
    const used = this.session.state.stats.activeTicks;
    return this.pickChanges(changes).some((c) => !((used[c.drug] ?? 0) > 0));
  }

  private pickChanges(changes: ResistanceChange[]): ResistanceChange[] {
    const hand = new Set(this.session.state.stage.hand.map((h) => h.drug));
    // 0.5 ポイント未満と、表示で同じ数字に丸まる変化（「36% → 36%」）は出さない（試遊の指摘）
    return changes
      .filter((c) => hand.has(c.drug) && c.to - c.from >= 0.005 && pct(c.from) !== pct(c.to))
      .sort((a, b) => b.to - b.from - (a.to - a.from))
      .slice(0, 2);
  }

  /** 手札の薬について、上がり幅の大きい順に2つ（0.5ポイント未満は出さない）。まだ使っていない薬（連動で上がった）には ※ */
  private topChanges(changes: ResistanceChange[]): string[] {
    const s = this.session.state;
    const used = s.stats.activeTicks;
    return this.pickChanges(changes).map(
      (c) =>
        `${escapeHtml(s.data.bacteriumById.get(c.species)?.name ?? c.species)}の ${escapeHtml(s.data.drugById.get(c.drug)?.abbr ?? c.drug)}${(used[c.drug] ?? 0) > 0 ? "" : "※"} ${pct(c.from)} → <b>${pct(c.to)}</b>`,
    );
  }

  private messageTimer = 0;

  /** レーンの下の帯に知らせを出す。新しい知らせが来るまで残し、しばらくしたら薄くする（ms が 0 なら薄くしない） */
  message(html: string, kind: TickerKind = "res", ms = 8000): void {
    const el = this.els.ticker;
    el.innerHTML = `<span class="tk-ico">${iconImg(TICKER_ICON[kind], 1)}</span><span class="tk-text">${html}</span>`;
    el.className = `ticker ${kind}`;
    window.clearTimeout(this.messageTimer);
    if (ms > 0) this.messageTimer = window.setTimeout(() => el.classList.add("old"), ms);
  }
}
