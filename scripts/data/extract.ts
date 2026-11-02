// data/raw/ の公開データ（Excel）から、ゲームが読む形を取り出す。
// build-data.ts（書き出し）と verify-data.ts（照合）の両方から使う。
//
// - 感受性は割合ではなく株数を持つ。割合は使うときに株数から計算する（丸めのずれを避けるため）
// - 対象の菌は data/catalog/bacteria.json の janis、抗菌薬は表にあるものすべて
import ExcelJS from "exceljs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { JANIS_KINKI, JANIS_NATIONAL, RAW_DIR, YAKKA_INJECTION, YAKKA_ORAL, type RawSource } from "./sources.ts";

export const OUT_DIR = "data/generated";
export const JANIS_OUT = join(OUT_DIR, "janis-2025.json");
export const PRICES_OUT = join(OUT_DIR, "prices-2026-11.json");
const NATIONAL = "全国";

type Cell = ExcelJS.CellValue;

/** セルの値を取り出す（数式は結果、リッチテキストは文字列にする） */
function cellValue(v: Cell): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "object") {
    if ("result" in v) return cellValue(v.result as Cell);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
  }
  return String(v);
}

/** 全角英数を半角にし、空白を除く */
function norm(v: Cell): string {
  return String(cellValue(v) ?? "").normalize("NFKC").replace(/\s+/g, "");
}

/** 株数のセル。"NA" や空は null */
function count(v: Cell): number | null {
  const x = cellValue(v);
  return typeof x === "number" ? x : null;
}

async function readSheet(src: RawSource, sheetName: string): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(RAW_DIR, src.file));
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`${src.file} にシート「${sheetName}」がない`);
  return ws;
}

async function retrievedDate(src: RawSource): Promise<string> {
  const s = await stat(join(RAW_DIR, src.file));
  // 日本時間の日付
  return new Date(s.mtime.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

const COUNT_KEYS = ["total", "S", "SorI", "I", "IorR", "R", "NS", "ND"] as const;
export type Counts = Record<(typeof COUNT_KEYS)[number], number | null>;

interface CatalogFiles {
  bacteria: { id: string; janis: string }[];
  drugs: { id: string; dosing: { unitsPerDay: number }; price: { list: "injection" | "oral"; ingredient: string; spec: string } }[];
}

async function readCatalog(): Promise<CatalogFiles> {
  const b = JSON.parse(await readFile("data/catalog/bacteria.json", "utf8")) as Pick<CatalogFiles, "bacteria">;
  const d = JSON.parse(await readFile("data/catalog/drugs.json", "utf8")) as Pick<CatalogFiles, "drugs">;
  return { bacteria: b.bacteria, drugs: d.drugs };
}

// ---------- JANIS ----------

/** 感受性の表を読む。府県の列があれば府県別、なければ全国 */
function readSusceptibility(ws: ExcelJS.Worksheet, hasPrefCol: boolean, speciesByJanis: Map<string, string>) {
  const out: Record<string, Record<string, Record<string, Counts>>> = {};
  const off = hasPrefCol ? 1 : 0;
  ws.eachRow((row, r) => {
    if (r < 6) return;
    const region = hasPrefCol ? norm(row.getCell(1).value) : NATIONAL;
    const species = speciesByJanis.get(String(cellValue(row.getCell(1 + off).value) ?? "").trim());
    const drug = norm(row.getCell(2 + off).value);
    if (!species || !drug || !region) return;
    const counts = Object.fromEntries(COUNT_KEYS.map((k, i) => [k, count(row.getCell(3 + off + i).value)])) as Counts;
    if (counts.total === null) return; // 集計対象外（施設数が3以下など）
    ((out[region] ??= {})[species] ??= {})[drug] = counts;
  });
  return out;
}

/** 尿の分離菌数（重複処理後）を読む */
function readUrineIsolation(ws: ExcelJS.Worksheet, hasPrefCol: boolean, speciesByJanis: Map<string, string>) {
  const out: Record<string, Record<string, number>> = {};
  const off = hasPrefCol ? 1 : 0;
  ws.eachRow((row, r) => {
    if (r < 6) return;
    const region = hasPrefCol ? norm(row.getCell(1).value) : NATIONAL;
    const name = String(cellValue(row.getCell(1 + off).value) ?? "").trim();
    const n = count(row.getCell(3 + off).value);
    if (!region || !name || n === null) return;
    const regionOut = (out[region] ??= {});
    regionOut._total = (regionOut._total ?? 0) + n;
    const species = speciesByJanis.get(name);
    if (species) regionOut[species] = n;
  });
  return out;
}

export async function extractJanis() {
  const catalog = await readCatalog();
  const speciesByJanis = new Map(catalog.bacteria.map((b) => [b.janis, b.id]));
  const nationalSus = readSusceptibility(await readSheet(JANIS_NATIONAL, "7.主要菌の抗菌薬感受性(全体)"), false, speciesByJanis);
  const kinkiSus = readSusceptibility(await readSheet(JANIS_KINKI, "7.主要菌の抗菌薬感受性"), true, speciesByJanis);
  const nationalUrine = readUrineIsolation(await readSheet(JANIS_NATIONAL, "3.検査材料別分離菌数割合(尿)(全体)"), false, speciesByJanis);
  const kinkiUrine = readUrineIsolation(await readSheet(JANIS_KINKI, "3.検査材料別分離菌数割合(尿)"), true, speciesByJanis);
  return {
    _comment: "JANIS 検査部門 公開情報 2025年年報から作成。感受性は株数（割合は使うときに計算する）。出典は data/README.md",
    sources: [
      { ...JANIS_NATIONAL, page: "https://www.e-stat.go.jp/stat-search/files?stat_infid=000040494034", retrieved: await retrievedDate(JANIS_NATIONAL) },
      { ...JANIS_KINKI, page: "https://www.e-stat.go.jp/stat-search/files?stat_infid=000040494039", retrieved: await retrievedDate(JANIS_KINKI) },
    ],
    criteria: "CLSI 2012",
    specimen: "入院検体・すべての検査材料（感受性）／尿（分離菌の割合、重複処理後）",
    regions: [NATIONAL, ...Object.keys(kinkiSus)],
    susceptibility: { ...nationalSus, ...kinkiSus },
    urineIsolation: { ...nationalUrine, ...kinkiUrine },
  };
}

// ---------- 薬価 ----------

async function readPrices(src: RawSource) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(RAW_DIR, src.file));
  const ws = wb.worksheets[0];
  if (!ws) throw new Error(`${src.file} にシートがない`);
  const rows: { ingredient: string; spec: string; product: string; brand: boolean; price: number; transitional: string | null }[] = [];
  ws.eachRow((row, r) => {
    if (r < 2) return;
    const price = count(row.getCell(13).value);
    if (price === null) return;
    rows.push({
      ingredient: norm(row.getCell(3).value),
      spec: norm(row.getCell(4).value),
      product: norm(row.getCell(8).value),
      brand: norm(row.getCell(11).value) === "先発品",
      price,
      transitional: norm(row.getCell(14).value) || null,
    });
  });
  return rows;
}

export async function extractPrices() {
  const catalog = await readCatalog();
  const priceRows = { injection: await readPrices(YAKKA_INJECTION), oral: await readPrices(YAKKA_ORAL) };
  const drugs: Record<string, { yenPerDayMin: number; yenPerDayBrand: number | null } & Record<string, unknown>> = {};
  for (const d of catalog.drugs) {
    const products = priceRows[d.price.list].filter(
      (p) => p.ingredient.startsWith(d.price.ingredient.normalize("NFKC")) && p.spec === d.price.spec,
    );
    if (products.length === 0) throw new Error(`薬価が見つからない：${d.id}（${d.price.ingredient} ${d.price.spec}）`);
    const values = products.map((p) => p.price);
    const brand = products.find((p) => p.brand)?.price ?? null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    drugs[d.id] = {
      ingredient: d.price.ingredient,
      spec: d.price.spec,
      unitsPerDay: d.dosing.unitsPerDay,
      min,
      max,
      brand,
      yenPerDayMin: Math.round(min * d.dosing.unitsPerDay * 10) / 10,
      yenPerDayBrand: brand === null ? null : Math.round(brand * d.dosing.unitsPerDay * 10) / 10,
      products: products.map(({ product, brand, price, transitional }) => ({ product, brand, price, transitional })),
    };
  }
  return {
    _comment: "薬価基準収載品目リスト（令和8年11月1日適用）から作成。単位は円。出典は data/README.md",
    sources: [
      { ...YAKKA_INJECTION, page: "https://www.mhlw.go.jp/topics/2026/04/tp20260401-01.html", retrieved: await retrievedDate(YAKKA_INJECTION) },
      { ...YAKKA_ORAL, page: "https://www.mhlw.go.jp/topics/2026/04/tp20260401-01.html", retrieved: await retrievedDate(YAKKA_ORAL) },
    ],
    drugs,
  };
}

export function toJson(v: unknown): string {
  return JSON.stringify(v, null, 1) + "\n";
}
