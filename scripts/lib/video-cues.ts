// 画面の切り替わりに合わせて、ナレーションの文を待たせるところ（at はシーンの頭からの秒）。
// scripts/make-draft-video.ts：仮の声のとき、その語で始まる区切りを at 秒まで待たせる
// scripts/make-recording-sheet.ts：録音用の原稿に「ここで約◯秒あける」と出す（1秒に5.3字で読んだときの計算）
export const ANCHORS: Record<number, { word: string; at: number; why: string }[]> = {
  // 台本 第5版（2026-11-06。問題から入り、作者は身元の開示として名乗る）
  // シーン2：時間のずれの図。「でも」で「いま」の箱、「耐性は目に」で「何年も先」の箱と矢印が出る
  2: [
    { word: "でも、", at: 6.3, why: "図に「いま」の箱が出るまで" },
    { word: "耐性は目に", at: 10.8, why: "「何年も先」の箱と矢印が出るまで" },
  ],
  // シーン3：名乗りの場面（丸い写真と経歴のカード）のあと、「何年も先の結果を」に合わせてタイトル画面に切り替える
  3: [{ word: "何年も先の結果を", at: 11.3, why: "タイトル画面に切り替わるまで" }],
  // シーン4（しくみ）は「はじめての人へ」の見せ方（src/intro/present-plan.ts）の 2. から使い、段の切り替わりに合わせる
  4: [
    { word: "薬ごとに", at: 4.6, why: "細菌 × 薬の表に切り替わるまで" },
    { word: "はじめは", at: 8.4, why: "遠く・中ほど・近くの絵に切り替わるまで" },
    { word: "でも薬を", at: 14, why: "細菌の列に薬をかける絵に切り替わるまで" },
  ],
  // シーン5は早送り8秒のあとに結果画面、シーン6は推移の表4.5秒のあとに盤面、膀胱が破られるのは約9.8秒
  5: [{ word: "ところが", at: 8.3, why: "結果画面に切り替わるまで" }],
  6: [
    { word: "手札の薬が", at: 4.8, why: "2050年の盤面に切り替わるまで" },
    { word: "最初の場面は", at: 9.4, why: "膀胱が破られる場面まで" },
  ],
  // 盤面の「守り切った！」は 9秒に出る（第4版の直しで、頭に合う薬に替える瞬間を等倍で足した）。「守り切れました」がそのころに来るよう、少し前から読む
  7: [{ word: "今度は", at: 8.3, why: "2050年を守り切る場面が近づくまで" }],
  // シーン10：タイトル画面の上の「使っていく場面」が消えて、「いまの一手が」に合わせて大きな字が出る
  10: [{ word: "いまの一手が", at: 12, why: "大きな字が出るまで" }],
};

/** 声をシーンの頭から何秒のところに置くか（make-draft-video.ts の既定） */
export const VOICE_FROM = 0.3;

/** ナレーションを字幕の区切りに分ける（句点で切り、長い文は読点で切る） */
export function chunks(text: string, max = 32): string[] {
  const out: string[] = [];
  for (const s of text.match(/[^。]+。?/g) ?? [text]) {
    if (s.length <= max) {
      out.push(s);
      continue;
    }
    let cur = "";
    for (const part of s.match(/[^、]+、?/g) ?? [s]) {
      if (cur && (cur + part).length > max) {
        out.push(cur);
        cur = part;
      } else cur += part;
    }
    if (cur) out.push(cur);
  }
  return out.map((x) => x.trim()).filter(Boolean);
}
