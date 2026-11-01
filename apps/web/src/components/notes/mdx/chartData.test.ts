import { describe, expect, it } from "vitest";
import { MAX_CHART_ROWS, parseChart, parseCsv, parseNumber } from "./chartData";

describe("parseCsv", () => {
  it("splits rows and cells, trimming each and skipping blank lines", () => {
    expect(parseCsv("a, b\n\n 1 ,2\r\n3,4\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("reads quoted cells with commas, escaped quotes and newlines", () => {
    expect(parseCsv('name,note\n"Smith, J","said ""hi"""\n"two\nlines",x')).toEqual([
      ["name", "note"],
      ["Smith, J", 'said "hi"'],
      ["two\nlines", "x"],
    ]);
  });

  it("is empty for blank text", () => {
    expect(parseCsv("  \n\n")).toEqual([]);
  });
});

describe("parseNumber", () => {
  it("accepts plain numbers, separators and percentages", () => {
    expect(["12", "-3.5", ".5", "1,234", "1,234.5", "12%", "+7"].map(parseNumber)).toEqual([12, -3.5, 0.5, 1234, 1234.5, 12, 7]);
  });

  it("rejects anything else", () => {
    expect(["", "n/a", "1e3", "12abc", "1,23", "$5"].map(parseNumber)).toEqual([null, null, null, null, null, null]);
  });
});

describe("parseChart", () => {
  const csv = "month,sales,costs\nJan,10,7\nFeb,12,\nMar,n/a,9";

  it("uses the first column for labels and every other column of numbers as a series", () => {
    expect(parseChart({ csv })).toEqual({
      spec: {
        type: "bar",
        x: "month",
        y: ["sales", "costs"],
        rows: [
          { month: "Jan", sales: 10, costs: 7 },
          { month: "Feb", sales: 12 },
          { month: "Mar", costs: 9 },
        ],
      },
    });
  });

  it("takes x and y by column name, in the order given", () => {
    const { spec } = parseChart({ csv, x: "month", y: "costs, sales", type: " line " });
    expect(spec).toMatchObject({ type: "line", x: "month", y: ["costs", "sales"] });
  });

  it("skips a non-numeric column when choosing series itself", () => {
    expect(parseChart({ csv: "a,note,n\nx,hello,1\ny,world,2" }).spec?.y).toEqual(["n"]);
  });

  it("draws an unknown type as a bar chart", () => {
    expect(parseChart({ csv, type: "radar" }).spec?.type).toBe("bar");
  });

  it("says what is wrong when it can't draw", () => {
    expect(parseChart({ csv: "" }).error).toMatch(/add a ```csv block/);
    expect(parseChart({ csv: "a,b" }).error).toMatch(/no rows/);
    expect(parseChart({ csv: "a,a\n1,2" }).error).toMatch(/same name/);
    expect(parseChart({ csv, x: "week" }).error).toBe("Chart: no column named “week”. Columns: month, sales, costs.");
    expect(parseChart({ csv, y: "profit" }).error).toMatch(/no column named “profit”/);
    expect(parseChart({ csv: "a,b\nx,y" }).error).toMatch(/no column of numbers/);
    expect(parseChart({ csv: "a,b,c\nx,1,y", y: "c" }).error).toMatch(/column “c” has no numbers/);
  });

  it("refuses a table too big to draw", () => {
    const rows = Array.from({ length: MAX_CHART_ROWS + 1 }, (_, i) => `r${i},${i}`).join("\n");
    expect(parseChart({ csv: `k,v\n${rows}` }).error).toMatch(/too many/);
  });
});
