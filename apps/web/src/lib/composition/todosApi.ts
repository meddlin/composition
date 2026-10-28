/**
 * What the to-do panel exchanges with the backend. Types only, apart from TODO_METHODS, so it is safe to import
 * anywhere (renderer, preload, main). Desktop only, like the panels that show it.
 */

import type { TodoLook } from "./todoLook";

/** Where an item stands, in the order the board shows them. */
export const TODO_STATUSES = ["backlog", "todo", "in_progress", "done"] as const;

export type TodoStatus = (typeof TODO_STATUSES)[number];

export const isTodoStatus = (value: unknown): value is TodoStatus => TODO_STATUSES.includes(value as TodoStatus);

/**
 * One to-do item. An item with a `parentId` is a sub-item of that item; sub-items nest without limit. `done` is
 * `status === "done"`, kept as a field because the list view ticks items off.
 */
export type Todo = {
  id: number;
  parentId: number | null;
  title: string;
  status: TodoStatus;
  done: boolean;
  createdAt: string;
  updatedAt: string;
};

/** The longest an item's title may be. The page limits its input to this; the backend refuses more. */
export const MAX_TODO_TITLE_LENGTH = 500;

export interface TodosApi {
  /** How the to-do panels look (one setting for all of them; see todoLook.ts). */
  loadTodoLook(): Promise<TodoLook>;
  /** Saves how the to-do panels look. Rejects anything that is not a look. */
  saveTodoLook(look: TodoLook): Promise<void>;
  /** Every item, oldest first. */
  listTodos(): Promise<Todo[]>;
  /** Adds an item at the end of its siblings, under `parentId` or at the top level. Rejects an empty title or a missing parent. */
  createTodo(title: string, parentId: number | null): Promise<Todo>;
  /** Rejects an empty title or a missing item. */
  renameTodo(id: number, title: string): Promise<Todo>;
  /** Marks the item done or not done. Unticking a done item puts it back to "todo"; sub-items are left as they are. */
  setTodoDone(id: number, done: boolean): Promise<Todo>;
  /** Moves the item to a status ("done" is the same as ticking it). Its sub-items are left as they are. Rejects a missing item. */
  setTodoStatus(id: number, status: TodoStatus): Promise<Todo>;
  /** Deletes the item and everything under it, for good. Deleting an item that is already gone is not an error. */
  deleteTodo(id: number): Promise<void>;
}

/** Every method of TodosApi, as data, so the preload script and the main process can't drift from it. */
export const TODO_METHODS = [
  "loadTodoLook",
  "saveTodoLook",
  "listTodos",
  "createTodo",
  "renameTodo",
  "setTodoDone",
  "setTodoStatus",
  "deleteTodo",
] as const satisfies readonly (keyof TodosApi)[];

export type TodoMethod = (typeof TODO_METHODS)[number];

type MissingFromTodoMethods = Exclude<keyof TodosApi, TodoMethod>;
const _everyMethodListed: [MissingFromTodoMethods] extends [never] ? true : never = true;
void _everyMethodListed;
