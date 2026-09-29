"use server";

import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { closeDb } from "@/lib/composition/db";
import { expandHome } from "@/lib/composition/paths";
import { resolvedDbPath, saveWebSettings, type WebSettings } from "@/lib/composition/webSettings";

export type SettingsFormState = {
  error?: string;
  success?: boolean;
  appDataDir?: string;
  dbPath?: string;
};

export async function saveSettingsAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const rawAppDataDir = String(formData.get("appDataDir") ?? "").trim();
  const rawDbPath = String(formData.get("dbPath") ?? "").trim();

  if (rawAppDataDir === "") {
    return { error: "Application data directory is required." };
  }

  const appDataDir = expandHome(rawAppDataDir);
  const dbPath = rawDbPath === "" ? undefined : expandHome(rawDbPath);

  try {
    fs.mkdirSync(appDataDir, { recursive: true });
    if (dbPath) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Could not create or write to that location: ${message}` };
  }

  const settings: WebSettings = dbPath ? { appDataDir, dbPath } : { appDataDir };
  saveWebSettings(settings);
  closeDb();

  revalidatePath("/settings");
  revalidatePath("/");

  return {
    success: true,
    appDataDir,
    dbPath: resolvedDbPath(settings),
  };
}
