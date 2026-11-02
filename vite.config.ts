import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub Pages ではリポジトリ名の下に置かれるので、相対パスで出力する
  base: "./",
  // Phaser 本体だけで約 1.2MB あるので、警告の目安を上げる
  build: { chunkSizeWarningLimit: 1600 },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
