import { Children, isValidElement, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { textOf } from "./Chart";
import { SHEET_LARGE_CHARS, columnLabel, columnWidths, isErrorValue, isNumberCell, parseSheet, viewportHeight } from "./sheetData";

/** Every row is this tall, in pixels, which is what lets a long sheet draw only the rows in view. */
const ROW_PX = 28;
/** A sheet with up to this many rows below the header is drawn whole, so the preview's find can search all of it. */
const DRAW_ALL_UP_TO = 100;
/** Rows drawn beyond each edge of the window, so a fast scroll doesn't show blank rows before the next frame. */
const OVERSCAN = 10;
/**
 * The look of the header and the row numbers, which stay put while the rows go by underneath. A scheme's `--muted`
 * is a faint tint with no body (`color-mix(…, transparent)`), so it is laid over the page's own background:
 * on its own, the rows scrolling beneath would show through.
 */
const STUCK = "bg-background bg-[linear-gradient(var(--muted),var(--muted))]";

type Fence = { className?: string; children?: ReactNode };

function codeBlocks(children: ReactNode): ReactElement<Fence>[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<Fence>(child)) return [];
    return child.type === "code" ? [child] : codeBlocks(child.props.children);
  });
}

/**
 * The text of the fenced block tagged `language` inside a tag's children, so a block of another kind
 * beside it (the `formulas` one) can't run into it. Falls back to the first block, then to all the text,
 * as a block the author forgot to tag is still meant. The block arrives as a rendered `<pre><code>`, with
 * the preview's own source spans and syntax-colouring spans inside it.
 */
export function blockText(children: ReactNode, language: string): string {
  const blocks = codeBlocks(children);
  const wanted = blocks.find((block) => block.props.className?.split(/\s+/).includes(`language-${language}`)) ?? blocks[0];
  return textOf(wanted ? wanted.props.children : children);
}

const notice = (text: string) => (
  <span role="img" aria-label="Sheet not drawn" className="not-prose my-4 block text-muted-foreground italic">
    {text}
  </span>
);

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * A grid of a table, written in a note as a CSV block inside the tag (see sheetData.ts for how it is read):
 *
 *     <Sheet title="Q3 budget">
 *
 *     ```csv
 *     Region,Units
 *     West,120
 *     ```
 *
 *     </Sheet>
 *
 * `title` captions it and `height` is how tall it may grow, in pixels (360 by default), after which it scrolls.
 * Drawn like a spreadsheet: Excel's column letters over the header row, row numbers down the side (the header
 * is row 1), numbers flush right, the header and the numbers kept in view as it scrolls. A long sheet draws only
 * the rows in view (`ROW_PX` is what makes that work), so its size is not what it costs.
 *
 * A figure that is a block, so the tag belongs on lines of its own. One that can't be drawn shows as a notice,
 * like a missing image, rather than vanishing while the block is half-typed.
 */
export function Sheet({ title, height, children }: { title?: string; height?: string; children?: ReactNode }) {
  const csv = blockText(children, "csv");
  const parsed = useMemo(() => parseSheet(csv), [csv]);
  const widths = useMemo(() => (parsed.sheet ? columnWidths(parsed.sheet) : []), [parsed]);
  const [scrollTop, setScrollTop] = useState(0);
  if (parsed.error !== undefined) return notice(parsed.error);

  const { rows, columns } = parsed.sheet;
  const header = rows[0];
  const bodyRows = rows.length - 1;
  const viewport = viewportHeight(height);
  const caption = title?.trim();

  // The rows of the body to draw: all of a short sheet's, otherwise a window on the scroll position.
  const windowed = bodyRows > DRAW_ALL_UP_TO;
  const first = windowed ? Math.min(Math.max(0, Math.floor(scrollTop / ROW_PX) - OVERSCAN), bodyRows) : 0;
  const last = windowed ? Math.min(bodyRows, first + Math.ceil(viewport / ROW_PX) + 2 * OVERSCAN) : bodyRows;
  const spacer = (rowsAway: number) =>
    rowsAway > 0 ? (
      <tr aria-hidden="true" style={{ height: rowsAway * ROW_PX }}>
        <td colSpan={columns + 1} className="p-0" />
      </tr>
    ) : null;

  const gutter = `sticky left-0 border-r border-b ${STUCK} px-2 text-right text-xs font-normal text-muted-foreground`;
  const shown = [];
  for (let b = first; b < last; b++) {
    const row = rows[b + 1];
    shown.push(
      <tr key={b} aria-rowindex={b + 2} style={{ height: ROW_PX }}>
        <th scope="row" className={cn(gutter, "z-[1] h-7 py-0 leading-[27px]")}>
          {b + 2}
        </th>
        {row.map((cell, c) => (
          <td
            key={c}
            title={cell.length > widths[c] ? cell : undefined}
            className={cn(
              "h-7 overflow-hidden border-r border-b px-2 py-0 leading-[27px] text-ellipsis whitespace-nowrap",
              isNumberCell(cell) && "text-right",
              isErrorValue(cell) && "text-destructive",
            )}
          >
            {cell}
          </td>
        ))}
      </tr>,
    );
  }

  return (
    <figure className="not-prose my-4">
      {caption ? <figcaption className="mb-2 text-sm font-semibold">{caption}</figcaption> : null}
      <div
        role="region"
        aria-label={`${caption || "Sheet"}: ${count(bodyRows, "row")} by ${count(columns, "column")}`}
        tabIndex={0}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="overflow-auto rounded-md border bg-background text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        style={{ maxHeight: viewport }}
      >
        <table aria-rowcount={rows.length} aria-colcount={columns + 1} className="w-max min-w-full border-separate border-spacing-0 text-left tabular-nums" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "3.5rem" }} />
            {widths.map((chars, c) => (
              <col key={c} style={{ width: `${chars + 2}ch` }} />
            ))}
          </colgroup>
          <thead>
            <tr aria-rowindex={1}>
              <th scope="row" className={cn(gutter, "top-0 z-20 py-1")}>
                1
              </th>
              {header.map((name, c) => (
                <th key={c} scope="col" className={`sticky top-0 z-10 overflow-hidden border-r border-b ${STUCK} px-2 py-1 font-semibold text-ellipsis whitespace-nowrap`}>
                  <span className="block text-[10px] leading-3 font-normal text-muted-foreground">{columnLabel(c)}</span>
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spacer(first)}
            {shown}
            {spacer(bodyRows - last)}
          </tbody>
        </table>
      </div>
      {csv.length > SHEET_LARGE_CHARS ? (
        <p className="mt-1 text-xs text-muted-foreground">
          This sheet is {csv.length.toLocaleString("en-US")} characters. Past {SHEET_LARGE_CHARS.toLocaleString("en-US")} the editor stops colouring the note.
        </p>
      ) : null}
    </figure>
  );
}
