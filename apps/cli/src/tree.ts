import type { Group, Note } from "./backend";

/**
 * What the left-hand tree shows, as plain rows. Pure (no UI), so the ordering and the
 * collapsing rules can be tested; the terminal widget just draws these.
 */

export type TreeRow =
  | {
      kind: "group";
      key: string;
      /** null is the "Ungrouped" bucket, which isn't a real group. */
      groupId: number | null;
      label: string;
      depth: number;
      expanded: boolean;
    }
  | { kind: "note"; key: string; noteId: number; label: string; depth: number }
  | { kind: "settings"; key: "settings"; label: string; depth: 0 }
  | { kind: "message"; key: string; label: string; depth: 0 };

export const groupKey = (groupId: number | null): string => `group:${groupId ?? "ungrouped"}`;
export const noteKey = (noteId: number): string => `note:${noteId}`;

export type TreeInput = {
  /** In the order they should appear within a group: most recently edited first. */
  notes: readonly Note[];
  groups: readonly Group[];
  /** Keys (see `groupKey`) of the groups the user has folded away. */
  collapsed: ReadonlySet<string>;
  /** A search is narrowing `notes`: leave out groups with nothing matching. */
  filtering?: boolean;
};

export function buildTree({ notes, groups, collapsed, filtering = false }: TreeInput): TreeRow[] {
  const notesByGroup = new Map<number | null, Note[]>();
  for (const note of notes) {
    const list = notesByGroup.get(note.groupId) ?? [];
    list.push(note);
    notesByGroup.set(note.groupId, list);
  }

  const childrenOf = new Map<number | null, Group[]>();
  for (const group of groups) {
    const list = childrenOf.get(group.parentId) ?? [];
    list.push(group);
    childrenOf.set(group.parentId, list);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  /** Whether anything matching sits in this group or below it. */
  const hasNotes = (groupId: number): boolean =>
    (notesByGroup.get(groupId)?.length ?? 0) > 0 ||
    (childrenOf.get(groupId) ?? []).some((child) => hasNotes(child.id));

  const rows: TreeRow[] = [];

  const addNotes = (groupId: number | null, depth: number) => {
    for (const note of notesByGroup.get(groupId) ?? []) {
      rows.push({ kind: "note", key: noteKey(note.id), noteId: note.id, label: note.title, depth });
    }
  };

  const addGroup = (group: Group, depth: number) => {
    const key = groupKey(group.id);
    const expanded = !collapsed.has(key);
    rows.push({ kind: "group", key, groupId: group.id, label: group.name, depth, expanded });
    if (!expanded) return;
    for (const child of childrenOf.get(group.id) ?? []) {
      if (!filtering || hasNotes(child.id)) addGroup(child, depth + 1);
    }
    addNotes(group.id, depth + 1);
  };

  for (const group of childrenOf.get(null) ?? []) {
    if (!filtering || hasNotes(group.id)) addGroup(group, 0);
  }

  const ungrouped = notesByGroup.get(null) ?? [];
  if (filtering && notes.length === 0) {
    rows.push({ kind: "message", key: "message:no-matches", label: "No notes match.", depth: 0 });
  } else if (ungrouped.length > 0 || (groups.length === 0 && !filtering)) {
    const key = groupKey(null);
    const expanded = !collapsed.has(key);
    rows.push({ kind: "group", key, groupId: null, label: "Ungrouped", depth: 0, expanded });
    if (expanded) addNotes(null, 1);
  }

  rows.push({ kind: "settings", key: "settings", label: "⚙ Settings", depth: 0 });
  return rows;
}

/**
 * The group a new note or group should land in. A highlighted group contributes its own
 * id; a highlighted note, the group it is already in. Anything else means top level.
 */
export function targetGroupId(row: TreeRow | undefined, notesById: ReadonlyMap<number, Note>): number | null {
  if (!row) return null;
  if (row.kind === "group") return row.groupId;
  if (row.kind === "note") return notesById.get(row.noteId)?.groupId ?? null;
  return null;
}

/** Every group, parents before children and siblings by name, with how deep each one sits. */
export function orderedGroups(groups: readonly Group[]): { group: Group; depth: number }[] {
  const childrenOf = new Map<number | null, Group[]>();
  for (const group of groups) {
    const list = childrenOf.get(group.parentId) ?? [];
    list.push(group);
    childrenOf.set(group.parentId, list);
  }
  const ordered: { group: Group; depth: number }[] = [];
  const visit = (parentId: number | null, depth: number) => {
    for (const group of [...(childrenOf.get(parentId) ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
      ordered.push({ group, depth });
      visit(group.id, depth + 1);
    }
  };
  visit(null, 0);
  return ordered;
}
