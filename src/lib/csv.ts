/**
 * Tiny CSV parser — no external deps, handles quoted values, commas in
 * quotes, \r\n and \n line endings, double-quote escaping ("").
 * Returns an array of objects keyed by the header row.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let i = 0;
  const N = text.length;
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  while (i < N) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((cell) => cell.trim().length > 0))
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, idx) => (obj[h] = (r[idx] ?? "").trim()));
      return obj;
    });
}

/**
 * Coerce a CSV cell into a usable value. Returns null/undefined for
 * blank cells (so defaults in Prisma kick in).
 */
export function asStr(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length ? s : null;
}
export function asInt(v: string | undefined): number | null {
  const s = asStr(v);
  if (s === null) return null;
  const n = parseInt(s.replace(/[\s,]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}
export function asFloat(v: string | undefined): number | null {
  const s = asStr(v);
  if (s === null) return null;
  const n = parseFloat(s.replace(/[\s,]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
export function asDate(v: string | undefined): Date | null {
  const s = asStr(v);
  if (s === null) return null;
  // Accept YYYY-MM-DD and YYYY-MM-DD HH:MM and full ISO
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0"] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
  }
  const dt = new Date(s);
  return Number.isFinite(dt.getTime()) ? dt : null;
}
