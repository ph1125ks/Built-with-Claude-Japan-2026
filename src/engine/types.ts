// ゲームエンジンの型。エンジンは描画から切り離し、ブラウザなしでも動く。

export type Gram = "positive" | "negative";
export type Shape = "rod" | "slender-rod" | "coccus";
export type Arrangement = "single" | "pair" | "chain" | "cluster";
export type Route = "iv" | "po";
/** WHO の AWaRe 分類 */
export type AwareGroup = "Access" | "Watch" | "Reserve";

// ---------- カタログ（data/catalog/） ----------

export interface BacteriumDef {
  id: string;
  name: string;
  sciName: string;
  janis: string;
  gram: Gram;
  look: { shape: Shape; arrangement: Arrangement; size: number; capsule: boolean; flagella: boolean };
  /** 自然耐性の薬（カードの id） */
  intrinsicResistance: string[];
  hp: number;
  /** 1秒に進む距離（レーンの長さは rules.board.laneLength） */
  speed: number;
  bladderDamage: number;
}

export interface DrugDef {
  id: string;
  abbr: string;
  name: string;
  class: string;
  route: Route;
  dosesPerDay: number;
  /** 内服の吸収率（0〜1）。注射は null */
  bioavailability: number | null;
  /** 膀胱での効きやすさ（尿中移行）。1 が標準 */
  urineFactor: number;
  /** WHO の AWaRe 分類。ボットの「狭い順」はこれと rules.stewardship で決める */
  aware: AwareGroup;
  /** ASC スコア（抗菌スペクトラムの広さ。ASP ガイダンス2024 表5）。表にない薬は null */
  asc: number | null;
  /** JANIS の表の抗菌薬名。null は代用（rules.susceptibility.proxies）だけで決まる */
  janis: string | null;
  /** 薬価リストで代表にする成分名と規格。plus は、1日量を別の規格と組み合わせるとき（例：AMK 900mg ＝ 200mg × 4 ＋ 100mg × 1） */
  price: { list: "injection" | "oral"; ingredient: string; spec: string; plus?: { spec: string; units: number }[] };
  dosing: { label: string; unitsPerDay: number };
}

export interface DrugClassDef {
  id: string;
  name: string;
  color: string;
}

// ---------- ルール（data/rules.json） ----------

export type ResistanceModelId = "none" | "A" | "B";

export interface SusceptibilityProxy {
  bacteria: string[];
  drug: string;
  /** この JANIS の抗菌薬名の値で代用する */
  useJanis?: string;
  /** 効く確率をこの値に固定する */
  fixedSusceptible?: number;
  note: string;
}

export interface Rules {
  time: { ticksPerSecond: number; secondsPerGameDay: number };
  board: {
    lanes: number;
    laneLength: number;
    /** 膀胱からの距離がレーン長のこの割合より近いと菌名が分かる */
    revealSpeciesBelow: number;
    /** 同じく、この割合より近いと感受性が分かる */
    revealSusceptibilityBelow: number;
    maxUnitsPerLane: number;
  };
  units: { fullHp: number; power: number };
  susceptibility: {
    conversion: "S_ONLY" | "S_PLUS_HALF_SORI";
    proxies: SusceptibilityProxy[];
    missing: "NOT_EFFECTIVE";
  };
  cost: {
    mode: "yakka" | "abstract";
    representativePrice: "MIN" | "BRAND";
    yakkaTiers: { maxYenPerDay: number | null; tier: number }[];
    costPerDayByTier: Record<string, number>;
    abstractCostPerDay: Record<string, number>;
  };
  resistance: ResistanceRules;
  /** 耐性の連動（例：ESBL）。trigger に耐性の個体は alsoResistant にも耐性 */
  linkedResistance: LinkedResistance[];
  stewardship: {
    groupOrder: AwareGroup[];
    /** 同じ群の中で最後に回す系統（カルバペネム系など） */
    spareLastWithinGroup: string[];
    /** Access 薬の使用割合の目標（WHO） */
    accessTarget: number;
  };
}

/** 耐性化の設定（data/rules.json の resistance）。式は src/engine/resistance.ts */
export interface ResistanceRules {
  model: ResistanceModelId;
  /** 耐性化の速さを何倍にするか（ゲーム用の誇張）。A・B のどちらにも掛かる */
  exaggeration: number;
  /** A：選択圧の再現 */
  A: {
    /** 波の中のその菌が全員その薬に十分さらされたときに、耐性のオッズの対数（logit）を上げる量 */
    logitPerWave: number;
    /** 1匹がこの秒数さらされたら「十分さらされた」とみなす（短ければ割合で数える） */
    fullExposureSeconds: number;
    /** この値未満の耐性率（0% を含む）は、さらされたときにこの値として上げ始める（外から持ち込まれうるとみなす） */
    minRate: number;
    /**
     * 公開データで同じ値を使っている薬の組（代用の組）。bacteria の菌では、組のどちらにさらされても同じ薬にさらされたとみなし、
     * 組の薬を同じだけ上げる（2026-11-03 作者の判断）。組は susceptibility.proxies の useJanis と一致していること
     */
    sharedSelection?: { drugs: [string, string]; bacteria: string[] }[];
  };
  /**
   * 系統の偏り：1つの系統が使用日数の referenceShare を超えて使われると選択圧が強まり、下回ると弱まる。
   * 倍率 ＝ （その系統の使用日数の割合 ÷ referenceShare）^ exponent（minFactor〜maxFactor に収める）。exponent 0 で無効。
   * 使用日数の合計が minDays に届くまでは 1（最初の波で1系統しか使っていないだけで倍率が上がらないように）
   */
  balance: { referenceShare: number; exponent: number; minFactor: number; maxFactor: number; minDays: number };
  /** B：耐性ゲージ */
  B: {
    /** ゲージ1段の大きさ（「広さ × 効いている日数」の合計） */
    gaugePerStep: number;
    /** 1段上がるごとに、まだ効いている菌のうち耐性になる割合 */
    risePerStep: number;
  };
  /**
   * 未来ステージへの引き継ぎ。
   * dataYear：開始時の耐性率のデータの年（JANIS 2025年報なら 2025）。未来ステージの年 ＝ dataYear ＋ yearsLater
   * stagesPerYear：1年あたり、ステージ1と同じ使い方が何回分続いたとみなすか（モデルごと。速さの決め方は rules.json の basis）
   */
  carryOver: {
    dataYear: number;
    stagesPerYear: { A: number; B: number };
    /**
     * 1年あたりの上がり方の上限（オッズの対数）＝ observed × exaggeration。
     * observed は公的な実測（NAOR 2024 の JANIS の推移）で、いちばん速く上がった組の傾き。exaggeration はゲーム用の誇張の倍率
     */
    maxLogitPerYear: { observed: number; exaggeration: number };
    /**
     * 使わなかった薬の下がり方（2026-11-03 作者の判断）。ステージ1で一度も使わなかった薬は、未来の年までに、
     * 公的な実測（NAOR 2024）で耐性率が下がっていた組に限って、その組の傾きで下がる。ステージ1の中では下げない。
     * logitPerYear：菌 → 薬 → 1年あたりのオッズの対数の変化（負の数）。maxLogitPerYear：下がり方の上限（正の数。実測でいちばん速く下がった組）
     */
    declineWhenUnused: { logitPerYear: Record<string, Record<string, number>>; maxLogitPerYear: number };
  };
}

/** 耐性率の変化（結果画面と、遊んでいる途中の知らせに使う） */
export interface ResistanceChange {
  species: string;
  drug: string;
  from: number;
  to: number;
}

export interface LinkedResistance {
  bacteria: string[];
  trigger: string;
  alsoResistant: string[];
  basis: string;
}

// ---------- 公開データ（data/generated/） ----------

export interface Counts {
  total: number | null;
  S: number | null;
  SorI: number | null;
  I: number | null;
  IorR: number | null;
  R: number | null;
  NS: number | null;
  ND: number | null;
}

export interface JanisData {
  criteria: string;
  specimen: string;
  regions: string[];
  /** 地域 → 菌 id → JANIS の抗菌薬名 → 株数 */
  susceptibility: Record<string, Record<string, Record<string, Counts>>>;
  /** 地域 → 菌 id → 尿からの分離菌数（_total は表の全菌の合計） */
  urineIsolation: Record<string, Record<string, number>>;
}

export interface PriceEntry {
  min: number;
  max: number;
  brand: number | null;
  unitsPerDay: number;
  yenPerDayMin: number;
  yenPerDayBrand: number | null;
}

export interface PriceData {
  drugs: Record<string, PriceEntry>;
}

export interface GameData {
  rules: Rules;
  classes: DrugClassDef[];
  drugs: DrugDef[];
  bacteria: BacteriumDef[];
  drugById: Map<string, DrugDef>;
  bacteriumById: Map<string, BacteriumDef>;
  classById: Map<string, DrugClassDef>;
  janis: JanisData;
  prices: PriceData;
}

/** 菌 id → 薬 id → 効かない確率（0〜1）。自然耐性は 1 */
export type ResistanceTable = Record<string, Record<string, number>>;

// ---------- ステージ（シナリオ） ----------

export interface HandEntry {
  drug: string;
  /** 召喚できる回数の上限（供給制限）。null または省略で上限なし */
  stock?: number | null;
}

export interface WaveDef {
  /** 開始時刻（秒） */
  at: number;
  /** レーン番号（0 始まり）か "random" */
  lane: number | "random";
  /** 菌の id か "auto"（地域の尿の分離菌の割合で選ぶ）か、菌 → 重みの組み合わせ（{ mix: { ecoli: 2, efaecalis: 1 } }） */
  species: string | "auto" | { mix: Record<string, number> };
  count: number;
  /** 1匹ごとの間隔（秒） */
  spacing: number;
}

export interface StageDef {
  title: string;
  briefing?: string;
  /** 医療費：はじめに使える額 */
  budget: number;
  /**
   * 医療費：1日（rules.time.secondsPerGameDay 秒）ごとに増える額。ティックごとに少しずつ足す。省略すると 0（はじめの額だけ）。
   * 2026-11-03 作者の希望：最初から上限が決まっているのではなく、時間とともに増えるように
   */
  budgetPerDay?: number;
  /** 医療費：ためておける上限。省略すると上限なし */
  budgetMax?: number;
  /**
   * 供給制限：遊ぶたびに、手札の候補から count 枚が「今回は使えない」になる（種で決まる。src/engine/shortage.ts）。
   * candidates：使えなくなりうる薬（省略すると手札すべて）。keepSusceptible：出てくる菌それぞれに、公開データでこの感性率以上の薬が
   * 1枚は残るようにする（既定 0.8）。2026-11-03 作者の希望（何度も遊びたくなるように。実臨床の供給制限）
   */
  shortage?: { count: number; candidates?: string[]; keepSusceptible?: number };
  bladderHp: number;
  hand: HandEntry[];
  waves: WaveDef[];
}

export interface ScenarioDef {
  id: string;
  title: string;
  /** JANIS の地域名（"全国" または府県名） */
  region: string;
  target?: string;
  learningGoal?: string;
  debrief?: string;
  present: StageDef;
  future: StageDef & { yearsLater: number };
}

// ---------- 実行中の状態 ----------

export type RevealLevel = "gram" | "species" | "susceptibility";

export interface Bacterium {
  uid: number;
  species: string;
  lane: number;
  /** 膀胱からの距離（0 で膀胱に着く） */
  x: number;
  hp: number;
  maxHp: number;
  wave: number;
  /** この個体に効かない薬（自然耐性を含む） */
  resistant: Set<string>;
  level: RevealLevel;
  /** 耐性で弾いたことのある薬（表示を一度だけ出すため） */
  met: Set<string>;
  /** 薬ごとにさらされたティック数 */
  exposure: Record<string, number>;
}

export interface Unit {
  uid: number;
  drug: string;
  lane: number;
  hp: number;
  decayPerTick: number;
  bornTick: number;
}

export interface SummonCommand {
  type: "summon";
  drug: string;
  lane: number;
}
export type Command = SummonCommand;

export type RejectReason = "notInHand" | "noStock" | "cooldown" | "budget" | "laneFull" | "badLane" | "ended";

export type GameEvent =
  | { type: "spawn"; uid: number; species: string; lane: number }
  | { type: "reveal"; uid: number; level: RevealLevel }
  | { type: "summon"; unit: number; drug: string; lane: number; cost: number; hp: number }
  | { type: "rejected"; drug: string; lane: number; reason: RejectReason }
  | { type: "resisted"; uid: number; drug: string; intrinsic: boolean }
  | { type: "killed"; uid: number; drug: string }
  | { type: "leaked"; uid: number; damage: number }
  | { type: "expired"; unit: number }
  | { type: "waveCleared"; wave: number }
  | { type: "resistanceChanged"; cause: "wave" | "gauge"; wave?: number; drugClass?: string; changes: ResistanceChange[] }
  | { type: "end"; outcome: "won" | "lost" };

export interface GameStats {
  summons: Record<string, number>;
  /**
   * 薬ごとに、投与していたティック数の合計（1回の召喚で投与間隔の長さ。レーンごとに足す）。
   * DOT にならった数え方で、体内の量や吸収率にはよらない（内服薬も投与間隔の長さで数える）
   */
  activeTicks: Record<string, number>;
  kills: Record<string, number>;
  costSpent: number;
  /** 時間とともに増えた医療費の合計（budgetPerDay） */
  budgetIncome: number;
  /** 医療費が手札でいちばん安い1回分に届かなかったティック数（予算で召喚が止まっていた長さの目安） */
  budgetShortTicks: number;
  spawned: number;
  leaked: number;
  /** 出てきた個体のうち、手札のどの薬にも耐性だったもの（SPEC.md 9.1 の比べる数値） */
  panResistant: number;
}

export interface SpawnPlan {
  tick: number;
  lane: number;
  species: string;
  wave: number;
}

export type Outcome = "playing" | "won" | "lost";
