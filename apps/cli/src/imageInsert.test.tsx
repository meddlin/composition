import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listNotes, loadWebSettings, service } from "./backend";
import { AUTOSAVE_DELAY_MS } from "./components/Pane";
import { createSandbox, frame, press, settle, sleep, type Rendered, type Sandbox } from "./testing";

let sandbox: Sandbox;
let files: string;
beforeEach(() => {
  sandbox = createSandbox();
  files = fs.mkdtempSync(path.join(os.tmpdir(), "composition-pics-"));
});
afterEach(async () => {
  await sandbox.dispose();
  fs.rmSync(files, { recursive: true, force: true });
});

// A 1x1 PNG: the app sniffs the bytes, so this is a real image to it.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const picture = (name: string) => {
  const file = path.join(files, name);
  fs.writeFileSync(file, PNG);
  return file;
};

const autosave = () => sleep(AUTOSAVE_DELAY_MS + 400);
const stored = () => listNotes().find((note) => note.title === "Plan")?.content ?? "";
const storedImages = () => fs.readdirSync(path.join(loadWebSettings().appDataDir, "app_data"));

/** The note open in a pane with the cursor at its end. */
async function openNote(): Promise<Rendered> {
  await service.createNote("Plan", null);
  const app = await sandbox.mount();
  await press(app, "RETURN", {}, 400);
  await press(app, "END");
  return app;
}

describe("adding an image from a file", () => {
  it("inserts it at the cursor from the Insert image prompt (ctrl+l)", async () => {
    const app = await openNote();
    await app.mockInput.typeText("\nbefore ");

    await press(app, "l", { ctrl: true }, 300);
    expect(frame(app)).toContain("Insert image");
    await app.mockInput.typeText(picture("Route map.png"));
    await press(app, "RETURN", {}, 600);
    await app.mockInput.typeText(" after");
    await autosave();

    expect(stored()).toMatch(/before !\[Route map\]\(app_data\/plan-route-map-[0-9a-f]{12}\.png\) after/);
    expect(storedImages()).toHaveLength(1);
    expect(frame(app)).toContain("Added 1 image.");
  });

  it("says so when the path is not an image", async () => {
    const app = await openNote();
    const text = path.join(files, "notes.txt");
    fs.writeFileSync(text, "words");

    await press(app, "l", { ctrl: true }, 300);
    await app.mockInput.typeText(text);
    await press(app, "RETURN", {}, 400);

    expect(frame(app)).toContain("isn't the path of an image file");
    expect(stored()).not.toContain("![");
  });

  it("turns a pasted image path (what dragging a file into the terminal pastes) into the image", async () => {
    const app = await openNote();

    await app.mockInput.pasteBracketedText(`'${picture("my pic.png")}'`);
    await settle(app, 600);
    await autosave();

    expect(stored()).toMatch(/!\[my pic\]\(app_data\/plan-my-pic-[0-9a-f]{12}\.png\)/);
    expect(stored()).not.toContain(files); // the path itself was not typed in
  });

  it("adds several dragged-in images, one per line", async () => {
    const app = await openNote();

    await app.mockInput.pasteBracketedText(`${picture("one.png")} ${picture("two.png")}`);
    await settle(app, 600);
    await autosave();

    expect(stored().match(/!\[(one|two)\]\(app_data\//g)).toHaveLength(2);
  });

  it("types any other paste as the text it is, even one that mentions a path", async () => {
    const app = await openNote();
    const pasted = `see ${picture("a.png")} for the map`;

    await app.mockInput.pasteBracketedText(pasted);
    await settle(app, 300);
    await autosave();

    expect(stored()).toContain(pasted);
    expect(fs.existsSync(path.join(loadWebSettings().appDataDir, "app_data"))).toBe(false);
  });
});
