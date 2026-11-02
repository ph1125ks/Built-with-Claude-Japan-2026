// 公開データの取得元。出典の書き方は data/README.md にまとめる。

export const RAW_DIR = "data/raw";

export interface RawSource {
  /** data/raw からの相対パス */
  file: string;
  url: string;
  title: string;
}

/** JANIS 検査部門 公開情報 2025年1〜12月 年報（e-Stat 掲載）。fileKind=0 は Excel */
export const JANIS_NATIONAL: RawSource = {
  file: "janis/ken_open_report_202500.xlsx",
  url: "https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040494034&fileKind=0",
  title: "院内感染対策サーベイランス 検査部門 公開情報 2025年1月〜12月 年報（全集計対象医療機関）【入院検体・CLSI 2012 版】",
};

export const JANIS_KINKI: RawSource = {
  file: "janis/ken_open_report_202500_kinki.xlsx",
  url: "https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040494039&fileKind=0",
  title: "院内感染対策サーベイランス 検査部門 公開情報 2025年1月〜12月 年報（近畿）【入院検体・CLSI 2012 版】",
};

/** 薬価基準収載品目リスト（令和8年11月1日適用） */
export const YAKKA_INJECTION: RawSource = {
  file: "yakka/tp20261101-01_02.xlsx",
  url: "https://www.mhlw.go.jp/topics/2026/04/xls/tp20261101-01_02.xlsx",
  title: "薬価基準収載品目リスト（令和8年11月1日適用）注射薬",
};

export const YAKKA_ORAL: RawSource = {
  file: "yakka/tp20261101-01_01.xlsx",
  url: "https://www.mhlw.go.jp/topics/2026/04/xls/tp20261101-01_01.xlsx",
  title: "薬価基準収載品目リスト（令和8年11月1日適用）内用薬",
};

export const ALL_SOURCES: RawSource[] = [JANIS_NATIONAL, JANIS_KINKI, YAKKA_INJECTION, YAKKA_ORAL];
