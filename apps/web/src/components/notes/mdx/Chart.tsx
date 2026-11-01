import { Children, isValidElement, useMemo, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { parseChart, type ChartSpec } from "./chartData";

/**
 * Series colours, from the active colour scheme so a chart matches the note it is in. Each is a
 * theme token (not a hex value), which is why the same chart reads in every scheme.
 */
const SERIES_COLORS = [
  "var(--primary)",
  "var(--success)",
  "var(--warning)",
  "var(--destructive)",
  "color-mix(in srgb, var(--primary) 55%, var(--success))",
  "color-mix(in srgb, var(--warning) 60%, var(--destructive))",
];
const colorOf = (index: number) => SERIES_COLORS[index % SERIES_COLORS.length];

const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 800;

/** `height="360"` as pixels; anything else (or out of range) is the default, so a half-typed value still draws. */
function heightOf(value: string | undefined): number {
  const pixels = Number.parseInt(value ?? "", 10);
  return Number.isFinite(pixels) ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, pixels)) : DEFAULT_HEIGHT;
}

/**
 * The text inside a tag's children. The CSV block arrives as a rendered `<pre><code>` (with the
 * preview's own source spans and syntax-highlighting spans inside it), so the text is collected
 * from whatever elements wrap it.
 */
export function textOf(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement<{ children?: ReactNode }>(child)) return textOf(child.props.children);
      return "";
    })
    .join("");
}

const AXIS = { stroke: "var(--muted-foreground)", fontSize: 12 } as const;
const GRID_STROKE = "var(--border)";
const TOOLTIP_STYLE = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
} as const;

function Plot({ spec, height }: { spec: ChartSpec; height: number }) {
  const { type, x, y, rows } = spec;
  const legend = y.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null;

  if (type === "pie") {
    const value = y[0];
    return (
      <PieChart>
        <Pie data={rows} dataKey={value} nameKey={x} outerRadius={Math.round(height / 2.6)} isAnimationActive={false} stroke="var(--background)">
          {rows.map((_, index) => (
            <Cell key={index} fill={colorOf(index)} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    );
  }

  const axes = (
    <>
      <CartesianGrid stroke={GRID_STROKE} vertical={false} />
      <XAxis dataKey={x} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
      <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} />
      <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--accent)" }} />
      {legend}
    </>
  );

  switch (type) {
    case "line":
      return (
        <LineChart data={rows}>
          {axes}
          {y.map((name, index) => (
            <Line key={name} type="monotone" dataKey={name} stroke={colorOf(index)} strokeWidth={2} dot={rows.length <= 40} isAnimationActive={false} />
          ))}
        </LineChart>
      );
    case "area":
      return (
        <AreaChart data={rows}>
          {axes}
          {y.map((name, index) => (
            <Area key={name} type="monotone" dataKey={name} stroke={colorOf(index)} fill={colorOf(index)} fillOpacity={0.25} strokeWidth={2} isAnimationActive={false} />
          ))}
        </AreaChart>
      );
    default:
      return (
        <BarChart data={rows}>
          {axes}
          {y.map((name, index) => (
            <Bar key={name} dataKey={name} fill={colorOf(index)} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      );
  }
}

const notice = (text: string) => (
  <span role="img" aria-label="Chart not drawn" className="not-prose my-4 block text-muted-foreground italic">
    {text}
  </span>
);

/**
 * A chart of a table, written in a note as a CSV block inside the tag:
 *
 *     <Chart type="line" x="month" y="sales,costs" title="2026">
 *
 *     ```csv
 *     month,sales,costs
 *     Jan,10,7
 *     ```
 *
 *     </Chart>
 *
 * `type` is bar (the default), line, area or pie; `x` and `y` name the columns; `title` captions it
 * and `height` is in pixels. How the table is read, and what is said when it can't be, is in chartData.ts.
 * A chart that can't be drawn shows as a notice, like a missing image, rather than vanishing while the
 * block is half-typed.
 *
 * A figure that is a block, so the tag belongs on lines of its own (a chart can't sit inside a sentence).
 */
export function Chart({ type, x, y, title, height, children }: { type?: string; x?: string; y?: string; title?: string; height?: string; children?: ReactNode }) {
  const csv = textOf(children);
  const parsed = useMemo(() => parseChart({ type, x, y, csv }), [type, x, y, csv]);
  if (parsed.error !== undefined) return notice(parsed.error);

  const { spec } = parsed;
  const caption = title?.trim();
  const pixels = heightOf(height);
  const label = `${caption || "Chart"}: ${spec.type} chart of ${spec.y.join(", ")} by ${spec.x}, ${spec.rows.length} rows`;

  return (
    <figure className="not-prose my-4">
      {caption ? <figcaption className="mb-2 text-sm font-semibold">{caption}</figcaption> : null}
      <div role="img" aria-label={label} style={{ height: pixels }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: pixels }}>
          <Plot spec={spec} height={pixels} />
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
