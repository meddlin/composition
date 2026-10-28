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
export const listTodos: TodosApi["listTodos"] = () => bridge().listTodos();
export const createTodo: TodosApi["createTodo"] = (title, parentId) => bridge().createTodo(title, parentId);
export const renameTodo: TodosApi["renameTodo"] = (id, title) => bridge().renameTodo(id, title);
export const setTodoDone: TodosApi["setTodoDone"] = (id, done) => bridge().setTodoDone(id, done);
export const deleteTodo: TodosApi["deleteTodo"] = (id) => bridge().deleteTodo(id);
