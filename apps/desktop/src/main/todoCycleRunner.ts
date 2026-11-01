import { TODOS_CHANGED_CHANNEL } from "../shared/channels";

type WindowLike = { isDestroyed(): boolean; webContents: { send(channel: string, ...args: unknown[]): void } };

/** Tells every open window the to-do list was changed behind its back, so each reads it again. */
export function broadcastTodosChanged(windows: readonly WindowLike[]): void {
  for (const window of windows) {
    if (!window.isDestroyed()) window.webContents.send(TODOS_CHANGED_CHANNEL);
  }
}

/** How often the app looks for a week that has ended: only so a window left open over midnight still closes it (plan T4). */
const HOUR_MS = 60 * 60 * 1000;

/**
 * Runs the weekly cycle (see `runCycle` in the data layer) as the app starts and then every hour, and tells the windows
 * when it changed the list. `run` is synchronous, like the database it works on, so two runs can never overlap. A run
 * that fails is logged and the next one goes ahead.
 */
export function createTodoCycleRunner(options: {
  run: () => { awaitingSetup: boolean; closedWeeks: number; purged: number; reportNotes: number[] };
  announce: () => void;
  /** Has the search told about the report notes a run made (the run itself cannot wait on it). */
  indexReports?: (noteIds: number[]) => void;
  log: (message: string, detail?: string) => void;
  intervalMs?: number;
}) {
  const { run, announce, indexReports, log, intervalMs = HOUR_MS } = options;
  let timer: ReturnType<typeof setInterval> | undefined;

  function tick(): void {
    try {
      const result = run();
      if (result.reportNotes.length > 0) indexReports?.(result.reportNotes);
      // A month can end in the middle of a week, so a report alone is a change too.
      if (result.closedWeeks > 0 || result.purged > 0 || result.reportNotes.length > 0) announce();
    } catch (error) {
      log("The to-do weekly cycle failed:", error instanceof Error ? error.message : String(error));
    }
  }

  return {
    start(): void {
      if (timer) return;
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}

/**
 * The to-do API with `announce` called once a report has been made by hand, so every window, the one that asked among them,
 * learns of the new note and reads again. (The cycle announces its own; this is the other way a report comes to be.)
 */
export function notifyTodoReports<T extends { generateTodoReport: (...args: never[]) => Promise<unknown> }>(api: T, announce: () => void): T {
  return {
    ...api,
    async generateTodoReport(...args: Parameters<T["generateTodoReport"]>) {
      const made = await api.generateTodoReport(...args);
      announce();
      return made;
    },
  };
}
