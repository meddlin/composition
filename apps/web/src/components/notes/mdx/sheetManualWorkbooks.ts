import * as XLSX from "xlsx";
import { zip } from "./zipForTests";

/**
 * The workbooks of the sheet manual test (docs/manual-tests/sheet.md), made here so the test does not need yours. Not part of the
 * app: `apps/desktop/src/tools/sheetManualFixture.ts` writes them to a scratch home, and its test reads them back through the real
 * import. They live in the web app's tree because `xlsx` is its dependency, and that is where it resolves.
 *
 * The XML below is the text of a workbook's parts, written into a zip and never HTML a browser parses; each statement that builds it
 * says so to the scanner that looks for HTML in template strings.
 */

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

// ---------------------------------------------------------------------------------------------------------------------------
// orders.xlsx: a workbook with a real Excel table, written as its parts, as Excel writes them.
// ---------------------------------------------------------------------------------------------------------------------------

type XmlCell = { at: string; xml: string };
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// nosemgrep: html-in-template-string
const text = (at: string, value: string): XmlCell => ({ at, xml: `<c r="${at}" t="inlineStr"><is><t>${esc(value)}</t></is></c>` });
// nosemgrep: html-in-template-string
const number = (at: string, value: number, style = 0): XmlCell => ({ at, xml: `<c r="${at}"${style ? ` s="${style}"` : ""}><v>${value}</v></c>` });
const formula = (at: string, f: string, value: number | string, style = 0): XmlCell => ({
  at,
  // nosemgrep: html-in-template-string
  xml: `<c r="${at}"${style ? ` s="${style}"` : ""}${typeof value === "string" ? ' t="str"' : ""}><f>${esc(f)}</f><v>${esc(String(value))}</v></c>`,
});

function sheetXml(cells: XmlCell[], table: boolean): string {
  const byRow = new Map<number, XmlCell[]>();
  for (const cell of cells) {
    const row = Number(/\d+/.exec(cell.at)![0]);
    byRow.set(row, [...(byRow.get(row) ?? []), cell]);
  }
  const rows = [...byRow]
    .sort((a, b) => a[0] - b[0])
    // nosemgrep: html-in-template-string
    .map(([row, list]) => `<row r="${row}">${list.sort((a, b) => a.at.localeCompare(b.at)).map((cell) => cell.xml).join("")}</row>`)
    .join("");
  // nosemgrep: html-in-template-string
  const parts = table ? `<tableParts count="1"><tablePart r:id="rId1" xmlns:r="${RELS}"/></tableParts>` : "";
  // nosemgrep: html-in-template-string
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN}"><sheetData>${rows}</sheetData>${parts}</worksheet>`;
}

const ORDERS = [
  { region: "West", product: "Widget", units: 120, price: 9.5, due: 46085, status: "Shipped" },
  { region: "East", product: "Widget", units: 80, price: 9.5, due: 46090, status: "Shipped" },
  { region: "West", product: "Gadget", units: 45, price: 20, due: 46100, status: "Open" },
  { region: "North", product: "Gadget", units: 10, price: 21.5, due: 46110, status: "Open" },
  { region: "East", product: "Gizmo", units: 60, price: 12, due: 46114, status: "Open" },
  { region: "South", product: "Widget", units: 30, price: 9.5, due: 46120, status: "Late" },
];

function ordersWorkbook(): Uint8Array {
  const header = ["Region", "Product", "Units", "Unit Price", "Revenue", "Due", "Share", "Status"];
  const letters = "ABCDEFGH";
  const revenue = ORDERS.map((order) => order.units * order.price);
  const total = revenue.reduce((sum, value) => sum + value, 0);
  const cells: XmlCell[] = header.map((name, c) => text(`${letters[c]}1`, name));
  ORDERS.forEach((order, i) => {
    const r = i + 2;
    cells.push(text(`A${r}`, order.region), text(`B${r}`, order.product), number(`C${r}`, order.units), number(`D${r}`, order.price));
    cells.push(formula(`E${r}`, "Orders[[#This Row],[Units]]*Orders[[#This Row],[Unit Price]]", revenue[i]));
    cells.push(number(`F${r}`, order.due, 1));
    cells.push(formula(`G${r}`, "Orders[[#This Row],[Revenue]]/SUM(Orders[Revenue])", revenue[i] / total, 2));
    cells.push(text(`H${r}`, order.status));
  });
  const last = ORDERS.length + 2;
  cells.push(text(`A${last}`, "Total"));
  cells.push(formula(`C${last}`, "SUBTOTAL(109,Orders[Units])", ORDERS.reduce((sum, order) => sum + order.units, 0)));
  cells.push(formula(`E${last}`, "SUBTOTAL(109,Orders[Revenue])", total));
  // Beside the table: formulas that name its columns, one that this engine cannot calculate, one that reads another sheet.
  cells.push(text("J1", "Checks"));
  cells.push(formula("J2", 'SUMIFS(Orders[Revenue],Orders[Region],"West")', revenue[0] + revenue[2]));
  cells.push(formula("J3", '_xlfn.XLOOKUP("East",Orders[Region],Orders[Revenue])', revenue[1]));
  cells.push(formula("J4", '_xlfn._xlws.FILTER(Orders[Revenue],Orders[Region]="West")', revenue[0]));
  cells.push(formula("J5", "Prices!B2*2", 1.9));
  cells.push(formula("J6", 'TEXT(MAX(Orders[Due]),"mmm d, yyyy")', "Apr 8, 2026"));
  cells.push(formula("J7", 'IFERROR(VLOOKUP("Nope",Orders[[Region]:[Revenue]],5,FALSE),"none")', "none"));

  const columns = header
    .map((name, i) => {
      const calculated =
        i === 4 ? "<calculatedColumnFormula>Orders[[#This Row],[Units]]*Orders[[#This Row],[Unit Price]]</calculatedColumnFormula>"
        : i === 6 ? "<calculatedColumnFormula>Orders[[#This Row],[Revenue]]/SUM(Orders[Revenue])</calculatedColumnFormula>"
        : "";
      // nosemgrep: html-in-template-string
      return `<tableColumn id="${i + 1}" name="${name}"${i === 2 || i === 4 ? ' totalsRowFunction="sum"' : ""}${calculated ? `>${calculated}</tableColumn>` : "/>"}`;
    })
    .join("");
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>`,
    // nosemgrep: html-in-template-string
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${RELS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    // nosemgrep: html-in-template-string
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${MAIN}" xmlns:r="${RELS}"><sheets><sheet name="Orders" sheetId="1" r:id="rId1"/><sheet name="Prices" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    // nosemgrep: html-in-template-string
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${RELS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${RELS}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${RELS}/styles" Target="styles.xml"/></Relationships>`,
    // nosemgrep: html-in-template-string
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${MAIN}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": sheetXml(cells, true),
    "xl/worksheets/sheet2.xml": sheetXml([text("A1", "Product"), text("B1", "Rate"), text("A2", "Widget"), number("B2", 0.95), text("A3", "Gadget"), number("B3", 1.1)], false),
    // nosemgrep: html-in-template-string
    "xl/worksheets/_rels/sheet1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${RELS}/table" Target="../tables/table1.xml"/></Relationships>`,
    // nosemgrep: html-in-template-string
    "xl/tables/table1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="${MAIN}" id="1" name="Orders" displayName="Orders" ref="A1:H${last}" totalsRowCount="1"><autoFilter ref="A1:H${last - 1}"/><tableColumns count="${header.length}">${columns}</tableColumns></table>`,
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// The workbooks SheetJS can write: formulas the engine cannot reproduce, a workbook counting from 1904, and big ones.
// ---------------------------------------------------------------------------------------------------------------------------

const cellS = (v: string): XLSX.CellObject => ({ t: "s", v });
const cellN = (v: number, extra: Partial<XLSX.CellObject> = {}): XLSX.CellObject => ({ t: "n", v, ...extra });
const bytesOf = (book: XLSX.WorkBook) => new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
const sheetOf = (cells: Record<string, XLSX.CellObject>, ref: string) => ({ ...cells, "!ref": ref }) as XLSX.WorkSheet;

function carriedWorkbook(): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    sheetOf(
      {
        A1: cellS("Item"), B1: cellS("Qty"), C1: cellS("Price"), D1: cellS("Calculated here"), E1: cellS("Why it differs or is carried"),
        A2: cellS("Pens"), B2: cellN(12), C2: cellN(1.5), D2: cellN(18, { f: "B2*C2" }), E2: cellN(5.2, { f: "STDEV(B2:B6)" }),
        A3: cellS("Paper"), B3: cellN(3), C3: cellN(4), D3: cellN(12, { f: "B3*C3" }), E3: cellN(7, { f: "NETWORKDAYS(DATE(2026,3,2),DATE(2026,3,10))" }),
        A4: cellS("Ink"), B4: cellN(8), C4: cellN(6), D4: cellN(48, { f: "B4*C4" }), E4: cellN(16, { f: "LET(x,B4,x*2)" }),
        A5: cellS("Tape"), B5: cellN(20), C5: cellN(0.5), D5: cellN(999, { f: "B5*C5" }), E5: cellS("(a stale value: the saved number is 999, not 10)"),
        A6: cellS("Glue"), B6: cellN(5), C6: cellN(2), D6: cellN(10, { f: "B6*C6" }), E6: cellN(46090, { f: "TODAY()" }),
        A7: cellS("Elsewhere"), B7: cellN(1), C7: cellN(1), D7: cellN(42, { f: "Notes!A1*2" }),
      },
      "A1:E7",
    ),
    "Carried",
  );
  XLSX.utils.book_append_sheet(book, sheetOf({ A1: cellN(21), A2: cellS("another sheet") }, "A1:A2"), "Notes");
  return bytesOf(book);
}

function oldWorkbook(): Uint8Array {
  const book = XLSX.utils.book_new();
  // The workbook counts days from 1904, so 44623 is what Excel shows as 2026-03-04.
  XLSX.utils.book_append_sheet(book, sheetOf({ A1: cellS("Event"), B1: cellS("Date"), A2: cellS("Kick-off"), B2: cellN(44623, { z: "yyyy-mm-dd" }), A3: cellS("Review"), B3: cellN(44628, { z: "yyyy-mm-dd" }) }, "A1:B3"), "Dates");
  book.Workbook = { WBProps: { date1904: true } };
  return bytesOf(book);
}

function bigWorkbook(): Uint8Array {
  const book = XLSX.utils.book_new();
  const make = (rows: number, withFormulas: boolean) => {
    const cells: Record<string, XLSX.CellObject> = { A1: cellS("Id"), B1: cellS("Group"), C1: cellS("Units"), D1: cellS("Price"), E1: cellS("Total"), F1: cellS("Running") };
    let running = 0;
    for (let r = 2; r <= rows; r++) {
      const units = (r * 7) % 50;
      const price = 5 + (r % 9);
      running += units * price;
      cells[`A${r}`] = cellN(r - 1);
      cells[`B${r}`] = cellS(["north", "south", "east", "west"][r % 4]);
      cells[`C${r}`] = cellN(units);
      cells[`D${r}`] = cellN(price);
      cells[`E${r}`] = withFormulas ? cellN(units * price, { f: `C${r}*D${r}` }) : cellN(units * price);
      cells[`F${r}`] = withFormulas ? cellN(running, { f: `SUM(E$2:E${r})` }) : cellN(running);
    }
    return sheetOf(cells, `A1:F${rows}`);
  };
  XLSX.utils.book_append_sheet(book, make(5001, true), "Big");
  XLSX.utils.book_append_sheet(book, make(5200, false), "TooBig");
  return bytesOf(book);
}

/** Every workbook of the test, by file name. */
export function workbooks(): Record<string, Uint8Array> {
  return {
    "orders.xlsx": ordersWorkbook(),
    "carried.xlsx": carriedWorkbook(),
    "old-1904.xlsx": oldWorkbook(),
    "big.xlsx": bigWorkbook(),
    // Not a workbook, and a workbook cut short: each says what is wrong with it.
    "not-a-workbook.xlsx": new TextEncoder().encode("This is a text file with an .xlsx name, not a workbook."),
    "cut-short.xlsx": ordersWorkbook().slice(0, 1500),
  };
}
