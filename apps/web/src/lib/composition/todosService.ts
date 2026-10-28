import { cleanTodoTitle } from "./todos";
import { isTodoLook } from "./todoLook";
import type { TodosApi } from "./todosApi";
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

export const deleteTodo: TodosApi["deleteTodo"] = async (id) => {
  todosRepo.deleteTodoTree(id);
};
