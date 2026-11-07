// 教員モードの手元のサーバー（SPEC.md 5・5.6）。作者の手元（localhost）だけで動かし、公開サイトには置かない。
//   npm run teacher（このサーバー、ポート 8787）と npm run dev（画面）を動かし、http://localhost:5173/teacher.html を開く
// API キーは作者が .env に ANTHROPIC_API_KEY=... と書く（.env は .gitignore に入っている）。キーはこのサーバーの中だけで使い、画面には送らない
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { designStage, MODEL, type DesignEvent } from "./agent.ts";
import { data, loadDraft, regionData, simulate } from "./tools.ts";

/**
 * API キーの読み込み先（先に見つかったものを使う。どれもリポジトリには入らない）：
 *   1. 環境変数 TEACHER_ENV_FILE で指定したファイル
 *   2. リポジトリ直下の .env（.gitignore に入っている）
 *   3. 作者の作業用フォルダ（Cowork）の .env（2026-11-04 作者の希望：キーは GitHub と関係のない作業用フォルダで管理する）
 */
const ENV_FILES = [process.env.TEACHER_ENV_FILE, ".env", join(homedir(), "Claude", "Cowork", "Built with Claude Japan 2026", ".env")].filter((f): f is string => Boolean(f));
const envFile = ENV_FILES.find((f) => existsSync(f));
if (envFile) process.loadEnvFile(envFile);

const PORT = Number(process.env.TEACHER_PORT ?? 8787);
const HOST = "127.0.0.1";
/** 学生用の公開サイト（承認したステージの URL を作る） */
const PUBLIC_BASE = process.env.PUBLIC_BASE ?? "https://ph1125ks.github.io/Built-with-Claude-Japan-2026/";
const LOCAL_BASE = process.env.LOCAL_BASE ?? "http://localhost:5173/";
const AUDIENCES = ["病院実務実習の薬学生", "院内の新人研修", "講義（大学・専門学校）"];

let busy = false;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 200_000) throw new Error("入力が大きすぎます");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // 手元のブラウザ以外からの要求は受けない（2026-11-07 安全点検）：
  //   Host が loopback でない → DNS リバインディング、Origin が手元でない／POST が JSON でない → 他サイトのページからの fetch。
  //   開発サーバー（vite.config.ts の proxy）を通る要求は Host が localhost:5173 で届くので、ポートは見ない
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) return json(res, 403, { error: "手元（localhost）からだけ使えます" });
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) return json(res, 403, { error: "手元（localhost）からだけ使えます" });
  if (req.method === "POST" && !String(req.headers["content-type"] ?? "").startsWith("application/json")) return json(res, 415, { error: "JSON だけ受け付けます" });
  const url = new URL(req.url ?? "/", `http://${HOST}`);

  if (req.method === "GET" && url.pathname === "/api/meta") {
    return json(res, 200, {
      regions: data.janis.regions,
      audiences: AUDIENCES,
      model: MODEL,
      hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
      drugs: data.drugs.map((d) => ({ id: d.id, abbr: d.abbr, cls: d.class, color: data.classById.get(d.class)?.color })),
      bacteria: data.bacteria.map((b) => ({ id: b.id, name: b.name, gram: b.gram })),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/region") {
    return json(res, 200, regionData(url.searchParams.get("name") ?? "全国"));
  }

  // 下書きのステージ（プレビュー。ゲームは stages/draft-xxx.json を読む。vite.config.ts がここへつなぐ）
  const dm = url.pathname.match(/^\/api\/drafts\/(draft-[a-z0-9-]+)\.json$/);
  if (req.method === "GET" && dm) {
    const d = loadDraft(dm[1]!);
    if (!d) return json(res, 404, { error: "下書きが見つかりません" });
    return json(res, 200, { ...d.scenario, id: d.id });
  }
  const im = url.pathname.match(/^\/api\/draft-info\/(draft-[a-z0-9-]+)$/);
  if (req.method === "GET" && im) {
    const d = loadDraft(im[1]!);
    return d ? json(res, 200, d) : json(res, 404, { error: "下書きが見つかりません" });
  }

  // 承認：もう一度検査とシミュレーションをしてから、public/stages/<id>.json に書き出す（コミットして push すると学生用の URL で遊べる）
  if (req.method === "POST" && url.pathname === "/api/approve") {
    const body = (await readBody(req)) as { id?: string };
    const d = loadDraft(str(body.id, 80));
    if (!d) return json(res, 404, { error: "下書きが見つかりません" });
    const r = simulate(d.scenario, d.focus, 100, 2001);
    if ("errors" in r) return json(res, 400, { error: "規則の検査に通りません", errors: r.errors });
    if (!r.evaluation!.passed) return json(res, 400, { error: "確かめ直しで合格の目安を満たしませんでした", evaluation: r.evaluation });
    const id = d.scenario.id;
    // 書き出し先は public/stages/ の中だけ（submit_stage の検査と同じ形をもう一度確かめる。手で直した下書きへの備え）
    if (!/^[a-z0-9-]+$/.test(id)) return json(res, 400, { error: "ステージの名前が正しくありません（英小文字・数字・ハイフンだけ）" });
    mkdirSync(join("public", "stages"), { recursive: true });
    const out = {
      _comment: `教員モードで作ったステージ（${new Date(d.createdAt).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })}、${d.model}）。地域：${d.input.region}／対象：${d.input.audience}／教えたいこと：${d.input.goal}。承認時の確かめ（各ボット100回、種2001〜）：${r.evaluation!.checks.map((c) => `${c.label} ${c.value}`).join("、")}`,
      ...d.scenario,
    };
    const file = join("public", "stages", `${id}.json`);
    writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
    return json(res, 200, { id, file, localUrl: `${LOCAL_BASE}?stage=${id}`, publicUrl: `${PUBLIC_BASE}?stage=${id}`, evaluation: r.evaluation });
  }

  // 設計：Claude の作業の流れを、そのまま画面に送る（Server-Sent Events）
  if (req.method === "POST" && url.pathname === "/api/design") {
    const body = (await readBody(req)) as { region?: string; audience?: string; goal?: string };
    const input = { region: str(body.region, 20), audience: str(body.audience, 40), goal: str(body.goal, 400) };
    if (!data.janis.regions.includes(input.region)) return json(res, 400, { error: "地域を選んでください" });
    if (!input.goal) return json(res, 400, { error: "教えたいことを書いてください" });
    if (busy) return json(res, 409, { error: "いま別のステージを作っています。終わってから試してください" });
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN)
      return json(res, 400, { error: "API キーがありません。.env に ANTHROPIC_API_KEY=… を書いて、npm run teacher を動かし直してください" });
    busy = true;
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
    // 画面が閉じられたら止める（req の close は本文を読み終えたときにも出るので、応答の close で見る）
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    const send = (e: DesignEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    try {
      await designStage(input, send, abort.signal);
    } catch (e) {
      send({ type: "error", message: (e as Error).message });
    } finally {
      busy = false;
      res.end();
    }
    return;
  }

  json(res, 404, { error: "not found" });
}

createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!res.headersSent) json(res, 500, { error: (e as Error).message });
    else res.end();
  });
}).listen(PORT, HOST, () => {
  console.log(`教員モードのサーバー：http://${HOST}:${PORT}（画面は npm run dev のあと ${LOCAL_BASE}teacher.html）`);
  console.log(envFile ? `API キーの読み込み先：${envFile === ".env" ? "リポジトリ直下の .env" : "リポジトリの外の .env"}` : "API キーのファイルは見つかりませんでした");
  if (!process.env.ANTHROPIC_API_KEY) console.log("注意：ANTHROPIC_API_KEY がありません。.env に書くか、ant auth login で認証してください");
});
