import os from "node:os";
import path from "node:path";

export const DEFAULT_APP_DATA_DIR = path.join(os.homedir(), ".composition");

export function defaultDatabasePath(appDataDir: string): string {
  return path.join(appDataDir, "composition.db");
}

/** Node does no shell tilde-expansion, unlike the CLI's `Path(...).expanduser()`. */
export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}
