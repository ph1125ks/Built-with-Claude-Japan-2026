// 画面なしの Chrome を DevTools Protocol で動かす小さな部品（録画 record-demo.ts と、仮の動画 make-draft-video.ts で使う）
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Chrome の DevTools Protocol（1ページだけ） */
export class Page {
  private id = 0;
  private pending = new Map<number, (v: { result?: unknown; error?: unknown }) => void>();
  private handlers = new Map<string, (p: Record<string, unknown>) => void>();
  constructor(private ws: WebSocket) {
    ws.onmessage = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id && this.pending.has(d.id)) {
        this.pending.get(d.id)!(d);
        this.pending.delete(d.id);
      } else if (d.method) this.handlers.get(d.method)?.(d.params);
    };
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<{ result?: unknown; error?: unknown }> {
    return new Promise((r) => {
      const i = ++this.id;
      this.pending.set(i, r);
      this.ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  on(method: string, fn: (p: Record<string, unknown>) => void): void {
    this.handlers.set(method, fn);
  }
  /** ページで式を評価して値を返す */
  async eval<T>(expression: string): Promise<T> {
    const r = (await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })) as {
      result?: { result?: { value?: T }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
    };
    const ex = r.result?.exceptionDetails;
    if (ex) throw new Error(`ページの式でエラー：${ex.exception?.description ?? ex.text}`);
    return r.result?.result?.value as T;
  }
  /** いまの画面を PNG で返す（transparent なら背景を透明にする） */
  async png(transparent = false): Promise<Buffer> {
    if (transparent) await this.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    const r = (await this.send("Page.captureScreenshot", { format: "png" })) as { result?: { data?: string } };
    return Buffer.from(r.result?.data ?? "", "base64");
  }
}

export async function openChrome(opts: { width: number; height: number; chrome?: string }): Promise<{ page: Page; close: () => void }> {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), "sentakuatsu-chrome-"));
  const chrome = spawn(
    opts.chrome ?? CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--hide-scrollbars",
      `--window-size=${opts.width},${opts.height}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
  for (let i = 0; i < 60 && targets.length === 0; i++) {
    try {
      targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as typeof targets;
    } catch {
      await sleep(200);
    }
  }
  const t = targets.find((x) => x.type === "page");
  if (!t) throw new Error("Chrome に接続できませんでした");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  const page = new Page(ws);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width: opts.width, height: opts.height, deviceScaleFactor: 1, mobile: false });
  return {
    page,
    close: () => {
      ws.close();
      chrome.kill();
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
    },
  };
}
