/**
 * The tables of an Excel workbook (a range with a header row that Excel has named, `Table1`): their names, where they are and
 * what their columns are called. SheetJS does not give them, and an import needs them to read a formula that says
 * `Table1[Revenue]` (see sheetStructured.ts), so this reads the few small parts of the file that hold them, and only those:
 * the zip's index, `xl/workbook.xml`, the relationships that say which sheet is which file and which tables a sheet has, and
 * each `xl/tables/*.xml`. A part is never read past `MAX_PART_BYTES`, however big the file says it is.
 *
 * Read with a small regular-expression reader of the attributes, not an XML parser, so it works in a worker and a test without
 * the DOM; the parts are plain and Excel writes them the same way each time.
 */
import { type ImportTable, parseRange } from "./sheetImport";

/** No part this reads is bigger than this; a larger one is skipped, which loses a table, not the import. */
export const MAX_PART_BYTES = 4 * 1024 * 1024;

const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const END = 0x06054b50;

/** Inflates raw deflate data, stopping as soon as it passes `limit` bytes (a zip bomb). */
async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array | null> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** The text of the parts of a zip file whose names `wanted` says yes to. A part that cannot be read is left out. */
export async function readZipParts(bytes: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const parts = new Map<string, string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END) {
      end = i;
      break;
    }
  }
  if (end < 0) return parts;
  const entries = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  for (let n = 0; n < entries && at + 46 <= bytes.length && view.getUint32(at, true) === CENTRAL; n++) {
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name) || size > MAX_PART_BYTES || compressed > MAX_PART_BYTES || local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + compressed);
    try {
      const content = method === 0 ? data : method === 8 ? await inflate(data, MAX_PART_BYTES) : null;
      if (content) parts.set(name, decoder.decode(content));
    } catch {
      // A damaged part is a table not read.
    }
  }
  return parts;
}

/** `&amp;` and the other entities, and Excel's `_x000a_` for a character it cannot write (a line break in a name). */
const unescapeXml = (text: string) =>
  text
    .replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_, hex: string, dec: string, named: string) =>
      named ? ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[named.toLowerCase()] : String.fromCodePoint(hex ? parseInt(hex, 16) : parseInt(dec, 10)),
    )
    .replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

/** The attributes of an XML tag, `name="value"` or `name='value'`, with entities taken out. */
function attributes(tag: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) found[match[1]] = unescapeXml(match[2] ?? match[3] ?? "");
  return found;
}

const TAGS = { sheet: /<sheet\b[^>]*>/g, Relationship: /<Relationship\b[^>]*>/g, tableColumn: /<tableColumn\b[^>]*>/g };

/** The attributes of each tag of one kind in a part. */
const tagsOf = (xml: string, name: keyof typeof TAGS) => [...xml.matchAll(TAGS[name])].map((match) => attributes(match[0]));

/** A path inside the file, relative to the folder of `from` (`../tables/table1.xml` from `xl/worksheets/sheet1.xml`), or absolute from the root. */
function resolvePath(target: string, from: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const folder = from.split("/").slice(0, -1);
  for (const step of target.split("/")) {
    if (step === "..") folder.pop();
    else if (step !== ".") folder.push(step);
  }
  return folder.join("/");
}

/** One table's definition from its part, or `null` for one that cannot be read (no range, no columns). */
function readTable(xml: string, sheet: string): ImportTable | null {
  const open = /<table\b[^>]*>/.exec(xml);
  if (!open) return null;
  const table = attributes(open[0]);
  const range = table.ref ? parseRange(table.ref) : null;
  const columns = tagsOf(xml, "tableColumn").map((column) => column.name ?? "");
  const name = table.displayName || table.name;
  if (!range || !name || columns.length === 0) return null;
  return {
    name,
    sheet,
    row1: range.row1,
    col1: range.col1,
    row2: range.row2,
    col2: range.col2,
    headerRows: table.headerRowCount === "0" ? 0 : 1,
    totalsRows: Number(table.totalsRowCount ?? "0") > 0 ? 1 : 0,
    columns,
  };
}

/** The workbook's tables, each with the name of its sheet. A file with none, or that is not a zip, gives none. */
export async function readTables(bytes: Uint8Array): Promise<ImportTable[]> {
  const parts = await readZipParts(
    bytes,
    (name) => name === "xl/workbook.xml" || name === "xl/_rels/workbook.xml.rels" || /^xl\/worksheets\/_rels\/[^/]+\.rels$/.test(name) || /^xl\/tables\/[^/]+\.xml$/.test(name),
  );
  const workbook = parts.get("xl/workbook.xml");
  const rels = parts.get("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) return [];
  const targets = new Map(tagsOf(rels, "Relationship").map((rel) => [rel.Id, rel.Target ?? ""]));
  const tables: ImportTable[] = [];
  for (const sheet of tagsOf(workbook, "sheet")) {
    const target = targets.get(sheet["r:id"] ?? "");
    if (!target || !sheet.name) continue;
    const path = resolvePath(target, "xl/workbook.xml");
    const sheetRels = parts.get(`${path.split("/").slice(0, -1).join("/")}/_rels/${path.split("/").pop()}.rels`);
    if (!sheetRels) continue;
    for (const rel of tagsOf(sheetRels, "Relationship")) {
      if (!rel.Type?.endsWith("/table") || !rel.Target) continue;
      const xml = parts.get(resolvePath(rel.Target, path));
      const table = xml ? readTable(xml, sheet.name) : null;
      if (table) tables.push(table);
    }
  }
  return tables;
}
