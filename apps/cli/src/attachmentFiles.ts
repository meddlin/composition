import fs from "node:fs";
import path from "node:path";
import { expandHome } from "./backend";

/** File handling for the Attachments screen that has no screen in it, so it can be tested alone. */

/**
 * The paths in what was typed or pasted. Read the way a shell reads them (spaces split, quotes and
 * backslashes group), because that is what a terminal pastes when a file is dragged into it. If
 * the whole text is one existing file, that wins, so a path typed with spaces and no quotes works.
 * `~` is expanded and a relative path is taken from `cwd`.
 */
export function parsePaths(input: string, cwd: string): string[] {
  const text = input.trim();
  if (text === "") return [];
  const resolve = (p: string) => path.resolve(cwd, expandHome(p));

  const whole = resolve(text);
  if (fileExists(whole)) return [whole];

  const paths: string[] = [];
  let current = "";
  let started = false;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && i + 1 < text.length) current += text[++i];
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === "\\" && i + 1 < text.length) {
      current += text[++i];
      started = true;
    } else if (/\s/.test(char)) {
      if (started) paths.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) paths.push(current);
  return paths.map(resolve);
}

function fileExists(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Copies a stored attachment to where the person asked. A folder means "in there, under the name it
 * was attached with". An existing file is never overwritten: the desktop app's save dialog asks
 * first, and a prompt line cannot.
 */
export function saveCopy(
  storedPath: string,
  fileName: string,
  destination: string,
  cwd: string,
): { path: string } | { error: string } {
  let target = path.resolve(cwd, expandHome(destination.trim()));
  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, fileName);
  } catch {
    // Not there yet: it is a new file name.
  }
  try {
    fs.copyFileSync(storedPath, target, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return { error: `${target} already exists. Choose another name.` };
    }
    return { error: `Could not save a copy: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { path: target };
}
