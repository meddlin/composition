import { describe, expect, it } from "vitest";
import { failuresOf, pageErrorsOf, summarize } from "./summarize.mjs";

// Step names are the ones measure.mjs writes. If it renames one, the row it fed goes missing and a test here says so.
const step = (name: string, extra: Record<string, unknown> = {}) => ({ name, ms: 1000, blockedMs: 800, longTasks: 1, maxLongMs: 800, ...extra });

function run(scale: number, overrides: { failed?: string; unfinished?: boolean; errors?: string[] } = {}) {
  const steps: Record<string, unknown>[] = [
    { name: "load /", htmlMB: 8.1 * scale, interactiveMs: 1391 * scale, maxLongMs: 316 * scale, domNodes: 13847 * scale, jsHeapMB: 55 * scale, errors: overrides.errors },
    step("sidebar: collapse all groups", { ms: 217 * scale }),
    step("sidebar: expand all groups", { ms: 430 * scale }),
    step("sidebar: sort -> Created: newest", { ms: 590 * scale }),
    step("sidebar: sort -> Custom", { ms: 619 * scale }),
    step("sidebar: switch notebook -> Work", { ms: 205 * scale }),
    step("sidebar: switch notebook -> Main", { ms: 463 * scale }),
    step('open: regular note B ("Malesuada")', { ms: 191 * scale }),
    step("tab: -> Markdown", { ms: 400 * scale }),
    step("tab: -> Preview", { ms: 700 * scale }),
    step("tab: -> Split (restore)", { ms: 99_000 }), // not one of the four tab switches: must not be counted
    step("typing: Markdown tab, regular note", { keyLatencyMs: { n: 22, p50: 134 * scale, p95: 200, max: 330, mean: 150 } }),
    step("typing: Split tab, regular note", { keyLatencyMs: { n: 22, p50: 133 * scale, p95: 175, max: 191, mean: 140 } }),
    step("typing: Live tab, regular note", { keyLatencyMs: { n: 22, p50: 131 * scale, p95: 195, max: 280, mean: 140 } }),
    step("autosave: edit regular note, wait for save round trip", { blockedMs: 725 * scale, saves: [{ ms: 292 * scale, reqKB: 2, resKB: 4875 * scale, status: 200 }] }),
    step("link picker: type '[[' + 'lorem' (title filter over all notes)", { keyLatencyMs: { n: 7, p50: 130 * scale, p95: 268, max: 268, mean: 133 } }),
    step("page: Home", { ms: 338 * scale }),
    step("page: Settings (full navigation)", { ms: 282 * scale }),
  ];
  if (overrides.failed) steps.push({ name: "typing: Live tab, regular note", failed: overrides.failed });
  return { steps, ...(overrides.unfinished ? {} : { finishedAt: "2026-11-08T04:00:00.000Z" }) };
}

describe("summarize", () => {
  it("puts each run in its own column, in the units a person reads", () => {
    const { markdown, failures } = summarize([
      { label: "1k", run: run(1) },
      { label: "10k", run: run(10) },
    ]);

    expect(markdown).toContain("| | 1k | 10k |");
    expect(markdown).toContain("| First page (HTML) | 8.1 MB | 81 MB |");
    expect(markdown).toContain("| Until a click works | 1.4 s | 14 s |");
    expect(markdown).toContain("| DOM nodes after load | 13,847 | 138,470 |");
    expect(markdown).toContain("| Keystroke, Markdown tab (median) | 134 ms | 1340 ms |");
    expect(markdown).toContain("| Link picker keystroke (median) | 130 ms | 1300 ms |");
    expect(markdown).toContain("| Autosave response | 4.8 MB | 48 MB |");
    expect(markdown).toContain("| Collapse all groups | 0.2 s | 2.2 s |");
    expect(failures).toEqual([]);
    expect(markdown).toContain("Every step completed");
  });

  it("takes the slowest of a group of steps, and leaves the restore step out of the tab switches", () => {
    const { markdown } = summarize([{ label: "1k", run: run(1) }]);

    expect(markdown).toContain("| Switch editor tab (slowest) | 0.7 s |");
    expect(markdown).toContain("| Change the sort (slowest) | 0.6 s |");
    expect(markdown).toContain("| Switch notebook (slowest) | 0.5 s |");
  });

  it("leaves out a row nothing measured, and shows a dash where only one run has the number", () => {
    const quick = { steps: [{ name: "load /", htmlMB: 8.1, interactiveMs: 1391, maxLongMs: 316, domNodes: 13847, jsHeapMB: 55 }], finishedAt: "x" };
    const { markdown } = summarize([
      { label: "1k", run: quick },
      { label: "10k", run: run(10) },
    ]);

    expect(markdown).toContain("| Home page | – | 3.4 s |");
    expect(summarize([{ label: "1k", run: quick }]).markdown).not.toContain("Home page");
  });

  it("reports a timed-out step, an unfinished run and a harness failure as failures", () => {
    const timedOut = run(1, { failed: "TIMEOUT after 240s: typing: Live tab" });
    const stopped = run(1, { unfinished: true });
    const broken = { steps: [], fatal: "Error: browser closed\n    at x" };

    expect(failuresOf(timedOut)).toEqual(["typing: Live tab, regular note: TIMEOUT after 240s: typing: Live tab"]);
    expect(failuresOf(stopped)).toEqual(["the run stopped before its end"]);
    expect(failuresOf(broken)).toEqual(["the harness itself failed: Error: browser closed"]);

    const { markdown, failures } = summarize([
      { label: "1k", run: timedOut },
      { label: "10k", run: stopped },
    ]);
    expect(failures.map((f) => f.label)).toEqual(["1k", "10k"]);
    expect(markdown).toContain("### Failed");
    expect(markdown).toContain("- **1k**: typing: Live tab, regular note: TIMEOUT");
    expect(markdown).not.toContain("Every step completed");
  });

  it("lists page errors once each without failing the run", () => {
    const error = "pageerror: Minified React error #418; visit https://react.dev/errors/418?args[]=text";
    const withErrors = run(1, { errors: [error, error] });

    expect(pageErrorsOf(withErrors)).toHaveLength(1);
    const { markdown, failures } = summarize([{ label: "50k", run: withErrors }]);
    expect(failures).toEqual([]);
    expect(markdown).toContain("### Page errors logged");
    expect(markdown).toContain("**50k**: `pageerror: Minified React error #418");
  });
});

describe("summarize, line-count notes", () => {
  const linesRun = (extra: Record<string, unknown>[] = []) => ({
    steps: [
      { name: "load /", htmlMB: 2, interactiveMs: 900, maxLongMs: 100, domNodes: 1000, jsHeapMB: 20 },
      // Deliberately out of order: the columns must come out smallest first.
      step("lines[LINES: 10,000 lines] open (Split)", { ms: 14_200 }),
      step("lines[LINES: 10,000 lines] typing, Split", { keyLatencyMs: { n: 3, p50: 9_800, p95: 9_900, max: 9_900, mean: 9_800 } }),
      step("lines[LINES: 500 lines] open (Split)", { ms: 450 }),
      step("lines[LINES: 500 lines] typing, Split", { keyLatencyMs: { n: 10, p50: 61, p95: 80, max: 90, mean: 64 } }),
      step("lines[LINES: 500 lines] switch to Markdown", { ms: 120 }),
      step("lines[LINES: 5,000 lines] open (Split)", { ms: 2_300 }),
      step("lines[LINES: 5,000 lines] typing, Split", { keyLatencyMs: { n: 10, p50: 700, p95: 800, max: 900, mean: 710 } }),
      ...extra,
    ],
    finishedAt: "2026-11-08T04:00:00.000Z",
  });

  it("makes a column for each line count, smallest first, with the units a person reads", () => {
    const { markdown, failures } = summarize([{ label: "lines", run: linesRun() }]);

    expect(failures).toEqual([]);
    expect(markdown).toContain("### Note line counts");
    expect(markdown).toContain("| | 500 lines | 5,000 lines | 10,000 lines |");
    expect(markdown).toContain("| Open (Split tab) | 0.5 s | 2.3 s | 14 s |");
    expect(markdown).toContain("| Keystroke, Split (median / worst) | 61 ms / 90 ms | 700 ms / 900 ms | 9.8 s / 9.9 s (3 of 10 keys) |");
    // Not measured for the other notes: a dash, not a made-up number.
    expect(markdown).toContain("| Switch to Markdown | 0.1 s | – | – |");
  });

  it("says when the typing ran out of time before all ten keys", () => {
    const { markdown } = summarize([{ label: "lines", run: linesRun() }]);

    expect(markdown).toContain("(3 of 10 keys)");
    expect(markdown).not.toContain("90 ms (");
  });

  it("shows a failed step as failed, and lists it among the failures", () => {
    const timedOut = linesRun([{ name: "lines[LINES: 10,000 lines] switch to Live", failed: "TIMEOUT after 180s" }]);
    const { markdown, failures } = summarize([{ label: "lines", run: timedOut }]);

    expect(markdown).toContain("| Switch to Live | – | – | failed |");
    expect(failures[0].problems).toEqual(["lines[LINES: 10,000 lines] switch to Live: TIMEOUT after 180s"]);
  });

  it("names the run above each table when several runs have line-count notes, and omits the table when none does", () => {
    const both = summarize([
      { label: "lines", run: linesRun() },
      { label: "lines-plain", run: linesRun() },
    ]).markdown;
    const neither = summarize([{ label: "1k", run: run(1) }]).markdown;

    expect(both).toContain("### Note line counts (lines)");
    expect(both).toContain("### Note line counts (lines-plain)");
    expect(neither).not.toContain("line counts");
  });

  it("reports a database with no line-count notes as a failure of the section", () => {
    const empty = { steps: [{ name: "lines: find the line-count notes", failed: "no `LINES: N lines` notes in this database" }], finishedAt: "x" };

    expect(summarize([{ label: "lines", run: empty }]).failures).toHaveLength(1);
  });
});
