// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Sheet, blockText, formulasText } from "./Sheet";

const fence = (language: string, text: string) => (
  <pre>
    <code className={`language-${language}`}>{text}</code>
  </pre>
);

const bigCsv = (rows: number) => `n,sq\n${Array.from({ length: rows }, (_, i) => `${i + 1},${(i + 1) ** 2}`).join("\n")}`;

describe("blockText", () => {
  it("is the text of the fence tagged with the language, even among others", () => {
    expect(blockText([fence("formulas", "E2 =C2*D2"), fence("csv", "a,b\n1,2")], "csv")).toBe("a,b\n1,2");
  });

  it("collects text through the spans a code block is coloured with", () => {
    expect(
      blockText(
        <pre>
          <code className="hljs language-csv">
            <span>a,b</span>
            {"\n"}
            <span>
              <span>1</span>,2
            </span>
          </code>
        </pre>,
        "csv",
      ),
    ).toBe("a,b\n1,2");
  });

  it("falls back to the first code block, then to whatever text there is", () => {
    expect(blockText(fence("text", "a,b"), "csv")).toBe("a,b");
    expect(blockText("a,b", "csv")).toBe("a,b");
  });
});

describe("formulasText", () => {
  it("is the text of the formulas fence, and nothing at all when there is none, where a block that is not tagged is the CSV", () => {
    expect(formulasText([fence("csv", "a,b\n1,2"), fence("formulas", "B2 =A2+1")])).toBe("B2 =A2+1");
    expect(formulasText(fence("csv", "a,b\n1,2"))).toBe("");
    expect(formulasText(fence("text", "a,b"))).toBe("");
    expect(formulasText("a,b")).toBe("");
  });
});

describe("Sheet", () => {
  afterEach(cleanup);

  const small = fence("csv", "Region,Units,Note\nWest,120,ok\nEast,80,#DIV/0!");

  it("is a table that says its size, with Excel's column letters, the header as row 1 and numbered rows", () => {
    render(<Sheet title="Q3 budget">{small}</Sheet>);

    expect(screen.getByRole("region", { name: "Q3 budget: 2 rows by 3 columns" })).toBeTruthy();
    const table = screen.getByRole("table");
    expect(table.getAttribute("aria-rowcount")).toBe("3");
    // One more than the sheet has: the column of row numbers.
    expect(table.getAttribute("aria-colcount")).toBe("4");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["ARegion", "BUnits", "CNote"]);
    expect(screen.getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["1", "2", "3"]);
  });

  it("gives the header and the row numbers an opaque background, since rows scroll beneath them", () => {
    render(<Sheet>{small}</Sheet>);

    // A scheme's muted colour is a faint tint, so the page's background has to be under it.
    for (const cell of [...screen.getAllByRole("columnheader"), ...screen.getAllByRole("rowheader")]) {
      expect(cell.className).toContain("bg-background");
    }
  });

  it("captions the table with its title, and has no caption without one", () => {
    const { unmount } = render(<Sheet title="Q3 budget">{small}</Sheet>);
    expect(screen.getByText("Q3 budget").tagName).toBe("FIGCAPTION");
    unmount();

    render(<Sheet>{small}</Sheet>);
    expect(document.querySelector("figcaption")).toBeNull();
    expect(screen.getByRole("region", { name: "Sheet: 2 rows by 3 columns" })).toBeTruthy();
  });

  it("sets numbers flush right and says an error is one", () => {
    render(<Sheet>{small}</Sheet>);

    expect(screen.getByRole("cell", { name: "120" }).className).toContain("text-right");
    expect(screen.getByRole("cell", { name: "West" }).className).not.toContain("text-right");
    expect(screen.getByRole("cell", { name: "#DIV/0!" }).className).toContain("text-destructive");
  });

  it("reads the csv fence, and a formulas fence after it is not drawn as cells", () => {
    render(
      <Sheet>
        {fence("csv", "a,b\n1,2")}
        {fence("formulas", "B2 =A2+10")}
      </Sheet>,
    );

    expect(screen.getByRole("region", { name: "Sheet: 1 row by 2 columns" })).toBeTruthy();
    expect(screen.queryByText(/=A2\+10/)).toBeNull();
  });

  describe("formulas", () => {
    const budget = (formulas: string) => (
      <Sheet>
        {fence("csv", "Units,Price,Revenue\n2,3,\n5,7,")}
        {fence("formulas", formulas)}
      </Sheet>
    );

    it("calculates the formulas block, and each cell shows its result in place of what the CSV had", () => {
      render(budget("C2 =A2*B2\nC3 =A3*B3"));

      expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["2", "3", "6", "5", "7", "35"]);
    });

    it("sets a calculated number flush right and shows an error as one", () => {
      render(budget("C2 =A2*B2\nC3 =A3/0"));

      expect(screen.getByRole("cell", { name: "6" }).className).toContain("text-right");
      expect(screen.getByRole("cell", { name: "#DIV/0!" }).className).toContain("text-destructive");
    });

    it("shows a cell's formula when it is pointed at, and a long cell's text only where there is no formula", () => {
      render(budget("C2 =A2*B2"));

      expect(screen.getByRole("cell", { name: "6" }).getAttribute("title")).toBe("=A2*B2");
      expect(screen.getByRole("cell", { name: "7" }).getAttribute("title")).toBeNull();
    });

    it("lets a formula use a cell that is a formula, whatever order the block lists them in", () => {
      render(budget("C3 =C2+A3\nC2 =A2*B2"));

      expect(screen.getByRole("cell", { name: "11" })).toBeTruthy();
    });

    it("says what it could not calculate: the cell is #NAME?, and pointing at it says why", () => {
      render(budget("C2 =FILTER(A2:A3,TRUE)\nC3 =C2+1"));

      const cells = screen.getAllByRole("cell", { name: "#NAME?" });
      expect(cells).toHaveLength(2);
      expect(cells[0].className).toContain("text-destructive");
      expect(cells[0].getAttribute("title")).toBe("=FILTER(A2:A3,TRUE)\nNot calculated: the function FILTER");
      expect(cells[1].getAttribute("title")).toContain("Not calculated: the function FILTER");
    });

    it("says which lines of the formulas block it could not read, and calculates the rest", () => {
      render(budget("C2 =A2*B2\nthis is not one\nC3 A3*B3\n\n"));

      expect(screen.getByRole("cell", { name: "6" })).toBeTruthy();
      expect(screen.getByText(/2 lines that are not a cell and a formula \(line 2, 3\)/)).toBeTruthy();
    });

    it("says nothing about formulas of a sheet that has none", () => {
      render(<Sheet>{fence("csv", "a,b\n1,2")}</Sheet>);

      expect(screen.queryByText(/formulas block/)).toBeNull();
      expect(screen.getByRole("cell", { name: "2" }).getAttribute("title")).toBeNull();
    });

    it("sizes the columns by what the formulas came to", () => {
      render(
        <Sheet>
          {fence("csv", "a,b\n1,")}
          {fence("formulas", 'B2 =REPT("x",30)')}
        </Sheet>,
      );

      expect(screen.getByRole("cell", { name: "x".repeat(30) })).toBeTruthy();
      expect(document.querySelectorAll("col")[2].getAttribute("style")).toContain("32ch");
    });
  });

  it("draws a header with no rows below it", () => {
    render(<Sheet>{fence("csv", "a,b")}</Sheet>);

    expect(screen.getByRole("region", { name: "Sheet: 0 rows by 2 columns" })).toBeTruthy();
  });

  it("shows a notice in place of a sheet it can't draw", () => {
    render(<Sheet />);

    expect(screen.getByRole("img", { name: "Sheet not drawn" }).textContent).toMatch(/add a ```csv block/);
  });

  it("limits how tall it is, 360 pixels unless the height says otherwise", () => {
    const { unmount } = render(<Sheet>{small}</Sheet>);
    expect(screen.getByRole("region").style.maxHeight).toBe("360px");
    unmount();

    render(<Sheet height="500">{small}</Sheet>);
    expect(screen.getByRole("region").style.maxHeight).toBe("500px");
  });

  it("shows a long cell in full as a tooltip, and only a long one", () => {
    render(<Sheet>{fence("csv", `a,b\n${"x".repeat(60)},y`)}</Sheet>);

    expect(screen.getByRole("cell", { name: "x".repeat(60) }).getAttribute("title")).toBe("x".repeat(60));
    expect(screen.getByRole("cell", { name: "y" }).getAttribute("title")).toBeNull();
  });

  it("says when the sheet is big enough that the editor stops colouring the note", () => {
    const { unmount } = render(<Sheet>{fence("csv", bigCsv(10))}</Sheet>);
    expect(screen.queryByText(/stops colouring/)).toBeNull();
    unmount();

    render(<Sheet>{fence("csv", `a\n${"x".repeat(100_001)}`)}</Sheet>);
    expect(screen.getByText(/100,00[0-9] characters.*stops colouring/).textContent).toContain("Past 100,000");
  });

  describe("a long sheet", () => {
    it("draws every row of a short one, which the preview's find can then search", () => {
      render(<Sheet>{fence("csv", bigCsv(100))}</Sheet>);

      expect(screen.getAllByRole("rowheader")).toHaveLength(101);
    });

    it("draws only the rows near the top, whatever its length, and says how many there are", () => {
      render(<Sheet>{fence("csv", bigCsv(5000))}</Sheet>);

      expect(screen.getByRole("table").getAttribute("aria-rowcount")).toBe("5001");
      const drawn = screen.getAllByRole("rowheader").length;
      expect(drawn).toBeGreaterThan(20);
      expect(drawn).toBeLessThan(60);
      expect(screen.getByRole("rowheader", { name: "2" })).toBeTruthy();
      expect(screen.queryByRole("rowheader", { name: "3000" })).toBeNull();
    });

    it("moves the window as it scrolls, keeping each row's own number and the table's height", () => {
      render(<Sheet>{fence("csv", bigCsv(5000))}</Sheet>);
      const region = screen.getByRole("region");
      const heightBefore = [...document.querySelectorAll("tbody > tr")].reduce((total, tr) => total + ((tr as HTMLElement).style.height ? parseInt((tr as HTMLElement).style.height, 10) : 0), 0);

      fireEvent.scroll(region, { target: { scrollTop: 5000 } });

      expect(screen.queryByRole("rowheader", { name: "2" })).toBeNull();
      const row = screen.getByRole("rowheader", { name: "181" }).closest("tr")!;
      expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(["180", "32400"]);
      expect(row.getAttribute("aria-rowindex")).toBe("181");
      const heightAfter = [...document.querySelectorAll("tbody > tr")].reduce((total, tr) => total + parseInt((tr as HTMLElement).style.height || "0", 10), 0);
      expect(heightAfter).toBe(heightBefore);
    });

    it("draws the last rows when scrolled to the end", () => {
      render(<Sheet>{fence("csv", bigCsv(5000))}</Sheet>);

      fireEvent.scroll(screen.getByRole("region"), { target: { scrollTop: 5000 * 28 } });

      expect(screen.getByRole("rowheader", { name: "5001" })).toBeTruthy();
    });
  });
});
