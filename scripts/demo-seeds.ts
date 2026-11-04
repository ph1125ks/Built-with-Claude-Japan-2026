// 録画用の乱数の種を探す（docs/DEMO.md のシーン3〜5）。データやルールを変えたら、探し直して DEMO.md の種を更新する。
//   npx tsx scripts/demo-seeds.ts [--scenario data/stages/uti-zenkoku.json] [--from 1] [--to 300]
// 乱用：ステージ1で勝ち、2050年で負ける（手札のどれも効かない菌が多いほどよい）
// 適正：ステージ1も2050年も勝ち、ステージ1で CTRX・CMZ・ABPC・内服 CFDN をすべて使う（台本の流れ）
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { demoAbuseBot, demoProperBot, loadGameData, runScenario, type ScenarioDef } from "../src/engine/index.ts";

const { values } = parseArgs({
  options: {
    scenario: { type: "string", default: "data/stages/uti-zenkoku.json" },
    from: { type: "string", default: "1" },
    to: { type: "string", default: "300" },
    model: { type: "string", default: "A" },
  },
});

const base = loadGameData();
const data = loadGameData({ rules: { resistance: { ...base.rules.resistance, model: values.model as "A" | "B" } } });
const scenario = JSON.parse(readFileSync(values.scenario!, "utf8")) as ScenarioDef;
const from = Number(values.from);
const to = Number(values.to);
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

const abuse: { score: number; line: string }[] = [];
const proper: { score: number; line: string }[] = [];
for (let seed = from; seed <= to; seed++) {
  const a = runScenario({ data, scenario, seed, bot: demoAbuseBot() });
  // 2050年にも MEPM が手札にあること（カルバペネム系を連打して負ける場面のため）
  if (a.present.outcome === "won" && a.future.outcome === "lost" && !a.shortage.future.includes("MEPM")) {
    abuse.push({
      // ステージ1は楽勝（膀胱が多く残る）、2050年は手札のどれも効かない菌が多いほど上に
      score: a.present.bladderHp / a.present.bladderMaxHp + a.future.panResistantFraction,
      line: `${seed}\tいま 膀胱${pct(a.present.bladderHp / a.present.bladderMaxHp)}・MEPM ${a.present.summons.MEPM ?? 0}回\t2050年 全耐性 ${pct(a.future.panResistantFraction)}・${a.future.seconds.toFixed(0)}秒で負け\t供給制限 ${a.shortage.present.join(",")} / ${a.shortage.future.join(",")}`,
    });
  }
  const p = runScenario({ data, scenario, seed, bot: demoProperBot() });
  const s = p.present.summons;
  const beats = ["CTRX", "CMZ", "ABPC", "CFDN_PO"].every((d) => (s[d] ?? 0) > 0);
  if (p.present.outcome === "won" && p.future.outcome === "won" && beats) {
    proper.push({
      // カルバペネム系を使わず、2050年も膀胱が多く残るほど上に
      score: p.future.bladderHp / p.future.bladderMaxHp - ((s.MEPM ?? 0) + (s.IPMCS ?? 0)) * 0.05,
      line: `${seed}\tいま 膀胱${pct(p.present.bladderHp / p.present.bladderMaxHp)}・${Object.entries(s).map(([d, n]) => `${d} ${n}`).join(" ")}\t2050年 膀胱${pct(p.future.bladderHp / p.future.bladderMaxHp)}・全耐性 ${pct(p.future.panResistantFraction)}\t供給制限 ${p.shortage.present.join(",")} / ${p.shortage.future.join(",")}`,
    });
  }
}
console.log(`シナリオ ${scenario.id}／モデル ${values.model}／種 ${from}〜${to}`);
console.log(`\n乱用（いま勝ち・2050年負け）：${abuse.length} 件`);
for (const l of abuse.sort((x, y) => y.score - x.score).slice(0, 10)) console.log(l.line);
console.log(`\n適正（両方勝ち・CTRX・CMZ・ABPC・CFDN を使う）：${proper.length} 件`);
for (const l of proper.sort((x, y) => y.score - x.score).slice(0, 10)) console.log(l.line);
