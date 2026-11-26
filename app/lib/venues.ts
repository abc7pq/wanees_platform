// سجل الفعاليات — تحميل من القرص وقت التشغيل حتى تديرها لوحة الإدارة
import fs from "fs";
import path from "path";
import type { Catalog } from "../engine/types.ts";

const VENUES_DIR = path.join(process.cwd(), "data", "venues");

export interface VenueEntry {
  id: string;
  name: string;
  file: string;
}

export interface VenuesIndex {
  active: string;
  venues: VenueEntry[];
}

export function readIndex(): VenuesIndex {
  return JSON.parse(fs.readFileSync(path.join(VENUES_DIR, "index.json"), "utf-8"));
}

export function writeIndex(idx: VenuesIndex) {
  fs.writeFileSync(path.join(VENUES_DIR, "index.json"), JSON.stringify(idx, null, 2));
}

export function loadCatalogFile(file: string): Catalog {
  return JSON.parse(fs.readFileSync(path.join(VENUES_DIR, file), "utf-8"));
}

export function saveCatalogFile(file: string, catalog: Catalog) {
  fs.writeFileSync(path.join(VENUES_DIR, file), JSON.stringify(catalog, null, 2));
}

export function loadActiveCatalog(): Catalog {
  const idx = readIndex();
  const v = idx.venues.find((x) => x.id === idx.active) ?? idx.venues[0];
  return loadCatalogFile(v.file);
}

export const VENUES_DIR_PATH = VENUES_DIR;
