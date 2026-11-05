// 画面の切り替わりに合わせて、ナレーションの文を待たせるところ（at はシーンの頭からの秒）。
// scripts/make-draft-video.ts：仮の声のとき、その語で始まる区切りを at 秒まで待たせる
// scripts/make-recording-sheet.ts：録音用の原稿に「ここで約◯秒あける」と出す（1秒に5字で読んだときの計算）
export const ANCHORS: Record<number, { word: string; at: number; why: string }[]> = {
  // 台本 第3版（2026-11-05）。シーン2（しくみ）は「はじめての人へ」の見せ方（src/intro/present-plan.ts）の 2. から使い、段の切り替わりに合わせる
  2: [
    { word: "薬ごとに", at: 8, why: "細菌 × 薬の表に切り替わるまで" },
    { word: "はじめは", at: 13.8, why: "遠く・中ほど・近くの絵に切り替わるまで" },
    { word: "でも薬を", at: 20.8, why: "細菌の列に薬をかける絵に切り替わるまで" },
  ],
  // 第3.1版（作者の読む速さ 1秒に約5.3字に合わせた）。シーン4は早送り7秒のあとに結果画面、シーン5は推移の表6秒のあとに盤面
  4: [{ word: "ところが", at: 7.3, why: "結果画面に切り替わるまで" }],
  5: [{ word: "手札の薬が", at: 6.3, why: "2050年の盤面に切り替わるまで" }],
  // 盤面の「守り切った！」は 11.5秒に出る。「守り切れました」がそのころに来るよう、少し前から読む
  6: [{ word: "今度は", at: 9.5, why: "2050年を守り切る場面が近づくまで" }],
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
