# .claude/ の中身（Claude Code の設定）

開発中の Claude Code が使う、スキル・サブエージェント・フックの定義。すべて期間中（2026-11-02〜04）に作った。README の「Claude の使い方」の表と対応する。考え方は、`CLAUDE.md` には守らせる約束だけ、スキルは作者だけが持つ知識と手順、サブエージェントはファイルを書き換えない点検役、フックは機械的に止める検査。

| 場所 | 中身 | 使いどころ |
|---|---|---|
| [`skills/stage-design/SKILL.md`](skills/stage-design/SKILL.md) | ステージ設計の知識：良いステージの条件、Claude に任せること・任せないこと、合格の目安、直し方の定石。**教員モードの Claude（`server/agent.ts`）にも同じ本文を渡す** | 開発中にステージを作る・直すとき。効果の比較は [`docs/eval/skill/`](../docs/eval/skill/README.md) |
| [`skills/janis-import/SKILL.md`](skills/janis-import/SKILL.md) | 公開データ（JANIS 年報・薬価基準）の取り込み直しの手順と変換ルール | 新しい年報や薬価改定が出たとき、地域や薬を増やすとき |
| [`agents/data-auditor.md`](agents/data-auditor.md) | 医学データの監査役（読み取り専用）。`data/` の数値を公開データの元の表と監修リストに照らして、食い違いを報告する | データを変えたあと、コミットや録画の前 |
| [`agents/balance-tester.md`](agents/balance-tester.md) | バランス検証役。ボットでシミュレーションを回し、耐性モデル A/B・医療費の方式・ステージの難しさを比べて、表を `docs/DEVLOG.md` に書く。ルールやコードは変えない | ステージやルールを変えたとき、作者が決めるための材料を作るとき |
| [`agents/playtester.md`](agents/playtester.md) | 試遊役。アプリ内ブラウザ（MCP のツール）でゲームを実際に操作し、表示の崩れや分かりにくい言い回しを報告する。コードは変えない | 画面を変えたあと、録画の前 |
| [`hooks/check-secrets.sh`](hooks/check-secrets.sh) | コミット前フック（PreToolUse: Bash）。`git commit` のとき、コミットされうるファイルから API キー・特典コード・個人情報の文字列を探し、見つかれば止める。秘密そのものは手元だけの `secret-patterns.local`（Git に入れない。見本は [`secret-patterns.example`](secret-patterns.example)） | 公開リポジトリなので、毎回のコミット |
| [`hooks/test-engine.sh`](hooks/test-engine.sh) | 編集後フック（PostToolUse: Edit・Write）。エンジン・テスト・ゲームのデータを編集したら単体テストを走らせ、失敗を Claude に返す | エンジンやデータの編集のたび |
| [`settings.json`](settings.json) | 上の2つのフックの登録 | — |
| [`launch.json`](launch.json) | アプリ内ブラウザで動かす開発サーバー（`game`・`pages-preview`・`teacher`）の定義 | 試遊と録画 |

個人の設定（`settings.local.json`）と秘密の文字列（`secret-patterns.local`）は `.gitignore` に入れていて、ここにはない。
