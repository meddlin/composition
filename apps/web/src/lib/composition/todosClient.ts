import type { TodosApi } from "./todosApi";
import type {} from "./desktopBridge";

/**
 * The desktop app's to-do items, reached over Electron IPC through the preload script's `window.composition`. Only
 * the desktop build uses it (the web app has no panels), so there is no Server Action twin.
 */

function bridge(): TodosApi {
  const api = typeof window === "undefined" ? undefined : window.composition;
  if (!api) {
    throw new Error("The Composition desktop bridge is unavailable. The to-do panel only runs inside the desktop app.");
  }
  return api;
}

export const loadTodoLook: TodosApi["loadTodoLook"] = () => bridge().loadTodoLook();
export const saveTodoLook: TodosApi["saveTodoLook"] = (look) => bridge().saveTodoLook(look);
export const loadTodoSettings: TodosApi["loadTodoSettings"] = () => bridge().loadTodoSettings();
export const saveTodoSettings: TodosApi["saveTodoSettings"] = (settings) => bridge().saveTodoSettings(settings);
export const previewTodoPurge: TodosApi["previewTodoPurge"] = (months) => bridge().previewTodoPurge(months);
export const listTodos: TodosApi["listTodos"] = () => bridge().listTodos();
export const createTodo: TodosApi["createTodo"] = (title, parentId) => bridge().createTodo(title, parentId);
export const renameTodo: TodosApi["renameTodo"] = (id, title) => bridge().renameTodo(id, title);
export const setTodoDone: TodosApi["setTodoDone"] = (id, done) => bridge().setTodoDone(id, done);
export const setTodoStatus: TodosApi["setTodoStatus"] = (id, status) => bridge().setTodoStatus(id, status);
export const setTodoPriority: TodosApi["setTodoPriority"] = (id, priority) => bridge().setTodoPriority(id, priority);
export const moveTodo: TodosApi["moveTodo"] = (id, beforeId) => bridge().moveTodo(id, beforeId);
export const sortDoneTodosLast: TodosApi["sortDoneTodosLast"] = () => bridge().sortDoneTodosLast();
export const sortTodosByPriority: TodosApi["sortTodosByPriority"] = () => bridge().sortTodosByPriority();
export const deleteTodo: TodosApi["deleteTodo"] = (id) => bridge().deleteTodo(id);
export const previewTodoDelete: TodosApi["previewTodoDelete"] = (id) => bridge().previewTodoDelete(id);
export const loadTodoReports: TodosApi["loadTodoReports"] = () => bridge().loadTodoReports();
export const generateTodoReport: TodosApi["generateTodoReport"] = (kind, periodStart) => bridge().generateTodoReport(kind, periodStart);
export const listArchivedTodos: TodosApi["listArchivedTodos"] = () => bridge().listArchivedTodos();
export const removeTodo: TodosApi["removeTodo"] = (id) => bridge().removeTodo(id);
export const dropTodo: TodosApi["dropTodo"] = (id) => bridge().dropTodo(id);
export const restoreTodo: TodosApi["restoreTodo"] = (id) => bridge().restoreTodo(id);
export const acceptRolledTodo: TodosApi["acceptRolledTodo"] = (id) => bridge().acceptRolledTodo(id);
export const moveRolledTodoToBacklog: TodosApi["moveRolledTodoToBacklog"] = (id) => bridge().moveRolledTodoToBacklog(id);
export const loadTodoSetup: TodosApi["loadTodoSetup"] = () => bridge().loadTodoSetup();
export const finishTodoSetup: TodosApi["finishTodoSetup"] = (archiveCompleted) => bridge().finishTodoSetup(archiveCompleted);
