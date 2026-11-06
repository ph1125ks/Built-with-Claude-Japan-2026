// ゲームのドット絵（大腸菌）から public/favicon.png（52×52、透明の地）を作る（2026-11-07）。外の画像は使わない。
//   npx tsx scripts/make-favicon.ts [書き出し先]
// index.html・intro.html・replay.html の <link rel="icon"> が読む。細菌の絵を変えたら作り直す。
import { writeFileSync } from "node:fs";
import type { Sprite } from "../src/game/pixel/engine.js";
import { bugFrame } from "../src/game/pixel/index.ts";
import { data, spritePng } from "./lib/pixel-art.ts";

const def = [...data.bacteriumById.values()].find((b) => b.name.includes("大腸菌")) ?? [...data.bacteriumById.values()][0]!;
const bug = bugFrame(def, 0, false);

// 正方形の透明な地の中央に置き、64px に収まる整数倍に拡大する（ぼかさない）
const side = Math.max(bug.w, bug.h) + 2;
const px: Sprite["px"] = new Array(side * side).fill(null);
const ox = Math.floor((side - bug.w) / 2);
const oy = Math.floor((side - bug.h) / 2);
for (let y = 0; y < bug.h; y++) for (let x = 0; x < bug.w; x++) px[(y + oy) * side + x + ox] = bug.px[y * bug.w + x] ?? null;
const z = Math.max(1, Math.floor(64 / side));
const out = process.argv[2] ?? "public/favicon.png";
writeFileSync(out, spritePng({ w: side, h: side, px }, z));
console.log(`${def.name}（${bug.w}×${bug.h}）→ ${out}（${side * z}×${side * z}）`);
