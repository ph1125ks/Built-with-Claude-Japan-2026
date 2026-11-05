// 「はじめての人へ」のページ（公開サイトの intro.html）。医療を知らない人のために、ゲームの前提（前提の鎖：docs/PLAIN-LANGUAGE.md）を
// 1段ずつ、ゲームのドット絵で説明する。?present=1 は動画用の見せ方（1920×1080 で 1〜5 を自動で順に見せる。present.ts）。
import "@fontsource/dotgothic16/400.css";
import { loadGameData } from "../engine/index.ts";
import { floorUrl } from "./art.ts";
import { renderPage } from "./page.ts";
import { renderPresent } from "./present.ts";
import "./style.css";

const root = document.getElementById("intro")!;
const data = loadGameData();
// レーンの床の模様（ゲームの盤面と同じ絵）
document.documentElement.style.setProperty("--floor", `url(${floorUrl()})`);

if (new URLSearchParams(location.search).get("present") === "1") renderPresent(root, data);
else renderPage(root, data);
