import { describe, expect, it } from "vitest";
import { importRange } from "./sheetImport";
import { MAX_PART_BYTES, readTables, readZipParts } from "./sheetTables";
import { readWorkbook } from "./sheetWorkbook";
import { zip, zipDeflated } from "./zipForTests";

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const tableXml = (name: string, ref: string, columns: string[], extra = "") =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="${MAIN}" id="1" name="${name}" displayName="${name}" ref="${ref}"${extra}><autoFilter ref="${ref}"/><tableColumns count="${columns.length}">${columns
    .map((column, i) => `<tableColumn id="${i + 1}" name="${column}"/>`)
    .join("")}</tableColumns></table>`;

/** A workbook of two sheets, each with a table, as the parts Excel writes them in. */
const parts = (overrides: Record<string, string> = {}): Record<string, string> => ({
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${MAIN}" xmlns:r="${RELS}"><sheets><sheet name="Orders" sheetId="1" r:id="rId1"/><sheet name="Other &amp; more" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${RELS}/worksheet" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
  "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN}"><dimension ref="A1"/><sheetData/></worksheet>`,
  "xl/worksheets/sheet2.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN}"><dimension ref="A1"/><sheetData/></worksheet>`,
  "xl/worksheets/_rels/sheet1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELS}/table" Target="../tables/table1.xml"/></Relationships>`,
  "xl/worksheets/_rels/sheet2.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELS}/table" Target="/xl/tables/table2.xml"/></Relationships>`,
  "xl/tables/table1.xml": tableXml("Table1", "B2:F7", ["Region", "Product", "Units", "Unit Price", "Revenue"], ' totalsRowCount="1"'),
  "xl/tables/table2.xml": tableXml("Prices", "A1:B3", ["Item", "Q&amp;A"], ' headerRowCount="0"'),
  ...overrides,
});

describe("readTables", () => {
  it("gives each table's name, its sheet, where it is, whether it has a header and a totals row, and its columns", async () => {
    expect(await readTables(zip(parts()))).toEqual([
      { name: "Table1", sheet: "Orders", row1: 1, col1: 1, row2: 6, col2: 5, headerRows: 1, totalsRows: 1, columns: ["Region", "Product", "Units", "Unit Price", "Revenue"] },
      { name: "Prices", sheet: "Other & more", row1: 0, col1: 0, row2: 2, col2: 1, headerRows: 0, totalsRows: 0, columns: ["Item", "Q&A"] },
    ]);
  });

  it("reads a file whose parts are deflated, as real ones are", async () => {
    const tables = await readTables(await zipDeflated(parts()));
    expect(tables.map((table) => table.name)).toEqual(["Table1", "Prices"]);
  });

  it("reads Excel's escapes in a column name: entities, and a line break written as _x000a_", async () => {
    const tables = await readTables(zip(parts({ "xl/tables/table1.xml": tableXml("Table1", "A1:B3", ["Line_x000a_break", "a &lt; b"]) })));
    expect(tables[0].columns).toEqual(["Line\nbreak", "a < b"]);
  });

  it("gives none for a workbook with no tables, for a file that is not a zip, and for one with damaged parts", async () => {
    const none = Object.fromEntries(Object.entries(parts()).filter(([name]) => !name.startsWith("xl/worksheets/_rels/")));
    expect(await readTables(zip(none))).toEqual([]);
    expect(await readTables(new TextEncoder().encode("not a zip file at all, only text"))).toEqual([]);
    expect(await readTables(zip(parts({ "xl/tables/table1.xml": "<table", "xl/tables/table2.xml": "garbage" })))).toEqual([]);
  });

  it("skips a table without columns or a range, and keeps the others", async () => {
    const tables = await readTables(zip(parts({ "xl/tables/table1.xml": `<table name="T" ref="A1:B2"></table>` })));
    expect(tables.map((table) => table.name)).toEqual(["Prices"]);
  });
});

describe("readZipParts", () => {
  it("reads only the parts asked for", async () => {
    const found = await readZipParts(zip({ "a.txt": "one", "b/c.txt": "two", "d.txt": "three" }), (name) => name.endsWith("c.txt"));
    expect([...found]).toEqual([["b/c.txt", "two"]]);
  });

  it("leaves out a part bigger than the limit, whatever it says, and reads the rest", async () => {
    const big = "x".repeat(MAX_PART_BYTES + 1);
    const found = await readZipParts(await zipDeflated({ "big.txt": big, "small.txt": "ok" }), () => true);
    expect([...found]).toEqual([["small.txt", "ok"]]);
  });
});

describe("an import of a workbook with a table", () => {
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN}"><dimension ref="B2:H7"/><sheetData>
    <row r="2"><c r="B2" t="inlineStr"><is><t>Region</t></is></c><c r="C2" t="inlineStr"><is><t>Product</t></is></c><c r="D2" t="inlineStr"><is><t>Units</t></is></c><c r="E2" t="inlineStr"><is><t>Unit Price</t></is></c><c r="F2" t="inlineStr"><is><t>Revenue</t></is></c><c r="H2" t="inlineStr"><is><t>West</t></is></c></row>
    <row r="3"><c r="B3" t="inlineStr"><is><t>West</t></is></c><c r="C3" t="inlineStr"><is><t>Widget</t></is></c><c r="D3"><v>120</v></c><c r="E3"><v>9.5</v></c><c r="F3"><f>Table1[[#This Row],[Units]]*Table1[[#This Row],[Unit Price]]</f><v>1140</v></c><c r="H3"><f>SUMIFS(Table1[Revenue],Table1[Region],H2)</f><v>2040</v></c></row>
    <row r="4"><c r="B4" t="inlineStr"><is><t>East</t></is></c><c r="C4" t="inlineStr"><is><t>Widget</t></is></c><c r="D4"><v>80</v></c><c r="E4"><v>9.5</v></c><c r="F4"><f>Table1[[#This Row],[Units]]*Table1[[#This Row],[Unit Price]]</f><v>760</v></c><c r="H4"><f>Prices[Q&amp;A]</f><v>1</v></c></row>
    <row r="5"><c r="B5" t="inlineStr"><is><t>West</t></is></c><c r="C5" t="inlineStr"><is><t>Gadget</t></is></c><c r="D5"><v>45</v></c><c r="E5"><v>20</v></c><c r="F5"><f>[@Units]*[@[Unit Price]]</f><v>900</v></c><c r="H5"><f>Table1[#Headers]</f><v>0</v></c></row>
    <row r="6"><c r="B6" t="inlineStr"><is><t>North</t></is></c><c r="C6" t="inlineStr"><is><t>Gadget</t></is></c><c r="D6"><v>10</v></c><c r="E6"><v>21.5</v></c><c r="F6"><f>Table1[@Units]*Table1[@[Unit Price]]</f><v>215</v></c></row>
    <row r="7"><c r="B7" t="inlineStr"><is><t>Total</t></is></c><c r="D7"><f>SUBTOTAL(109,Table1[Units])</f><v>255</v></c><c r="F7"><f>SUM(Table1[Revenue])</f><v>3015</v></c></row>
  </sheetData></worksheet>`;
  const workbook = () => zip(parts({ "xl/worksheets/sheet1.xml": sheetXml }));

  it("reads the table with the sheet, and the formulas as the file holds them", async () => {
    const book = await readWorkbook(workbook());
    const range = book.read("Orders", "B2:F7");
    if ("error" in range) throw new Error(range.error);
    expect(range.tables?.map((table) => table.name)).toEqual(["Table1", "Prices"]);
    expect(range.sheet).toBe("Orders");
    expect(range.cells[1][4]?.formula).toBe("Table1[[#This Row],[Units]]*Table1[[#This Row],[Unit Price]]");
  });

  it("keeps the formulas that name a column as formulas, as ranges, calculated here, and the totals row's out of the data", async () => {
    const range = (await readWorkbook(workbook())).read("Orders", "B2:F7");
    if ("error" in range) throw new Error(range.error);
    const result = importRange(range);
    if (!result.ok) throw new Error(result.error);
    expect(result.source.formulas.split("\n")).toEqual([
      "E2 =C2*D2",
      "E3 =C3*D3",
      "E4 =C4*D4",
      "E5 =C5*D5",
      "C6 carried =SUBTOTAL(109,$C$2:$C$5)",
      "E6 =SUM($E$2:$E$5)",
    ]);
    expect(result.summary).toMatchObject({ formulas: 6, calculated: 5, carried: 1, values: 0 });
  });

  it("makes a value of one that names a table on another sheet, and keeps the ones that name this table's columns inside the range", async () => {
    const range = (await readWorkbook(workbook())).read("Orders", "B2:H7");
    if ("error" in range) throw new Error(range.error);
    const result = importRange(range);
    if (!result.ok) throw new Error(result.error);
    expect(result.summary.values).toBe(1);
    expect(result.summary.valuesWhy).toEqual([{ reason: "a table on another sheet", count: 1 }]);
    // H3 reads Table1[Revenue] and Table1[Region] and H2: the range begins at B2, so they are E2:E5, A2:A5 and G1 here.
    expect(result.source.formulas).toContain("G2 =SUMIFS($E$2:$E$5,$A$2:$A$5,G1)");
  });

  it("makes a value of every formula that names a column the range does not hold, when it holds part of the table", async () => {
    const range = (await readWorkbook(workbook())).read("Orders", "F2:F7");
    if ("error" in range) throw new Error(range.error);
    const result = importRange(range);
    if (!result.ok) throw new Error(result.error);
    // F3 to F6 multiply columns that are not in the range; F7 sums its own column, which is.
    expect(result.summary.values).toBe(4);
    expect(result.source.formulas).toBe("A6 =SUM($A$2:$A$5)");
  });
});
