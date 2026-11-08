import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { importRange } from "./sheetImport";
import { MAX_ROWS_READ, numberFormatKind, readWorkbook, sourceCell } from "./sheetWorkbook";

/** A sheet as SheetJS holds it: its cells by address, and the range they are in as `!ref`. */
type Cells = Record<string, unknown>;

/** The bytes of a workbook with these sheets, as Excel's file format holds them. */
function bytesOf(sheets: Record<string, Cells>, options: { date1904?: boolean; hidden?: Record<string, 1 | 2> } = {}): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const [name, cells] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, cells as XLSX.WorkSheet, name);
  book.Workbook = {
    WBProps: options.date1904 ? { date1904: true } : {},
    Sheets: Object.keys(sheets).map((name) => ({ name, Hidden: options.hidden?.[name] ?? 0 })),
  };
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

const text = (v: string): XLSX.CellObject => ({ t: "s", v });
const number = (v: number, extra: Partial<XLSX.CellObject> = {}): XLSX.CellObject => ({ t: "n", v, ...extra });

const ORDERS = {
  "!ref": "A1:D3",
  A1: text("Item"),
  B1: text("Qty"),
  C1: text("Price"),
  D1: text("Total"),
  A2: text("Pens"),
  B2: number(12),
  C2: number(1.5),
  D2: number(18, { f: "B2*C2" }),
  A3: text("Paper"),
  B3: number(3),
  C3: number(4),
  D3: number(12, { f: "_xlfn.XLOOKUP(A3,A2:A3,B2:B3)" }),
};

describe("readWorkbook", () => {
  it("lists the sheets with the range Excel says each uses, hidden ones too and very hidden ones not", async () => {
    const book = await readWorkbook(bytesOf({ Orders: ORDERS, Empty: {}, Aside: { "!ref": "B2:C3", B2: text("x") }, Secret: { "!ref": "A1", A1: text("s") } }, { hidden: { Aside: 1, Secret: 2 } }));
    expect(book.sheets).toEqual([
      { name: "Orders", used: "A1:D3" },
      { name: "Empty", used: "" },
      { name: "Aside", used: "B2:C3" },
    ]);
  });

  it("reads the values of a range, and where it began", async () => {
    const book = await readWorkbook(bytesOf({ Orders: ORDERS }));
    const range = book.read("Orders", "A1:D3");
    if ("error" in range) throw new Error(range.error);
    expect(range.origin).toEqual({ row: 0, col: 0 });
    expect(range.cells[0].map((cell) => cell?.value)).toEqual(["Item", "Qty", "Price", "Total"]);
    expect(range.cells[1].map((cell) => cell?.value)).toEqual(["Pens", 12, 1.5, 18]);

    const inner = book.read("Orders", "B2:C3");
    if ("error" in inner) throw new Error(inner.error);
    expect(inner.origin).toEqual({ row: 1, col: 1 });
    expect(inner.cells.map((row) => row.map((cell) => cell?.value))).toEqual([[12, 1.5], [3, 4]]);
  });

  it("gives a formula without its equals sign and without the prefix newer functions are saved with, and the value Excel saved", async () => {
    const range = (await readWorkbook(bytesOf({ Orders: ORDERS }))).read("Orders", "A1:D3");
    if ("error" in range) throw new Error(range.error);
    expect(range.cells[1][3]).toMatchObject({ formula: "B2*C2", value: 18 });
    expect(range.cells[2][3]).toMatchObject({ formula: "XLOOKUP(A3,A2:A3,B2:B3)", value: 12 });
    expect(range.cells[1][1]?.formula).toBeUndefined();
  });

  it("reads a logical, an error as the text Excel shows, and leaves out a cell with nothing in it", async () => {
    const sheet = { "!ref": "A1:D1", A1: { t: "b", v: true } as XLSX.CellObject, B1: { t: "e", v: 0x2a, w: "#N/A" } as XLSX.CellObject, C1: { t: "z" } as XLSX.CellObject };
    const range = (await readWorkbook(bytesOf({ S: sheet }))).read("S", "A1:D1");
    if ("error" in range) throw new Error(range.error);
    expect(range.cells[0][0]?.value).toBe(true);
    expect(range.cells[0][1]?.value).toEqual({ error: "#N/A" });
    expect(range.cells[0][2]).toBeNull();
    expect(range.cells[0][3]).toBeNull();
  });

  it("says a number is a date, or a time, by its format, and keeps Excel's own text for it", async () => {
    const sheet = {
      "!ref": "A1:C1",
      A1: number(46085, { z: "yyyy-mm-dd" }),
      B1: number(0.4375, { z: "h:mm AM/PM" }),
      C1: number(46085, { z: "0.00" }),
    };
    const range = (await readWorkbook(bytesOf({ S: sheet }))).read("S", "A1:C1");
    if ("error" in range) throw new Error(range.error);
    expect(range.cells[0][0]).toMatchObject({ value: 46085, kind: "date", text: "2026-03-04" });
    expect(range.cells[0][1]).toMatchObject({ kind: "time" });
    expect(range.cells[0][2]?.kind).toBeUndefined();
  });

  it("says when the workbook counts its days from 1904", async () => {
    const book = await readWorkbook(bytesOf({ S: { "!ref": "A1", A1: number(1, { z: "yyyy-mm-dd" }) } }, { date1904: true }));
    const range = book.read("S", "A1");
    if ("error" in range) throw new Error(range.error);
    expect(range.date1904).toBe(true);
    const plain = (await readWorkbook(bytesOf({ S: { "!ref": "A1", A1: number(1) } }))).read("S", "A1");
    if ("error" in plain) throw new Error(plain.error);
    expect(plain.date1904).toBe(false);
  });

  it("refuses a range that is not one, one in a sheet that is not there, and one too big for a sheet or too far down", async () => {
    const book = await readWorkbook(bytesOf({ Orders: ORDERS }));
    expect(book.read("Orders", "nonsense")).toEqual({ error: "nonsense is not a range." });
    expect(book.read("Nope", "A1:B2")).toEqual({ error: "There is no sheet called Nope." });
    expect(book.read("Orders", "A1:A6000")).toMatchObject({ error: expect.stringContaining("narrower") });
    expect(book.read("Orders", "A1:DA3")).toMatchObject({ error: expect.stringContaining("columns") });
    expect(book.read("Orders", `A${MAX_ROWS_READ}:A${MAX_ROWS_READ + 5}`)).toMatchObject({ error: expect.stringContaining("Choose a range above") });
  });

  it("throws, in words, for a file that is not a workbook", async () => {
    await expect(readWorkbook(new TextEncoder().encode("this is just some text, not a zip file"))).rejects.toThrow("It is not an Excel workbook.");
  });
});

/** A zip file of these entries, stored with no compression: enough to hand SheetJS a workbook whose XML is written by hand. */
function zip(files: Record<string, string>): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes: Uint8Array) => (bytes.reduce((c, byte) => crcTable[(c ^ byte) & 0xff] ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => [n & 255, (n >> 8) & 255];
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = Uint8Array.from([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...nameBytes, ...data]);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes]));
    parts.push(local);
    offset += local.length;
  }
  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
  return Uint8Array.from([...parts.flatMap((part) => [...part]), ...central.flatMap((part) => [...part]), ...end]);
}

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const workbookWith = (sheetXml: string, extraWorkbookXml = "") =>
  zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${MAIN}" xmlns:r="${RELS}">${extraWorkbookXml}<sheets><sheet name="Orders" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELS}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN}">${sheetXml}</worksheet>`,
  });

describe("readWorkbook: a file as Excel writes it", () => {
  const header = `<row r="1"><c r="A1" t="inlineStr"><is><t>Qty</t></is></c><c r="B1" t="inlineStr"><is><t>Price</t></is></c><c r="C1" t="inlineStr"><is><t>Total</t></is></c></row>`;

  it("writes out a formula that Excel shared down a column for each of its cells", async () => {
    const rows =
      `<row r="2"><c r="A2"><v>2</v></c><c r="B2"><v>3</v></c><c r="C2"><f t="shared" ref="C2:C4" si="0">A2*B2</f><v>6</v></c></row>` +
      `<row r="3"><c r="A3"><v>4</v></c><c r="B3"><v>5</v></c><c r="C3"><f t="shared" si="0"/><v>20</v></c></row>` +
      `<row r="4"><c r="A4"><v>1</v></c><c r="B4"><v>7</v></c><c r="C4"><f t="shared" si="0"/><v>7</v></c></row>`;
    const book = await readWorkbook(workbookWith(`<dimension ref="A1:C4"/><sheetData>${header}${rows}</sheetData>`));
    expect(book.sheets).toEqual([{ name: "Orders", used: "A1:C4" }]);
    const range = book.read("Orders", "A1:C4");
    if ("error" in range) throw new Error(range.error);
    expect(range.cells.map((row) => row[2]?.formula)).toEqual([undefined, "A2*B2", "A3*B3", "A4*B4"]);
    expect(range.cells.map((row) => row[2]?.value)).toEqual(["Total", 6, 20, 7]);
  });

  it("reads strings kept in the shared strings table, as Excel writes nearly all of them", async () => {
    const files = workbookWith(`<dimension ref="A1:A2"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData>`);
    const withStrings = zip({
      ...unzipToFiles(files),
      "xl/sharedStrings.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${MAIN}" count="2" uniqueCount="2"><si><t>Item</t></si><si><r><t>Pens</t></r><r><t xml:space="preserve"> &amp; paper</t></r></si></sst>`,
      "[Content_Types].xml": unzipToFiles(files)["[Content_Types].xml"].replace("</Types>", `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`),
      "xl/_rels/workbook.xml.rels": unzipToFiles(files)["xl/_rels/workbook.xml.rels"].replace("</Relationships>", `<Relationship Id="rId2" Type="${RELS}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`),
    });
    const range = (await readWorkbook(withStrings)).read("Orders", "A1:A2");
    if ("error" in range) throw new Error(range.error);
    expect(range.cells.map((row) => row[0]?.value)).toEqual(["Item", "Pens & paper"]);
  });

  it("reads a workbook that counts from 1904", async () => {
    const book = await readWorkbook(workbookWith(`<dimension ref="A1"/><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>`, `<workbookPr date1904="1"/>`));
    const range = book.read("Orders", "A1");
    if ("error" in range) throw new Error(range.error);
    expect(range.date1904).toBe(true);
  });
});

/** The entries of a stored zip made by `zip` above, to build on. */
function unzipToFiles(archive: Uint8Array): Record<string, string> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();
  const files: Record<string, string> = {};
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = decoder.decode(archive.subarray(at + 30, at + 30 + nameLength));
    files[name] = decoder.decode(archive.subarray(at + 30 + nameLength, at + 30 + nameLength + size));
    at += 30 + nameLength + size;
  }
  return files;
}

describe("sourceCell", () => {
  it("is null for a cell with no value and no formula, or an empty text, and keeps a formula that has no value saved", () => {
    expect(sourceCell(undefined)).toBeNull();
    expect(sourceCell({ t: "s", v: "" })).toBeNull();
    expect(sourceCell({ t: "z" })).toBeNull();
    expect(sourceCell({ t: "n", f: "A1+1" })).toEqual({ value: undefined, formula: "A1+1" });
  });

  it("takes the prefixes Excel saves newer functions with off a formula, whichever way they were left", () => {
    expect(sourceCell({ t: "n", v: 1, f: "_xlfn.XLOOKUP(A1,B:B,C:C)" })?.formula).toBe("XLOOKUP(A1,B:B,C:C)");
    expect(sourceCell({ t: "n", v: 1, f: "_xlws.FILTER(A1:A5,B1:B5>2)" })?.formula).toBe("FILTER(A1:A5,B1:B5>2)");
    expect(sourceCell({ t: "n", v: 1, f: "_xlfn._xlws.SORT(A1:A5)+_xlfn.IFS(A1,1)" })?.formula).toBe("SORT(A1:A5)+IFS(A1,1)");
    expect(sourceCell({ t: "n", v: 1, f: 'CONCAT("_xlfn.",A1)' })?.formula).toBe('CONCAT("_xlfn.",A1)');
  });

  it("keeps an empty text that a formula gave, which is a value", () => {
    expect(sourceCell({ t: "s", v: "", f: 'IF(A1,"x","")' })).toMatchObject({ value: "", formula: 'IF(A1,"x","")' });
  });

  it("names an error from its number when the file has no text for it", () => {
    expect(sourceCell({ t: "e", v: 0x07 })?.value).toEqual({ error: "#DIV/0!" });
    expect(sourceCell({ t: "e", v: 0x2a, w: "#N/A" })?.value).toEqual({ error: "#N/A" });
  });
});

describe("numberFormatKind", () => {
  it.each([
    ["General", undefined],
    ["0.00", undefined],
    ["#,##0", undefined],
    ["0.0%", undefined],
    ['0.00" days"', undefined],
    ["#,##0.00;[Red]-#,##0.00", undefined],
    ["@", undefined],
    ["0.00E+00", undefined],
    ["yyyy-mm-dd", "date"],
    ["m/d/yyyy", "date"],
    ["dd/mm/yy", "date"],
    ["d-mmm-yy", "date"],
    ["mmmm", "date"],
    ["mmm yyyy", "date"],
    ["[$-409]dddd, mmmm d, yyyy", "date"],
    ["yyyy-mm-dd hh:mm", "date"],
    ["h:mm", "time"],
    ["h:mm:ss AM/PM", "time"],
    ["mm:ss", "time"],
    ["[h]:mm:ss", "time"],
    ["[mm]:ss", "time"],
  ])("takes %s as %s", (code, kind) => {
    expect(numberFormatKind(code)).toBe(kind);
  });
});

describe("a workbook through the import", () => {
  it("comes across as values with its formulas kept, calculated or carried, and its dates as 2026-03-04", async () => {
    const sheet = {
      "!ref": "A1:E3",
      A1: text("Item"),
      B1: text("Qty"),
      C1: text("Price"),
      D1: text("Total"),
      E1: text("Due"),
      A2: text("Pens"),
      B2: number(12),
      C2: number(1.5),
      D2: number(18, { f: "B2*C2" }),
      E2: number(46085, { z: "yyyy-mm-dd" }),
      A3: text("Paper"),
      B3: number(3),
      C3: number(4),
      D3: number(99, { f: "_xlfn.XLOOKUP(A3,A2:A3,B2:B3)" }),
      E3: number(46090, { z: "yyyy-mm-dd" }),
    };
    const range = (await readWorkbook(bytesOf({ Orders: sheet }))).read("Orders", "A1:E3");
    if ("error" in range) throw new Error(range.error);
    const result = importRange(range);
    if (!result.ok) throw new Error(result.error);

    expect(result.source.csv).toBe("Item,Qty,Price,Total,Due\nPens,12,1.5,18,2026-03-04\nPaper,3,4,99,2026-03-09");
    // D2 gives Excel's number; D3 would be 3 here, where Excel saved 99, so it is carried with Excel's value.
    expect(result.source.formulas).toBe("D2 =B2*C2\nD3 carried =XLOOKUP(A3,A2:A3,B2:B3)");
    expect(result.summary).toMatchObject({ formulas: 2, calculated: 1, carried: 1, values: 0 });
  });
});
