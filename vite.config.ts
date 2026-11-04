import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub Pages ではリポジトリ名の下に置かれるので、相対パスで出力する
  base: "./",
  // Phaser 本体だけで約 1.2MB あるので、警告の目安を上げる
  build: { chunkSizeWarningLimit: 1600 },
  // 教員モード（npm run teacher のサーバー）へつなぐ。開発サーバーのときだけ使う（公開サイトには教員用の画面もサーバーもない）
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      // 下書きのステージのプレビュー：ゲームが読む stages/draft-xxx.json を、サーバーの下書きにつなぐ
      "^/stages/draft-[a-z0-9-]+\\.json$": {
        target: "http://127.0.0.1:8787",
        rewrite: (p) => p.replace(/^\/stages\//, "/api/drafts/"),
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
