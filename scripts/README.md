# scripts/ の一覧

どれも TypeScript で、`npx tsx scripts/<名前>.ts` で動く（`npm run …` があるものはそれを使う）。外部の画像・音源・サービスは使わず、絵も音もこのリポジトリのコードで作る。各ファイルの先頭のコメントに、使い方と引数がある。

## データ（`data/`）

| スクリプト | 何をするか | 動かし方 |
|---|---|---|
| `data/fetch-raw.ts` | 公開データの元ファイル（JANIS 年報・薬価基準の Excel）を `data/raw/` に取り直す（`data/raw/` は Git に入れない） | `npm run data:fetch` |
| `data/build-data.ts` | 元ファイルから、ゲームが読む JSON（`data/generated/`）を書き出す | `npm run data:build` |
| `data/verify-data.ts` | `data/generated/` が元ファイルの値と一致するか、菌×薬の扱い（データ・代用・自然耐性）、監修待ちの一覧を出す。サブエージェント `data-auditor` と人が使う。ファイルは書き換えない | `npm run data:verify` |
| `data/extract.ts`・`data/sources.ts` | 上の3つが共有する、Excel の読み方と取得元 | — |

手順の全体はスキル [`.claude/skills/janis-import/SKILL.md`](../.claude/skills/janis-import/SKILL.md)、出典と加工の内容は [`data/README.md`](../data/README.md)。

## シミュレーションと評価

| スクリプト | 何をするか | 動かし方 |
|---|---|---|
| `sim.ts` | ボット（適正・乱用・偏り・ランダム・何もしない）でステージを何度も動かし、勝率・系統の使い分け（AHI）・医療費などをまとめる。耐性モデル A/B と医療費の方式を比べるのに使った（結果は `docs/DEVLOG.md`） | `npm run sim -- --runs 200 --model A` |
| `eval-skill.ts` | スキル `stage-design` あり・なしで、教員モードの Claude に同じ入力から各 N 回ステージを作らせて比べる（API キーが要る）。結果は [`docs/eval/skill/`](../docs/eval/skill/README.md) | `npx tsx scripts/eval-skill.ts --runs 3` |
| `demo-seeds.ts` | 録画用の乱数の種を探す（乱用はステージ1で勝って2050年で負ける、適正は両方守り切る、など台本の条件に合う種） | `npx tsx scripts/demo-seeds.ts` |

## デモ動画（`recordings/` に書き出す。`recordings/` は Git に入れない）

| スクリプト | 何をするか |
|---|---|
| `record-demo.ts` | 画面なしの Chrome でゲームを自動で遊び、MP4 に録画する（`--take` は title・intro・abuse・proper・teacher・all）。画面が切り替わった時刻を同じ名前の JSON に残す |
| `make-draft-video.ts` | 台本（`docs/DEMO.md`）の時間配分どおりに、録画を切り出して字幕・声・BGM を重ね、3分の動画にする。作者の録音があればそれに字幕の時刻を合わせる（`lib/align.ts`）。英語の字幕（SRT）も出す |
| `make-hook-chart.ts` | 冒頭の図：薬剤耐性による死亡者数の推定（2014年の報告書の数値だけを使い、ゲームの画風で描き直す） |
| `make-scene2.ts` | シーン2の動く絵：細菌が何年もかけて耐性を獲得していく（ゲームのドット絵で） |
| `make-scene7.ts` | シーン7の絵：Git の記録・テスト・ファイル構成など、実際に動かした結果から作る |
| `make-bgm.ts` | BGM をコードで合成する（ファミコン風。サンプルや素材は読み込まない） |
| `make-recording-sheet.ts` | 作者がナレーションを録音するときに読む原稿（HTML 1枚） |
| `make-storyboard.ts` | 絵コンテ表（HTML 1枚）：シーンごとの時刻・コマ・字幕・ナレーション。直しを「シーン3」「0:52」のように伝えるため |
| `make-phone-shot.ts` | スマホの縦画面のタイトル画面を写す（シーン10） |
| `make-thumbnail.ts` | YouTube のサムネイルの案を描く |
| `make-favicon.ts` | ゲームのドット絵（大腸菌）から `public/favicon.png` を作る |
| `lib/chrome.ts`・`lib/pixel-art.ts`・`lib/align.ts`・`lib/video-cues.ts` | 上のスクリプトが共有する部品：画面なしの Chrome、ドット絵を PNG にする、録音と字幕の時刻合わせ、画面の切り替わりに合わせた間 |

動画の作り方の全体（台本の版ごとの変わり方、収録の手順）は [`docs/DEMO.md`](../docs/DEMO.md)。
