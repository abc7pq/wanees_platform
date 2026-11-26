import fs from "fs";
import path from "path";
import type { Catalog } from "../engine/types";

const DATA_DIR_CANDIDATES = [
  path.resolve(process.cwd(), "app", "data"),
  path.resolve(process.cwd(), "..", "app", "data"),
  "/root/wanees/app/data",
];

function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  return DATA_DIR_CANDIDATES.find((candidate) =>
    fs.existsSync(path.join(candidate, "venues", "index.json")),
  ) ?? DATA_DIR_CANDIDATES[DATA_DIR_CANDIDATES.length - 1];
}

const VENUES_DIR = path.join(resolveDataDir(), "venues");

export interface VenueEntry { id: string; name: string; file: string }
export interface VenuesIndex { active: string; venues: VenueEntry[] }

// كتابة ذرّية: ملف مؤقت ثم rename — لا يفسد الملف لو انقطعت العملية في المنتصف
function writeJsonAtomic(file: string, data: unknown) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export const VENUE_ID_RE = /^[a-z0-9_-]{1,64}$/i;

export function readIndex(): VenuesIndex {
  return JSON.parse(fs.readFileSync(path.join(VENUES_DIR, "index.json"), "utf-8"));
}
export function writeIndex(idx: VenuesIndex) {
  writeJsonAtomic(path.join(VENUES_DIR, "index.json"), idx);
}
export function loadCatalogFile(file: string): Catalog {
  return JSON.parse(fs.readFileSync(path.join(VENUES_DIR, file), "utf-8"));
}
export function saveCatalogFile(file: string, catalog: Catalog) {
  writeJsonAtomic(path.join(VENUES_DIR, file), catalog);
}
export const VENUES_DIR_PATH = VENUES_DIR;
