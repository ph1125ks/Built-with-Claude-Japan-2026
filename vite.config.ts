import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub Pages ではリポジトリ名の下に置かれるので、相対パスで出力する
  base: "./",
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
