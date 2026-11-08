import { describe, expect, it } from "vitest";
import { type TableDef, renameColumnReferences, resolveStructuredReferences } from "./sheetStructured";

/** A table at A1:E5: a header row, four data rows (rows 2 to 5), and five columns. */
const TABLE: TableDef = { row1: 0, col1: 0, row2: 4, col2: 4, headerRows: 1, totalsRows: 0, columns: ["Region", "Product", "Units", "Unit Price", "Revenue"] };
/** The same with a totals row at row 6, so the data are rows 2 to 5 still. */
const WITH_TOTALS: TableDef = { ...TABLE, row2: 5, totalsRows: 1 };

const resolve = (formula: string, table: TableDef = TABLE, cell: { row: number; col: number } | null = { row: 2, col: 5 }) => {
  const result = resolveStructuredReferences(formula, (name) => (name === null ? table : undefined), cell);
  return result.formula ?? `unsupported: ${result.unsupported}`;
};

describe("a column", () => {
  it("is the data of that column, without its header", () => {
    expect(resolve("=SUM([Revenue])")).toBe("=SUM($E$2:$E$5)");
    expect(resolve("=SUMIFS([Revenue],[Region],\"West\")")).toBe('=SUMIFS($E$2:$E$5,$A$2:$A$5,"West")');
  });

  it("leaves out a totals row, which is not data", () => {
    expect(resolve("=SUM([Revenue])", WITH_TOTALS)).toBe("=SUM($E$2:$E$5)");
  });

  it("is found by its name whatever the case, and with the spaces in it", () => {
    expect(resolve("=SUM([revenue])")).toBe("=SUM($E$2:$E$5)");
    expect(resolve("=AVERAGE([Unit Price])")).toBe("=AVERAGE($D$2:$D$5)");
    expect(resolve("=SUM([ Units ])")).toBe("=SUM($C$2:$C$5)");
  });

  it("is a range of columns when two are given", () => {
    expect(resolve("=COUNTA([[Product]:[Units]])")).toBe("=COUNTA($B$2:$C$5)");
    expect(resolve("=COUNTA([[Units]:[Product]])")).toBe("=COUNTA($B$2:$C$5)");
  });

  it("reads a name with the characters Excel escapes with a quote", () => {
    const table: TableDef = { ...TABLE, columns: ["Qty [old]", "#Items", "it's", "A", "B"] };
    expect(resolve("=SUM([Qty '[old']])", table)).toBe("=SUM($A$2:$A$5)");
    expect(resolve("=SUM(['#Items])", table)).toBe("=SUM($B$2:$B$5)");
    expect(resolve("=SUM([it''s])", table)).toBe("=SUM($C$2:$C$5)");
  });

  it("is #REF! where the table has no such column, so an IFERROR round it still answers", () => {
    expect(resolve("=SUM([Nope])")).toBe("=SUM(#REF!)");
    expect(resolve("=IFERROR([Nope],0)")).toBe("=IFERROR(#REF!,0)");
    expect(resolve("=SUM([[Region]:[Nope]])")).toBe("=SUM(#REF!)");
  });
});

describe("this row", () => {
  it("is the cell of that column in the formula's own row, for @ and for [#This Row]", () => {
    expect(resolve("=[@Units]*[@[Unit Price]]")).toBe("=C3*D3");
    expect(resolve("=[[#This Row],[Units]]*[[#This Row],[Unit Price]]")).toBe("=C3*D3");
  });

  it("is the whole row for a bare @, and a range of its cells for two columns", () => {
    expect(resolve("=SUM([@])")).toBe("=SUM(A3:E3)");
    expect(resolve("=SUM([@[Product]:[Units]])")).toBe("=SUM(B3:C3)");
  });

  it("is #VALUE! when the formula is not in one of the table's rows, which is what Excel says (checked in it)", () => {
    expect(resolve("=[@Units]", TABLE, { row: 6, col: 5 })).toBe("=#VALUE!");
    expect(resolve("=[@Units]", TABLE, { row: 0, col: 5 })).toBe("=#VALUE!");
    expect(resolve("=[@Units]", TABLE, null)).toBe("=#VALUE!");
    expect(resolve("=[@Units]", WITH_TOTALS, { row: 5, col: 5 })).toBe("=#VALUE!"); // in the totals row
  });
});

describe("the parts of a table", () => {
  it("reads the headers, the data, everything, and the totals row of a table that has one", () => {
    expect(resolve("=[#Headers]")).toBe("=$A$1:$E$1");
    expect(resolve("=[#Data]")).toBe("=$A$2:$E$5");
    expect(resolve("=[#All]")).toBe("=$A$1:$E$5");
    expect(resolve("=[#Totals]", WITH_TOTALS)).toBe("=$A$6:$E$6");
    expect(resolve("=[#All]", WITH_TOTALS)).toBe("=$A$1:$E$6");
  });

  it("is #REF! for a totals row the table has not", () => {
    expect(resolve("=[#Totals]")).toBe("=#REF!");
    expect(resolve("=[[#Totals],[Revenue]]")).toBe("=#REF!");
  });

  it("combines a part with a column: one cell, or the column with its header", () => {
    expect(resolve("=[[#Headers],[Revenue]]")).toBe("=$E$1");
    expect(resolve("=[[#Data],[Revenue]]")).toBe("=$E$2:$E$5");
    expect(resolve("=[[#Totals],[Revenue]]", WITH_TOTALS)).toBe("=$E$6");
    expect(resolve("=[[#Headers],[#Data],[Revenue]]")).toBe("=$E$1:$E$5");
    expect(resolve("=[[#Data],[#Totals],[Revenue]]", WITH_TOTALS)).toBe("=$E$2:$E$6");
  });

  it("combines two parts that run on from each other", () => {
    expect(resolve("=[[#Headers],[#Data]]")).toBe("=$A$1:$E$5");
    expect(resolve("=[[#Data],[#Totals]]", WITH_TOTALS)).toBe("=$A$2:$E$6");
  });

  it("is a table with no header row: its data from the first row", () => {
    const bare: TableDef = { ...TABLE, headerRows: 0 };
    expect(resolve("=SUM([Revenue])", bare)).toBe("=SUM($E$1:$E$5)");
    expect(resolve("=[#Headers]", bare)).toBe("=#REF!");
  });
});

describe("a table's name", () => {
  const find = (name: string | null) =>
    name === null ? TABLE : name.toLowerCase() === "table1" ? TABLE : name === "Away" ? { unsupported: "a table on another sheet" } : undefined;
  const named = (formula: string) => {
    const result = resolveStructuredReferences(formula, find, { row: 2, col: 5 });
    return result.formula ?? `unsupported: ${result.unsupported}`;
  };

  it("picks the table, and is written without the name in the range it gives", () => {
    expect(named("=SUM(Table1[Revenue])")).toBe("=SUM($E$2:$E$5)");
    expect(named("=SUM(table1[[#Headers],[Revenue]])+Table1[@Units]")).toBe("=SUM($E$1)+C3");
  });

  it("is #REF! for a table that is not there", () => {
    expect(named("=SUM(Nothing[Revenue])")).toBe("=SUM(#REF!)");
  });

  it("is not read for a table on another sheet, and says so", () => {
    expect(named("=SUM(Away[Revenue])")).toBe("unsupported: a table on another sheet");
  });
});

describe("what it leaves alone, and what it does not read", () => {
  it("leaves a formula with no reference as it was, and the same for one it cannot read", () => {
    expect(resolve("=SUM(A1:A5)")).toBe("=SUM(A1:A5)");
    expect(resolve('=A1&"open')).toBe('=A1&"open');
  });

  it("does not touch brackets in a text", () => {
    expect(resolve('="[Revenue]"&SUM([Revenue])')).toBe('="[Revenue]"&SUM($E$2:$E$5)');
  });

  it("does not read a combination of parts Excel does not allow, or two columns that are not a range, and says what it did not read", () => {
    expect(resolve("=[[#Headers],[#Totals]]", WITH_TOTALS)).toContain("unsupported: a table reference this reads no further");
    expect(resolve("=[[#Data],[Region],[Units]]")).toContain("unsupported: a table reference this reads no further");
    expect(resolve("=[[#Foo]]")).toContain("unsupported");
  });

  it("works without the equals sign", () => {
    expect(resolve("SUM([Revenue])")).toBe("SUM($E$2:$E$5)");
  });
});

describe("renameColumnReferences", () => {
  const rename = (formula: string, from: string, to: string) => renameColumnReferences(formula, from, to);

  it("renames the column in each form of reference, and leaves the text around it as it was", () => {
    expect(rename("=[@Units]*[@Price]", "Units", "Qty")).toBe("=[@Qty]*[@Price]");
    expect(rename("=SUM([Units])+SUM([Units])", "Units", "Qty")).toBe("=SUM([Qty])+SUM([Qty])");
    // The brackets it was written with are kept, as they are valid for any name.
    expect(rename("=[@[Unit Price]]*2", "Unit Price", "Cost")).toBe("=[@[Cost]]*2");
    expect(rename("=[[#This Row],[Units]]*2", "Units", "Qty")).toBe("=[[#This Row],[Qty]]*2");
    expect(rename("=SUMIFS([Revenue],[Region],\"West\")", "Region", "Area")).toBe("=SUMIFS([Revenue],[Area],\"West\")");
    expect(rename("=SUM([[Region]:[Revenue]])", "Revenue", "Sales")).toBe("=SUM([[Region]:[Sales]])");
    expect(rename("=SUM([[#Data],[Units]:[Revenue]])", "Units", "Qty")).toBe("=SUM([[#Data],[Qty]:[Revenue]])");
    expect(rename("=SUM([[#Headers], [Units]])", "Units", "Qty")).toBe("=SUM([[#Headers], [Qty]])");
    expect(rename("=[[Units]]", "Units", "Qty")).toBe("=[[Qty]]");
  });

  it("matches the name without regard to case or the spaces around it, as a reference does", () => {
    expect(rename("=SUM([units])", "Units", "Qty")).toBe("=SUM([Qty])");
    expect(rename("=SUM([Units])", " units ", "Qty")).toBe("=SUM([Qty])");
  });

  it("gives the new name brackets of its own where Excel does, and escapes the marks that need it", () => {
    expect(rename("=[@Units]", "Units", "Unit Price")).toBe("=[@[Unit Price]]");
    expect(rename("=SUM([Units])", "Units", "Unit Price")).toBe("=SUM([Unit Price])");
    expect(rename("=SUM([Units])", "Units", "Total, units")).toBe("=SUM([[Total, units]])");
    expect(rename("=SUM([Units])", "Units", "Q[1]")).toBe("=SUM([[Q'[1']]])");
    expect(rename("=[@Units]", "Units", "It's")).toBe("=[@[It''s]]");
  });

  it("finds a name that was written with an escape", () => {
    expect(rename("=SUM([It''s])", "It's", "Its")).toBe("=SUM([Its])");
    expect(rename("=SUM([Q'[1']])", "Q[1]", "Q1")).toBe("=SUM([Q1])");
  });

  it("leaves other columns, the special items, a text that looks like a reference and a formula with none as they were", () => {
    expect(rename("=[@Price]*2", "Units", "Qty")).toBe("=[@Price]*2");
    expect(rename("=ROWS([#Headers])+ROWS([#All])", "Headers", "Qty")).toBe("=ROWS([#Headers])+ROWS([#All])");
    expect(rename("=[@]", "Units", "Qty")).toBe("=[@]");
    expect(rename('=IF(A1="[Units]",[Price],0)', "Units", "Qty")).toBe('=IF(A1="[Units]",[Price],0)');
    expect(rename("=B2*C2", "Units", "Qty")).toBe("=B2*C2");
    expect(rename("=B2*", "Units", "Qty")).toBe("=B2*");
  });

  it("does nothing for an empty new name", () => {
    expect(rename("=SUM([Units])", "Units", "")).toBe("=SUM([Units])");
    expect(rename("=SUM([Units])", "Units", "  ")).toBe("=SUM([Units])");
  });
});
