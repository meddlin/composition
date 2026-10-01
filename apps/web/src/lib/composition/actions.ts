"use server";

import { revalidatePath } from "next/cache";
import type {
  MoveGroupResult,
  SaveImageInput,
  SaveImageResult,
  SaveLocationResult,
  SaveSettingsInput,
  SaveSettingsResult,
  SearchResult,
  SettingsSnapshot,
  Workspace,
} from "./api";
import type { Favorites } from "./favorites";
import type { Group } from "./groupsRepo";
import type { Layout } from "./layout";
import type { Note } from "./notesRepo";
import * as service from "./service";
import type { SunSchedule } from "./sunTimes";
import type { RestoreResult, Trash } from "./trash";

/**
 * The web app's transport for CompositionApi (see api.ts): Server Actions that
 * delegate to the framework-free service and then invalidate Next's cache.
 * All logic lives in service.ts.
 */

export async function loadWorkspace(): Promise<Workspace> {
  return service.loadWorkspace();
}

export async function loadSettings(): Promise<SettingsSnapshot> {
  return service.loadSettings();
}

export async function searchNotes(query: string): Promise<SearchResult> {
  return service.searchNotes(query);
}

export async function saveNoteContent(noteId: number, content: string): Promise<Note> {
  const note = await service.saveNoteContent(noteId, content);
  revalidatePath("/");
  return note;
}

// No revalidatePath: storing a file changes nothing the page renders until the
// note's own content (which refers to it) is saved.
export async function saveImage(input: SaveImageInput): Promise<SaveImageResult> {
  return service.saveImage(input);
}

export async function createNote(
  title: string,
  groupId: number | null = null,
): Promise<Note> {
  const note = await service.createNote(title, groupId);
  revalidatePath("/");
  return note;
}

export async function deleteNote(id: number): Promise<void> {
  await service.deleteNote(id);
  revalidatePath("/");
}

export async function createGroup(
  name: string,
  parentId: number | null,
): Promise<Group> {
  const group = await service.createGroup(name, parentId);
  revalidatePath("/");
  return group;
}

export async function renameGroup(id: number, name: string): Promise<Group> {
  const group = await service.renameGroup(id, name);
  revalidatePath("/");
  return group;
}

export async function deleteGroup(id: number): Promise<{ error?: string }> {
  const result = await service.deleteGroup(id);
  if (!result.error) revalidatePath("/");
  return result;
}

export async function moveGroup(
  id: number,
  parentId: number | null,
): Promise<MoveGroupResult> {
  const result = await service.moveGroup(id, parentId);
  if (result.group) revalidatePath("/");
  return result;
}

export async function moveNoteToGroup(
  noteId: number,
  groupId: number | null,
): Promise<Note> {
  const note = await service.moveNoteToGroup(noteId, groupId);
  revalidatePath("/");
  return note;
}

export async function loadTrash(): Promise<Trash> {
  return service.loadTrash();
}

// Restoring changes what the notes workspace lists; deleting for good changes only the Trash Can.
export async function restoreNote(id: number): Promise<RestoreResult> {
  const result = await service.restoreNote(id);
  if (!result.error) revalidatePath("/");
  return result;
}

export async function restoreGroup(id: number): Promise<RestoreResult> {
  const result = await service.restoreGroup(id);
  if (!result.error) revalidatePath("/");
  return result;
}

export async function permanentlyDeleteNote(id: number): Promise<void> {
  await service.permanentlyDeleteNote(id);
}

export async function permanentlyDeleteGroup(id: number): Promise<void> {
  await service.permanentlyDeleteGroup(id);
}

export async function saveLayout(layout: Layout): Promise<void> {
  await service.saveLayout(layout);
  revalidatePath("/");
}

// No revalidatePath: the workspace keeps its own copy of the pins, same as the layout's
// optimistic updates, and re-renders from it.
export async function saveFavorites(favorites: Favorites): Promise<void> {
  await service.saveFavorites(favorites);
}

export async function saveSettings(input: SaveSettingsInput): Promise<SaveSettingsResult> {
  const result = await service.saveSettings(input);
  if (result.success) {
    revalidatePath("/settings");
    revalidatePath("/");
  }
  return result;
}

export async function saveTheme(theme: string): Promise<{ error?: string }> {
  const result = await service.saveTheme(theme);
  if (!result.error) {
    revalidatePath("/settings");
    revalidatePath("/");
  }
  return result;
}

export async function saveLocation(city: string): Promise<SaveLocationResult> {
  const result = await service.saveLocation(city);
  if (!result.error) {
    revalidatePath("/settings");
    revalidatePath("/");
  }
  return result;
}

export async function loadSunSchedule(): Promise<SunSchedule | null> {
  return service.loadSunSchedule();
}
