import { describe, expect, it } from "vitest";
import { shiftReferences, type Shift } from "./sheetRefs";

const insertRow = (at: number): Shift => ({ axis: "row", at, delta: 1 });
const deleteRow = (at: number): Shift => ({ axis: "row", at, delta: -1 });
const insertColumn = (at: number): Shift => ({ axis: "col", at, delta: 1 });
const deleteColumn = (at: number): Shift => ({ axis: "col", at, delta: -1 });

describe("shiftReferences: inserting a row", () => {
  it("moves a reference to a cell at or below the new row, and leaves the ones above", () => {
    expect(shiftReferences("=A3", insertRow(2))).toBe("=A4");
    expect(shiftReferences("=A2", insertRow(2))).toBe("=A2");
    expect(shiftReferences("=A9+B3+C1", insertRow(2))).toBe("=A10+B4+C1");
  });

  it("moves an absolute reference too, and keeps its dollar signs", () => {
    expect(shiftReferences("=$A$3+A$3+$A3", insertRow(2))).toBe("=$A$4+A$4+$A4");
  });

  it("grows a range that has a row inserted inside it, and moves one that is entirely below", () => {
    expect(shiftReferences("=SUM(B2:B9)", insertRow(4))).toBe("=SUM(B2:B10)");
    expect(shiftReferences("=SUM(B5:B9)", insertRow(1))).toBe("=SUM(B6:B10)");
  });

  it("moves a whole range when the row goes in at its first row, and does not grow it when the row goes in just below", () => {
    expect(shiftReferences("=SUM(B2:B9)", insertRow(1))).toBe("=SUM(B3:B10)");
    expect(shiftReferences("=SUM(B2:B9)", insertRow(9))).toBe("=SUM(B2:B9)");
  });

  it("moves whole-row references, and not whole-column ones", () => {
    expect(shiftReferences("=SUM(3:5)", insertRow(3))).toBe("=SUM(3:6)");
    expect(shiftReferences("=SUM(B:B)", insertRow(3))).toBe("=SUM(B:B)");
  });
});

describe("shiftReferences: deleting a row", () => {
  it("moves a reference below it up, and a reference to it becomes #REF!", () => {
    expect(shiftReferences("=A5", deleteRow(2))).toBe("=A4");
    expect(shiftReferences("=A3", deleteRow(2))).toBe("=#REF!");
    expect(shiftReferences("=A2", deleteRow(2))).toBe("=A2");
  });

  it("shrinks a range that loses a row, wherever in it the row was", () => {
    expect(shiftReferences("=SUM(B2:B9)", deleteRow(4))).toBe("=SUM(B2:B8)");
    expect(shiftReferences("=SUM(B2:B9)", deleteRow(1))).toBe("=SUM(B2:B8)");
    expect(shiftReferences("=SUM(B2:B9)", deleteRow(8))).toBe("=SUM(B2:B8)");
    expect(shiftReferences("=SUM(B2:B9)", deleteRow(0))).toBe("=SUM(B1:B8)");
  });

  it("makes a range of only the deleted row #REF!", () => {
    expect(shiftReferences("=SUM(B3:B3)", deleteRow(2))).toBe("=SUM(#REF!)");
    expect(shiftReferences("=SUM(B3:B4)+1", deleteRow(2))).toBe("=SUM(B3:B3)+1");
  });

  it("moves whole-row references", () => {
    expect(shiftReferences("=SUM(3:5)", deleteRow(3))).toBe("=SUM(3:4)");
  });
});

describe("shiftReferences: columns", () => {
  it("moves references right of an inserted column, and grows a range around it", () => {
    expect(shiftReferences("=C2*D2", insertColumn(1))).toBe("=D2*E2");
    expect(shiftReferences("=SUM(B2:D2)", insertColumn(2))).toBe("=SUM(B2:E2)");
    expect(shiftReferences("=A2", insertColumn(1))).toBe("=A2");
  });

  it("moves whole-column references, and not whole-row ones", () => {
    expect(shiftReferences("=SUM(B:D)", insertColumn(2))).toBe("=SUM(B:E)");
    expect(shiftReferences("=SUM($C:$C)", insertColumn(0))).toBe("=SUM($D:$D)");
    expect(shiftReferences("=SUM(2:5)", insertColumn(0))).toBe("=SUM(2:5)");
  });

  it("deletes a column the way it deletes a row", () => {
    expect(shiftReferences("=C2+D2", deleteColumn(2))).toBe("=#REF!+C2");
    expect(shiftReferences("=SUM(B:D)", deleteColumn(2))).toBe("=SUM(B:C)");
    expect(shiftReferences("=SUM(B2:D9)", deleteColumn(1))).toBe("=SUM(B2:C9)");
  });

  it("goes past Z into two letters", () => {
    expect(shiftReferences("=Z1", insertColumn(0))).toBe("=AA1");
  });
});

describe("shiftReferences: what it leaves alone", () => {
  it("does not touch a cell name inside a text", () => {
    expect(shiftReferences('="A3"&A3', insertRow(0))).toBe('="A3"&A4');
  });

  it("does not take a function name for a cell", () => {
    expect(shiftReferences("=LOG10(A3)+ATAN2(1,B3)", insertRow(0))).toBe("=LOG10(A4)+ATAN2(1,B4)");
  });

  it("does not move another sheet's cells", () => {
    expect(shiftReferences("=Sheet2!A3+A3", insertRow(0))).toBe("=Sheet2!A3+A4");
    expect(shiftReferences("=SUM(Sheet2!A3:B5)+A3", insertRow(0))).toBe("=SUM(Sheet2!A3:B5)+A4");
  });

  it("keeps the spaces and the letters it has no reason to change", () => {
    expect(shiftReferences("=  sum( b2 : b9 ) + 1", insertRow(0))).toBe("=  sum( b3 : b10 ) + 1");
  });

  it("gives a formula it cannot read back as it was", () => {
    expect(shiftReferences('=A3&"open', insertRow(0))).toBe('=A3&"open');
  });

  it("reads a formula with no leading equals sign", () => {
    expect(shiftReferences("A3+1", insertRow(0))).toBe("A4+1");
  });
});
