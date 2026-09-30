"use server";

import { revalidatePath } from "next/cache";
import * as frontmatter from "./frontmatter";
import * as groupsRepo from "./groupsRepo";
import { GroupNotEmptyError } from "./groupsRepo";
import type { Group } from "./groupsRepo";
import * as notesRepo from "./notesRepo";
import type { Note } from "./notesRepo";
import * as searchIndex from "./searchIndex";

/**
 * Indexing is derived state (docs/architecture/search.md): a Meilisearch outage
 * must never fail or roll back a write, so errors are logged and swallowed.
 */
async function bestEffortIndex(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error("[search] indexing failed:", error);
  }
}

export type SearchHit = { id: number; title: string; description: string };

export type SearchResult = { hits: SearchHit[]; error?: string };

/**
 * Never throws: an unreachable Meilisearch comes back as `error` (no hits) so
 * the UI can say "unavailable" instead of a misleading "No matches".
 */
export async function searchNotes(query: string): Promise<SearchResult> {
  try {
    const ids = await searchIndex.searchNoteIds(query);
    const hits: SearchHit[] = [];
    for (const id of ids) {
      const note = notesRepo.getNote(id);
      if (note) hits.push({ id: note.id, title: note.title, description: note.description });
    }
    return { hits };
  } catch (error) {
    console.error("[search] query failed:", error);
    return {
      hits: [],
      error: `Search is unavailable. Is Meilisearch running at ${searchIndex.meiliHost()}?`,
    };
  }
}

/**
 * Mirrors EditorScreen._save() / docs/architecture/note-lifecycle.md: parse
 * whatever frontmatter the user is currently typing and reconcile it back
 * into the Note row, without ever crashing on a mid-edit YAML block.
 */
export async function saveNoteContent(noteId: number, content: string): Promise<Note> {
  const [fm, body] = frontmatter.parse(content);

  if (fm === null) {
    notesRepo.updateNoteContent(noteId, content);
  } else {
    const previous = notesRepo.getNote(noteId);
    if (!previous) throw new Error(`Note ${noteId} not found`);

    const reconciled: frontmatter.Frontmatter = {
      title: fm.title || previous.title,
      description: fm.description,
      tags: fm.tags,
      createdAt: fm.createdAt || previous.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const rendered = frontmatter.render(reconciled, body);
    notesRepo.updateNote(noteId, rendered, {
      title: reconciled.title,
      tags: frontmatter.tagsToString(reconciled.tags),
      description: reconciled.description,
    });
  }

  revalidatePath("/");
  const note = notesRepo.getNote(noteId);
  if (!note) throw new Error(`Note ${noteId} not found`);
  await bestEffortIndex(() => searchIndex.indexNote(note));
  return note;
}

export async function createNote(title: string): Promise<Note> {
  const note = notesRepo.createNote(title);
  revalidatePath("/");
  await bestEffortIndex(() => searchIndex.indexNote(note));
  return note;
}

export async function deleteNote(id: number): Promise<void> {
  notesRepo.deleteNote(id);
  revalidatePath("/");
  await bestEffortIndex(() => searchIndex.deleteNoteFromIndex(id));
}

export async function createGroup(
  name: string,
  parentId: number | null,
): Promise<Group> {
  const group = groupsRepo.createGroup(name, parentId);
  revalidatePath("/");
  return group;
}

export async function renameGroup(id: number, name: string): Promise<Group> {
  groupsRepo.renameGroup(id, name);
  revalidatePath("/");
  const group = groupsRepo.getGroup(id);
  if (!group) throw new Error(`Group ${id} not found`);
  return group;
}

/**
 * Returns an error message instead of throwing on GroupNotEmptyError, so a
 * race (another tab added a note to this group mid-delete) surfaces as
 * inline feedback rather than a crashed action.
 */
export async function deleteGroup(id: number): Promise<{ error?: string }> {
  try {
    groupsRepo.deleteGroup(id);
  } catch (error) {
    if (error instanceof GroupNotEmptyError) {
      return { error: "This group still has sub-groups or notes — empty it first." };
    }
    throw error;
  }
  revalidatePath("/");
  return {};
}

export async function moveNoteToGroup(
  noteId: number,
  groupId: number | null,
): Promise<Note> {
  notesRepo.setNoteGroup(noteId, groupId);
  revalidatePath("/");
  const note = notesRepo.getNote(noteId);
  if (!note) throw new Error(`Note ${noteId} not found`);
  return note;
}
