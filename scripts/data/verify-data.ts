// データの照合。サブエージェント data-auditor と人が使う。ファイルは書き換えない。
// 使い方：npm run data:verify
//  1. data/generated/ が、元の Excel から取り直した値と一致するか
//  2. カタログに食い違いがないか（エンジンの読み込み時の検査）
//  3. すべての菌×薬の組み合わせの扱い（データ・自然耐性・代用・固定・値なし）
//  4. 監修待ち（review.status が「仮」）の項目の一覧
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadGameData, susceptibility } from "../../src/engine/index.ts";
import { extractJanis, extractPrices, JANIS_OUT, PRICES_OUT, toJson } from "./extract.ts";
import { ALL_SOURCES, RAW_DIR } from "./sources.ts";

// 元の Excel（data/raw/）は Git に入れていない。クローンしたばかりの環境では、まず取り直してもらう
const missing = ALL_SOURCES.filter((s) => !existsSync(join(RAW_DIR, s.file)));
if (missing.length > 0) {
  console.error(`公開データの元ファイル（${RAW_DIR}/）が見つかりません。元の Excel は Git に入れていないので、先に npm run data:fetch で取り直してください。`);
  for (const s of missing) console.error(`  - ${join(RAW_DIR, s.file)}（${s.title}）`);
  process.exit(2);
}

let problems = 0;
const ng = (msg: string) => {
  problems++;
  console.log(`  ✗ ${msg}`);
};
const ok = (msg: string) => console.log(`  ✓ ${msg}`);

console.log("1. 公開データとの一致");
for (const [label, path, fresh] of [
  ["JANIS", JANIS_OUT, toJson(await extractJanis())],
  ["薬価", PRICES_OUT, toJson(await extractPrices())],
] as const) {
  const current = await readFile(path, "utf8");
  if (current === fresh) ok(`${label}：${path} は元の Excel から取り直した値と一致`);
  else ng(`${label}：${path} が元の Excel と一致しない（npm run data:build で作り直す）`);
}

console.log("2. カタログの整合");
let data;
try {
  data = loadGameData();
  ok("カタログ・ルール・公開データの参照がすべてつながっている");
} catch (e) {
  ng(String(e));
  process.exit(1);
}

console.log("3. 菌×薬の扱い（全国）");
const byBasis: Record<string, string[]> = {};
for (const b of data.bacteria) {
  for (const d of data.drugs) {
    const v = susceptibility(data, "全国", b.id, d.id);
    const label = `${b.name}×${d.abbr}${v.basis === "data" || v.basis === "proxy" ? ` ${(v.p * 100).toFixed(1)}%（n=${v.n}）` : ""}${v.note ? `［${v.note}］` : ""}`;
    (byBasis[v.basis] ??= []).push(label);
  }
}
const basisName: Record<string, string> = { data: "データ", intrinsic: "自然耐性", proxy: "代用", fixed: "固定値", missing: "値なし" };
for (const [basis, items] of Object.entries(byBasis)) {
  console.log(`  ${basisName[basis] ?? basis}（${items.length}件）`);
  if (basis !== "data") for (const it of items) console.log(`    - ${it}`);
}
if (byBasis.missing?.length) ng(`値がない組み合わせが ${byBasis.missing.length} 件ある（rules.json の proxies で扱いを決める）`);

console.log("4. 監修待ち（仮）の項目");
const files = ["data/catalog/drugs.json", "data/catalog/bacteria.json", "data/rules.json"];
let pending = 0;
for (const f of files) {
  const json = JSON.parse(await readFile(f, "utf8"));
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const review = o.review as { status?: string; check?: string[] } | undefined;
    if (review?.status === "仮") {
      pending++;
      console.log(`  - ${f} ${o.id ?? path}：${(review.check ?? []).join("／")}`);
    }
    for (const [k, v] of Object.entries(o)) if (k !== "review") walk(v, path ? `${path}.${k}` : k);
  };
  walk(json, "");
}
console.log(`  計 ${pending} 件`);

console.log(problems === 0 ? "\n照合の問題はありません（監修待ちの項目は上の一覧）。" : `\n問題が ${problems} 件あります。`);
process.exit(problems === 0 ? 0 : 1);
