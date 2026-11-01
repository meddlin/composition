import { ageWeeks, describeState, SCENARIOS, setupScenario, type Scenario } from "./todoManualFixture";

/**
 * The commands of the to-do manual test, run against the scratch home that `scripts/todo-manual.mjs` points HOME and the settings
 * file at before starting this. See docs/manual-tests/todo-archival.md.
 */

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const [command] = process.argv.slice(2);

try {
  if (command === "setup") {
    const scenario = option("scenario") as Scenario | undefined;
    if (!scenario || !SCENARIOS.includes(scenario)) throw new Error(`setup needs --scenario, one of: ${SCENARIOS.join(", ")}.`);
    const weeks = option("weeks") === undefined ? undefined : Number(option("weeks"));
    const keep = option("keep");
    setupScenario(scenario, { weeks, keepMonths: keep === undefined ? undefined : keep === "forever" ? null : Number(keep) });
    console.log(`Set up the "${scenario}" scenario${scenario === "behind" ? `, ${weeks ?? 3} week(s) behind` : ""}.`);
  } else if (command === "age") {
    const weeks = Number(option("weeks"));
    ageWeeks(weeks);
    console.log(`Moved the closed weeks back ${weeks} week(s): the next launch closes that many again.`);
  } else if (command === "report") {
    console.log(describeState().join("\n"));
  } else {
    throw new Error(`Unknown command "${command ?? ""}".`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
