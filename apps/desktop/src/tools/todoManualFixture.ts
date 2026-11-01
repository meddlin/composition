import { getDb } from "../../../web/src/lib/composition/db";
import { makeReport } from "../../../web/src/lib/composition/todoReportMaker";
import { listReportRows } from "../../../web/src/lib/composition/todoReportsRepo";
import { todoSections, type TodoNode } from "../../../web/src/lib/composition/todos";
import * as repo from "../../../web/src/lib/composition/todosRepo";
import {
  addDays,
  fiscalQuarterOf,
  latestClosedMonth,
  latestClosedQuarter,
  latestClosedWeek,
  localDateOf,
  monthOf,
  weekOf,
  type DayOfWeek,
  type LocalDate,
} from "../../../web/src/lib/composition/todoWeeks";
import { isRetention, RETENTION_ERROR } from "../../../web/src/lib/composition/todoSettings";
import { loadWebSettings, saveWebSettings } from "../../../web/src/lib/composition/webSettings";

/**
 * The fixture behind the to-do manual test (docs/manual-tests/todo-archival.md). The weekly cycle runs on the real clock,
 * so to see a week close, or three at once, the database has to look as if the app had last run that long ago: each
 * scenario builds one, with every date relative to a clock (today, unless a test gives one). It is for a scratch home
 * only: it refuses a database that already holds to-dos.
 */

export const SCENARIOS = ["behind", "first-run", "archive", "retention"] as const;
export type Scenario = (typeof SCENARIOS)[number];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A local moment: a date, at an hour. */
function at(date: LocalDate, hour = 10): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day, hour, 0);
}

type Settings = { weekStartsOn: DayOfWeek; fiscalStartMonth: number };

function settings(): Settings {
  const { weekStartsOn, fiscalYearStartMonth } = loadWebSettings().todos;
  return { weekStartsOn, fiscalStartMonth: fiscalYearStartMonth };
}

/** Marks the week, month and quarter that ended last as closed: the app has nothing to catch up on. */
function closedThroughNow(today: LocalDate, { weekStartsOn, fiscalStartMonth }: Settings, now: Date): void {
  repo.markWeekClosed(latestClosedWeek(today, weekStartsOn), now);
  repo.markPeriodClosed("month", latestClosedMonth(today), now);
  repo.markPeriodClosed("quarter", latestClosedQuarter(today, fiscalStartMonth), now);
}

/** Open work, a branch in progress, a done parent with an open sub-item, a backlog item, work done in each closed period. */
function behind(weeks: number, now: Date): void {
  const today = localDateOf(now);
  const config = settings();
  const { weekStartsOn, fiscalStartMonth } = config;
  const first = addDays(latestClosedWeek(today, weekStartsOn).start, -7 * (weeks - 1)); // the first week to close at launch
  const weekStart = (index: number) => addDays(first, 7 * index);
  const before = addDays(first, -3);

  // The app last ran when the week before `first` had just ended, and the month and quarter before the last ones ended.
  repo.markWeekClosed(weekOf(addDays(first, -1), weekStartsOn), now);
  repo.markPeriodClosed("month", monthOf(addDays(latestClosedMonth(today).start, -1)), now);
  const lastQuarter = latestClosedQuarter(today, fiscalStartMonth);
  repo.markPeriodClosed("quarter", fiscalQuarterOf(addDays(lastQuarter.start, -1), fiscalStartMonth), now);

  repo.addTodo("Write the Q4 plan", null, at(before, 9));
  const trip = repo.addTodo("Plan trip", null, at(before, 9));
  repo.updateTodo(trip.id, { status: "in_progress" }, at(addDays(before, 1), 9));
  repo.addTodo("Book flights", trip.id, at(before, 9));

  const house = repo.addTodo("Move house", null, at(before, 9));
  repo.addTodo("Pack boxes", house.id, at(before, 9));
  repo.updateTodo(house.id, { done: true }, at(addDays(weekStart(0), 3), 15));

  const reply = repo.addTodo("Reply to vendor", null, at(before, 9));
  repo.updateTodo(reply.id, { done: true }, at(addDays(weekStart(0), 3), 14));
  const migration = repo.addTodo("Ship the migration", null, at(before, 9));
  repo.updateTodo(migration.id, { done: true }, at(addDays(weekStart(weeks - 1), 3), 14));

  const spanish = repo.addTodo("Someday: learn Spanish", null, at(before, 9));
  repo.updateTodo(spanish.id, { status: "backlog" }, at(before, 10));

  // Work done in the last quarter, so its report has something in it when the quarter closes.
  const audit = repo.addTodo("Quarter-end audit", null, at(addDays(lastQuarter.start, 2), 9));
  repo.updateTodo(audit.id, { done: true }, at(addDays(lastQuarter.start, 20), 15));
}

/** What an older version left: completed items with no history, no week closed yet. */
function firstRun(now: Date): void {
  const ago = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const insert = getDb().prepare("INSERT INTO todos (title, done, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
  insert.run("Reply to vendor", 1, "done", ago(30), ago(9));
  insert.run("Send invoice", 1, "done", ago(30), ago(8));
  insert.run("File expenses", 1, "done", ago(40), ago(20));
  insert.run("Write the Q4 plan", 0, "todo", ago(30), ago(30));
  insert.run("Call the bank", 0, "todo", ago(10), ago(10));
}

/** Archived items of every kind, up to date, and a weekly report that mentions the sensitive one. */
function archive(now: Date): void {
  const today = localDateOf(now);
  const config = settings();
  const { weekStartsOn } = config;
  const latest = latestClosedWeek(today, weekStartsOn);
  const earlier = weekOf(addDays(latest.start, -1), weekStartsOn);

  repo.addTodo("Buy milk", null, at(addDays(today, -2), 9));
  repo.addTodo("Write the Q4 plan", null, at(addDays(today, -2), 9));

  // Done in the second-to-last week and swept when it closed; its report names it.
  const salary = repo.addTodo("Prepare the salary talk", null, at(addDays(earlier.start, -1), 9));
  repo.updateTodo(salary.id, { done: true }, at(addDays(earlier.start, 3), 15));
  repo.closeWeek({ week: earlier, archive: [salary.id], roll: [] }, at(addDays(earlier.end, 1), 0));
  makeReport({ kind: "weekly", period: earlier }, now);

  const trip = repo.addTodo("Plan trip", null, at(addDays(latest.start, -3), 9));
  repo.addTodo("Book flights", trip.id, at(addDays(latest.start, -3), 9));
  repo.archiveTodoTree(trip.id, "removed", weekStartsOn, at(addDays(today, -1), 14));

  const idea = repo.addTodo("Old idea", null, at(addDays(latest.start, -3), 9));
  repo.archiveTodoTree(idea.id, "dropped", weekStartsOn, at(addDays(today, -1), 9));

  closedThroughNow(today, config, now);
}

/** Removed items of five ages, the oldest beyond the five years that is the default window. */
function retention(now: Date): void {
  const today = localDateOf(now);
  const config = settings();
  repo.addTodo("Buy milk", null, at(addDays(today, -2), 9));
  const ages: [string, number][] = [
    ["Removed six months ago", 6],
    ["Removed eighteen months ago", 18],
    ["Removed three years ago", 36],
    ["Removed four and a half years ago", 54],
    ["Removed six years ago", 72],
  ];
  for (const [title, months] of ages) {
    const past = new Date(now.getFullYear(), now.getMonth() - months, now.getDate(), 12);
    const item = repo.addTodo(title, null, past);
    repo.archiveTodoTree(item.id, "removed", config.weekStartsOn, past);
  }
  closedThroughNow(today, config, now);
}

/**
 * Builds a scenario in an empty database (see the manual test for what each one is for). `keepMonths` also sets how long
 * archived items are kept (`null`: forever), so that a launch purges at once: it purges only once a day, and the first launch
 * of a fresh home is the one that does.
 */
export function setupScenario(scenario: Scenario, options: { weeks?: number; now?: Date; keepMonths?: number | null } = {}): void {
  const { weeks = 3, now = new Date(), keepMonths } = options;
  if (!SCENARIOS.includes(scenario)) throw new Error(`There is no scenario "${scenario}". Use one of: ${SCENARIOS.join(", ")}.`);
  if (repo.listTodos().length + repo.listArchivedTodos().length > 0) {
    throw new Error("This database already has to-dos in it, so a scenario is not added to it. Use a scratch home.");
  }
  if (!Number.isInteger(weeks) || weeks < 1) throw new Error("A scenario can be a whole number of weeks behind, 1 or more.");
  if (keepMonths !== undefined) {
    if (!isRetention(keepMonths)) throw new Error(RETENTION_ERROR);
    const current = loadWebSettings();
    saveWebSettings({ ...current, todos: { ...current.todos, retentionMonths: keepMonths } });
  }
  getDb().transaction(() => {
    if (scenario === "behind") behind(weeks, now);
    else if (scenario === "first-run") firstRun(now);
    else if (scenario === "archive") archive(now);
    else retention(now);
  })();
}

/** Pretends `weeks` more weeks went by: the closed weeks are moved back, so the next launch closes that many again. */
export function ageWeeks(weeks: number): void {
  if (!Number.isInteger(weeks) || weeks < 1) throw new Error("Age the app by a whole number of weeks, 1 or more.");
  const db = getDb();
  db.transaction(() => {
    const rows = db.prepare("SELECT period_start, period_end, closed_at FROM todo_closed WHERE kind = 'week'").all() as {
      period_start: string;
      period_end: string;
      closed_at: string;
    }[];
    // Delete and put back, since moving rows one at a time can meet one that has not moved yet.
    db.prepare("DELETE FROM todo_closed WHERE kind = 'week'").run();
    const insert = db.prepare("INSERT INTO todo_closed (kind, period_start, period_end, closed_at) VALUES ('week', ?, ?, ?)");
    for (const row of rows) insert.run(addDays(row.period_start, -7 * weeks), addDays(row.period_end, -7 * weeks), row.closed_at);
  })();
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function lines(nodes: TodoNode[], depth: number, describe: (node: TodoNode) => string): string[] {
  return nodes.flatMap((node) => [`${"  ".repeat(depth + 1)}- ${describe(node)}`, ...lines(node.children, depth + 1, describe)]);
}

/** What the database holds, in the words the app uses, to be compared with what the app shows. */
export function describeState(): string[] {
  const { weekStartsOn, retentionMonths, fiscalYearStartMonth } = loadWebSettings().todos;
  const through = (kind: repo.PeriodKind) => repo.lastClosedPeriodEnd(kind) ?? "never";
  const sections = todoSections(repo.listTodos());
  const status = (node: TodoNode) => (node.todo.status === "todo" ? "" : ` · ${node.todo.status}`);
  const archived = repo.listArchivedTodos();
  const reports = listReportRows();
  return [
    `Settings: Weeks start on ${DAYS[weekStartsOn]} · ${retentionMonths === null ? "keep archived items forever" : `keep archived items for ${plural(retentionMonths, "month")}`} · fiscal year starts in month ${fiscalYearStartMonth}`,
    `Closed through: week ${through("week")} · month ${through("month")} · quarter ${through("quarter")}`,
    `Rolled over (${sections.rolledOver.length}):`,
    ...lines(sections.rolledOver, 0, (node) => `${node.todo.title}${status(node)} · from the week of ${node.todo.rolledFromWeek}, rolled ${node.todo.rollCount === 1 ? "once" : `${node.todo.rollCount} times`}`),
    `This week (${sections.thisWeek.length}):`,
    ...lines(sections.thisWeek, 0, (node) => `${node.todo.title}${status(node)}`),
    `Backlog (${sections.backlog.length}):`,
    ...lines(sections.backlog, 0, (node) => node.todo.title),
    `Archive (${archived.length}):`,
    ...archived.map((item) => `  - ${item.title} · ${item.archiveReason} · week of ${item.archiveWeek}`),
    `Reports (${reports.length}):`,
    ...reports.map((report) => `  - ${report.title}`),
  ];
}
