import { getDb } from "./db";
import * as frontmatter from "./frontmatter";
import { createGroup, getGroup } from "./groupsRepo";
import { createNotebook, getNotebook } from "./notebooksRepo";
import { createNote, updateNote } from "./notesRepo";
import type { ReportKind, WeekReport } from "./todoReports";
import type { LocalDate, Period } from "./todoWeeks";

/**
 * Where the weekly cycle keeps its reports: a notebook of their own, with a group for each kind, and a note for each
 * report, with a link recorded in `todo_reports` (docs/todo-archival-plan.md, T9). Reports are ordinary notes, so the owner
 * can rename, move, edit or delete them; the cycle only ever adds.
 */

export const REPORTS_NOTEBOOK = "To-do reports";

const GROUP_NAMES: Record<ReportKind, string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly" };
const KINDS: ReportKind[] = ["weekly", "monthly", "quarterly"];

function placeId(place: string): number | undefined {
  const row = getDb().prepare("SELECT ref_id FROM todo_places WHERE place = ?").get(place) as { ref_id: number } | undefined;
  return row?.ref_id;
}

function setPlace(place: string, id: number): void {
  getDb().prepare("INSERT OR REPLACE INTO todo_places (place, ref_id) VALUES (?, ?)").run(place, id);
}

/**
 * The notebook and the groups the reports go in. They are found by the ids kept when they were made, so renaming them
 * changes nothing; one the owner has deleted is made again.
 */
export function reportPlaces(): { notebookId: number; groupIds: Record<ReportKind, number> } {
  return getDb().transaction(() => {
    let notebookId = placeId("notebook");
    if (notebookId === undefined || !getNotebook(notebookId)) {
      notebookId = createNotebook(REPORTS_NOTEBOOK).id;
      setPlace("notebook", notebookId);
    }
    const groupIds = {} as Record<ReportKind, number>;
    for (const kind of KINDS) {
      let groupId = placeId(kind);
      const group = groupId === undefined ? null : getGroup(groupId);
      if (groupId === undefined || !group || group.notebookId !== notebookId) {
        groupId = createGroup(GROUP_NAMES[kind], null, notebookId).id;
        setPlace(kind, groupId);
      }
      groupIds[kind] = groupId;
    }
    return { notebookId, groupIds };
  })();
}

/** The titles of the report notes that exist, so a new one is never given the same. */
export function reportTitles(): Set<string> {
  const rows = getDb().prepare("SELECT n.title AS title FROM todo_reports r JOIN notes n ON n.id = r.note_id").all() as { title: string }[];
  return new Set(rows.map((row) => row.title));
}

/** Makes the note for a report, in its group, with its text, and records the link. Returns the note's id. */
export function writeReportNote(report: {
  kind: ReportKind;
  period: Period;
  title: string;
  description: string;
  markdown: string;
  generatedAt: Date;
}): number {
  return getDb().transaction(() => {
    const { notebookId, groupIds } = reportPlaces();
    const tags = ["todo-report", report.kind];
    const note = createNote(report.title, frontmatter.tagsToString(tags), groupIds[report.kind], notebookId);
    const content = frontmatter.render(
      { title: report.title, description: report.description, tags, createdAt: note.createdAt, updatedAt: note.updatedAt },
      report.markdown,
    );
    updateNote(note.id, content, { title: report.title, tags: frontmatter.tagsToString(tags), description: report.description });
    getDb()
      .prepare("INSERT INTO todo_reports (kind, period_start, period_end, note_id, generated_at) VALUES (?, ?, ?, ?, ?)")
      .run(report.kind, report.period.start, report.period.end, note.id, report.generatedAt.toISOString());
    return note.id;
  })();
}

/** A report that exists: its note, and the period and moment recorded when it was made. */
export type ReportRow = { noteId: number; title: string; kind: ReportKind; period: Period; generatedAt: string };

/** Every report whose note still exists (a deleted one is gone, whatever link is left), newest period first, then newest copy. */
export function listReportRows(): ReportRow[] {
  const rows = getDb()
    .prepare(
      `SELECT n.id AS note_id, n.title AS title, r.kind AS kind, r.period_start AS period_start, r.period_end AS period_end, MAX(r.generated_at) AS generated_at
       FROM todo_reports r JOIN notes n ON n.id = r.note_id
       WHERE r.kind IN ('weekly', 'monthly', 'quarterly')
       GROUP BY n.id ORDER BY r.period_start DESC, generated_at DESC, n.id DESC`,
    )
    .all() as { note_id: number; title: string; kind: ReportKind; period_start: LocalDate; period_end: LocalDate; generated_at: string }[];
  return rows.map((row) => ({
    noteId: row.note_id,
    title: row.title,
    kind: row.kind,
    period: { start: row.period_start, end: row.period_end },
    generatedAt: row.generated_at,
  }));
}

/** The weekly reports as they stand now, edited or not: what the month's and the quarter's "My notes" are gathered from. */
export function weeklyReportTexts(): WeekReport[] {
  return listReportRows()
    .filter((row) => row.kind === "weekly")
    .map((row) => {
      const note = getDb().prepare("SELECT content FROM notes WHERE id = ?").get(row.noteId) as { content: string };
      return { week: row.period, generatedAt: row.generatedAt, markdown: note.content };
    });
}
