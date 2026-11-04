// 画面の切り替わりに合わせて、ナレーションの文を待たせるところ（at はシーンの頭からの秒）。
// scripts/make-draft-video.ts：仮の声のとき、その語で始まる区切りを at 秒まで待たせる
// scripts/make-recording-sheet.ts：録音用の原稿に「ここで約◯秒あける」と出す（1秒に5字で読んだときの計算）
export const ANCHORS: Record<number, { word: string; at: number; why: string }[]> = {
  3: [{ word: "ところが", at: 11.3, why: "結果画面に切り替わるまで" }],
  4: [{ word: "手札の薬が", at: 8.3, why: "2050年の盤面に切り替わるまで" }],
  // 盤面の「守り切った！」は 21秒に出る。「守り切れました」がそのころに来るよう、少し前から読む
  5: [{ word: "今度は", at: 19.5, why: "2050年を守り切る場面が近づくまで" }],
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
