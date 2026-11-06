// 学生用の画面の入り口。盤面は Phaser、文字とボタンは DOM で描く。
// 基準の大きさは 1280×720（16:9）。画面に合わせて全体を拡大・縮小し、盤面は高い解像度で描く（1080p の録画でもぼやけない）。
import "@fontsource/dotgothic16/400.css";
import Phaser from "phaser";
import { loadGameData } from "../engine/index.ts";
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

/**
 * 盤面（canvas）に描く文字のドット絵フォントを、先に読み込んでおく。
 * フォントは文字の範囲ごとに分かれているので、盤面で使う文字（菌の名前・薬の略号・札の文）をまとめて渡す。
 * 読めなくても（オフラインなど）、端末のフォントで描いて遊べる
 */
async function loadBoardFont(): Promise<void> {
  try {
    const data = loadGameData();
    const words = [
      ...data.bacteria.map((b) => b.name),
      ...data.drugs.map((d) => d.abbr),
      "膀胱レーン予約耐性自然効かない扱い手札すべて効くほか内服体に届くのは吸収率守り切った！の波をしのいだが破られた最後",
      "0123456789/%（）：・−+ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      // DOM の見出しやボタン（最初の画面で端末のフォントに一瞬切り替わらないように）
      "センタクアツ仮あなたの選択が、未来の敵をつくるはじめる遊び方出典と注意耐性の進み方薬ごと系統ごとステージ結果開始一時停止再開アンチバイオグラム医療費使える額日ごとに近中ほど遠菌名が分かるグラム染色像だけ",
      // タイトルの名前の由来と、遊び方の絵の3枚の見出し（2026-11-05）
      "選択圧（せんたくあつ）からての人へ細菌を抗菌薬で倒す効く違う使うほど効かない残る次前／膀胱手札",
      // 「？」のパネルと、正体が分かった細菌の札「効く：」（2026-11-06）
      "？遊び方の要点操作近づくほど分かるカードの見かた細菌が残る効く：補助",
    ].join("");
    await Promise.race([document.fonts.load('16px "DotGothic16"', words), new Promise((r) => setTimeout(r, 2500))]);
  } catch {
    // 読めなくても進める
  }
}

// 盤面の解像度：表示の大きさ × 画素密度（1〜2 倍）。起動時に一度だけ決める。?r=1.5 で指定もできる（1080p の録画用）
const forced = Number(new URLSearchParams(window.location.search).get("r"));
const R = forced >= 1 && forced <= 3 ? forced : Math.min(2, Math.max(1, Math.round(fitScale() * window.devicePixelRatio * 4) / 4));

async function main(): Promise<void> {
  await loadBoardFont();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: boardEl,
    width: W * R,
    height: H * R,
    backgroundColor: "#0b0812",
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / R },
    banner: false,
    audio: { noAudio: true },
    input: { mouse: false, touch: false, keyboard: false, gamepad: false },
  });
  const boardReady = new Promise<BoardScene>((resolve) => {
    game.events.once("board-ready", resolve);
    game.scene.add("board", BoardScene, true, { R });
  });
  const params = readParams(window.location.search);
  try {
    const [board, scenario] = await Promise.all([boardReady, loadScenario(params.stage)]);
    const app = new App(scenario, params, board, { screen: screenEl, play: playEl });
    (window as unknown as { sentakuatsu: App }).sentakuatsu = app;
    document.body.classList.add("ready");
  } catch (e) {
    screenEl.classList.add("open");
    screenEl.innerHTML = `<div class="screen"><h2>読み込めませんでした</h2><pre>${String((e as Error).message ?? e)}</pre></div>`;
    console.error(e);
  }
}
void main();
