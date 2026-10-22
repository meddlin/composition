"use server";

import { revalidatePath } from "next/cache";
import type { Attachment, AttachmentActionResult } from "./attachmentsApi";
import type {
  AssistantModels,
  ImageInfo,
  MoveGroupResult,
  SaveAssistantSettingsInput,
  SaveAssistantSettingsResult,
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
import type { Notebook } from "./notebooksRepo";
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

export async function listImages(): Promise<ImageInfo[]> {
  return service.listImages();
}

// Attachments are listed and removed through Server Actions; their bytes travel
// by the route handlers in app/api (upload and download), which can stream.
export async function listAttachments(noteId: number): Promise<Attachment[]> {
  return service.listAttachments(noteId);
}

export async function removeAttachment(id: number): Promise<AttachmentActionResult> {
  return service.removeAttachment(id);
}

export async function createNote(
  title: string,
  groupId: number | null = null,
  notebookId: number | null = null,
): Promise<Note> {
  const note = await service.createNote(title, groupId, notebookId);
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
  notebookId: number | null = null,
): Promise<Group> {
  const group = await service.createGroup(name, parentId, notebookId);
  revalidatePath("/");
  return group;
}

export async function createNotebook(name: string): Promise<Notebook> {
  const notebook = await service.createNotebook(name);
  revalidatePath("/");
  return notebook;
}

export async function renameNotebook(id: number, name: string): Promise<Notebook> {
  const notebook = await service.renameNotebook(id, name);
  revalidatePath("/");
  return notebook;
}

export async function deleteNotebook(id: number): Promise<{ error?: string }> {
  const result = await service.deleteNotebook(id);
  if (!result.error) revalidatePath("/");
  return result;
}

export async function moveGroupToNotebook(
  id: number,
  notebookId: number,
): Promise<MoveGroupResult> {
  const result = await service.moveGroupToNotebook(id, notebookId);
  if (result.group) revalidatePath("/");
  return result;
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

export async function placeNote(
  noteId: number,
  groupId: number | null,
  beforeNoteId: number | null,
): Promise<Note> {
  const note = await service.placeNote(noteId, groupId, beforeNoteId);
  revalidatePath("/");
  return note;
}

export async function placeGroup(
  id: number,
  parentId: number | null,
  beforeGroupId: number | null,
): Promise<MoveGroupResult> {
  const result = await service.placeGroup(id, parentId, beforeGroupId);
  if (result.group) revalidatePath("/");
  return result;
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

export async function savePreviewFont(font: string): Promise<{ error?: string }> {
  const result = await service.savePreviewFont(font);
  if (!result.error) {
    revalidatePath("/settings");
    revalidatePath("/");
  }
  return result;
}

export async function saveAssistantSettings(input: SaveAssistantSettingsInput): Promise<SaveAssistantSettingsResult> {
  const result = await service.saveAssistantSettings(input);
  if (!result.error) revalidatePath("/settings");
  return result;
}

// Not cached: it asks the server on the network, and the answer changes as models are pulled.
export async function listAssistantModels(): Promise<AssistantModels> {
  return service.listAssistantModels();
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
