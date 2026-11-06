// デモ動画のプレイ画面を録画する（docs/DEMO.md のシーン0〜5）。画面なしの Chrome を DevTools Protocol で動かし、
// 画面の流れを ffmpeg で MP4（1920×1080、30fps）にする。画面が切り替わった時刻は、同じ名前の .json に残す（編集の目印）。
//   開発サーバーを動かしてから：npx tsx scripts/record-demo.ts --take abuse --base http://localhost:5173
//   --take：title（タイトルと遊び方）／intro（はじめての人への見せ方）／abuse（乱用：ステージ1で楽勝 → 2050年で負ける）／proper（適正：両方守り切る）／all
//           teacher（シーン6：教員モードで本物の Claude がステージを作る。npm run teacher と .env の API キーが要り、費用がかかるので all には入れない）
//   --seed：乱数の種（既定 570。scripts/demo-seeds.ts で選んだ。データを変えたら探し直す）
// 必要なもの：Google Chrome と ffmpeg（どちらも手元に入っているもの）。録画は Git に入れない（recordings/ は .gitignore）
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CHROME, openChrome as open, sleep, type Page } from "./lib/chrome.ts";

const { values } = parseArgs({
  options: {
    take: { type: "string", default: "all" },
    base: { type: "string", default: "http://localhost:5173" },
    seed: { type: "string", default: "570" },
    out: { type: "string", default: "recordings" },
    chrome: { type: "string", default: CHROME },
    width: { type: "string", default: "1920" },
    height: { type: "string", default: "1080" },
  },
});

const W = Number(values.width);
const H = Number(values.height);
const openChrome = () => open({ width: W, height: H, chrome: values.chrome });

/** 画面の流れ（screencast）を ffmpeg に流して MP4 にする。届いた時刻をそのまま使い、30fps にそろえる */
function startRecorder(page: Page, file: string): { stop: () => Promise<void> } {
  const ff: ChildProcessWithoutNullStreams = spawn("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-use_wallclock_as_timestamps",
    "1",
    "-f",
    "image2pipe",
    "-c:v",
    "mjpeg",
    "-i",
    "-",
    "-vf",
    `fps=30,scale=${W}:${H},format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    file,
  ]);
  ff.stderr.on("data", (d) => process.stderr.write(d));
  page.on("Page.screencastFrame", (p) => {
    ff.stdin.write(Buffer.from(String(p.data), "base64"));
    void page.send("Page.screencastFrameAck", { sessionId: p.sessionId });
  });
  void page.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  return {
    stop: async () => {
      await page.send("Page.stopScreencast");
      ff.stdin.end();
      await new Promise((r) => ff.on("close", r));
    },
  };
}

interface Marker {
  t: number;
  label: string;
}

/** 1本の録画（take）。手順の中で「いつ何をしたか」を記録する */
async function record(name: string, url: string, script: (s: Step) => Promise<void>, ready = "typeof window.sentakuatsu === 'object'"): Promise<void> {
  mkdirSync(values.out!, { recursive: true });
  const file = join(values.out!, `${name}.mp4`);
  const { page, close } = await openChrome();
  await page.send("Page.navigate", { url });
  for (let i = 0; i < 100; i++) {
    if (await page.eval<boolean>(ready)) break;
    await sleep(200);
  }
  await sleep(800);
  const markers: Marker[] = [];
  const t0 = Date.now();
  const rec = startRecorder(page, file);
  const mark = (label: string) => {
    markers.push({ t: Math.round((Date.now() - t0) / 100) / 10, label });
    console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}秒 ${label}`);
  };
  const step: Step = {
    page,
    mark,
    markAt: (label, epochMs) => {
      markers.push({ t: Math.round((epochMs - t0) / 100) / 10, label });
      console.log(`  ${((epochMs - t0) / 1000).toFixed(1)}秒 ${label}`);
    },
    press: async (action, label) => {
      await page.eval(`window.sentakuatsu.press(${JSON.stringify(action)})`);
      mark(label ?? action);
    },
    hold: async (ms) => {
      await sleep(ms);
    },
    until: async (phase, timeoutMs = 8 * 60_000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if ((await page.eval<string>("window.sentakuatsu.current")) === phase) {
          mark(`画面：${phase}`);
          return;
        }
        await sleep(200);
      }
      throw new Error(`${phase} の画面になりませんでした`);
    },
    scrollTo: async (selector) => {
      await page.eval(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ behavior: "smooth", block: "center" })`);
    },
  };
  console.log(`録画：${name}（${url}）`);
  try {
    await script(step);
  } finally {
    await rec.stop();
    close();
  }
  writeFileSync(join(values.out!, `${name}.json`), JSON.stringify({ url, seed: Number(values.seed), width: W, height: H, markers }, null, 2));
  console.log(`  → ${file}`);
}

interface Step {
  page: Page;
  mark: (label: string) => void;
  /** ページの中の時刻（Date.now の値）で目印を付ける */
  markAt: (label: string, epochMs: number) => void;
  press: (action: string, label?: string) => Promise<void>;
  hold: (ms: number) => Promise<void>;
  until: (phase: string, timeoutMs?: number) => Promise<void>;
  scrollTo: (selector: string) => Promise<void>;
}

const base = values.base!.replace(/\/$/, "");
const url = (auto?: string) => `${base}/?model=A&seed=${values.seed}&r=1.5${auto ? `&auto=${auto}` : ""}`;

/** ステージ1 → 結果 → 2050年 → 結果（乱用・適正で共通の流れ） */
async function playthrough(s: Step, withFinal: boolean): Promise<void> {
  await s.hold(2500);
  await s.press("start", "タイトル → 遊び方");
  await s.hold(1500);
  await s.press("start", "遊び方 → ブリーフィング（ステージ1）");
  await s.hold(6000);
  await s.press("play", "ステージ1を始める");
  await s.until("result1");
  // 結果画面は1画面に収まる（2026-11-06 に作り直した。耐性率の表は「くわしい数字」のポップアップ）ので、スクロールせずに映す
  await s.hold(10000);
  await s.press("future", "結果1 → ブリーフィング（2050年）");
  await s.hold(3000);
  await s.scrollTo("table.timeline");
  await s.hold(7000);
  await s.press("play", "2050年を始める");
  await s.until("result2");
  await s.hold(9000);
  if (withFinal) {
    await s.press("final", "結果2 → まとめ");
    await s.hold(8000);
  }
}

const takes: Record<string, () => Promise<void>> = {
  title: () =>
    record("title", url(), async (s) => {
      // タイトルの後ろで適正ボットが遊ぶデモを、シーン1（20秒）とシーン8（11秒）で別の場面から使えるよう長めに映す
      await s.hold(40000);
      await s.press("howto", "タイトル → 遊び方");
      // 遊び方は絵の3枚（1画面に1つ）。「次へ」でめくり、最後に「くわしく」を開いて兵士の姿の見本を映す（2026-11-05）
      await s.hold(6000);
      await s.press("howto-next", "遊び方 2枚目");
      await s.hold(7000);
      await s.press("howto-next", "遊び方 3枚目");
      await s.hold(7000);
      await s.press("howto-more", "遊び方：くわしくを開く");
      await s.hold(1500);
      await s.scrollTo(".soldier-legend");
      await s.hold(8000);
    }),
  // シーン6：教員モード（本物の Claude を動かす。npm run teacher のサーバーと .env の API キーが要る。1回ごとに API の費用がかかる）
  teacher: () =>
    record("teacher", `${base}/teacher.html`, async (s) => {
      const goal = "第3世代セフェムが効かない大腸菌に、カルバペネムを使わずに勝つ経験をさせたい";
      await s.hold(2500);
      await s.page.eval(`(() => { const r = document.querySelector('#region'); r.value = '大阪府'; r.dispatchEvent(new Event('change')); })()`);
      s.mark("地域：大阪府");
      await s.hold(3000);
      await s.page.eval(`document.querySelector('#audience').value = '病院実務実習の薬学生'`);
      for (const ch of goal) {
        await s.page.eval(`document.querySelector('#goal').value += ${JSON.stringify(ch)}`);
        await s.hold(70);
      }
      s.mark("教えたいこと");
      await s.hold(1500);
      await s.page.eval(`document.querySelector('#go').click()`);
      s.mark("ステージを作る");
      // できるまで待つ（最長20分）。止まったら（エラー・提出なし）そこで終える
      const t0 = Date.now();
      let state = "";
      while (Date.now() - t0 < 20 * 60_000) {
        await s.hold(1000);
        state = await s.page.eval<string>(`!document.querySelector('#result').hidden ? 'done' : document.querySelector('#go').disabled ? 'busy' : 'stopped'`);
        if (state !== "busy") break;
      }
      s.mark(`設計の終わり：${state}`);
      if (state !== "done") return;
      await s.page.eval(`document.querySelector('#result').scrollIntoView({ behavior: 'smooth', block: 'start' })`);
      await s.hold(6000);
      await s.page.eval(`document.querySelector('#approve').click()`);
      s.mark("承認");
      for (let i = 0; i < 60; i++) {
        await s.hold(500);
        if (await s.page.eval<boolean>(`!!document.querySelector('.t-qr img')`)) break;
      }
      await s.page.eval(`document.querySelector('#approved').scrollIntoView({ behavior: 'smooth', block: 'center' })`);
      s.mark("学生用の URL");
      await s.hold(6000);
      // できたステージを学生用の画面で遊ぶ（適正ボットで少し進める）
      const id = await s.page.eval<string>(`document.querySelector('#result h3 code')?.textContent ?? ''`);
      await s.page.send("Page.navigate", { url: `${base}/?stage=${id}&model=A&r=1.5&auto=appropriate` });
      await s.hold(2500);
      await s.press("start", "タイトル → 遊び方");
      await s.press("start", "遊び方 → ブリーフィング（できたステージ）");
      await s.hold(5000);
      await s.press("play", "できたステージを遊ぶ");
      await s.hold(25000);
    }),
  // シーン2（しくみ）：「はじめての人へ」の動画用の見せ方（intro.html?present=1。src/intro/present-plan.ts の時刻表で自動で進む）
  intro: () =>
    record(
      "intro",
      `${base}/intro.html?present=1`,
      async (s) => {
        for (let i = 0; i < 100 && !(await s.page.eval<boolean>("typeof window.__presentT0 === 'number'")); i++) await s.hold(100);
        s.markAt("見せ方の始まり", await s.page.eval<number>("window.__presentT0"));
        const steps = await s.page.eval<{ step: number; label: string; at: number }[]>("window.__presentTimeline ?? []");
        const p0 = await s.page.eval<number>("window.__presentT0");
        for (const st of steps) s.markAt(`段${st.step}：${st.label}`, p0 + st.at * 1000);
        for (let i = 0; i < 600 && !(await s.page.eval<boolean>("window.__presentDone === true")); i++) await s.hold(100);
        s.mark("見せ方の終わり");
        await s.hold(1500);
      },
      "document.readyState === 'complete'",
    ),
  abuse: () => record(`abuse-seed${values.seed}`, url("demo-abuse"), (s) => playthrough(s, false)),
  proper: () => record(`proper-seed${values.seed}`, url("demo-proper"), (s) => playthrough(s, true)),
};

const names = values.take === "all" ? Object.keys(takes).filter((n) => n !== "teacher") : values.take!.split(",");
for (const n of names) {
  const fn = takes[n];
  if (!fn) throw new Error(`take ${n} はない（${Object.keys(takes).join(", ")}）`);
  await fn();
}
