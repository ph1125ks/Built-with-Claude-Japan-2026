// data/raw/ の公開データ（Excel）から、ゲームが読む JSON を data/generated/ に書き出す。
// 使い方：npm run data:fetch（初回だけ）→ npm run data:build → npm run data:verify
import { mkdir, writeFile } from "node:fs/promises";
import { extractJanis, extractPrices, JANIS_OUT, OUT_DIR, PRICES_OUT, toJson, type Counts } from "./extract.ts";

const janis = await extractJanis();
const prices = await extractPrices();

await mkdir(OUT_DIR, { recursive: true });
await writeFile(JANIS_OUT, toJson(janis));
await writeFile(PRICES_OUT, toJson(prices));

// 確認用の要約
console.log(`地域：${janis.regions.join("、")}`);
for (const region of ["全国", "京都府", "大阪府"]) {
  const ec = janis.susceptibility[region]?.ecoli;
  if (!ec) continue;
  const pct = (c: Counts | undefined) => (c && c.total ? ((100 * (c.S ?? 0)) / c.total).toFixed(1) : "—");
  console.log(`${region} 大腸菌 S%：CTRX ${pct(ec.CTRX)}、CMZ ${pct(ec.CMZ)}、LVFX ${pct(ec.LVFX)}、MEPM ${pct(ec.MEPM)}`);
}
for (const [id, p] of Object.entries(prices.drugs)) {
  console.log(`${id}：1日 ${p.yenPerDayMin} 円（最小）／${p.yenPerDayBrand ?? "—"} 円（先発品）`);
}
