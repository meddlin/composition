import fs from "node:fs";
import path from "node:path";
import type { UpdatePrefs, UpdatePrefsStore } from "./updates";

/**
 * The update preference, in its own small file under the app's data folder rather than in
 * the settings file the web app and CLI share (plan decision U7). Checking is on until the
 * person turns it off, and a missing or damaged file means "on": losing the file must never
 * be what stops an app from receiving a security fix.
 */
export const DEFAULT_UPDATE_PREFS: UpdatePrefs = { autoCheck: true };

export function createUpdatePrefsStore(file: string): UpdatePrefsStore {
  return {
    load() {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
        const autoCheck = (parsed as { autoCheck?: unknown } | null)?.autoCheck;
        return { autoCheck: typeof autoCheck === "boolean" ? autoCheck : DEFAULT_UPDATE_PREFS.autoCheck };
      } catch {
        return { ...DEFAULT_UPDATE_PREFS };
      }
    },
    save(prefs) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Write beside the file and rename over it, so a crash can't leave half a file.
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify({ autoCheck: prefs.autoCheck }, null, 2)}\n`);
      fs.renameSync(temporary, file);
    },
  };
}
