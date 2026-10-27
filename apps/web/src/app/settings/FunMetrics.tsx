import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Metrics } from "@/lib/composition/metrics";

const number = new Intl.NumberFormat("en-US");

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Just-for-fun numbers about what you've written and the space it takes. */
export function FunMetrics({ metrics }: { metrics: Metrics }) {
  const rows: [string, string][] = [
    ["Notes", number.format(metrics.noteCount)],
    ["Words written", number.format(metrics.words)],
    ["Characters written", number.format(metrics.characters)],
    ["Average words per note", number.format(metrics.averageWords)],
    ["Database on disk", formatBytes(metrics.databaseBytes)],
    ["Assets on disk", formatBytes(metrics.assetsBytes)],
    ["Media on disk", formatBytes(metrics.mediaBytes)],
  ];
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle
          role="heading"
          aria-level={2}
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Just for fun
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
