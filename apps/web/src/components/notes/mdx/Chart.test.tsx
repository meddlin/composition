// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Chart, textOf } from "./Chart";

describe("textOf", () => {
  it("collects text through the elements a code block is rendered as", () => {
    expect(
      textOf(
        <pre>
          <code>
            <span>a,b</span>
            {"\n"}
            <span>
              <span>1</span>,2
            </span>
          </code>
        </pre>,
      ),
    ).toBe("a,b\n1,2");
  });
});

describe("Chart", () => {
  afterEach(cleanup);

  const table = (
    <pre>
      <code>{"month,sales\nJan,10\nFeb,12"}</code>
    </pre>
  );

  it("describes the chart for assistive tech and captions it", () => {
    render(
      <Chart type="line" title="Sales" y="sales">
        {table}
      </Chart>,
    );

    expect(screen.getByRole("img", { name: "Sales: line chart of sales by month, 2 rows" })).toBeTruthy();
    expect(screen.getByText("Sales").tagName).toBe("FIGCAPTION");
  });

  it("shows a notice in place of a chart it can't draw", () => {
    render(<Chart />);

    expect(screen.getByRole("img", { name: "Chart not drawn" }).textContent).toMatch(/add a ```csv block/);
  });

  it("names the column that isn't there", () => {
    render(<Chart x="week">{table}</Chart>);

    expect(screen.getByRole("img", { name: "Chart not drawn" }).textContent).toBe("Chart: no column named “week”. Columns: month, sales.");
  });
});
