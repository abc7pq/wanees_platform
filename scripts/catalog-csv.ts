import { createHash } from "node:crypto";

export type CsvRecord = Record<string, string>;

export type ImportCandidate = {
  stableKey: string;
  nameAr: string;
  nameEn: string | null;
  zoneStableKey: string;
  zoneNameAr: string;
  type: string;
  durationMin: number;
  priceSar: number | null;
  ageMin: number | null;
  familyFriendly: boolean;
  descriptionAr: string | null;
  interests: string[];
  sourceRow: number;
};

export type ImportZone = { stableKey: string; nameAr: string };

export type CatalogImport = {
  zones: ImportZone[];
  activities: ImportCandidate[];
  summary: {
    records: number;
    rawZones: number;
    pricedCandidates: number;
    freeCandidates: number;
    newSeasonRecords: number;
  };
  errors: Array<{ row: number; field: string; message: string }>;
};

/** Parse RFC-4180-style CSV without treating commas or line breaks in quotes as delimiters. */
export function parseCsv(text: string): CsvRecord[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length === 0) return [];

  const headers = rows[0].map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function safeKey(value: string, prefix: string) {
  const readable = value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${prefix}-${readable || "item"}-${hashKey(value)}`.slice(0, 80);
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  const text = textValue(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value: unknown) {
  const parsed = numberValue(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function booleanValue(value: unknown) {
  return ["true", "1", "yes", "y", "نعم"].includes(textValue(value).toLowerCase());
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/** Normalize the supplied activity list without assigning map geometry or inventing schedules. */
export function normalizeCatalogRows(rows: CsvRecord[]): CatalogImport {
  const errors: CatalogImport["errors"] = [];
  const zones = new Map<string, ImportZone>();
  const activities: ImportCandidate[] = [];
  const seenKeys = new Set<string>();

  rows.forEach((row, index) => {
    const sourceRow = index + 2;
    const id = textValue(row.id);
    const nameAr = textValue(row.name_ar);
    const zoneNameAr = textValue(row.zone);
    const durationMin = integerValue(row.duration_min);
    const priceSar = numberValue(row.price_sar);
    const ageMin = integerValue(row.min_age);
    if (!id) errors.push({ row: sourceRow, field: "id", message: "المعرف مطلوب." });
    if (!nameAr) errors.push({ row: sourceRow, field: "name_ar", message: "الاسم العربي مطلوب." });
    if (!zoneNameAr) errors.push({ row: sourceRow, field: "zone", message: "المنطقة الخام مطلوبة." });
    if (durationMin === null || durationMin <= 0 || durationMin > 1440) errors.push({ row: sourceRow, field: "duration_min", message: "المدة يجب أن تكون عددًا صحيحًا بين 1 و1440." });
    if (priceSar === null || priceSar < 0) errors.push({ row: sourceRow, field: "price_sar", message: "السعر يجب أن يكون فارغًا أو رقمًا غير سالب." });
    if (ageMin !== null && ageMin < 0) errors.push({ row: sourceRow, field: "min_age", message: "العمر الأدنى لا يمكن أن يكون سالبًا." });
    if (!id || !nameAr || !zoneNameAr || durationMin === null || durationMin <= 0 || durationMin > 1440 || priceSar === null || priceSar < 0) return;

    const stableKey = `csv-${safeKey(id, "activity")}`;
    if (seenKeys.has(stableKey)) {
      errors.push({ row: sourceRow, field: "id", message: `المعرف مكرر بعد التطبيع: ${stableKey}.` });
      return;
    }
    seenKeys.add(stableKey);
    const zoneStableKey = safeKey(zoneNameAr, "zone");
    zones.set(zoneStableKey, { stableKey: zoneStableKey, nameAr: zoneNameAr });
    const audience = textValue(row.audience).split(",").map((value) => value.trim()).filter(Boolean);
    const category = textValue(row.category);
    const interests = unique([category, ...audience, booleanValue(row.new_2026) ? "new-2026" : ""]);
    activities.push({
      stableKey,
      nameAr,
      nameEn: textValue(row.name_en) || null,
      zoneStableKey,
      zoneNameAr,
      type: textValue(row.type) || "experience",
      durationMin,
      priceSar,
      ageMin,
      familyFriendly: audience.includes("family") || audience.includes("kids"),
      descriptionAr: textValue(row.note) || null,
      interests,
      sourceRow,
    });
  });

  return {
    zones: [...zones.values()].sort((left, right) => left.stableKey.localeCompare(right.stableKey)),
    activities,
    summary: {
      records: activities.length,
      rawZones: zones.size,
      pricedCandidates: activities.filter((activity) => (activity.priceSar ?? 0) > 0).length,
      freeCandidates: activities.filter((activity) => activity.priceSar === 0).length,
      newSeasonRecords: activities.filter((activity) => activity.interests.includes("new-2026")).length,
    },
    errors,
  };
}
