import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculate } from "./sheetFormula";
import { type TableDef, resolveStructuredReferences } from "./sheetStructured";

/**
 * Column names in formulas against real Excel: every case in spikes/sheet/excel-verified-tables.json is a formula that was run in
 * Microsoft Excel over a real Table, with the value Excel showed. Each is resolved here against the same table and calculated,
 * and must give the same. The tables are `Table1` (A1:F5) and `Table2` (A1:F6, with a totals row); the formulas are in the
 * file's own syntax (`[#This Row]`, not `@`), as an import meets them.
 */
type Spec = {
  header: string[];
  rows: (string | number)[][];
  tables: Record<string, { totals: boolean }>;
  cases: { table: string; address: string; formula: string; excel: string }[];
};
const spec: Spec = JSON.parse(readFileSync(new URL("../../../../../../spikes/sheet/excel-verified-tables.json", import.meta.url), "utf8"));

const at = (address: string) => ({ row: Number(/\d+/.exec(address)![0]) - 1, col: address.charCodeAt(0) - 65 });

function tableDef(totals: boolean): TableDef {
  return { row1: 0, col1: 0, row2: spec.rows.length + (totals ? 1 : 0), col2: spec.header.length - 1, headerRows: 1, totalsRows: totals ? 1 : 0, columns: spec.header };
}

/** What this engine shows for every case of a table, by address. */
function calculated(table: string): Map<string, string> {
  const totals = spec.tables[table].totals;
  const grid: string[][] = [spec.header, ...spec.rows.map((row) => [...row.map(String), ""])];
  if (totals) grid.push(["Total", "", "255", "", "", ""]);
  const padded = grid.map((row) => [...row, ...Array<string>(8).fill("")].slice(0, 8));
  const def = tableDef(totals);
  const formulas = new Map<string, string>();
  for (const { table: name, address, formula } of spec.cases) {
    if (name !== table) continue;
    const resolved = resolveStructuredReferences(`=${formula}`, (n) => (n === null || n.toLowerCase() === table.toLowerCase() ? def : undefined), at(address));
    formulas.set(address, resolved.formula ?? "=NA()");
  }
  const { sheet, results } = calculate({ rows: padded, columns: 8 }, formulas);
  const shown = new Map<string, string>();
  for (const address of formulas.keys()) {
    const value = results.get(address)?.value;
    shown.set(address, typeof value === "object" && value !== null && "code" in value ? (value as { code: string }).code : (sheet.rows[at(address).row]?.[at(address).col] ?? ""));
  }
  return shown;
}

describe("column names in formulas, against Excel's tables", () => {
  it("has the cases to check", () => {
    expect(spec.cases.length).toBeGreaterThan(30);
  });

  for (const table of Object.keys(spec.tables)) {
    const shown = calculated(table);
    describe(table, () => {
      for (const { table: name, address, formula, excel } of spec.cases.filter((c) => c.table === table)) {
        it(`${address}: ${formula}`, () => {
          const ours = shown.get(address);
          const [a, b] = [Number(ours), Number(excel)];
          if (ours !== "" && excel !== "" && Number.isFinite(a) && Number.isFinite(b)) expect(a).toBeCloseTo(b, 9);
          else expect(ours, `${name} ${address}`).toBe(excel);
        });
      }
    });
  }
});
