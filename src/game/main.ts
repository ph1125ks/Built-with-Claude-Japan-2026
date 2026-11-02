// 学生用の画面の入り口。盤面は Phaser、文字とボタンは DOM で描く。
// 基準の大きさは 1280×720（16:9）。画面に合わせて全体を拡大・縮小し、盤面は高い解像度で描く（1080p の録画でもぼやけない）。
import Phaser from "phaser";
import { App, loadScenario, readParams } from "./app.ts";
import { BoardScene, H, W } from "./board.ts";
import "./style.css";

const appEl = document.getElementById("app")!;
const boardEl = document.getElementById("board")!;
const screenEl = document.getElementById("screen")!;
const playEl = document.getElementById("play")!;

function fitScale(): number {
  return Math.min(window.innerWidth / W, window.innerHeight / H);
}

function layout(): void {
  const s = fitScale();
  appEl.style.transform = `translate(-50%, -50%) scale(${s})`;
}
window.addEventListener("resize", layout);
layout();

// 盤面の解像度：表示の大きさ × 画素密度（1〜2 倍）。起動時に一度だけ決める。?r=1.5 で指定もできる（1080p の録画用）
const forced = Number(new URLSearchParams(window.location.search).get("r"));
const R = forced >= 1 && forced <= 3 ? forced : Math.min(2, Math.max(1, Math.round(fitScale() * window.devicePixelRatio * 4) / 4));

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: boardEl,
  width: W * R,
  height: H * R,
  backgroundColor: "#f5edf1",
  scale: { mode: Phaser.Scale.NONE, zoom: 1 / R },
  banner: false,
  audio: { noAudio: true },
  input: { mouse: false, touch: false, keyboard: false, gamepad: false },
});

const boardReady = new Promise<BoardScene>((resolve) => {
  game.events.once("board-ready", resolve);
  game.scene.add("board", BoardScene, true, { R });
});

async function main(): Promise<void> {
  const params = readParams(window.location.search);
  try {
    const [board, scenario] = await Promise.all([boardReady, loadScenario(params.stage)]);
    const app = new App(scenario, params, board, { screen: screenEl, play: playEl });
    (window as unknown as { sentakuatsu: App }).sentakuatsu = app;
  } catch (e) {
    screenEl.classList.add("open");
    screenEl.innerHTML = `<div class="screen"><h2>読み込めませんでした</h2><pre>${String((e as Error).message ?? e)}</pre></div>`;
    console.error(e);
  }
}
void main();
