// 遊ぶ前後の画面（DOM）：タイトル、遊び方、ブリーフィング、結果、まとめ、出典。
// ボタンは data-action を持ち、app.ts がまとめて受ける。
import { futureYear, susceptibility, type GameData, type ResistanceModelId, type ResistanceTable, type ScenarioDef, type StageDef, type StageResult } from "../engine/index.ts";
import { GRAM_COLORS } from "./bugs.ts";
import { escapeHtml, genericName, modelLabel, pct, yen } from "./format.ts";

const css = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const GN = css(GRAM_COLORS.negative.fill);
const GP = css(GRAM_COLORS.positive.fill);

/** 注意書き（SPEC.md 7.3）。医療費の文は、医療費の方式（薬価の段階化／抽象コスト）で切り替える */
export function notice(data: GameData): string {
  const cost =
    data.rules.cost.mode === "yakka"
      ? "医療費は、令和8年度の薬価基準をもとに段階化したものです（実際の金額ではありません）。"
      : "医療費はゲーム用の数値で、実際の値段とは関係ありません。";
  return `
  <ul class="notice">
    <li>このゲームは教育用のシミュレーションです。実際の診療の判断には使えません。</li>
    <li>感受性の数値は公開データ（JANIS）を加工したものです。耐性化の速さは、ゲーム用に誇張しています。</li>
    <li>${cost}</li>
  </ul>`;
}

export function titleScreen(data: GameData, scenario: ScenarioDef, model: ResistanceModelId): string {
  return `
  <div class="screen title-screen">
    <div class="title-art">${miniBugs()}</div>
    <h1>センタクアツ<small>（仮）</small></h1>
    <p class="tagline">あなたの選択が、未来の敵をつくる</p>
    <p class="lead">細菌から膀胱を守る、抗菌薬のタワーディフェンス。<br>選んだ抗菌薬しだいで耐性菌が増え、「${escapeHtml(scenario.future.title)}」で、自分が育てた耐性菌と戦います。</p>
    <div class="buttons">
      <button class="primary" data-action="start">はじめる</button>
      <button data-action="howto">遊び方</button>
      <button data-action="sources">出典と注意</button>
    </div>
    ${notice(data)}
    <p class="meta">ステージ：${escapeHtml(scenario.title)}／使うデータ：${escapeHtml(scenario.region)}（JANIS）／${escapeHtml(modelLabel(model))}</p>
  </div>`;
}

function miniBugs(): string {
  const rod = (x: number, y: number, w: number, h: number, a: number) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${GN}" stroke="#9d1f52" transform="rotate(${a} ${x + w / 2} ${y + h / 2})"/>`;
  const cocci = (x: number, y: number) =>
    [0, 13, 28, 41].map((dx) => `<circle cx="${x + dx}" cy="${y}" r="6.5" fill="${GP}" stroke="#2e1260"/>`).join("");
  return `<svg viewBox="0 0 260 60" width="260" height="60" aria-hidden="true">
    ${rod(10, 22, 30, 13, -12)}${rod(60, 30, 36, 15, 8)}<rect x="112" y="16" width="40" height="8" rx="4" fill="${GN}" stroke="#9d1f52"/>${cocci(170, 34)}${rod(220, 18, 28, 12, 20)}
  </svg>`;
}

export function howtoScreen(): string {
  return `
  <div class="screen howto-screen">
    <h2>遊び方</h2>
    <div class="panels">
      <section>
        <h3>1. 膀胱を守る</h3>
        <svg viewBox="0 0 260 120" width="260" height="120" aria-hidden="true">
          <rect x="6" y="10" width="54" height="100" rx="22" fill="#fde68a" stroke="#d4a017" stroke-width="2"/>
          <text x="33" y="66" font-size="13" text-anchor="middle" fill="#7c4a03" font-weight="bold">膀胱</text>
          ${[30, 60, 90].map((y) => `<line x1="64" y1="${y}" x2="254" y2="${y}" stroke="#e6d3dc"/>`).join("")}
          <rect x="200" y="38" width="30" height="13" rx="6.5" fill="${GN}" stroke="#9d1f52"/>
          <path d="M190 45 L150 45" stroke="#9d1f52" stroke-width="2" marker-end="url(#ar)"/>
          <defs><marker id="ar" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M10 0 L0 5 L10 10z" fill="#9d1f52"/></marker></defs>
        </svg>
        <p>細菌は右（尿道側）から3本のレーンを進んできます。膀胱に着くと耐久が減り、0 になると負けです。すべての波をしのげば勝ちです。</p>
      </section>
      <section>
        <h3>2. 近づくほど分かる</h3>
        <div class="levels">
          <div><b>遠い</b><span>グラム染色の色と形だけ</span><em><i style="background:${GN}"></i>陰性（ピンク〜赤）<i style="background:${GP}"></i>陽性（紫）</em></div>
          <div><b>中ほど</b><span>菌名（培養・同定）</span></div>
          <div><b>近い</b><span>手札のうち効かない薬（薬剤感受性試験）</span></div>
        </div>
        <p>早く広い薬を使うか、菌名や感受性が分かるまで待って狭い薬に切り替えるか（デエスカレーション）を判断します。</p>
        <p>菌名が分かる前は、<b>アンチバイオグラム</b>（その地域で、菌ごとに感性（S）だった株の割合。右上のボタンか A キー）を見て、効く見込みの高い薬を選べます。</p>
      </section>
      <section>
        <h3>3. 抗菌薬を召喚する</h3>
        <p>下のカードを選び（数字キーでも選べます）、レーンをクリックすると召喚されます。医療費が減ります。</p>
        <ul>
          <li><b>待ち時間＝投与間隔</b>：ゲームの1日は24秒（1時間＝1秒）。「6時間毎」の薬は6秒、「1日1回」の薬は24秒待ちます。</li>
          <li><b>内服薬</b>は吸収率のぶん弱い状態で出ます。</li>
          <li>効かない菌には弾がはじかれます。<b>耐性</b>＝その個体が耐性を獲得している。<b>自然耐性</b>＝その菌種がもともと効かない。<b>効かない扱い</b>＝このゲームで効かないことにしている組み合わせ（腸球菌に MEPM）。</li>
          <li>薬を使うと、その薬にさらされた菌の中で耐性菌が選ばれて残り（<b>選択圧</b>）、<b>耐性率が上がります</b>。このゲームでは、同じ系統ばかり使うと、その系統の耐性が早く進みます。</li>
        </ul>
        <p class="small">カードの <b>Access</b>・<b>Watch</b> は WHO の AWaRe 分類（Access がまず使う薬、Watch は耐性化に注意して使う薬）。「大腸菌など・緑膿菌・腸球菌」は、この地域のデータで効く見込みがあるかのゲーム内の目安で、実際の薬の選び方の根拠にはなりません。</p>
      </section>
    </div>
    <div class="buttons"><button class="primary" data-action="start">はじめる</button><button data-action="title">タイトルへ</button></div>
  </div>`;
}

function handChips(data: GameData, stage: StageDef): string {
  return stage.hand
    .map((h) => {
      const d = data.drugById.get(h.drug)!;
      const color = data.classById.get(d.class)?.color ?? "#64748b";
      return `<span class="chip" style="--cls:${color}" title="${escapeHtml(d.name)}">${escapeHtml(d.abbr)}</span>`;
    })
    .join("");
}

export function briefingScreen(data: GameData, scenario: ScenarioDef, phase: "present" | "future", extra = "", startTable?: ResistanceTable): string {
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
    ${phase === "future" ? `<p class="exaggerated">ゲームの中の耐性化の速さは誇張しています。現実が${futureYear(data, scenario.future.yearsLater)}年にこのとおりになる、という予測ではありません。</p>` : ""}
    ${extra}
    <div class="facts">
      <div><span>手札</span><div class="chips">${handChips(data, stage)}</div></div>
      <div><span>医療費の予算</span><b>${yen(stage.budget)}</b></div>
      <div><span>敵の波</span><b>${stage.waves.length}</b></div>
    </div>
    ${handNote}
    ${startTable ? `<details class="abg-details"><summary>アンチバイオグラム（開始時の感性率）を見る</summary>${antibiogramBlock(data, scenario.region, startTable, stage.hand.map((h) => h.drug), phase)}</details>` : ""}
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
    ...years.map((y) => `<th>${base + y}年</th>`),
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
  return `<table class="timeline"><thead><tr><th>耐性率</th>${head}</tr></thead><tbody>${body}</tbody></table>
    <p class="table-note">ゲーム内の値で、予測ではありません。ステージ1の中の変化はゲーム用に誇張しています。そのあとの1年あたりの上がり方は、国の報告書で実際に観測された上がり方のうち、このゲームの菌と薬でいちばん速かったものを超えないようにしています（多くの組では、実測より速く上がります）。</p>`;
}

/** 「2050年問題」の注記（研究の推計の数字と、ゲームの値はそこから出したものではないこと） */
export function year2050Note(data: GameData, yearsLater: number): string {
  if (futureYear(data, yearsLater) !== 2050) return "";
  return `<p class="note2050"><b>「2050年問題」</b>：2014年の英国の AMR Review は、対策をとらなければ2050年に薬剤耐性（AMR）による死亡が年1,000万人に達するという大まかな試算を示しました（HIV・結核・マラリアの薬剤耐性を含む）。2024年の世界疾病負荷研究（GBD、Lancet）は、2050年に細菌の薬剤耐性が直接の原因の死亡を191万人、耐性菌の感染に関連した死亡を822万人と予測しています（2つの推計は対象が違うため、そのまま比べることはできません）。このステージの耐性率は、これらの推計から出したものではありません。</p>`;
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

function resistanceTable(data: GameData, region: string, from: ResistanceTable, to: ResistanceTable, drugs: string[], fromLabel: string): string {
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
          return rose ? `<td class="${cls}">${pct(a)}<span>→</span><b>${pct(b)}</b></td>` : `<td>${pct(b)}</td>`;
        })
        .join("");
      return `<tr><th>${escapeHtml(data.bacteriumById.get(sp)!.name)}</th>${cells}</tr>`;
    })
    .join("");
  return `<div class="rtable-wrap"><table class="rtable"><thead><tr><th>耐性率（${escapeHtml(fromLabel)} → 終わり）</th>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="table-note">耐性率＝その菌のうち、薬が効かない個体の割合。盤面の「耐性：」は1匹ごとの結果です。自然耐性＝その菌種にもともと効かない。効かない扱い＝このゲームで効かないことにしている組み合わせ。</p>`;
}

function outcomeLine(r: StageResult): string {
  return r.outcome === "won" ? `<span class="won">守り切った</span>` : `<span class="lost">膀胱が破られた</span>`;
}

/** DASC/DOT（使った薬の平均の ASC＝平均の抗菌スペクトラムの広さ）。ASP ガイダンス2024 表4（p.119） */
function dascValue(data: GameData, r: StageResult): string {
  if (r.spectrum.dascPerDot !== null) return r.spectrum.dascPerDot.toFixed(1);
  return "—";
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
  const small =
    r.spectrum.dascPerDot !== null
      ? `使った薬の平均の抗菌スペクトラム（ASC。${ascScale(data)}）`
      : r.spectrum.dot > 0
        ? `ASC スコアを確かめていない薬（${missing}）を使ったので、まだ出せません`
        : "抗菌薬を使っていません";
  return `<div><span>スペクトラムの広さ（DASC/DOT）</span><b>${dascValue(data, r)}</b><small>${small}</small></div>`;
}

function topClass(data: GameData, r: StageResult): string {
  const top = Object.entries(r.usageByClass).sort((a, b) => b[1] - a[1])[0];
  return top ? `${escapeHtml(data.classById.get(top[0])?.name ?? top[0])} ${pct(top[1])}` : "—";
}

/** 「いちばん上がった耐性率」の1行（上位3つ） */
function risesLine(data: GameData, from: ResistanceTable, to: ResistanceTable, drugs: string[]): string {
  const rises = biggestRises(data, from, to, drugs, 3);
  if (rises.length === 0) return "大きく上がった耐性率はありません";
  return rises
    .map((x) => `${escapeHtml(data.bacteriumById.get(x.species)!.name)}の ${escapeHtml(data.drugById.get(x.drug)!.abbr)} ${pct(x.from)} → <b>${pct(x.to)}</b>`)
    .join("、");
}

/**
 * 結果画面。ステージ2では、耐性率の表をステージ1の開始時から数える（from を渡す）。
 * ステージ1 → 2 のあいだ（既定は2050年まで）の変化も見えるようにするため
 */
export function resultScreen(data: GameData, scenario: ScenarioDef, phase: "present" | "future", r: StageResult, from?: ResistanceTable): string {
  const stage = phase === "present" ? scenario.present : scenario.future;
  const drugs = stage.hand.map((h) => h.drug);
  const access = r.usageByAware.Access;
  const target = data.rules.stewardship.accessTarget;
  const start = from ?? r.resistanceStart;
  const fromLabel = from ? "ステージ1の開始" : "開始";
  const used = Object.values(r.summons).reduce((a, b) => a + b, 0) > 0;
  return `
  <div class="screen result-screen">
    <h2>${phase === "present" ? "ステージ1" : "ステージ2"}の結果：${outcomeLine(r)}</h2>
    <p class="why">いちばん使った系統：<b>${topClass(data, r)}</b>　／　大きく上がった耐性率（${fromLabel}から）：${used || from ? risesLine(data, start, r.resistanceEnd, drugs) : "抗菌薬を使わなかったので、耐性率は変わっていません"}</p>
    <div class="stats">
      <div><span>膀胱の残り</span><b>${Math.ceil(r.bladderHp)} / ${r.bladderMaxHp}</b></div>
      <div><span>医療費の合計</span><b>${yen(r.costSpent)}</b><small>/ ${yen(r.budgetStart)}</small></div>
      <div><span>手札のどの薬も効かない菌</span><b>${pct(r.panResistantFraction)}</b><small>出てきた菌のうち</small></div>
      <div><span>偏りの指標（仮）</span><b>${r.evennessProvisional === null ? "—" : r.evennessProvisional.toFixed(2)}</b><small>使った系統の偏り（仮の式。作者の指標に差し替える）</small></div>
      ${dascCard(data, r)}
    </div>
    <div class="cols">
      <section>
        <h3>系統別の使用割合<small>（使用日数。合計 ${r.spectrum.dot.toFixed(1)} 日。DOT にならった数え方）</small></h3>
        ${bars(data, r.usageByClass)}
        <p class="aware-line">Access 薬の割合 <b>${pct(access)}</b>　<small>WHO の目標は、国全体の抗菌薬の使用量のうち Access 薬を ${pct(target)} 以上にすること（手引き 医科・外来編 p.17）。1ステージの割合とは比べる対象が違います。日本は2023年に23.2%（同 歯科編 p.10）。</small></p>
      </section>
      <section>
        <h3>菌ごとの耐性率の変化</h3>
        ${resistanceTable(data, scenario.region, start, r.resistanceEnd, drugs, fromLabel)}
      </section>
    </div>
    <p class="foot strong">耐性化の速さは、ゲーム用に大きく誇張しています（${escapeHtml(modelLabel(r.model))}）。</p>
    <div class="buttons">
      ${phase === "present" ? `<button class="primary" data-action="future">${escapeHtml(scenario.future.title)}へ</button><button data-action="restart">ステージ1をやり直す</button>` : `<button class="primary" data-action="final">まとめへ</button>`}
    </div>
  </div>`;
}

export function finalScreen(data: GameData, scenario: ScenarioDef, present: StageResult, future: StageResult): string {
  const row = (label: string, f: (r: StageResult) => string) => `<tr><th>${label}</th><td>${f(present)}</td><td>${f(future)}</td></tr>`;
  const drugs = [...new Set([...scenario.present.hand, ...scenario.future.hand].map((h) => h.drug))];
  return `
  <div class="screen final-screen">
    <p class="big-tagline">あなたの選択が、未来の敵をつくる</p>
    <table class="summary">
      <thead><tr><th></th><th>ステージ1「${escapeHtml(scenario.present.title)}」</th><th>ステージ2「${escapeHtml(scenario.future.title)}」</th></tr></thead>
      <tbody>
        ${row("結果", outcomeLine)}
        ${row("膀胱の残り", (r) => `${Math.ceil(r.bladderHp)} / ${r.bladderMaxHp}`)}
        ${row("医療費の合計", (r) => yen(r.costSpent))}
        ${row("いちばん使った系統", (r) => topClass(data, r))}
        ${row("Access 薬の割合", (r) => pct(r.usageByAware.Access))}
        ${row("使用日数（DOT にならう）", (r) => `${r.spectrum.dot.toFixed(1)} 日`)}
        ${row("スペクトラムの広さ（DASC/DOT）", (r) => dascValue(data, r))}
        ${row("手札のどの薬も効かない菌", (r) => pct(r.panResistantFraction))}
        <tr><th>大きく上がった耐性率<br><small>（ステージ1の開始 → ステージ2の終わり）</small></th><td colspan="2">${risesLine(data, present.resistanceStart, future.resistanceEnd, drugs)}</td></tr>
      </tbody>
    </table>
    ${scenario.debrief ? `<section class="debrief"><h3>振り返り</h3><p>${escapeHtml(scenario.debrief)}</p></section>` : ""}
    ${notice(data)}
    <div class="buttons"><button class="primary" data-action="restart">最初からやり直す</button><button data-action="sources">出典と注意</button><button data-action="title">タイトルへ</button></div>
  </div>`;
}

export function sourcesScreen(data: GameData): string {
  const r = data.rules.resistance;
  return `
  <div class="screen sources-screen">
    <h2>出典と注意</h2>
    ${notice(data)}
    <div class="src-cols">
      <section>
        <h3>データの出典</h3>
        <dl>
          <dt>感受性率・尿から分離される菌の割合</dt>
          <dd>厚生労働省 院内感染対策サーベイランス（JANIS）検査部門 公開情報 2025年1月〜12月 年報（全集計対象医療機関）【入院検体・CLSI 2012 版】表7・表3。政府統計の総合窓口（e-Stat）掲載のファイルを加工して作成（政府標準利用規約 第2.0版）。府県別は同じ年報の地域ブロック別ファイル。</dd>
          <dt>薬価</dt>
          <dd>厚生労働省「薬価基準収載品目リスト及び後発医薬品に関する情報について（令和8年11月1日適用）」を加工して作成（公共データ利用規約 第1.0版）。</dd>
          <dt>投与間隔・AWaRe 分類・吸収率・耐性の連動（ESBL・CRE）</dt>
          <dd>厚生労働省「抗微生物薬適正使用の手引き 第四版」（医科・入院編、医科・外来編、歯科編、薬剤耐性菌感染症の抗菌薬適正使用編）。AMK の用法（1日量を含む）は JAID/JSC 感染症治療ガイド2023。セフジニルの用法は電子添文、LVFX の吸収率はインタビューフォーム（この2つは PMDA 掲載）。</dd>
          <dt>使用日数・スペクトラムの広さ（DASC/DOT）・アンチバイオグラムの使い方</dt>
          <dd>8学会合同抗微生物薬適正使用推進検討委員会「抗微生物薬適正使用支援プログラム実践のためのガイダンス 2024年度改訂版」（日本化学療法学会雑誌 73巻2号）。使用日数と DASC は表4（p.119）の考え方にならい、ASC スコアは表5（p.120。Kakiuchi ら, Clin Infect Dis 2022 の値）。表にない CMZ・AMK・LVFX・CFDN の ASC は未設定です。アンチバイオグラムを初期治療の薬選びに使うことは p.130。</dd>
          <dt>2050年の注記</dt>
          <dd>Review on Antimicrobial Resistance（委員長 Jim O'Neill）「Antimicrobial Resistance: Tackling a crisis for the health and wealth of nations」2014年12月：2050年の推計と、その前提（RAND Europe：15年で耐性率が100%になる、KPMG：耐性率が今より40%上がる（相対か絶対かは本文に書かれていない）。どちらも確かな予測ではない大まかな見積もり。p.6・p.8）。GBD 2021 Antimicrobial Resistance Collaborators. Lancet 2024; 404: 1199–226：2050年の予測（細菌の薬剤耐性が直接の原因の死亡 191万人、関連した死亡 822万人）。この2つは2050年の注記にだけ使っています。</dd>
          <dt>2050年までの耐性化の速さ</dt>
          <dd>厚生労働省「薬剤耐性ワンヘルス動向調査年次報告書 2024」（令和7年3月14日）の JANIS の耐性率の推移（2014〜2023年）で、このゲームに出てくる菌と薬の組み合わせ（CTRX は CTX の値で見た）の中でいちばん速く上がった組（肺炎桿菌の CFPM：3.5% → 9.7%、表2）の上がり方を、1年あたりの上限にしています（表の値は「耐性（R）」の割合で、使ったのは上がる速さだけです）。ステージ1の中の変化はゲーム用に誇張しています。2050年までは、上がった組の多くがこの上限の速さで延びるので、多くの組では実測より速く上がります。</dd>
          <dt>自然耐性・値のない組み合わせの扱い</dt>
          <dd>EUCAST「Expected Resistant Phenotypes」v1.2、「Expert Rules v3.2 on Enterococcus spp.」、「Breakpoint tables」v16.1。</dd>
        </dl>
      </section>
      <section>
        <h3>加工していること</h3>
        <ul>
          <li>「効く」確率は、JANIS の感性（S）の割合だけを使います（中間・耐性・判定不能は効かない扱い）。判定基準は CLSI 2012 で、いまの臨床検査の基準とは違います。</li>
          <li>府県と比べられるよう、「すべての検査材料」の表を使っています（尿から出た株だけの集計ではありません）。</li>
          <li>腸内細菌目で CTRX が効かない菌は ESBL 産生菌とみなし（単純化）、ABPC・CEZ・経口第3世代セフェム・CFPM も効かないことにしています。CTRX が効かないだけでは、CMZ・MEPM には連動させません。</li>
          <li>腸内細菌目で MEPM が効かない菌は CRE とみなし（単純化）、このゲームのほかの β-ラクタム系の薬（CTRX・CMZ・TAZ/PIPC、ESBL の連動を通して ABPC・CEZ・経口第3世代セフェム・CFPM）も効かないことにしています。LVFX・AMK と、緑膿菌には連動させません。</li>
          <li>経口第3世代セフェム（セフジニル）は CTX の値で代用し、CTRX より効く値にならないようにしています。腸球菌の TAZ/PIPC は ABPC の値で代用し、腸球菌の MEPM は効かない扱いです。</li>
          <li>カードには用量を出していません。投与間隔を「召喚の待ち時間」にしています。医療費は1日量の薬価を5段階にしたものです。</li>
          <li>使用日数は、1回の召喚で投与間隔の長さを数え、レーンごとに足しています（DOT にならった数え方で、在院日数で補正していません）。DASC/DOT は推奨度・エビデンスレベルの低い指標（C-III）で、もとの ASC スコアは米国の状況で作られたものです（ガイダンス p.118〜121）。</li>
          <li>アンチバイオグラムは JANIS の地域の集計で、施設ごとの表ではありません。色の区切りはゲーム用の目安です。</li>
        </ul>
        <h3>誇張していること</h3>
        <ul>
          <li>耐性化の速さ：現実に年単位で起きる変化を、数分のステージに縮めています（${escapeHtml(modelLabel(r.model))}。式と係数は data/rules.json）。</li>
          <li>ステージ2は、ステージ1と同じ使い方が2050年まで続いたとみなして、耐性率を先へ延ばしています。1年あたりの上がり方は、国の報告書で2014〜2023年に実際に観測された上がり方のうち、このゲームの菌と薬でいちばん速かったもの（オッズが約5.6年で2倍）を超えないようにしています。多くの組ではこの上限の速さで延びるので、実測より速く上がります。ゲームの耐性率は、2050年の予測ではありません。</li>
          <li>同じ系統ばかり使うと、その系統の耐性が早く進みます（使い方が偏るほど選択圧が強まる、という考え方。式と強さはゲームの決めごと）。</li>
          <li>菌の体力・速さ・膀胱へのダメージ、薬の強さはゲーム用の値です。</li>
        </ul>
      </section>
    </div>
    <p class="muted">薬の名前は略号と一般名だけを使っています（${escapeHtml(drugNames(data))}）。細菌の絵はすべてコードで描いています。フォントは端末に入っているものを使います。</p>
    <div class="buttons"><button class="primary" data-action="back">戻る</button></div>
  </div>`;
}

/** 薬の一般名の一覧（出典画面の補足用） */
export function drugNames(data: GameData): string {
  return data.drugs.map((d) => `${d.abbr}＝${genericName(d)}`).join("、");
}
