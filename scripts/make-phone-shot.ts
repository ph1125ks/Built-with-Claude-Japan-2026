// スマホの縦画面のタイトル画面を写す（シーン10 の絵に使う。2026-11-08 作者の案：スマホでも遊べることが分かるように）。
// 開発サーバー（npm run dev）を動かしてから：
//   npx tsx scripts/make-phone-shot.ts [--base http://localhost:5173] [--out recordings/phone]
//   → recordings/phone/title-portrait.png（390×844 を 2倍の解像度で。Git に入れない）
// 画面なしの Chrome を iPhone ほどの大きさにして、実際のタイトル画面（狭い画面では文字の画面が1列に組み直される）を撮る。合成の絵ではない
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { openChrome, sleep } from "./lib/chrome.ts";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:5173" },
    out: { type: "string", default: join("recordings", "phone") },
  },
});
const W = 390;
const H = 844;
const { page, close } = await openChrome({ width: W, height: H });
try {
  await page.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await page.send("Page.navigate", { url: `${values.base!.replace(/\/$/, "")}/?seed=570` });
  await sleep(5000); // フォントとドット絵の読み込み、後ろのデモの始まりを待つ
  mkdirSync(values.out!, { recursive: true });
  const file = join(values.out!, "title-portrait.png");
  writeFileSync(file, await page.png());
  console.log(`→ ${file}`);
} finally {
  close();
}
