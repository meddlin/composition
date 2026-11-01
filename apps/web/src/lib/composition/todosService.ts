import * as todoCycle from "./todoCycle";
import { generateReport, loadReports } from "./todoReportMaker";
import { indexReportNotes } from "./todoReportIndex";
import { isLocalDate } from "./todoWeeks";
import { cleanTodoTitle } from "./todos";
import { isTodoLook } from "./todoLook";
import { isRetention, RETENTION_ERROR, validateTodoSettings } from "./todoSettings";
import { isReportKind, isTodoStatus, type TodosApi } from "./todosApi";
import * as todosRepo from "./todosRepo";
import { loadWebSettings, saveWebSettings } from "./webSettings";

/** The desktop app's to-do items, kept in the notes database. */

function titleOrThrow(title: string): string {
  const cleaned = cleanTodoTitle(title);
  if (cleaned === null) throw new Error("A to-do needs a title (up to 500 characters).");
  return cleaned;
}

export const loadTodoLook: TodosApi["loadTodoLook"] = async () => loadWebSettings().todoLook;

export const saveTodoLook: TodosApi["saveTodoLook"] = async (look) => {
  if (!isTodoLook(look)) throw new Error("That is not a to-do background.");
  // Merged into the stored settings, so everything else in them survives.
  saveWebSettings({ ...loadWebSettings(), todoLook: { background: look.background, color: look.color } });
};

export const loadTodoSettings: TodosApi["loadTodoSettings"] = async () => loadWebSettings().todos;

export const saveTodoSettings: TodosApi["saveTodoSettings"] = async (settings) => {
  const checked = validateTodoSettings(settings);
  if (checked.error !== undefined) throw new Error(checked.error);
  // Merged into the stored settings, so everything else in them survives.
  saveWebSettings({ ...loadWebSettings(), todos: checked.settings });
};

export const previewTodoPurge: TodosApi["previewTodoPurge"] = async (months) => {
  if (!isRetention(months)) throw new Error(RETENTION_ERROR);
  return todosRepo.previewPurge(months);
};

export const listTodos: TodosApi["listTodos"] = async () => todosRepo.listTodos();

export const createTodo: TodosApi["createTodo"] = async (title, parentId) => {
  const cleaned = titleOrThrow(title);
  if (parentId !== null && !todosRepo.getTodo(parentId)) throw new Error("That to-do no longer exists.");
  return todosRepo.addTodo(cleaned, parentId);
};

export const renameTodo: TodosApi["renameTodo"] = async (id, title) => {
  const todo = todosRepo.updateTodo(id, { title: titleOrThrow(title) });
  if (!todo) throw new Error("That to-do no longer exists.");
  return todo;
};

export const setTodoDone: TodosApi["setTodoDone"] = async (id, done) => {
  const todo = todosRepo.updateTodo(id, { done });
  if (!todo) throw new Error("That to-do no longer exists.");
  return todo;
};

export const setTodoStatus: TodosApi["setTodoStatus"] = async (id, status) => {
  if (!isTodoStatus(status)) throw new Error("That is not a to-do status.");
  const todo = todosRepo.updateTodo(id, { status });
  if (!todo) throw new Error("That to-do no longer exists.");
  return todo;
};

export const deleteTodo: TodosApi["deleteTodo"] = async (id) => {
  todosRepo.deleteTodoTree(id);
};

export const previewTodoDelete: TodosApi["previewTodoDelete"] = async (id) => todosRepo.previewDelete(id);

export const loadTodoReports: TodosApi["loadTodoReports"] = async () => loadReports();

export const generateTodoReport: TodosApi["generateTodoReport"] = async (kind, periodStart) => {
  if (!isReportKind(kind)) throw new Error("That is not a kind of report.");
  if (!isLocalDate(periodStart)) throw new Error("That is not a date.");
  const made = generateReport(kind, periodStart);
  await indexReportNotes([made.noteId]);
  return made;
};

export const listArchivedTodos: TodosApi["listArchivedTodos"] = async () => todosRepo.listArchivedTodos();

export const removeTodo: TodosApi["removeTodo"] = async (id) => {
  if (!todosRepo.getTodo(id)) throw new Error("That to-do no longer exists.");
  todosRepo.archiveTodoTree(id, "removed", loadWebSettings().todos.weekStartsOn);
};

export const dropTodo: TodosApi["dropTodo"] = async (id) => {
  // "Dropped" means abandoned from Rolled over, so an item that is not waiting there cannot be dropped.
  if (todosRepo.getTodo(id)?.rolledFromWeek === undefined) throw new Error("That to-do is not waiting in Rolled over.");
  todosRepo.archiveTodoTree(id, "dropped", loadWebSettings().todos.weekStartsOn);
};

export const moveRolledTodoToBacklog: TodosApi["moveRolledTodoToBacklog"] = async (id) => {
  if (todosRepo.getTodo(id)?.rolledFromWeek === undefined) throw new Error("That to-do is not waiting in Rolled over.");
  todosRepo.moveRolledToBacklog(id);
  return todosRepo.getTodo(id)!;
};

export const loadTodoSetup: TodosApi["loadTodoSetup"] = async () => todoCycle.loadSetup();

export const finishTodoSetup: TodosApi["finishTodoSetup"] = async (archiveCompleted) => {
  if (typeof archiveCompleted !== "boolean") throw new Error("Answer the question with yes or no.");
  todoCycle.finishSetup(archiveCompleted);
};

export const restoreTodo: TodosApi["restoreTodo"] = async (id) => {
  const restored = todosRepo.restoreTodo(id);
  if (!restored) throw new Error("That to-do is not in the archive.");
  return restored;
};

export const acceptRolledTodo: TodosApi["acceptRolledTodo"] = async (id) => {
  const todo = todosRepo.getTodo(id);
  if (!todo) throw new Error("That to-do no longer exists.");
  if (todo.rolledFromWeek === undefined) return todo;
  todosRepo.acceptRolledTodo(id);
  return todosRepo.getTodo(id)!;
};
