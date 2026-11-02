// 公開データの元ファイル（Excel）を data/raw/ に取り直す。
// 使い方：npm run data:fetch
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ALL_SOURCES, RAW_DIR } from "./sources.ts";

for (const src of ALL_SOURCES) {
  const dest = join(RAW_DIR, src.file);
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`取得に失敗：${src.url}（${res.status}）`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Excel（xlsx）は zip 形式なので、先頭が "PK" でなければエラーページを受け取っている
  if (buf.subarray(0, 2).toString() !== "PK") throw new Error(`Excel ではない応答：${src.url}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`${dest}  ${buf.length.toLocaleString()} bytes`);
}
