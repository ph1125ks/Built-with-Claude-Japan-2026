// 遊ぶ前後の画面（DOM）：タイトル、遊び方、ブリーフィング、結果、まとめ、出典。
// ボタンは data-action を持ち、app.ts がまとめて受ける。
import { futureYear, susceptibility, type BacteriumDef, type GameData, type ResistanceModelId, type ResistanceTable, type ScenarioDef, type StageDef, type StageResult } from "../engine/index.ts";
import { GRAM_COLORS } from "./bugs.ts";
import { escapeHtml, genericName, isTouchDevice, modelLabel, pct, SPECTRUM_LABELS, spectrumOf, TRUMP_CLASS, yen } from "./format.ts";
import { LEVELS, SOLID_AT, bladderImg, bugImg, iconImg, levelForAmount, soldierImg } from "./pixel/index.ts";

const css = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const GN = css(GRAM_COLORS.negative.fill);
const GP = css(GRAM_COLORS.positive.fill);

/** 注意書き（SPEC.md 7.3）。医療費の文は、医療費の方式（薬価の段階化／抽象コスト）で切り替える */
export function notice(data: GameData): string {
  const cost =
    data.rules.cost.mode === "yakka"
      ? "医療費は、令和8年度の薬価基準をもとに段階化したものです（実際の金額ではありません）。"
      : "医療費はゲーム用の数値で、実際の値段とは関係ありません。";
  // 言葉は docs/PLAIN-LANGUAGE.md の言い換えの表（感受性 → 薬が効く割合、誇張 → 大げさ、JANIS → 国の公開データ）
  return `
  <ul class="notice">
    <li>このゲームは教育用のシミュレーションです。実際の診療の判断には使えません。</li>
    <li>薬が効く割合は、国の公開データ（JANIS）を加工したものです。薬が効かなくなる速さは、ゲーム用に大げさにしています。</li>
    <li>${cost}</li>
  </ul>`;
}

/** タイトル・まとめに出す短い注意書き（2行）。全文は「出典と注意」（2026-11-06「文字が多すぎる」） */
function noticeShort(): string {
  return `<p class="notice compact">教育用のシミュレーションです。実際の診療の判断には使えません。<br>薬が効く割合は国の公開データ（JANIS）をもとにし、効かなくなる速さは大げさにしています。</p>`;
}

export function titleScreen(data: GameData, scenario: ScenarioDef, model: ResistanceModelId, showDev = false): string {
  // 背景の盤面では、ボットが遊んでいる（app.ts の attract）。左に寄せて、右に盤面が見えるようにする。
  // 2026-11-05 作者の判断「すべての人に伝わるように」：名前の由来、抗菌薬とは何か、選択圧の一文、「はじめての人へ」のページ（intro.html）を足した（docs/PLAIN-LANGUAGE.md 3章）。
  // 2026-11-06「文字が多すぎる」：説明は2行に、注意書きは短い2行に（全文は「出典と注意」）
  void data;
  return `
  <div class="screen title-screen">
    <div class="title-logo"><h1>センタクアツ</h1><p class="title-origin">選択圧（せんたくあつ）から</p></div>
    <p class="tagline">あなたの選択が、未来の敵をつくる</p>
    <p class="lead">細菌から膀胱を守る、抗菌薬（いわゆる抗生物質）のタワーディフェンス。<br>使うほど「薬が効かない細菌」が残って増え（選択圧）、「${escapeHtml(scenario.future.title)}」で自分が残した細菌と戦います。</p>
    <div class="title-main">
      <div class="buttons">
        <button class="primary" data-action="start">はじめる</button>
        <a class="btn intro-link" href="./intro.html">はじめての人へ</a>
        <button data-action="howto">遊び方</button>
        <button data-action="sources">出典と注意</button>
      </div>
      <div class="title-side-col">
        ${modelPicker(model)}
        ${noticeShort()}
      </div>
    </div>
    <p class="meta">使うデータ：${escapeHtml(scenario.region)}（JANIS 2025年報）${showDev ? `／ステージ：${escapeHtml(scenario.title)}／${escapeHtml(modelLabel(model))}` : ""}</p>
  </div>`;
}

/** 耐性の進み方（耐性モデル A/B）を選ぶ。2026-11-03 作者の希望（どちらも捨てがたいので、遊ぶ人が選べるように）。説明は一言にし、詳しくは吹き出し（title） */
function modelPicker(model: ResistanceModelId): string {
  const opt = (id: "A" | "B", title: string, text: string, tip: string) =>
    `<button class="model-opt${model === id ? " on" : ""}" data-action="model-${id}" aria-pressed="${model === id}" title="${tip}"><b>${id}：${title}</b><small>${text}</small></button>`;
  return `<div class="model-pick" role="group" aria-label="耐性の進み方">
    <span class="model-pick-label">耐性の進み方<small>迷ったら A のまま</small></span>
    ${opt("A", "薬ごと", "使った薬が効かなくなる", "使った薬ごとに、その薬が効かない細菌が残って増える（選択圧の再現）")}
    ${opt("B", "系統ごと", "同じ系統がまとめて効かなくなる", "同じ系統の薬を使うほど系統のゲージがたまり、その系統の薬がまとめて効かなくなる")}
  </div>`;
}

/** 遊び方の「兵士の姿」の見本：系統ごとに代表の薬を1つ（カタログにない薬は飛ばす） */
const LEGEND: [string, string, string][] = [
  ["ABPC", "ペニシリン系", "剣だけ"],
  ["TAZPIPC", "β-ラクタマーゼ阻害薬との合剤", "剣＋盾"],
  ["CEZ", "第1世代セフェム", "革の胸当て"],
  ["CMZ", "セファマイシン系", "鉄の胸当て"],
  ["CTRX", "第3世代セフェム", "全身の鎧"],
  ["CFPM", "第4世代セフェム", "金の縁・羽飾り"],
  ["MEPM", "カルバペネム系", "機械兵"],
  ["AMK", "アミノグリコシド系", "槌"],
  ["LVFX_PO", "キノロン系", "弓"],
];

function soldierLegend(data: GameData): string {
  const figs = LEGEND.filter(([id]) => data.drugById.has(id))
    .map(([id, cls, look]) => {
      const d = data.drugById.get(id)!;
      return `<figure><div class="px-stage">${soldierImg(data, d, "lane")}</div><figcaption><b>${escapeHtml(d.abbr)}</b><span>${escapeHtml(cls)}</span><small>${escapeHtml(look)}</small></figcaption></figure>`;
    })
    .join("");
  // 2026-11-06「文字が多すぎる」：見本の絵を主役にし、文は短い箇条書きに（事実は前のまま。細かい補足は「出典と注意」の用語の説明「兵士の姿」）
  return `
      <section class="soldier-legend">
        <h3>4. 兵士の姿は、抗菌薬の系統</h3>
        <div class="legend-row">${figs}</div>
        ${densityLegend(data)}
        <ul class="tight">
          <li><b>剣</b>＝β-ラクタム系（機械兵のカルバペネム系も剣）。<b>盾</b>＝β-ラクタマーゼ阻害薬を配合した薬（菌が作る、薬を壊す酵素の多くを抑える）。</li>
          <li><b>鎧</b>＝セフェム系の世代。世代が上がるほど豪華で、おおまかに効くグラム陰性菌の種類が増えます（得意・不得意あり：第3世代はグラム陽性菌に第1世代より弱い。CMZ は ESBL に分解されず、第3・第4世代が効かない菌に効くことがある）。</li>
          <li><b>紋章</b>＝緑膿菌にも効く見込み（カードの「緑膿菌」と同じ目安）。<b>足元のカプセル</b>＝内服薬。</li>
          <li><b>濃さ</b>＝いま体内にある薬の量（薬の良し悪しではない）。6割を切ると点が抜けて薄くなり、0 で消えます。内服薬は吸収率のぶんの量で出るので、吸収率の低い薬は薄く、早く尽きます（届かなかった粒は灰色になって落ちる）。</li>
          <li>同じ系統・同じ世代は同じ姿（見分けは名札の略号）。服や鉢巻きの系統の色は、菌の色（ピンク＝陰性、紫＝陽性）とは関係ありません。</li>
        </ul>
        <p class="caution"><b>姿が立派でも、強い薬・良い薬という意味ではありません。</b>鎧はセフェム系の世代の印で、ほかの系統の広さは表していません（鎧のない弓の LVFX や機械兵のカルバペネム系は、効く範囲がとても広い薬）。効く範囲の広い薬ほど多くの菌に選択圧をかけるので、使いすぎると耐性菌が増えやすくなります。</p>
      </section>`;
}

/** 遊び方の「兵士の濃さ」の見本：注射（満タン）・吸収率の高い内服・吸収率の低い内服・薬が切れかけ（試遊の指摘：見本が注射ばかり） */
function densityLegend(data: GameData): string {
  const items: [string, number, string][] = [
    ["CTRX", 1, "注射：出てきたとき"],
    ["AMPC_PO", data.drugById.get("AMPC_PO")?.bioavailability ?? 1, "内服（吸収率 92%）：注射と同じ濃さ"],
    ["CFDN_PO", data.drugById.get("CFDN_PO")?.bioavailability ?? 1, "内服（吸収率 25%）：はじめから薄い"],
    ["CTRX", 0.15, "薬が切れかけ"],
  ];
  const figs = items
    .filter(([id]) => data.drugById.has(id))
    .map(([id, f, cap]) => {
      const d = data.drugById.get(id)!;
      return `<figure><div class="px-stage">${soldierImg(data, d, "lane", levelForAmount(f))}</div><figcaption><b>${escapeHtml(d.abbr)}</b><small>${escapeHtml(cap)}</small></figcaption></figure>`;
    })
    .join("");
  return `<div class="legend-row density" title="体内の薬の量が${Math.round(SOLID_AT * 100)}%を切ると薄くなる">${figs}</div>`;
}

/** 遊び方の絵の枚数（1画面に1つ。「次へ」で進む） */
export const HOWTO_SLIDES = 3;

/** 手札のカードの「大腸菌など／緑膿菌／腸球菌」と同じ目安（ゲーム内の値から） */
function specTags(data: GameData, region: string, drugId: string): string {
  const sp = spectrumOf(data, region, drugId);
  return `<span class="art-spec">${SPECTRUM_LABELS.map((x) => `<span class="${sp[x.key] ? "on" : "off"}">${x.label}</span>`).join("")}</span>`;
}

/** 遊び方の絵：小さなカード（手札の見本） */
function miniCard(data: GameData, id: string): string {
  const d = data.drugById.get(id);
  if (!d) return "";
  const color = data.classById.get(d.class)?.color ?? "#64748b";
  return `<span class="mini-card" style="--cls:${color}">${soldierImg(data, d, "chip")}<b>${escapeHtml(genericName(d))}</b></span>`;
}

/**
 * 遊び方のはじめの絵の3枚（2026-11-05 作者の判断「すべての人に伝わるように」。文は docs/PLAIN-LANGUAGE.md 3章の文案）。
 * 絵はゲームのドット絵（兵士・細菌・膀胱）で描く。どの薬・菌が効くかの印は、手札のカードと同じゲーム内の目安（spectrumOf）から出す
 */
function howtoSlides(data: GameData, region: string, year: number): string[] {
  const drug = (id: string) => data.drugById.get(id);
  const bug = (id: string) => data.bacteriumById.get(id);
  const sol = (id: string, z = 3) => (drug(id) ? soldierImg(data, drug(id)!, "lane", LEVELS, z) : "");
  const bg = (id: string, frame = 0, bare = false, z = 2) => (bug(id) ? bugImg(bug(id)!, frame, bare, z) : "");
  const name = (id: string) => escapeHtml(bug(id)?.name.replace(/（.*?）/g, "") ?? id);
  const gname = (id: string) => escapeHtml(drug(id) ? genericName(drug(id)!) : id);
  const slide = (i: number, title: string, text: string, art: string) => `
      <section class="slide${i === 0 ? " on" : ""}" data-i="${i}" aria-label="${i + 1} / ${HOWTO_SLIDES}：${title}">
        <div class="slide-art">${art}</div>
        <div class="slide-text">
          <p class="slide-no">${i + 1} / ${HOWTO_SLIDES}</p>
          <h3>${title}</h3>
          ${text}
        </div>
      </section>`;

  // 1. 細菌を、抗菌薬で倒す：膀胱・レーン・兵士・細菌と、下の手札
  const art1 = `
        <div class="art art-defeat">
          <div class="a-bladder">${bladderImg(22, 58, 3)}<span>膀胱</span></div>
          <div class="a-lane">
            <span class="a-soldier">${sol("CTRX")}<em>兵士（抗菌薬）</em></span>
            <i class="a-shot"></i><i class="a-shot s2"></i><i class="a-shot s3"></i>
            <span class="a-bug b1">${bg("ecoli", 0, false, 3)}</span>
            <span class="a-bug b2">${bg("kpneumoniae", 1, false, 2)}</span>
            <span class="a-come">◀ 細菌が向かってくる</span>
          </div>
          <div class="a-hand"><span class="a-hand-label">手札</span>${["ABPC", "CTRX", "MEPM"].map((id) => miniCard(data, id)).join("")}<span class="a-pick">▲ 選んで、呼び出す</span></div>
        </div>`;

  // 2. 細菌ごとに、効く薬が違う：切り札とねらいをしぼった薬／近づくほど分かる
  const art2 = `
        <div class="art art-spectrum">
          <div class="a-kinds">
            <figure class="a-kind trump">${sol("MEPM")}<figcaption><b><span class="trump-tag">切り札</span>${gname("MEPM")}</b><small>カルバペネム系。機械兵の姿</small>${specTags(data, region, "MEPM")}<span class="a-note">ほとんどの細菌に効く</span></figcaption></figure>
            <figure class="a-kind narrow">${sol("CEZ")}<figcaption><b>${gname("CEZ")}</b><small>ねらいをしぼった薬の例</small>${specTags(data, region, "CEZ")}<span class="a-note">効く細菌が限られる</span></figcaption></figure>
          </div>
          <div class="a-reveal">
            <figure class="near"><span class="a-tagname">${name("ecoli")}</span>${bg("ecoli", 0, false, 3)}<span class="a-tagok">効く：CMZ MEPM</span><figcaption><b>近い</b>効く薬が分かる</figcaption></figure>
            <figure class="mid"><span class="a-tagname">${name("ecoli")}</span>${bg("ecoli", 1, false, 3)}<figcaption><b>中ほど</b>細菌の名前が分かる</figcaption></figure>
            <figure class="far"><span class="a-tagname blank">？</span>${bg("ecoli", 0, true, 3)}<figcaption><b>遠い</b>顕微鏡で見た色と形だけ</figcaption></figure>
            <span class="a-come">◀ 近づくほど分かる</span>
          </div>
        </div>`;

  // 3. 使うほど、効かない細菌が残る：薬を使う前 → 効く細菌は倒れる → 効かない細菌が増える
  // 薬が効かない細菌は盾の印（動画・「はじめての人へ」・結果画面と同じ。2026-11-06 に朱の枠から統一）
  const pop = (kinds: string) => `<div class="a-pop">${[...kinds].map((k, j) => `<span class="${k === "r" ? "res" : k === "x" ? "dead" : ""}">${bg("ecoli", j % 2)}${k === "r" ? SHIELD() : ""}</span>`).join("")}</div>`;
  const art3 = `
        <div class="art art-selection">
          <div class="a-step">${pop("ssrsssss")}<p>効かない細菌が<br>少しだけまじっている</p></div>
          <div class="a-arrow"><span class="a-drug">${sol("MEPM", 2)}</span>▶<small>薬を使う</small></div>
          <div class="a-step">${pop("xxrxxxxx")}<p>効く細菌は倒れ、<br>効かない細菌が残る</p></div>
          <div class="a-arrow">▶<small>増える</small></div>
          <div class="a-step">${pop("rrrrrrrr")}<p>効かない細菌ばかりに<br>なる（選択圧）</p></div>
          <p class="a-legend"><span class="res">${bg("ecoli")}${SHIELD()}</span>盾の印＝薬が効かない細菌（耐性菌）</p>
        </div>`;

  return [
    slide(
      0,
      "細菌を、抗菌薬で倒す",
      `<p>細菌が、膀胱（おしっこをためる袋）に向かってきます。下の手札から抗菌薬を選んで、兵士として呼び出し、倒します。膀胱に細菌が入ると耐久が減り、0 になると負けです。</p>`,
      art1,
    ),
    slide(
      1,
      "細菌ごとに、効く薬が違う",
      `<p>ほとんどの細菌に効く「切り札」（機械兵の姿。カルバペネム系）と、ねらいをしぼった薬があります。</p><p>はじめは細菌の正体が分かりません。遠くでは顕微鏡で見た色と形だけ、近づくと名前、さらに近づくと効く薬が分かります（実際の検査の結果が、時間差で届くのと同じです）。</p>`,
      art2,
    ),
    slide(
      2,
      "使うほど、効かない細菌が残る",
      `<p>薬を使うと、効く細菌は倒れ、効かない細菌だけが残って増えます（選択圧）。切り札ばかり使うと、${year}年に、自分が残した細菌が攻めてきます。</p><p>細菌の正体が分かったら、切り札を使わずに、その細菌に合う薬へ切り替えましょう。</p>`,
      art3,
    ),
  ];
}

/**
 * 遊び方。はじめに絵の3枚（1画面に1つ、「次へ」で進む）。前からの詳しい説明（カードの見かた・兵士の姿など）は「くわしく」に畳む。
 * 何枚目かは app.ts が showHowtoSlide で切り替える（画面を作り直さない）
 */
export function howtoScreen(data: GameData, scenario: ScenarioDef): string {
  return `
  <div class="screen howto-screen" data-slide="0">
    <h2>遊び方</h2>
    <div class="slides">${howtoSlides(data, scenario.region, futureYear(data, scenario.future.yearsLater)).join("")}</div>
    <div class="slide-dots" aria-hidden="true">${Array.from({ length: HOWTO_SLIDES }, (_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("")}</div>
    <details class="howto-more">
      <summary>くわしく（カードの見かた・情報が分かる距離・兵士の姿）</summary>
      ${howtoDetails(data)}
    </details>
    <div class="buttons">
      <button class="h-prev" data-action="howto-prev" hidden>◀ 前へ</button>
      <button class="primary h-next" data-action="howto-next">次へ ▶</button>
      <button class="h-start" data-action="start">はじめる</button>
      <button data-action="title">タイトルへ</button>
    </div>
  </div>`;
}

/** 遊び方の i 枚目を出す（0 から。範囲の外は端に寄せる）。出した枚数を返す */
export function showHowtoSlide(root: HTMLElement, i: number): number {
  const screen = root.querySelector<HTMLElement>(".howto-screen");
  if (!screen) return 0;
  const n = Math.max(0, Math.min(HOWTO_SLIDES - 1, i));
  screen.dataset.slide = String(n);
  screen.querySelectorAll<HTMLElement>(".slide").forEach((el, k) => el.classList.toggle("on", k === n));
  screen.querySelectorAll<HTMLElement>(".slide-dots i").forEach((el, k) => el.classList.toggle("on", k === n));
  const last = n === HOWTO_SLIDES - 1;
  screen.querySelector<HTMLElement>(".h-prev")?.toggleAttribute("hidden", n === 0);
  screen.querySelector<HTMLElement>(".h-next")?.toggleAttribute("hidden", last);
  // 最後の1枚では「はじめる」を主のボタンにする（それまでは「次へ」）
  screen.querySelector<HTMLElement>(".h-start")?.classList.toggle("primary", last);
  return n;
}

/** 遊び方の「くわしく」：前からの詳しい説明（3つの欄と兵士の姿の見本）。2026-11-06「文字が多すぎる」：箇条書きを短くし、事実は前のまま */
function howtoDetails(data: GameData): string {
  return `
    <div class="panels">
      <section>
        <h3>1. 膀胱を守る</h3>
        <svg viewBox="0 0 260 120" width="260" height="120" aria-hidden="true">
          <rect x="6" y="10" width="54" height="100" rx="22" fill="#f6bd34" stroke="#df5f93" stroke-width="4"/>
          <text x="33" y="66" font-size="13" text-anchor="middle" fill="#7c4a03" font-weight="bold">膀胱</text>
          ${[30, 60, 90].map((y) => `<line x1="64" y1="${y}" x2="254" y2="${y}" stroke="#8f2f5f" stroke-width="3"/>`).join("")}
          <rect x="200" y="38" width="30" height="13" rx="6.5" fill="${GN}" stroke="#ffb3cf"/>
          <path d="M190 45 L150 45" stroke="#ff8ab3" stroke-width="2" marker-end="url(#ar)"/>
          <defs><marker id="ar" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M10 0 L0 5 L10 10z" fill="#ff8ab3"/></marker></defs>
        </svg>
        <ul class="tight">
          <li>細菌は右（尿道側）から3本のレーンを進んできます</li>
          <li>膀胱に着くと耐久が減り、0 になると負け。細菌は1日に1群れ来て、最後の日までしのげば勝ち</li>
          <li>遊ぶたびに、手札の何枚かが<b>供給制限</b>（薬が手に入りにくくなること）で使えなくなります</li>
        </ul>
      </section>
      <section>
        <h3>2. 近づくほど分かる</h3>
        <div class="levels">
          <div><b>遠い</b><span>顕微鏡で見た色と形（グラム染色）だけ</span><em><i style="background:${GN}"></i>陰性（ピンク〜赤）<i style="background:${GP}"></i>陽性（紫）</em></div>
          <div><b>中ほど</b><span>細菌の名前（培養検査）</span></div>
          <div><b>近い</b><span>手札のうち効く薬（効く薬を調べる検査＝薬剤感受性試験）</span></div>
        </div>
        <ul class="tight">
          <li>まず効く見込みの高い薬（多くは広い範囲に効く薬）で始め、正体が分かったら、切り札を使わずに合う薬へ切り替えるか（デエスカレーション）、広い薬を続けるかを判断します</li>
          <li>名前が分かる前は、<b>アンチバイオグラム</b>（細菌ごとに薬が効いた割合の表。右上のボタン${isTouchDevice() ? "" : "か A キー"}）が手がかり</li>
          <li>効かない細菌には弾がはじかれ、「効かない」「もともと効かない（自然耐性）」「効かない扱い（ゲームの決めごと：腸球菌に MEPM・IPM/CS）」が出ます</li>
        </ul>
      </section>
      <section>
        <h3>3. 抗菌薬を呼び出す</h3>
        <ul class="tight">
          <li>${isTouchDevice() ? "カードを選び、レーンをタップ。" : "カードを選び（数字キーでも）、レーンをクリック。"}医療費が減ります（時間とともに増える。高い薬ばかりだと足りなくなる）</li>
          <li><b>カードの見かた</b>：大きな字＝一般名、上＝略号。${iconImg("coin", 1)}＝1回の医療費、${iconImg("hourglass", 1)}＝待ち時間＝投与間隔（<b>h</b> はゲーム内の時間。1時間＝1秒なので「6h」は6秒、1日は24秒）。${isTouchDevice() ? "" : "絵の左下の数字＝数字キー。"}<b>切り札</b>＝カルバペネム系</li>
          <li><b>内服薬</b>は、体に届く割合（<b>吸収率</b>）のぶんの量で出るので、吸収率の低い薬は兵士が薄く出ます</li>
          <li>薬を使うと、さらされた細菌の中で効かない細菌が残り（<b>選択圧</b>）、<b>耐性率が上がります</b>。同じ系統ばかり使うと、その系統の耐性が早く進みます（進み方はタイトル画面で A／B）</li>
          <li class="small"><b>Access</b>（まず使う薬）・<b>Watch</b>（使いすぎ注意）は WHO の AWaRe 分類。「大腸菌など（大腸菌・肺炎桿菌・プロテウス）・緑膿菌・腸球菌」は、この地域のデータで効く見込みがあるかのゲーム内の目安で、実際の薬の選び方の根拠にはなりません</li>
        </ul>
      </section>
    </div>
    ${soldierLegend(data)}`;
}

function handChips(data: GameData, stage: StageDef, short: readonly string[] = []): string {
  return stage.hand
    .map((h) => {
      const d = data.drugById.get(h.drug)!;
      const color = data.classById.get(d.class)?.color ?? "#64748b";
      const out = short.includes(d.id);
      return `<span class="chip${out ? " short" : ""}" style="--cls:${color}" title="${escapeHtml(d.name)}${out ? "（供給制限で今回は使えません）" : ""}">${soldierImg(data, d, "chip")}${escapeHtml(d.abbr)}</span>`;
    })
    .join("");
}

/** 供給制限の知らせ（ブリーフィング） */
function shortNote(data: GameData, short: readonly string[]): string {
  if (short.length === 0) return "";
  const list = short.map((d) => escapeHtml(data.drugById.get(d)?.abbr ?? d)).join("・");
  return `<p class="short-note"><b>供給制限</b>：${list} は今回は使えません。どの薬が使えないかは、遊ぶたびに変わります。</p>`;
}

/** 結果・まとめの「使えなかった薬」 */
function shortList(data: GameData, short: readonly string[]): string {
  return short.length ? short.map((d) => escapeHtml(data.drugById.get(d)?.abbr ?? d)).join("・") : "なし";
}

/** ブリーフィングの医療費の欄。時間で増えるステージは「はじめ ◯、1日ごとに +◯」 */
function budgetFact(stage: StageDef): string {
  if (!stage.budgetPerDay) return `<div><span>${iconImg("coin", 2)}医療費の予算</span><b>${yen(stage.budget)}</b></div>`;
  const max = stage.budgetMax ? `（ためられるのは ${yen(stage.budgetMax)} まで）` : "";
  return `<div><span>${iconImg("coin", 2)}医療費</span><b>はじめ ${yen(stage.budget)}</b><small>1日（ゲーム内の24秒）ごとに +${yen(stage.budgetPerDay)}${max}</small></div>`;
}

export function briefingScreen(data: GameData, scenario: ScenarioDef, phase: "present" | "future", extra = "", startTable?: ResistanceTable, short: readonly string[] = []): string {
  const stage = phase === "present" ? scenario.present : scenario.future;
  const head = phase === "present" ? `ステージ1「${escapeHtml(stage.title)}」` : `ステージ2「${escapeHtml(stage.title)}」`;
  const defaultBrief =
    phase === "present"
      ? `${escapeHtml(scenario.region)}の公開データ（JANIS）の耐性率から始まります。菌の正体が分かるにつれて、薬を選び直せます。`
      : `ステージ1の終わりの耐性率を引き継ぎ、同じ使い方が ${futureYear(data, scenario.future.yearsLater)}年まで（${scenario.future.yearsLater}年間）続いたとみなしています。`;
  // 手札が変わったら書く（ステージごとに手札を決める：SPEC.md 4.9）
  let handNote = "";
  if (phase === "future") {
    const now = new Set(scenario.future.hand.map((h) => h.drug));
    const gone = scenario.present.hand.map((h) => h.drug).filter((d) => !now.has(d));
    const added = scenario.future.hand.map((h) => h.drug).filter((d) => !scenario.present.hand.some((h) => h.drug === d));
    const ab = (ds: string[]) => ds.map((d) => escapeHtml(data.drugById.get(d)?.abbr ?? d)).join("・");
    const parts: string[] = [];
    if (gone.length) parts.push(`${ab(gone)} はこのステージでは使えません`);
    if (added.length) parts.push(`${ab(added)} が使えるようになりました`);
    if (parts.length) handNote = `<p class="hand-note">手札が変わりました：${parts.join("。")}。</p>`;
  }
  return `
  <div class="screen briefing-screen ${phase}">
    ${phase === "future" ? `<p class="kicker">${scenario.future.yearsLater}年後</p>` : ""}
    <h2>${head}</h2>
    <p class="brief">${stage.briefing ? escapeHtml(stage.briefing) : defaultBrief}</p>
    ${phase === "future" ? `<p class="exaggerated">薬が効かなくなる速さはゲーム用に大げさにしています。${futureYear(data, scenario.future.yearsLater)}年の予測ではありません。</p>` : ""}
    ${extra}
    <div class="facts">
      <div><span>手札</span><div class="chips">${handChips(data, stage, short)}</div></div>
      ${budgetFact(stage)}
      <div><span>${iconImg("germ", 2)}期間</span><b>${stage.waves.length}日間</b><small>細菌は1日に1群れ来る</small></div>
    </div>
    ${shortNote(data, short)}
    ${handNote}
    ${startTable ? `<details class="abg-details"><summary>アンチバイオグラム（細菌ごとに、薬が効く割合の表）を見る</summary>${antibiogramBlock(data, scenario.region, startTable, stage.hand.map((h) => h.drug).filter((d) => !short.includes(d)), phase)}</details>` : ""}
    <div class="buttons"><button class="primary" data-action="play">開始</button></div>
  </div>`;
}

/**
 * アンチバイオグラム（菌 × 手札の薬の感性率）。菌名が分かる前に薬を選ぶ手がかり
 * （ASP ガイダンス2024 p.130。推奨度 A・エビデンスレベル I。ゲームの表は JANIS の地域の集計で、施設ごとの表ではない）。
 * withN：公開データの株数を、セルにカーソルを置いたときに出す（ステージ1だけ。ステージ2はゲーム内の値なので出さない）
 */
export function antibiogramTable(data: GameData, region: string, table: ResistanceTable, drugs: string[], withN: boolean): string {
  const head = drugs.map((d) => `<th>${escapeHtml(data.drugById.get(d)!.abbr)}</th>`).join("");
  const body = data.bacteria
    .map((b) => {
      const cells = drugs
        .map((d) => {
          const v = susceptibility(data, region, b.id, d);
          if (v.basis === "intrinsic") return `<td class="na" title="自然耐性">自然耐性</td>`;
          if (v.basis === "fixed" && (table[b.id]?.[d] ?? 0) >= 1) return `<td class="na" title="${escapeHtml(v.note ?? "")}">効かない扱い</td>`;
          const s = 1 - (table[b.id]?.[d] ?? 1);
          const cls = s >= 0.8 ? "good" : s >= 0.5 ? "mid" : "poor";
          const note = withN ? (v.basis === "proxy" ? `${v.note}（n=${v.n}）` : v.n ? `n=${v.n}` : "") : "";
          return `<td class="${cls}"${note ? ` title="${escapeHtml(note)}"` : ""}>${pct(s)}${withN && v.basis === "proxy" ? "<sup>*</sup>" : ""}</td>`;
        })
        .join("");
      return `<tr><th>${escapeHtml(b.name)}</th>${cells}</tr>`;
    })
    .join("");
  return `<table class="abg"><thead><tr><th>感性率</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function antibiogramBlock(data: GameData, region: string, table: ResistanceTable, drugs: string[], phase: "present" | "future"): string {
  const caption =
    phase === "present"
      ? `${escapeHtml(region)}の感性率（JANIS 2025年報、入院検体・すべての検査材料、CLSI 2012）。地域の集計で、施設ごとや尿だけの値ではありません。ゲームで使う値で、ESBL の連動などで調整したものを含みます。* は代用の値。セルにカーソルを置くと株数が出ます。`
      : "このステージの感性率。ステージ1の結果から作ったゲーム内の値です（耐性化の速さは誇張しています）。";
  return `${antibiogramTable(data, region, table, drugs, phase === "present")}
    <p class="table-note">${caption} 緑＝80%以上、黄＝50〜80%、赤＝50%未満（色の区切りはゲーム用の目安で、実際の薬の選択には使えません）。アンチバイオグラムは、菌名や感受性が分かる前に「効く見込みの高い薬」を選ぶ手がかりです。</p>`;
}

/** 開始時 → 終わりで大きく上がった組（手札の薬だけ） */
export function biggestRises(data: GameData, from: ResistanceTable, to: ResistanceTable, drugs: string[], n = 6) {
  const out: { species: string; drug: string; from: number; to: number }[] = [];
  for (const sp of data.bacteria.map((b) => b.id)) {
    for (const d of drugs) {
      const a = from[sp]?.[d];
      const b = to[sp]?.[d];
      if (a === undefined || b === undefined || a >= 1) continue;
      if (b - a >= 0.01) out.push({ species: sp, drug: d, from: a, to: b });
    }
  }
  return out.sort((x, y) => y.to - y.from - (x.to - x.from)).slice(0, n);
}

/** ステージ1の終わり → 未来の開始で下がった組（使わなかった薬のうち、実測で下がっていた組。手札の薬だけ） */
export function biggestDrops(data: GameData, from: ResistanceTable, to: ResistanceTable, drugs: string[], n = 3) {
  const out: { species: string; drug: string; from: number; to: number }[] = [];
  for (const sp of data.bacteria.map((b) => b.id)) {
    for (const d of drugs) {
      const a = from[sp]?.[d];
      const b = to[sp]?.[d];
      if (a === undefined || b === undefined || a >= 1) continue;
      if (a - b >= 0.005) out.push({ species: sp, drug: d, from: a, to: b });
    }
  }
  return out.sort((x, y) => y.from - y.to - (x.from - x.to)).slice(0, n);
}

/** 下がった組の注記（2050年のブリーフィング） */
export function dropsNote(data: GameData, drops: ReturnType<typeof biggestDrops>): string {
  if (drops.length === 0) return "";
  const list = drops
    .map((r) => `${escapeHtml(data.bacteriumById.get(r.species)!.name)}の ${escapeHtml(data.drugById.get(r.drug)!.abbr)} ${pct(r.from)} → <b>${pct(r.to)}</b>`)
    .join("、");
  // 理由は畳んでおく（2026-11-06「文字が多すぎる」）
  return `<p class="table-note drops">下がったもの：${list}。</p><details class="more-note"><summary>なぜ下がるのか</summary>ステージ1で一度も使わなかった薬は、国の報告書（2014〜2023年）で耐性率が下がっていた組に限り、その下がり方が2050年まで続いたとみなして下げています。報告書の値は薬が使われ続けた中での変化で、使わなければ下がると示したものではありません（ゲームとしての決めごと）。</details>`;
}

/** 未来ステージまでの節目の年（10年ごとの区切りと最後の年。例：25年後なら 5・15・25 年後 ＝ 2030・2040・2050年） */
export function milestoneYears(data: GameData, yearsLater: number): number[] {
  const base = data.rules.resistance.carryOver.dataYear;
  const ys: number[] = [];
  for (let y = 1; y < yearsLater; y++) if ((base + y) % 10 === 0) ys.push(y);
  ys.push(yearsLater);
  return ys;
}

/**
 * 大きく上がった耐性率の、年ごとの推移の表。tables は milestoneYears と同じ順の、その年の耐性率の表。
 * 耐性菌が少ないうちはゆっくり、増えると一気に上がる（S 字）ことを見せる
 */
export function risesTimeline(
  data: GameData,
  rises: ReturnType<typeof biggestRises>,
  years: number[],
  tables: ResistanceTable[],
  usedDrugs = true,
  stage1End?: ResistanceTable,
): string {
  if (rises.length === 0) return risesList(data, rises, usedDrugs);
  const base = data.rules.resistance.carryOver.dataYear;
  // ステージ1の中の変化（ゲーム用に誇張した部分）と、そのあと実測の速さを上限に延ばした部分を分けて見せる
  const head = [
    `<th>${base}年<br><small>ステージ1の開始</small></th>`,
    ...(stage1End ? [`<th>ステージ1の終わり<br><small>（ゲーム内の変化）</small></th>`] : []),
    ...years.map((y) => `<th>${base + y}年<br><small>ゲーム内</small></th>`),
  ].join("");
  const body = rises
    .map((r) => {
      const cells = tables.map((t) => {
        const v = t[r.species]?.[r.drug] ?? 0;
        const cls = v >= 0.8 ? "poor" : v >= 0.5 ? "mid" : "";
        return `<td class="${cls}">${pct(v)}</td>`;
      });
      const mid = stage1End ? `<td class="stage1">${pct(stage1End[r.species]?.[r.drug] ?? r.from)}</td>` : "";
      return `<tr><th>${escapeHtml(data.bacteriumById.get(r.species)!.name)}の <b>${escapeHtml(data.drugById.get(r.drug)!.abbr)}</b></th><td>${pct(r.from)}</td>${mid}${cells.join("")}</tr>`;
    })
    .join("");
  // 作り方の説明は畳んでおく（2026-11-06「文字が多すぎる」）
  return `<table class="timeline"><thead><tr><th>耐性率</th>${head}</tr></thead><tbody>${body}</tbody></table>
    <details class="more-note timeline-note"><summary>この表の作り方（ゲーム内の値で、予測ではありません）</summary>ステージ1の中の変化はゲーム用に誇張しています。そのあとは、ステージ1の変化を同じ割合で延ばし、1年あたりの上がり方が、国の報告書で観測されたうちこのゲームの菌と薬でいちばん速いもの（どの組にも同じ上限）を超えないようにしています。このため多くの組では、実測より速く上がります。</details>`;
}

/** 「2050年問題」の注記（研究の推計の数字と、ゲームの値はそこから出したものではないこと） */
export function year2050Note(data: GameData, yearsLater: number): string {
  if (futureYear(data, yearsLater) !== 2050) return "";
  // 畳んでおく（2026-11-06「文字が多すぎる」。開くと前と同じ全文）
  return `<details class="more-note note2050"><summary><b>「2050年問題」</b>：対策をとらなければ、2050年に薬剤耐性による死亡が年1,000万人に達するという試算があります</summary>2014年の英国の AMR Review が示した大まかな試算で、HIV・結核・マラリアの薬剤耐性を含みます。2024年の世界疾病負荷研究（GBD、Lancet）は、2050年に細菌の薬剤耐性が直接の原因の死亡を191万人、耐性菌の感染に関連した死亡を822万人と予測しています（2つの推計は対象が違うため、そのまま比べることはできません）。このステージの耐性率は、これらの推計から出したものではありません。</details>`;
}

export function risesList(data: GameData, rises: ReturnType<typeof biggestRises>, usedDrugs = true): string {
  if (rises.length === 0) return `<p class="muted">${usedDrugs ? "耐性率はほとんど変わっていません。" : "抗菌薬を使わなかったので、耐性率は変わっていません。"}</p>`;
  return `<ul class="rises">${rises
    .map(
      (r) =>
        `<li><span>${escapeHtml(data.bacteriumById.get(r.species)!.name)}</span><b>${escapeHtml(data.drugById.get(r.drug)!.abbr)}</b><span class="from">${pct(r.from)}</span><span class="arrow">→</span><span class="to">${pct(r.to)}</span></li>`,
    )
    .join("")}</ul>`;
}

function bars(data: GameData, usage: Record<string, number>): string {
  const rows = Object.entries(usage)
    .filter(([, v]) => v > 0.004)
    .sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return `<p class="muted">抗菌薬を使っていません。</p>`;
  return `<div class="bars">${rows
    .map(([cls, v]) => {
      const c = data.classById.get(cls);
      return `<div class="bar-row"><span class="lbl">${escapeHtml(c?.name ?? cls)}</span><div class="track"><i style="width:${(v * 100).toFixed(1)}%;background:${c?.color ?? "#888"}"></i></div><b>${pct(v)}</b></div>`;
    })
    .join("")}</div>`;
}

function resistanceTable(data: GameData, region: string, from: ResistanceTable, to: ResistanceTable, drugs: string[], spanLabel: string): string {
  const species = data.bacteria.map((b) => b.id);
  const head = drugs.map((d) => `<th>${escapeHtml(data.drugById.get(d)!.abbr)}</th>`).join("");
  const body = species
    .map((sp) => {
      const cells = drugs
        .map((d) => {
          const basis = susceptibility(data, region, sp, d).basis;
          if (basis === "intrinsic") return `<td class="na">自然耐性</td>`;
          if (basis === "fixed" && (from[sp]?.[d] ?? 0) >= 1) return `<td class="na">効かない扱い</td>`;
          const a = from[sp]?.[d] ?? 0;
          const b = to[sp]?.[d] ?? 0;
          const up = b - a;
          // 0.1% → 0.6% のように、低い値が何倍にもなった変化も見せる（未来ステージで大きく効いてくるため）
          const rose = up >= 0.005 || (b >= 0.002 && b >= a * 1.5);
          const cls = up >= 0.2 ? "up2" : up >= 0.05 ? "up1" : rose ? "up0" : "";
          // 使わなかった薬で、実測にもとづいて下がった組（未来ステージ）
          if (!rose && a - b >= 0.005) return `<td class="down"><small>${pct(a)}→</small><b>${pct(b)}</b></td>`;
          return rose ? `<td class="${cls}"><small>${pct(a)}→</small><b>${pct(b)}</b></td>` : `<td>${pct(b)}</td>`;
        })
        .join("");
      return `<tr><th>${escapeHtml(data.bacteriumById.get(sp)!.name)}</th>${cells}</tr>`;
    })
    .join("");
  return `<div class="rtable-wrap"><table class="rtable"><thead><tr><th>耐性率（${escapeHtml(spanLabel)}）</th>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="table-note">耐性率＝その菌のうち薬が効かない個体の割合。<span class="k-up">赤</span>＝上がった、<span class="k-down">緑</span>＝下がった（ステージ1で使わなかった薬）。自然耐性＝もともと効かない。効かない扱い＝このゲームで効かないことにした組み合わせ。</p>`;
}

function outcomeLine(r: StageResult): string {
  return r.outcome === "won" ? `<span class="won">守り切った</span>` : `<span class="lost">膀胱が破られた</span>`;
}

/** DASC/DOT（使った薬の平均の ASC＝平均の抗菌スペクトラムの広さ）。ASP ガイダンス2024 表4（p.119） */
function dascValue(data: GameData, r: StageResult): string {
  if (r.spectrum.dascPerDot !== null) return r.spectrum.dascPerDot.toFixed(1);
  return "—";
}

/** まとめ画面：DASC/DOT が「—」になった理由 */
function dascMissingNote(data: GameData, rs: StageResult[]): string {
  const missing = [...new Set(rs.filter((r) => r.spectrum.dascPerDot === null && r.spectrum.dot > 0).flatMap((r) => r.spectrum.ascMissing))];
  if (missing.length === 0) return "";
  const list = missing.map((d) => escapeHtml(data.drugById.get(d)?.abbr ?? d)).join("・");
  return `<p class="table-note">スペクトラムの広さの「—」：ASC スコア（薬の広さの点数）を確かめていない薬（${list}）を使ったため、まだ出せません。</p>`;
}

/** ASC の目盛り（データにある値を小さい順に） */
function ascScale(data: GameData): string {
  return data.drugs
    .filter((d) => d.asc !== null)
    .sort((a, b) => (a.asc ?? 0) - (b.asc ?? 0))
    .map((d) => `${escapeHtml(d.abbr)} ${d.asc}`)
    .join("・");
}

function dascCard(data: GameData, r: StageResult): string {
  const missing = r.spectrum.ascMissing.map((d) => escapeHtml(data.drugById.get(d)?.abbr ?? d)).join("・");
  // 説明は吹き出し（title）に（2026-11-06「文字が多すぎる」）。出せないときだけ、その理由を小さく書く
  const tip = `使った薬の平均の抗菌スペクトラム（ASC スコア × 使用日数 ÷ 使用日数）。ASC：${ascScale(data)}`;
  const small = r.spectrum.dascPerDot !== null ? "" : r.spectrum.dot > 0 ? `ASC スコアを確かめていない薬（${missing}）を使ったので、まだ出せません` : "抗菌薬を使っていません";
  return `<div title="${escapeHtml(tip)}"><span>${iconImg("microscope", 1)} スペクトラムの広さ（DASC/DOT）<i class="q">？</i></span><b>${dascValue(data, r)}</b><small><em class="dir">${DIR.dasc}</em>${small}</small></div>`;
}

/** 数字の向き（どちらが良いか）の一言。2026-11-05 作者の判断（docs/PLAIN-LANGUAGE.md 3章）。文は作者が確かめる */
const DIR = {
  ahi: "1 に近いほど、偏らずに使えた。",
  dasc: "小さいほど、ねらいをしぼった薬を使えた。",
  access: "高いほど、まず使う薬を多く使えた。",
} as const;

/** いちばん使った系統（使用日数の割合）。使っていなければ undefined */
function topEntry(r: StageResult): [string, number] | undefined {
  const top = Object.entries(r.usageByClass).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] > 0 ? top : undefined;
}

function topClass(data: GameData, r: StageResult): string {
  const top = Object.entries(r.usageByClass).sort((a, b) => b[1] - a[1])[0];
  return top ? `${escapeHtml(data.classById.get(top[0])?.name ?? top[0])} ${pct(top[1])}` : "—";
}

/**
 * 結果画面のいちばん上に出す、原因の一文（2026-11-05 作者の判断。文は docs/PLAIN-LANGUAGE.md 3章の文案）。
 * 割合と「手札のどの薬も効かない細菌」は、この画面の数字と同じ値（usageByClass・panResistantFraction）から出す。
 * ステージ2の「いちばん使った系統」は、ステージ1の結果（present）から
 */
export function causeLine(data: GameData, scenario: ScenarioDef, phase: "present" | "future", r: StageResult, present?: StageResult): { text: string; kind: "good" | "warn" | "bad" } {
  const year = futureYear(data, scenario.future.yearsLater);
  const won = r.outcome === "won";
  const clsName = (id: string) => escapeHtml(data.classById.get(id)?.name ?? id);
  if (phase === "present") {
    const head = won ? "守り切りました。" : "膀胱が破られました。";
    const trump = r.usageByClass[TRUMP_CLASS] ?? 0;
    if (trump >= 0.5)
      return {
        text: `${head}${won ? "ただ、" : ""}切り札（カルバペネム系）を ${pct(trump)} 使いました。効かない細菌が選ばれて残り、${year}年に影響します。`,
        kind: won ? "warn" : "bad",
      };
    const top = topEntry(r);
    return { text: top ? `${head}いちばん使ったのは${clsName(top[0])}（${pct(top[1])}）でした。` : `${head}抗菌薬は使いませんでした。`, kind: won ? "good" : "bad" };
  }
  if (won) return { text: `${year}年も守り切りました。`, kind: "good" };
  const top = topEntry(present ?? r);
  const pan = r.panResistantFraction;
  const panText = `手札のどの薬も効かない細菌が ${pct(pan)} 出てきました。`;
  if (!top) return { text: `膀胱が破られました。${pan >= 0.005 ? panText : ""}`, kind: "bad" };
  const base = `膀胱が破られました。ステージ1でいちばん使った${clsName(top[0])}（${pct(top[1])}）が効かない細菌が増え`;
  return { text: pan >= 0.005 ? `${base}、${panText}` : `${base}ていました。`, kind: "bad" };
}

/** 「いちばん上がった耐性率」の1行（上位3つ） */
function risesLine(data: GameData, from: ResistanceTable, to: ResistanceTable, drugs: string[]): string {
  const rises = biggestRises(data, from, to, drugs, 3);
  if (rises.length === 0) return "大きく上がった耐性率はありません";
  return rises
    .map((x) => `${escapeHtml(data.bacteriumById.get(x.species)!.name)}の ${escapeHtml(data.drugById.get(x.drug)!.abbr)} ${pct(x.from)} → <b>${pct(x.to)}</b>`)
    .join("、");
}

/** 結果画面の「膀胱」：ドット絵（傷むほど赤い）と残りの耐久 */
function bladderPanel(r: StageResult): string {
  const frac = r.bladderMaxHp > 0 ? r.bladderHp / r.bladderMaxHp : 0;
  const cls = frac < 0.3 ? "low" : frac < 0.6 ? "mid" : "";
  return `<section class="r-panel r-bladder">
      <h4>${iconImg("bladder", 1)}膀胱</h4>
      <div class="r-bladder-art">${bladderImg(22, 58, 3, frac)}</div>
      <b class="r-big ${r.outcome === "won" ? "" : "bad"}">${Math.ceil(r.bladderHp)}<small>／${r.bladderMaxHp}</small></b>
      <div class="r-bar"><i class="${cls}" style="width:${(frac * 100).toFixed(0)}%"></i></div>
    </section>`;
}

/** 結果画面の「呼び出した兵士」：呼んだ回数の多い薬から4つ、兵士の絵と回数の帯で */
function drugsPanel(data: GameData, r: StageResult): string {
  const rows = Object.entries(r.summons)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, [, n]) => a + n, 0);
  const trump = r.usageByClass[TRUMP_CLASS] ?? 0;
  const list = rows
    .slice(0, 4)
    .map(([id, n]) => {
      const d = data.drugById.get(id);
      if (!d) return "";
      const color = data.classById.get(d.class)?.color ?? "#64748b";
      const isTrump = d.class === TRUMP_CLASS;
      return `<li style="--cls:${color}"><span class="r-portrait">${soldierImg(data, d, "card")}</span><span class="r-drug-name"><b>${escapeHtml(d.abbr)}${isTrump ? `<span class="trump-tag">切り札</span>` : ""}</b><small>${escapeHtml(genericName(d))}</small></span><span class="r-drug-bar"><i style="width:${((n / total) * 100).toFixed(0)}%"></i></span><em>×${n}</em></li>`;
    })
    .join("");
  const more = rows.length > 4 ? `<p class="r-more">ほか ${rows.length - 4} 種類</p>` : "";
  return `<section class="r-panel r-drugs">
      <h4>${iconImg("play", 1)}呼び出した兵士（抗菌薬）</h4>
      ${rows.length ? `<ul class="r-drug-list">${list}</ul>${more}` : `<p class="muted r-empty">抗菌薬を使いませんでした</p>`}
      <p class="r-trump ${trump >= 0.5 ? "bad" : trump > 0 ? "warn" : "good"}"><span class="trump-tag">切り札</span>（カルバペネム系）の割合 <b>${pct(trump)}</b></p>
    </section>`;
}

/** 薬が効かない細菌の印：盾（動画のシーン2・「はじめての人へ」・盤面で弾がはじかれたときと同じ。2026-11-06 作者の指摘で、朱の枠から統一） */
const SHIELD = () => `<i class="bug-shield">${iconImg("shield", 2)}</i>`;

/** 10匹の細菌の列。p の割合（四捨五入）を「薬が効かない細菌」（盾の印）にする。幅をそろえるため、べん毛のない絵（bare）で描く */
function bugRow(def: BacteriumDef | undefined, p: number, n = 10): string {
  if (!def) return "";
  const res = Math.round(Math.max(0, Math.min(1, p)) * n);
  return `<span class="r-bugs">${Array.from({ length: n }, (_, i) => `<span class="${i < res ? "res" : ""}">${bugImg(def, i % 2, true, 2)}${i < res ? SHIELD() : ""}</span>`).join("")}</span>`;
}

/**
 * 結果画面の「育った敵」：いちばん上がった組を、細菌10匹の列（はじめ → 終わり）で見せる。
 * 非医療従事者にも「薬が効かない細菌が増えた」が一目で分かるように（2026-11-06 作者の指摘）
 */
function enemyPanel(data: GameData, start: ResistanceTable, end: ResistanceTable, drugs: string[], used: boolean, fromLabel: string, toLabel: string): string {
  const rises = biggestRises(data, start, end, drugs, 3);
  const top = rises[0];
  if (!top) {
    return `<section class="r-panel r-enemy">
      <h4>${iconImg("germ", 1)}育った敵：薬が効かない細菌</h4>
      <div class="r-pop"><div class="r-pop-row"><span class="r-pop-label">${fromLabel}</span>${bugRow(data.bacteria[0], 0)}</div><div class="r-pop-row"><span class="r-pop-label">${toLabel}</span>${bugRow(data.bacteria[0], 0)}</div></div>
      <p class="r-pop-note">${used ? "大きく増えた組はありません" : "抗菌薬を使わなかったので、増えていません"}</p>
      <p class="r-pop-note r-pop-legend">${iconImg("shield", 2)}盾の印＝薬が効かない細菌</p>
    </section>`;
  }
  const def = data.bacteriumById.get(top.species);
  const abbr = (d: string) => escapeHtml(data.drugById.get(d)?.abbr ?? d);
  const name = (sp: string) => escapeHtml(data.bacteriumById.get(sp)?.name ?? sp);
  const others = rises
    .slice(1)
    .map((x) => `<li>${name(x.species)}の ${abbr(x.drug)}<span>${pct(x.from)} → <b>${pct(x.to)}</b></span></li>`)
    .join("");
  return `<section class="r-panel r-enemy">
      <h4>${iconImg("germ", 1)}育った敵：薬が効かない細菌</h4>
      <p class="r-pop-title">${name(top.species)}のうち、<b>${abbr(top.drug)}</b> が効かない細菌</p>
      <div class="r-pop">
        <div class="r-pop-row"><span class="r-pop-label">${fromLabel}<b>${pct(top.from)}</b></span>${bugRow(def, top.from)}</div>
        <div class="r-pop-row"><span class="r-pop-label">${toLabel}<b class="bad">${pct(top.to)}</b></span>${bugRow(def, top.to)}</div>
      </div>
      <p class="r-pop-note r-pop-legend">${iconImg("shield", 2)}盾の印＝薬が効かない細菌</p>
      ${others ? `<ul class="r-rises">${others}</ul>` : ""}
    </section>`;
}

/** 結果画面の下の小さな数字（医療費・手札のどの薬も効かない細菌・まず使う薬の割合） */
function subStats(r: StageResult): string {
  return `<div class="r-sub">
      <div>${iconImg("coin", 1)}<span>医療費</span><b>${yen(r.costSpent)}</b></div>
      <div class="${r.panResistantFraction >= 0.005 ? "bad" : ""}">${iconImg("broken", 1)}<span>手札のどの薬も効かない細菌</span><b>${pct(r.panResistantFraction)}</b></div>
      <div>${iconImg("shield", 1)}<span>まず使う薬（Access）の割合</span><b>${pct(r.usageByAware.Access)}</b></div>
    </div>`;
}

/** 「くわしい数字」の末尾：この回の種（2026-11-06 作者の判断で種を毎回変えたので、同じ条件でもう一度遊べるように出す） */
function seedNote(seed?: number): string {
  return seed === undefined ? "" : `<p class="seed-note">この回の乱数の種：<b>${seed}</b>。URL に <code>?seed=${seed}</code> を付けると、同じ供給制限・同じ細菌の並びでもう一度遊べます</p>`;
}

/**
 * 「くわしい数字」のポップアップ（教える人・専門家向け）。app.ts の data-action="detail" で開け閉め。
 * 「（教える人・専門家向け）」は small に分け、狭い画面では見出しの下の行に出す（実機：縦向きでは見出しが閉じるボタンの横で3行に折れていた）
 */
function detailPopup(title: string, body: string): string {
  return `<div class="detail-popup" hidden>
      <div class="popup-box">
        <div class="popup-head">${iconImg("chart", 2)}<b>${title}<small>（教える人・専門家向け）</small></b><button data-action="detail">閉じる<span class="key">（Esc）</span></button></div>
        ${body}
      </div>
    </div>`;
}

/**
 * 結果画面。ステージ2では、耐性率の表をステージ1の開始時から数える（from を渡す）。
 * ステージ1 → 2 のあいだ（既定は2050年まで）の変化も見えるようにするため。
 * 2026-11-06 作者の指摘「非医療従事者にも面白い結果を主役に、専門家が喜ぶ数字はポップアップに」：
 * 主役は膀胱のドット絵・呼び出した兵士・育った敵（細菌10匹の列）。AHI・DASC/DOT・系統別の割合・耐性率の表は「くわしい数字」へ
 */
export function resultScreen(data: GameData, scenario: ScenarioDef, phase: "present" | "future", r: StageResult, from?: ResistanceTable, short: readonly string[] = [], present?: StageResult, seed?: number): string {
  const stage = phase === "present" ? scenario.present : scenario.future;
  const drugs = stage.hand.map((h) => h.drug).filter((d) => !short.includes(d));
  const access = r.usageByAware.Access;
  const target = data.rules.stewardship.accessTarget;
  const start = from ?? r.resistanceStart;
  const fromLabel = from ? "ステージ1の開始" : "はじめ";
  const toLabel = from ? `${futureYear(data, scenario.future.yearsLater)}年の終わり` : "終わり";
  const used = Object.values(r.summons).reduce((a, b) => a + b, 0) > 0;
  const cause = causeLine(data, scenario, phase, r, present);
  const detail = `
    ${short.length ? `<p class="why short-why">供給制限で使えなかった薬：<b>${shortList(data, short)}</b></p>` : ""}
    <p class="why">いちばん使った系統：<b>${topClass(data, r)}</b>　／　大きく上がった耐性率（${fromLabel}から）：${used || from ? risesLine(data, start, r.resistanceEnd, drugs) : "抗菌薬を使わなかったので変わっていません"}</p>
    ${used ? `<p class="why-note">${USED_RISE_NOTE}</p>` : ""}
    <div class="stats">
      <div title="${r.budgetIncome > 0 ? `使えた額 ${yen(r.budgetStart + r.budgetIncome)}＝はじめ ${yen(r.budgetStart)}＋時間で増えた ${yen(r.budgetIncome)}${r.budgetShortSeconds >= 1 ? `。足りずに待った ${r.budgetShortSeconds.toFixed(0)}秒` : ""}` : `予算 ${yen(r.budgetStart)}`}"><span>${iconImg("coin", 1)} 医療費の合計</span><b>${yen(r.costSpent)}</b><small>${r.budgetIncome > 0 ? `使えた額 ${yen(r.budgetStart + r.budgetIncome)}${r.budgetShortSeconds >= 1 ? `・足りずに待った ${r.budgetShortSeconds.toFixed(0)}秒` : ""}` : `／ ${yen(r.budgetStart)}`}</small></div>
      <div><span>${iconImg("broken", 1)} 手札のどの薬も効かない細菌</span><b>${pct(r.panResistantFraction)}</b><small>出てきた細菌のうち</small></div>
      <div title="AHI（antibiotic heterogeneity index）：0〜1。1 は手札のすべての系統を同じ日数ずつ使ったとき、0 は1つの系統だけ。系統ごとの使用日数の割合から計算"><span>${iconImg("chart", 1)} 系統の使い分け（AHI）<i class="q">？</i></span><b>${r.ahi === null ? "—" : r.ahi.toFixed(2)}</b><small><em class="dir">${DIR.ahi}</em></small></div>
      ${dascCard(data, r)}
    </div>
    <div class="cols">
      <section>
        <h3>系統別の使用割合<small>（使用日数 ${r.spectrum.dot.toFixed(1)} 日のうち）</small></h3>
        ${bars(data, r.usageByClass)}
        <p class="aware-line" title="WHO の目標は、国全体の抗菌薬の使用量のうち Access 薬を ${pct(target)} 以上にすること（厚生労働省「抗微生物薬適正使用の手引き 第四版」医科・外来編 p.17）。1ステージの割合とは比べる対象が違います。日本は2023年に23.2%（同 歯科編 p.10）">Access 薬（まず使う薬）の割合 <b>${pct(access)}</b>　<em class="dir">${DIR.access}</em><i class="q">？</i></p>
      </section>
      <section>
        <h3>菌ごとの耐性率の変化</h3>
        ${resistanceTable(data, scenario.region, start, r.resistanceEnd, drugs, from ? "ステージ1の開始 → ステージ2の終わり" : "開始 → 終わり")}
      </section>
    </div>`;
  return `
  <div class="screen result-screen">
    <h2>${iconImg(r.outcome === "won" ? "star" : "broken", 3)}${phase === "present" ? "ステージ1" : "ステージ2"}の結果：<span class="result-banner">${outcomeLine(r)}</span></h2>
    <p class="cause ${cause.kind}">${cause.text}</p>
    <div class="r-main">
      ${bladderPanel(r)}
      ${drugsPanel(data, r)}
      ${enemyPanel(data, start, r.resistanceEnd, drugs, used, fromLabel, toLabel)}
    </div>
    ${subStats(r)}
    <p class="foot strong r-foot">効かなくなる速さはゲーム用に大げさにしています。現実の予測ではありません。</p>
    <div class="buttons">
      ${resultButtons(scenario, phase, r)}
      <button class="ghost" data-action="detail">${iconImg("chart", 1)}くわしい数字</button>
      <button data-action="share" title="結果を文にして、共有かコピー">${iconImg("up", 1)}共有</button>
    </div>
    ${detailPopup(`${phase === "present" ? "ステージ1" : "ステージ2"}のくわしい数字`, `${detail}${seedNote(seed)}`)}
  </div>`;
}

function resultButtons(scenario: ScenarioDef, phase: "present" | "future", r: StageResult): string {
  const won = r.outcome === "won";
  const next =
    phase === "present"
      ? `<button${won ? ' class="primary"' : ""} data-action="future">${escapeHtml(scenario.future.title)}へ</button>`
      : `<button${won ? ' class="primary"' : ""} data-action="final">まとめへ</button>`;
  const retry =
    phase === "present"
      ? `<button${won ? "" : ' class="primary"'} data-action="restart">ステージ1をやり直す</button>`
      : `<button${won ? "" : ' class="primary"'} data-action="retry2">ステージ2をやり直す<small>（ステージ1の結果はそのまま）</small></button>`;
  return won ? next + retry : retry + next;
}

/**
 * 適正に使っても耐性率が上がることの説明（2026-11-04 作者の判断「見せ方で対処」：適正な使い方でも結果の表で大きく上がる組があり、
 * 「どう使っても同じ」と受け取られないように。文は作者が確かめる）
 */
const USED_RISE_NOTE = "適正に使っても、使った薬の耐性率は上がります（どの薬も、効かない菌を選んで残すため）。このゲームでは、系統を使い分けると、1つの薬の耐性の上がり方を抑えられます。";

/** まとめ画面の、ステージ1・2050年それぞれの短い振り返り（膀胱の絵・結果・いちばん呼んだ兵士・切り札の割合） */
function finalCard(data: GameData, title: string, r: StageResult, kicker?: string): string {
  const frac = r.bladderMaxHp > 0 ? r.bladderHp / r.bladderMaxHp : 0;
  const top = Object.entries(r.summons)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])[0];
  const d = top ? data.drugById.get(top[0]) : undefined;
  const trump = r.usageByClass[TRUMP_CLASS] ?? 0;
  return `<section class="f-card ${r.outcome}">
      <h3>${escapeHtml(title)}${kicker ? `<small>${escapeHtml(kicker)}</small>` : ""}</h3>
      <div class="f-row">
        <div class="f-bladder">${bladderImg(22, 58, 2, frac)}<b>${Math.ceil(r.bladderHp)}<small>／${r.bladderMaxHp}</small></b></div>
        <div class="f-facts">
          <p class="f-outcome">${outcomeLine(r)}</p>
          <p class="f-fact">${d ? `<span class="r-portrait" style="--cls:${data.classById.get(d.class)?.color ?? "#64748b"}">${soldierImg(data, d, "card")}</span><span>いちばん呼んだ<br><b>${escapeHtml(genericName(d))}</b></span>` : `<span>抗菌薬を使いませんでした</span>`}</p>
          <p class="f-fact ${trump >= 0.5 ? "bad" : trump > 0 ? "warn" : "good"}"><span class="trump-tag">切り札</span><span>の割合 <b>${pct(trump)}</b></span></p>
          <p class="f-fact ${r.panResistantFraction >= 0.005 ? "bad" : ""}">${iconImg("broken", 1)}<span>手札のどの薬も効かない細菌 <b>${pct(r.panResistantFraction)}</b></span></p>
        </div>
      </div>
    </section>`;
}

/**
 * まとめ画面。2026-11-06 作者の指摘：主役は2つのステージの振り返り（膀胱の絵・結果・いちばん呼んだ兵士・切り札）と、
 * 育った敵（細菌10匹の列）。数字の表は「くわしい数字」のポップアップへ
 */
export function finalScreen(data: GameData, scenario: ScenarioDef, present: StageResult, future: StageResult, short: { present: string[]; future: string[] } = { present: [], future: [] }, seed?: number): string {
  const row = (label: string, f: (r: StageResult) => string) => `<tr><th>${label}</th><td>${f(present)}</td><td>${f(future)}</td></tr>`;
  const drugs = [...new Set([...scenario.present.hand, ...scenario.future.hand].map((h) => h.drug))];
  const year = futureYear(data, scenario.future.yearsLater);
  const used = Object.values(present.summons).reduce((a, b) => a + b, 0) > 0;
  const table = `<table class="summary">
      <thead><tr><th></th><th>ステージ1「${escapeHtml(scenario.present.title)}」</th><th>ステージ2「${escapeHtml(scenario.future.title)}」</th></tr></thead>
      <tbody>
        ${row("結果", outcomeLine)}
        ${short.present.length || short.future.length ? `<tr><th>供給制限で使えなかった薬</th><td>${shortList(data, short.present)}</td><td>${shortList(data, short.future)}</td></tr>` : ""}
        ${row("膀胱の残り", (r) => `${Math.ceil(r.bladderHp)} / ${r.bladderMaxHp}`)}
        ${row("医療費の合計", (r) => yen(r.costSpent))}
        ${row("いちばん使った系統", (r) => topClass(data, r))}
        ${row(`Access 薬（まず使う薬）の割合<br><small class="dir">${DIR.access}</small>`, (r) => pct(r.usageByAware.Access))}
        ${row("使用日数（DOT にならう）", (r) => `${r.spectrum.dot.toFixed(1)} 日`)}
        ${row(`スペクトラムの広さ（DASC/DOT）<br><small class="dir">${DIR.dasc}</small>`, (r) => dascValue(data, r))}
        ${row("手札のどの薬も効かない細菌", (r) => pct(r.panResistantFraction))}
        <tr><th>耐性の進み方</th><td colspan="2">${escapeHtml(modelLabel(present.model))}</td></tr>
        <tr><th>大きく上がった耐性率<br><small>（ステージ1の開始 → ステージ2の終わり）</small></th><td colspan="2">${risesLine(data, present.resistanceStart, future.resistanceEnd, drugs)}</td></tr>
      </tbody>
    </table>
    ${dascMissingNote(data, [present, future])}`;
  return `
  <div class="screen final-screen">
    <p class="big-tagline">あなたの選択が、未来の敵をつくる</p>
    <div class="f-cards">
      ${finalCard(data, `ステージ1「${scenario.present.title}」`, present)}
      <span class="f-arrow">▶</span>
      ${finalCard(data, `ステージ2「${scenario.future.title}」`, future, `${scenario.future.yearsLater}年後`)}
    </div>
    <div class="r-main one">
      ${enemyPanel(data, present.resistanceStart, future.resistanceEnd, drugs, used, "ステージ1の開始", `${year}年の終わり`)}
    </div>
    ${scenario.debrief ? `<section class="debrief"><h3>振り返り</h3><p>${escapeHtml(scenario.debrief)}</p></section>` : ""}
    <p class="foot strong r-foot center">耐性率の動きはゲーム用に大げさにした値です。現実の予測ではありません。</p>
    ${noticeShort()}
    <div class="buttons"><button class="primary" data-action="restart">最初からやり直す</button><button class="ghost" data-action="detail">${iconImg("chart", 1)}くわしい数字</button><button data-action="share" title="結果を文にして、共有かコピー">${iconImg("up", 1)}共有</button><button data-action="sources">出典と注意</button><button data-action="title">タイトルへ</button></div>
    ${detailPopup("2つのステージのくわしい数字", `${table}${used ? `<p class="why-note">${USED_RISE_NOTE}</p>` : ""}${seedNote(seed)}`)}
  </div>`;
}

export function sourcesScreen(data: GameData): string {
  const r = data.rules.resistance;
  return `
  <div class="screen sources-screen">
    <h2>出典と注意</h2>
    ${notice(data)}
    <p class="small">教える人が出典を確かめるための画面です。見出しを押すと開きます。専門用語は「用語の説明」に。</p>
    <div class="src-cols">
      <details class="src-sec" open>
        <summary><h3>データの出典</h3></summary>
        <dl>
          <dt>感受性率・尿から分離される菌の割合</dt>
          <dd>厚生労働省 院内感染対策サーベイランス（JANIS）検査部門 公開情報 2025年1月〜12月 年報（全集計対象医療機関）【入院検体・CLSI 2012 版】表7・表3。政府統計の総合窓口（e-Stat）掲載のファイルを加工して作成（政府標準利用規約 第2.0版）。府県別は同じ年報の地域ブロック別ファイル。</dd>
          <dt>薬価</dt>
          <dd>厚生労働省「薬価基準収載品目リスト及び後発医薬品に関する情報について（令和8年11月1日適用）」を加工して作成（公共データ利用規約 第1.0版）。</dd>
          <dt>投与間隔・AWaRe 分類・吸収率・耐性の連動（ESBL・CRE）</dt>
          <dd>厚生労働省「抗微生物薬適正使用の手引き 第四版」（医科・入院編、医科・外来編、歯科編、薬剤耐性菌感染症の抗菌薬適正使用編）。AMK・IPM/CS・CTX の用法（1日量を含む）は JAID/JSC 感染症治療ガイド2023（CTX は尿路感染症の章に成人の用量がないため、市中肺炎の章）。セフジニルの用法は電子添文、LVFX の吸収率はインタビューフォーム（この2つは PMDA 掲載）。内服の AMPC・CEX の用法は、手引き 歯科編の表と、手引きに引かれた電子添文の範囲から選んでいます。</dd>
          <dt>使用日数・スペクトラムの広さ（DASC/DOT）・アンチバイオグラムの使い方</dt>
          <dd>8学会合同抗微生物薬適正使用推進検討委員会「抗微生物薬適正使用支援プログラム実践のためのガイダンス 2024年度改訂版」（日本化学療法学会雑誌 73巻2号）。使用日数と DASC は表4（p.119）の考え方にならい、ASC スコアは表5（p.120。Kakiuchi ら, Clin Infect Dis 2022 の値）。表にない薬の ASC は、元の論文（Kakiuchi ら, Clin Infect Dis 2022 の表1）の値、そこにもない CMZ は、同じ方法で日本の承認薬に定めた Maeda ら（J Infect Chemother 2025 の表1）の値です。アンチバイオグラムを初期治療の薬選びに使うことは p.130。</dd>
          <dt>2050年の注記</dt>
          <dd>Review on Antimicrobial Resistance（委員長 Jim O'Neill）「Antimicrobial Resistance: Tackling a crisis for the health and wealth of nations」2014年12月：2050年の推計と、その前提（RAND Europe：15年で耐性率が100%になる、KPMG：耐性率が今より40%上がる（相対か絶対かは本文に書かれていない）。どちらも確かな予測ではない大まかな見積もり。p.6・p.8）。GBD 2021 Antimicrobial Resistance Collaborators. Lancet 2024; 404: 1199–226：2050年の予測（細菌の薬剤耐性が直接の原因の死亡 191万人、関連した死亡 822万人）。この2つは2050年の注記にだけ使っています。</dd>
          <dt>2050年までの耐性化の速さ</dt>
          <dd>厚生労働省「薬剤耐性ワンヘルス動向調査年次報告書 2024」（令和7年3月14日）の JANIS の耐性率の推移（2014〜2023年）で、このゲームに出てくる菌と薬の組み合わせ（CTRX は CTX の値で見た）の中でいちばん速く上がった組（肺炎桿菌の CAZ：3.8% → 11.7%、表2）の上がり方を、1年あたりの上限にしています（表の値は「耐性（R）」の割合で、使ったのは上がる速さ・下がる速さ（傾き）だけです）。ステージ1の中の変化はゲーム用に誇張しています。2050年までは、使い方によっては多くの組がこの上限の速さで延びるので、多くの組では実測より速く上がります。ステージ1で一度も使わなかった薬（連動などでステージ1の中に上がったものを除く）は、同じ表で耐性率がはっきり下がっていた組（緑膿菌の TAZ/PIPC・CFPM・IPM/CS・MEPM・AMK・LVFX、腸球菌の LVFX、大腸菌と肺炎桿菌の CMZ、肺炎桿菌の MEPM）に限り、その組の下がり方で下げています（いちばん速いのは緑膿菌の AMK：1.9% → 0.6%）。実測は薬が使われ続けた中での変化で、使わなければ下がると示したものではありません。</dd>
          <dt>自然耐性・値のない組み合わせの扱い</dt>
          <dd>EUCAST「Expected Resistant Phenotypes」v1.2、「Expert Rules v3.2 on Enterococcus spp.」、「Breakpoint tables」v16.1。</dd>
        </dl>
      </details>
      <details class="src-sec">
        <summary><h3>加工していること</h3></summary>
        <ul>
          <li>「効く」確率は、JANIS の感性（S）の割合だけを使います（中間・耐性・判定不能は効かない扱い）。判定基準は CLSI 2012 で、いまの臨床検査の基準とは違います。</li>
          <li>府県と比べられるよう、「すべての検査材料」の表を使っています（尿から出た株だけの集計ではありません）。</li>
          <li>腸内細菌目で CTRX が効かない菌は ESBL 産生菌とみなし（単純化）、ABPC・AMPC・CEZ・CEX・CTX・CAZ・経口第3世代セフェム・CFPM も効かないことにしています。このため CTX・CAZ・CFPM の耐性率は公開データより高くなります（いちばん大きいのはプロテウスの CAZ：全国で 5% → 29%）。CTRX が効かないだけでは、CMZ・カルバペネム系には連動させません。</li>
          <li>腸内細菌目で MEPM が効かない菌は CRE とみなし（単純化）、このゲームのほかの β-ラクタム系の薬（IPM/CS・CTRX・CMZ・TAZ/PIPC、ESBL の連動を通して ABPC・AMPC・CEZ・CEX・CTX・CAZ・経口第3世代セフェム・CFPM）も効かないことにしています。IPM/CS も効かないことにしています（国内のカルバペネマーゼ産生菌に多い型の一つは、イミペネムに感性を示しますが、表していません）。LVFX・AMK と、緑膿菌には連動させません。</li>
          <li>経口第3世代セフェム（セフジニル）は CTX の値で代用し、CTRX より効く値にならないようにしています。内服の AMPC は ABPC、内服の CEX は CEZ の値で代用しています（JANIS に値がないため。EUCAST で ABPC の感性をそのまま当てはめられるのは単純性尿路感染症だけです）。腸球菌の TAZ/PIPC は ABPC の値で代用し、腸球菌の MEPM と IPM/CS は効かない扱いです。プロテウスの IPM/CS は公開データの値（全国で感性 55%）をそのまま使っています（プロテウスにはイミペネムの活性がもともと低い：EUCAST）。</li>
          <li>カードには用量を出していません。投与間隔を「召喚の待ち時間」にしています。医療費は1日量の薬価を5段階にしたものです。</li>
          <li>使用日数は、1回の召喚で投与間隔の長さを数え、レーンごとに足しています（DOT にならった数え方で、在院日数で補正していません）。DASC/DOT は推奨度・エビデンスレベルの低い指標（C-III）で、もとの ASC スコアは米国の状況で作られたものです（ガイダンス p.118〜121）。</li>
          <li>アンチバイオグラムは JANIS の地域の集計で、施設ごとの表ではありません。色の区切りはゲーム用の目安です。</li>
        </ul>
      </details>
      <details class="src-sec">
        <summary><h3>誇張していること</h3></summary>
        <ul>
          <li>耐性化の速さ：現実に年単位で起きる変化を、数分のステージに縮めています（${escapeHtml(modelLabel(r.model))}）。</li>
          <li>ステージ2は、ステージ1と同じ使い方が2050年まで続いたとみなして、耐性率を先へ延ばしています。1年あたりの上がり方は、国の報告書で2014〜2023年に実際に観測された上がり方のうち、このゲームの菌と薬でいちばん速かったもの（肺炎桿菌の CAZ。オッズが約4.8年で2倍）を超えないようにしています。使い方によっては多くの組がこの上限の速さで延びるので、多くの組では実測より速く上がります。ステージ1で一度も使わなかった薬（連動などで上がったものを除く）は、実際に下がっていた組に限って、その下がり方で下げています。ゲームの耐性率は、2050年の予測ではありません。</li>
          <li>同じ系統ばかり使うと、その系統の耐性が早く進みます（系統を偏らせずに使う考え方。ASP ガイダンス2024 p.120 に評価指標の一つとして AHI（抗菌薬選択圧指数）の名前があり、有用性は今後の検討課題とされています。式と強さはゲームの決めごとです）。</li>
          <li>菌の体力・速さ・膀胱へのダメージ、薬の強さはゲーム用の値です。</li>
        </ul>
      </details>
    </div>
    <details class="src-sec glossary">
      <summary><h3>用語の説明</h3></summary>
      <dl>${GLOSSARY.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join("")}</dl>
    </details>
    <p class="muted">薬の名前は略号と一般名だけを使っています（${escapeHtml(drugNames(data))}）。細菌と兵士（抗菌薬）の絵はすべてコードで描いています。見出し・数字・ボタンなどのドット絵の文字は DotGothic16（Fontworks。SIL Open Font License 1.1）、長い説明の文は端末に入っているフォントを使います。</p>
    <div class="buttons"><button class="primary" data-action="back">戻る</button></div>
  </div>`;
}

/** 出典画面の用語の説明（遊ぶ人向けに、言い切れる範囲で短く） */
const GLOSSARY: [string, string][] = [
  ["JANIS", "厚生労働省の院内感染対策サーベイランス。参加している医療機関の検査室から細菌の検査結果を集め、集計を公開しています。"],
  ["感性（S）・中間（I）・耐性（R）", "薬剤感受性試験の判定。このゲームでは「感性」の割合だけを「効く」確率に使います。"],
  ["CLSI 2012", "米国の臨床検査標準協会（CLSI）が定めた、感受性を判定する基準の2012年版。このゲームで使った JANIS の表は、この基準で判定しています。"],
  ["EUCAST", "欧州の薬剤感受性試験の委員会。判定の基準や、ほとんどの株に効かない菌と薬の組み合わせの表（Expected Resistant Phenotypes。以前は自然耐性の表と呼ばれていました）を出しています。"],
  ["自然耐性", "その菌の種類がもともと持っている、薬が効かない性質。あとから遺伝子の変化や、ほかの菌からの遺伝子の受け渡しで身につける耐性（獲得耐性）とは別のものです。"],
  ["選択圧", "薬を使うと、効く菌は減り、効かない菌が残って増えます。耐性菌が選ばれて残る、この働きのことです。"],
  ["腸内細菌目", "大腸菌・肺炎桿菌・プロテウスなどのグラム陰性桿菌のグループ。名前は似ていますが、腸球菌や緑膿菌は含みません。"],
  ["β-ラクタム系", "ペニシリン系・セフェム系（セファロスポリン系と、CMZ などのセファマイシン系）・カルバペネム系など、β-ラクタム環という共通の形を持つ薬。"],
  ["β-ラクタマーゼ阻害薬", "β-ラクタム系を分解する酵素（β-ラクタマーゼ）の働きを抑える薬。TAZ/PIPC のタゾバクタムがこれに当たり、系統名の「βラクタマーゼ阻害薬配合ペニシリン」はこの組み合わせのことです。"],
  ["ESBL", "基質特異性拡張型 β-ラクタマーゼ。ペニシリン系や第1〜3世代のセファロスポリン系を分解する酵素で、これを作る菌にはそれらの薬が効きにくくなります。セファマイシン系（CMZ）とカルバペネム系（MEPM・IPM/CS）は分解されません。このゲームでは手引き（薬剤耐性菌感染症編 p.12〜13）にならい、ESBL を作る菌には CFPM も効かないことにしています。"],
  ["供給制限", "製造や流通の事情で、薬が手に入りにくくなること。このゲームでは、遊ぶたびに手札の何枚かが使えなくなります（どの薬かは毎回変わり、出てくる菌それぞれに、公開データで感性率 80% 以上の薬が1枚は残るようにしています）。"],
  ["耐性の進み方（A・B）", "タイトル画面で選べます。A（薬ごと）：使った薬にさらされた菌の中で、その薬に耐性の菌が残って増えます。公開データで同じ値を使っている薬（内服 AMPC と ABPC、内服 CEX と CEZ、経口第3世代セフェムと CTX）は、片方を使うと両方上がります。B（系統ごと）：同じ系統の薬を使うほど系統のゲージがたまり、その系統の薬がまとめて効かなくなります。どちらも、変化の速さはゲーム用に誇張しています。"],
  ["耐性の連動", "このゲームで、ある薬に耐性の菌を、仕組みの近いほかの薬にも耐性にすること。CTRX に耐性の腸内細菌目は ESBL とみなして ABPC・AMPC・CEZ・CEX・CTX・CAZ・経口第3世代セフェム・CFPM にも、MEPM に耐性の腸内細菌目は CRE とみなして IPM/CS などほかの β-ラクタム系にも耐性にします。遊んでいる途中の知らせでは、こうして上がった薬（そのステージでまだ使っていない薬）に ※ を付けます（耐性の進み方 A で、代用の組の片方を使ってもう片方が上がったときも ※ が付きます）。"],
  ["CRE", "カルバペネム耐性腸内細菌目細菌。カルバペネム系の薬に耐性を示す腸内細菌目の菌です。このゲームでは MEPM に耐性の菌を CRE とみなします。"],
  ["CTX", "セフォタキシム（第3世代セフェム）。経口第3世代セフェムの感性率の代用と、国の報告書の耐性率の推移（CTRX の代わり）にも使っています。"],
  ["代用", "公開データに値がない薬の感性率を、近い薬の値で置き換えること。このゲームでは、内服の AMPC を ABPC、内服の CEX を CEZ、経口第3世代セフェムを CTX、腸球菌の TAZ/PIPC を ABPC の値で代用しています。"],
  ["AWaRe 分類", "WHO の抗菌薬の分類。Access は一般的な感染症の第一・第二選択薬の多くを含み、耐性化しても代わりがある群、Watch は耐性化が心配されるため使う場面を限るべき薬、Reserve はほかの薬が効かないときのために取っておく薬です。"],
  ["DOT（使用日数）", "抗菌薬を使った日数を、薬ごとに数えたもの。このゲームでは、1回の召喚で投与間隔の長さを数えます。"],
  ["ASC スコア・DASC/DOT", "ASC スコアは、薬が効く菌の範囲（スペクトラム）の広さを点数にしたもの（米国の状況で作られた点数）。DASC は ASC スコア × 使用日数の合計で、DASC/DOT はそれを使用日数で割った、使った薬の広さの平均です。"],
  ["効かない扱い", "このゲームで効かないことにしている組み合わせ（腸球菌の MEPM と IPM/CS）。EUCAST の自然耐性の表にはありませんが、MEPM は判定の基準の表で「その菌の治療には適さない」とされ、IPM/CS は公開データに値がなく、EUCAST の基準でも通常量で感性（S）とは判定されません。感受性試験の中間（I）や判定不能も、このゲームでは効かない扱いです。"],
  ["兵士の姿", "このゲームで、抗菌薬の系統を表した姿。剣は β-ラクタム系（機械兵のカルバペネム系も剣を持つ）、盾は β-ラクタマーゼ阻害薬を配合した TAZ/PIPC、機械兵はカルバペネム系、槌は AMK（アミノグリコシド系）、弓は LVFX（キノロン系）です。鎧はセフェム系の世代だけの印で（第1世代は革の胸当て、セファマイシン系の CMZ は第2世代の段で鉄の胸当て、第3世代は全身の鎧、第4世代は金の縁と羽飾り）、世代が上がるほど、おおまかに効くグラム陰性菌の種類が増えます（第3世代はグラム陽性菌への効き目が第1世代より弱い、CMZ は ESBL に分解されないなど、得意・不得意があります）。ほかの系統の広さは表していません（鎧のない LVFX も、効く範囲がとても広い薬です）。姿が立派でも、強い・良いという意味ではありません。範囲の広い薬を使いすぎると、耐性菌が増えやすくなります。胸や盾の紋章は緑膿菌にも効く見込み（カードの「緑膿菌」と同じ、ゲーム内の目安）、足元のカプセルは内服です。兵士の濃さ（点の詰まり具合）は、いま体内にある薬の量です（薬の良し悪しではありません）。吸収率の低い内服薬は、はじめから薄く出ます。"],
  ["デエスカレーション", "菌名や感受性が分かったあとに、効く範囲の狭い薬に切り替えたり、要らなくなった薬をやめたりすること（狭域化）。"],
  ["グラム染色・薬剤感受性試験", "グラム染色は、菌を色（陰性はピンク〜赤、陽性は紫）と形で分ける検査。薬剤感受性試験は、どの薬が効くかを調べる検査です。"],
  ["手引き", "厚生労働省「抗微生物薬適正使用の手引き 第四版」（医科・入院編、医科・外来編、歯科編、薬剤耐性菌感染症の抗菌薬適正使用編）。"],
  ["オッズ", "耐性率 ÷（1 − 耐性率）。耐性率が数%のうちは、オッズが2倍になると耐性率もほぼ2倍になります（5% → 約9.5%）。耐性率が高いほど上がり方は小さくなり（30% → 約46%）、100%は超えません。"],
];

/** 薬の一般名の一覧（出典画面の補足用） */
export function drugNames(data: GameData): string {
  return data.drugs.map((d) => `${d.abbr}＝${genericName(d)}`).join("、");
}
