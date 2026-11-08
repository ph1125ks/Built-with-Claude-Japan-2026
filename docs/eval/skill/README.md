# スキル `stage-design` あり・なしの比較（2026-11-05）

教員モードの Claude（`server/agent.ts`、`claude-opus-5-5`）に渡す指示に、スキル [`.claude/skills/stage-design/SKILL.md`](../../../.claude/skills/stage-design/SKILL.md) の本文を入れる・入れないの2条件で、同じ入力から各3回ステージを作らせ、結果を比べた。変えたのはスキルの有無だけ。過去のハッカソンの受賞作にならい、「変えた条件は1つだけ、件数を書く」形にした。

- 入力（本番と同じ）：大阪府・病院実務実習の薬学生・「第3世代セフェムが効かない大腸菌に、カルバペネムを使わずに勝つ経験をさせたい」
- 動かし方：`npx tsx scripts/eval-skill.ts --runs 3`（API キーが要る。1回 約0.5〜1ドル・約2〜4分）
- 結果の表と読み方は [README.md の「評価」](../../../README.md#評価スキル-stage-design-ありなし) にある

## ファイル

| ファイル | 中身 |
|---|---|
| [summary.json](summary.json) | 2条件のまとめ（提出できた回数、1回目のシミュレーションで合格した回数、シミュレーションの回数・時間・費用の平均）と、6回それぞれの結果（`runs`）。各回の `finalChecks` が、提出したステージが合格の目安（SPEC.md 5.4）をどう満たしたか |
| [runs/skill-1.json](runs/skill-1.json) 〜 `skill-3.json` | スキルありの3回。作業の記録（`events`）をすべて含む |
| [runs/noskill-1.json](runs/noskill-1.json) 〜 `noskill-3.json` | スキルなしの3回。同じ形 |

`events` は、教員モードの画面に流れたものと同じ出来事の列（`t` は開始からのミリ秒）：`status`（進み具合）、`thinking`（考え）、`text`（Claude の文）、`tool_call`／`tool_result`（ツールの呼び出しと返り）、`draft`（提出した案）、`usage`（トークンと費用）、`done`。ツールが返す数値は公開データとシミュレーションの結果で、Claude は作れない。

`runs/skill-2.json` は、公開サイトの[再生ページ](https://ph1125ks.github.io/Built-with-Claude-Japan-2026/replay.html)（`public/replays/osaka.json`）で、記録した時間のとおりに見られる回（1回目で合格したのに「乱用ボットの2050年の勝率 27% は上限 30% に近い」と自分で書き、敵の波を増やして 17% にしてから提出した）。

## 読むときの注意

- 件数が各3回と少ないので、差は目安。スキルなしでも最後には合格のステージを出せた（ツールが誤りと目安を返すので、Claude はそれを見て直せる）
- 費用と時間は 2026-11-05 時点の `claude-opus-5-5` の値
- 本番（動画のシーン8）はこの評価とは別の回（2026-11-08）で、その記録は `recordings/` にあり、リポジトリには入れていない（README の教員モードの段落に要点を書いた）
