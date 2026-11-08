import { describe, expect, it } from "vitest";
import { boundNames, tokenize } from "./sheetParse";
import { rebaseReferences, shiftReferences, type Shift } from "./sheetRefs";

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


describe("rebaseReferences", () => {
  const FROM_B2 = { row: 1, col: 1 };
  const SIZE = { rows: 10, cols: 5 };

  it("moves every reference by where the range began, absolute ones too", () => {
    expect(rebaseReferences("=C3*D3", FROM_B2, SIZE)).toEqual({ formula: "=B2*C2" });
    expect(rebaseReferences("=SUM($C$3:C9)+$B4", FROM_B2, SIZE)).toEqual({ formula: "=SUM($B$2:B8)+$A3" });
  });

  it("is the same formula when the range began at A1", () => {
    expect(rebaseReferences("=SUMIFS(C2:C9,A2:A9,\"West\")", { row: 0, col: 0 }, SIZE)).toEqual({ formula: "=SUMIFS(C2:C9,A2:A9,\"West\")" });
  });

  it("leaves a text, a function name and a logical alone", () => {
    expect(rebaseReferences('=IF(C3="C3",LOG10(D3),TRUE)', FROM_B2, SIZE)).toEqual({ formula: '=IF(B2="C3",LOG10(C2),TRUE)' });
  });

  it("moves whole columns and whole rows that are inside, and says outside for ones that are not", () => {
    expect(rebaseReferences("=SUM(C:D)", FROM_B2, SIZE)).toEqual({ formula: "=SUM(B:C)" });
    expect(rebaseReferences("=SUM(3:4)", FROM_B2, SIZE)).toEqual({ formula: "=SUM(2:3)" });
    expect(rebaseReferences("=SUM(A:C)", FROM_B2, SIZE)).toMatchObject({ outside: expect.stringContaining("columns") });
    expect(rebaseReferences("=SUM(1:3)", FROM_B2, SIZE)).toMatchObject({ outside: expect.stringContaining("rows") });
  });

  it("is outside when it reads a cell above or left of the range, or below or right of it", () => {
    expect(rebaseReferences("=A1+C3", FROM_B2, SIZE)).toMatchObject({ outside: expect.stringContaining("not in the range") });
    expect(rebaseReferences("=C3+Z3", FROM_B2, SIZE)).toMatchObject({ outside: expect.stringContaining("not in the range") });
    expect(rebaseReferences("=SUM(C3:C99)", FROM_B2, SIZE)).toMatchObject({ outside: expect.stringContaining("not in the range") });
  });

  it("is outside when it reads another sheet, another workbook, a table's column or a defined name", () => {
    expect(rebaseReferences("=Sheet2!C3", FROM_B2, SIZE)).toMatchObject({ outside: "another sheet or workbook" });
    expect(rebaseReferences("='Q3 budget'!C3", FROM_B2, SIZE)).toMatchObject({ outside: "another sheet or workbook" });
    expect(rebaseReferences("=[1]Sheet1!C3", FROM_B2, SIZE)).toMatchObject({ outside: expect.any(String) });
    expect(rebaseReferences("=SUM(Table1[Revenue])", FROM_B2, SIZE)).toMatchObject({ outside: "a table's column" });
    expect(rebaseReferences("=C3*TaxRate", FROM_B2, SIZE)).toMatchObject({ outside: "a defined name" });
  });

  it("is outside when it cannot be read", () => {
    expect(rebaseReferences('=C3&"open', FROM_B2, SIZE)).toMatchObject({ outside: "a formula that cannot be read" });
  });

  it("reads a name a LET or a LAMBDA gives as the formula's own, and moves the cells it reads", () => {
    expect(rebaseReferences("=LET(x,C3,x*2)", FROM_B2, SIZE)).toEqual({ formula: "=LET(x,B2,x*2)" });
    expect(rebaseReferences("=LET(a,C3,b,a+1,a*b)", FROM_B2, SIZE)).toEqual({ formula: "=LET(a,B2,b,a+1,a*b)" });
    expect(rebaseReferences("=LET(x,C3,LET(y,x+1,y*x))", FROM_B2, SIZE)).toEqual({ formula: "=LET(x,B2,LET(y,x+1,y*x))" });
    expect(rebaseReferences("=LAMBDA(n,n+1)(C3)", FROM_B2, SIZE)).toEqual({ formula: "=LAMBDA(n,n+1)(B2)" });
    expect(rebaseReferences("=LET(X,C3,x*2)", FROM_B2, SIZE)).toEqual({ formula: "=LET(X,B2,x*2)" });
    expect(rebaseReferences("=LET(_xlpm.x,C3,_xlpm.x*2)", FROM_B2, SIZE)).toEqual({ formula: "=LET(_xlpm.x,B2,_xlpm.x*2)" });
  });

  it("still finds a defined name beside a LET, or a name the LET does not give, and the cells it reads outside the range", () => {
    expect(rebaseReferences("=LET(x,C3,x*TaxRate)", FROM_B2, SIZE)).toMatchObject({ outside: "a defined name" });
    expect(rebaseReferences("=LET(x,Z99,x*2)", FROM_B2, SIZE)).toMatchObject({ outside: expect.stringContaining("not in the range") });
    // The last argument of a LET is its result, not a name it gives.
    expect(rebaseReferences("=LET(x,C3,y)", FROM_B2, SIZE)).toMatchObject({ outside: "a defined name" });
  });

  it("reads a formula with no leading equals sign, as the files hold them", () => {
    expect(rebaseReferences("C3*D3", FROM_B2, SIZE)).toEqual({ formula: "B2*C2" });
  });
});

describe("boundNames", () => {
  const names = (formula: string) => [...boundNames(tokenize(formula))].sort();

  it("gives the names a LET gives (its odd arguments but the last) and a LAMBDA gives (all but the last), in lower case", () => {
    expect(names("LET(x,5,y,x+1,x*y)")).toEqual(["x", "y"]);
    expect(names("LET(X,5,X*2)")).toEqual(["x"]);
    expect(names("LAMBDA(a,b,a+b)(1,2)")).toEqual(["a", "b"]);
    expect(names("_xlfn.LET(_xlpm.x,5,_xlpm.x*2)")).toEqual(["x"]);
  });

  it("reads each call at its own level: a nested one, a comma inside a function or an array, and an argument that is not a lone name", () => {
    expect(names("LET(x,SUM(1,2),y,{1,2,3},LET(z,x+y,z))")).toEqual(["x", "y", "z"]);
    expect(names("LET(x+1,5,2)")).toEqual([]);
    expect(names("SUM(x,5)")).toEqual([]);
  });
});
