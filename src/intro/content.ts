// 「はじめての人へ」のページ（intro.html）の文と、データから作る表。DOM を使わない（テストで確かめる）。
// 医学的な文は docs/PLAIN-LANGUAGE.md の「1. 前提の鎖」の文をそのまま使う（2026-11-05 作者の判断。tests/intro.test.ts で、文書の表にあるかを確かめる）。
// 言い換え（かっこの中の専門用語）は同じ文書の「2. 言い換えの表」から。ゲームの説明の文は「3. ゲームの文案」から。
import { COVER_S, susceptibility, type GameData } from "../engine/index.ts";

/** 前提の鎖の1段 */
export interface ChainStep {
  n: number;
  /** 見出し（前提の鎖の表の「見出し」） */
  title: string;
  /** 文（前提の鎖の表の「文」。文ごとに分けてある。つなげると表の文になる） */
  sentences: string[];
}

/** 前提の鎖（docs/PLAIN-LANGUAGE.md 1.）。文は1字も変えない */
export const CHAIN: ChainStep[] = [
  {
    n: 1,
    title: "細菌",
    sentences: [
      "細菌は、目に見えないほど小さな生き物。",
      "体に入ると、病気を起こすことがあります。",
      "膀胱炎（おしっこをためる膀胱の感染症）も、細菌が原因です。",
      "かぜの多くはウイルスが原因で、細菌とは別のものです",
    ],
  },
  {
    n: 2,
    title: "抗菌薬",
    sentences: ["抗菌薬（いわゆる抗生物質）は、細菌を倒す薬です。", "ウイルスには効きません"],
  },
  {
    n: 3,
    title: "効く相手が違う",
    sentences: ["抗菌薬は、薬ごとに効く細菌が違います。", "ねらいをしぼった薬もあれば、ほとんどの細菌に効く「切り札」もあります（例：メロペネム。カルバペネム系）"],
  },
  {
    n: 4,
    title: "切り札が選ばれやすい理由",
    sentences: [
      "はじめは、どの細菌が原因か分かりません。",
      "調べる検査の結果が出るまで、数日かかります。",
      "外して悪くなるのが怖いので、「ほとんどに効く切り札」が選ばれやすくなります",
    ],
  },
  {
    n: 5,
    title: "選択圧",
    sentences: [
      "薬を使うと、効く細菌は倒れます。",
      "でも、たまたま薬が効かない細菌がいると、それだけが生き残って増えます。",
      "変わるのは人の体ではなく、細菌のほうです。",
      "切り札ほど、多くの種類の細菌にこの「ふるい」をかけます。",
      "これが選択圧（せんたくあつ）。",
      "ゲームの名前「センタクアツ」は、ここから取りました",
    ],
  },
  {
    n: 6,
    title: "効く薬がなくなる",
    sentences: [
      "薬が効かない細菌が増えると、本当に必要なときに、効く薬がなくなります。",
      "新しい抗菌薬は、なかなか生まれません。",
      "対策をとらなければ、2050年に薬剤耐性による死亡が年間1,000万人になり、がんを超えるという試算もあります",
    ],
  },
  {
    n: 7,
    title: "適正使用",
    sentences: [
      "検査で細菌と効く薬が分かったら、切り札を使わずに、その細菌に合う薬へ切り替えます。",
      "切り札は、本当に必要なときのために取っておきます。",
      "これが抗菌薬の適正使用です",
    ],
  },
  {
    n: 8,
    title: "知ることの意味",
    sentences: ["抗菌薬を、なぜ適切に使わなければいけないのか。", "それを知ることは、抗菌薬を処方された人が、自分の薬の意味を理解することにもつながります"],
  },
];

/** 文の終わりに「。」を足す（表の文は、最後の文に句点がない） */
export const withPeriod = (s: string) => (s.endsWith("。") ? s : `${s}。`);

/** 各段の「ゲームでは」の一言（docs/PLAIN-LANGUAGE.md 3. の遊び方の文から） */
export const IN_GAME: Record<number, string> = {
  1: "ゲームでは、細菌が、膀胱（おしっこをためる袋）に向かってきます。膀胱に細菌が入ると耐久が減り、0 になると負けです。",
  2: "ゲームでは、下の手札から抗菌薬を選んで、兵士として呼び出し、細菌を倒します。",
  3: "ゲームでは、ほとんどの細菌に効く「切り札」（機械兵の姿。カルバペネム系）と、ねらいをしぼった薬があります。",
  4: "ゲームでは、遠くでは顕微鏡で見た色と形だけ、近づくと名前、さらに近づくと効かない薬が分かります（実際の検査の結果が、時間差で届くのと同じです）。",
  5: "ゲームでは、切り札ばかり使うと、2050年に、自分が残した細菌が攻めてきます。",
};

/** 図の札（言い換えの表の「字幕・画面」の言い方） */
export const LABELS = {
  bladder: "膀胱（おしっこをためる袋）",
  bacteria: "細菌",
  virus: "ウイルス",
  virusNote: "かぜの多く。細菌とは別のもの",
  antibiotic: "抗菌薬（いわゆる抗生物質）",
  resistant: "薬が効かない細菌（耐性菌）",
  susceptible: "薬が効く細菌",
  trump: "切り札の薬（メロペネム：カルバペネム系）",
  far: { zone: "遠い", what: "顕微鏡で見た色と形", term: "グラム染色" },
  mid: { zone: "中ほど", what: "細菌の名前", term: "培養検査" },
  near: { zone: "近い", what: "効く薬", term: "感受性" },
  days: "検査の結果が出るまで、数日かかる",
  selection: "選択圧（せんたくあつ）",
  deescalation: "合う薬へ切り替える（デエスカレーション）",
  stewardship: "抗菌薬の適正使用",
  amr: "薬剤耐性（AMR）",
} as const;

// ---------- 3. 効く相手が違う：公開データの表 ----------

/** 表に出す細菌（ゲームの5種。尿から多く分離される順） */
export const TABLE_BACTERIA = ["ecoli", "kpneumoniae", "pmirabilis", "paeruginosa", "efaecalis"] as const;
/** 表に出す薬：ねらいをしぼった薬2つと、切り札のメロペネム（作者が差し替えられるよう、ここで決める） */
export const TABLE_DRUGS = ["ABPC", "CMZ", "MEPM"] as const;
/** 表の地域（公開の既定ステージと同じ全国） */
export const TABLE_REGION = "全国";
/** 「効く見込みが高い」とみなす割合。ゲームで「手札に効く薬がある」とみなす感性率（COVER_S）と同じ */
export const HIGH_AT = COVER_S;

export type Effect = "high" | "low";

export interface EffectRow {
  bacterium: string;
  cells: { drug: string; effect: Effect }[];
}

/** 細菌 × 薬の「効く見込み」（高い・低い）。数値はゲームと同じ公開データ（JANIS）から読む。自然耐性・効かない扱いは「低い」 */
export function effectTable(data: GameData, region: string = TABLE_REGION, bacteria: readonly string[] = TABLE_BACTERIA, drugs: readonly string[] = TABLE_DRUGS): EffectRow[] {
  return bacteria.map((b) => ({
    bacterium: b,
    cells: drugs.map((d) => ({ drug: d, effect: susceptibility(data, region, b, d).p >= HIGH_AT ? "high" : "low" })),
  }));
}

/** 表の短い細菌の名前（スマホの幅に収める） */
export function shortBacteriumName(data: GameData, id: string): string {
  const name = data.bacteriumById.get(id)?.name ?? id;
  return name.replace(/（.*?）/g, "").replace("プロテウス・ミラビリス", "プロテウス");
}

export const TABLE_TEXT = {
  high: "効く見込みが高い",
  low: "効く見込みが低い",
  note: `国の公開データ（JANIS）2025年・全国。調べた細菌のうち、薬が効いた割合が${Math.round(HIGH_AT * 10)}割以上なら「高い」、それより少なければ「低い」（もともと効かない組み合わせも「低い」）。ゲームも同じデータで始まります。`,
  /** 動画用の短い出典 */
  noteShort: "国の公開データ（JANIS）2025年・全国",
  trumpBadge: "切り札",
} as const;

// ---------- 5. 選択圧の動く絵の札 ----------

export const SIEVE_TEXT = {
  start: "同じ種類の細菌の中に、薬が効かない細菌が少しだけいます",
  drug: "薬を使うと、効く細菌は倒れます",
  grown: "効かない細菌だけが生き残って、増えました",
  again: "同じ薬をもう一度使っても、倒れません",
  body: "変わるのは人の体ではなく、細菌のほうです",
  bodySame: "人の体：変わらない",
  bugsChanged: "細菌：薬が効かない細菌が増えた",
  buttons: { drug: "薬を使う", grow: "増える", again: "もう一度、同じ薬を使う", reset: "はじめから" },
  mark: "盾の印＝薬が効かない細菌（耐性菌）",
} as const;

// ---------- 6. 2050年の試算 ----------

/** The Review on Antimicrobial Resistance（議長 Jim O'Neill）2014年12月 p.5 の数値（1年あたりの死亡数、万人） */
export const AMR_2050 = {
  bars: [
    { key: "amr2050", label: "薬剤耐性（2050年の試算）", value: 1000, tone: "bad" },
    { key: "cancer", label: "がん（報告書のころ）", value: 820, tone: "dim" },
    { key: "amrNow", label: "薬剤耐性（報告書のころ。少なく見積もって）", value: 70, tone: "warn" },
  ],
  unit: "1年あたりの死亡数",
  note: "対策をとらずに耐性が上がり続けた場合の、おおまかな試算です。数値は、細菌以外（マラリア・HIV・結核）の薬剤耐性も含みます。",
  source:
    "出典：The Review on Antimicrobial Resistance（議長 Jim O'Neill）「Antimicrobial Resistance: Tackling a Crisis for the Health and Wealth of Nations」2014年12月、p.5",
} as const;

/** 万人を「1,000万人」の形にする */
export function manNin(v: number): string {
  return `${v.toLocaleString("ja-JP")}万人`;
}

// ---------- 7. 並べ比べ ----------

export const COMPARE = {
  title: "ゲームでは",
  rows: [
    { key: "abuse", label: "切り札ばかり使う", present: "楽に守れる", future: "自分が残した、薬が効かない細菌に負ける", win: [true, false] },
    { key: "proper", label: LABELS.deescalation, present: "守れる", future: "2050年も守れる", win: [true, true] },
  ],
  stage1: "ステージ1（いま）",
  stage2: "ステージ2（2050年）",
} as const;

// ---------- ページの枠 ----------

export const PAGE = {
  title: "はじめての人へ",
  logo: "センタクアツ",
  logoSub: "選択圧（せんたくあつ）から",
  lead: "センタクアツは、抗菌薬の使い方を学ぶゲームです。医療を知らない人にも分かるように、遊ぶ前に知っておきたいことを、8つの段で順に説明します。",
  play: "ゲームで遊ぶ",
  replay: "Claude がステージを作った記録",
  replayNote: "教える人が、地域の公開データと教えたいことを入れて、Claude（Anthropic の AI）にステージを作らせたときの記録です。",
  caution: ["このゲームは教育用のシミュレーションです。実際の診療の判断には使えません。", "耐性化の速さは、ゲーム用に大げさにしています。"],
  dataNote: "細菌と薬のデータは、国の公開データ（JANIS：国が集めている、病院の細菌の検査データ）2025年報から作っています。",
} as const;

/** ページに出す文をすべて集める（テストで、使わない言葉や指示に読める文がないかを見る） */
export function allTexts(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk([CHAIN, IN_GAME, LABELS, TABLE_TEXT, SIEVE_TEXT, AMR_2050, COMPARE, PAGE]);
  return out;
}
