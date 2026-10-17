import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chooseDirectory, COMMAND_NAME, inspect, install, isOnPath, launcherPath, linkDirectories, locationProblem, uninstall } from "./cliTool";

let root: string;
let launcher: string;
let writable: string;
let home: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "composition-clitool-")));
  const resources = path.join(root, "Applications", "Composition.app", "Contents", "Resources");
  launcher = launcherPath(resources);
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  fs.writeFileSync(launcher, "#!/bin/sh\n", { mode: 0o755 });
  writable = path.join(root, "bin");
  fs.mkdirSync(writable);
  home = path.join(root, "home");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const dirs = () => [writable, path.join(home, ".local", "bin")];

describe("install", () => {
  it("links the launcher into the first writable directory", () => {
    const result = install(dirs(), launcher);

    expect(result).toEqual({ ok: true, link: path.join(writable, COMMAND_NAME), alreadyInstalled: false });
    expect(fs.readlinkSync(path.join(writable, COMMAND_NAME))).toBe(launcher);
  });

  it("creates ~/.local/bin when no earlier directory can be written", () => {
    const missing = path.join(root, "no-such-dir");

    const result = install([missing, path.join(home, ".local", "bin")], launcher);

    expect(result).toEqual({ ok: true, link: path.join(home, ".local", "bin", COMMAND_NAME), alreadyInstalled: false });
  });

  it("skips a directory that exists but can't be written", () => {
    const readOnly = path.join(root, "readonly");
    fs.mkdirSync(readOnly, { mode: 0o555 });

    expect(chooseDirectory([readOnly, writable, path.join(home, ".local", "bin")])).toBe(writable);
  });

  it("is a no-op when already installed", () => {
    install(dirs(), launcher);

    expect(install(dirs(), launcher)).toEqual({ ok: true, link: path.join(writable, COMMAND_NAME), alreadyInstalled: true });
  });

  it("replaces a link left by another copy of the app, or pointing at nothing", () => {
    const other = path.join(root, "Old", "Composition.app", "Contents", "Resources", "cli", COMMAND_NAME);
    fs.symlinkSync(other, path.join(writable, COMMAND_NAME));

    const result = install(dirs(), launcher);

    expect(result).toMatchObject({ ok: true, alreadyInstalled: false });
    expect(fs.readlinkSync(path.join(writable, COMMAND_NAME))).toBe(launcher);
  });

  it("never replaces a real file or an unrelated link of the same name", () => {
    fs.writeFileSync(path.join(writable, COMMAND_NAME), "mine");

    const result = install(dirs(), launcher);

    expect(result).toMatchObject({ ok: false });
    expect(fs.readFileSync(path.join(writable, COMMAND_NAME), "utf-8")).toBe("mine");

    fs.rmSync(path.join(writable, COMMAND_NAME));
    const unrelated = path.join(root, "unrelated");
    fs.writeFileSync(unrelated, "x");
    fs.symlinkSync(unrelated, path.join(writable, COMMAND_NAME));
    expect(install(dirs(), launcher)).toMatchObject({ ok: false });
  });

  it("refuses an app that was opened from a disk image", () => {
    expect(install(dirs(), "/Volumes/Composition 0.1.4/Composition.app/Contents/Resources/cli/composition")).toMatchObject({ ok: false });
    expect(locationProblem("/private/var/folders/x/AppTranslocation/ABC/d/Composition.app/Contents/Resources/cli/composition")).toMatch(/Applications/);
    expect(locationProblem("/Applications/Composition.app/Contents/Resources/cli/composition")).toBeNull();
  });

  it("says so when this build has no command line tool", () => {
    fs.rmSync(launcher);

    expect(install(dirs(), launcher)).toMatchObject({ ok: false, reason: expect.stringContaining("doesn't include") });
  });
});

describe("uninstall", () => {
  it("removes our link and nothing else", () => {
    install(dirs(), launcher);
    const bystander = path.join(home, ".local", "bin");
    fs.mkdirSync(bystander, { recursive: true });
    fs.writeFileSync(path.join(bystander, COMMAND_NAME), "not ours");

    const result = uninstall(dirs(), launcher);

    expect(result).toEqual({ ok: true, removed: [path.join(writable, COMMAND_NAME)] });
    expect(fs.existsSync(path.join(writable, COMMAND_NAME))).toBe(false);
    expect(fs.readFileSync(path.join(bystander, COMMAND_NAME), "utf-8")).toBe("not ours");
  });

  it("reports nothing removed when nothing is installed", () => {
    expect(uninstall(dirs(), launcher)).toEqual({ ok: true, removed: [] });
  });
});

describe("inspect", () => {
  it("is missing, then installed", () => {
    expect(inspect(dirs(), launcher)).toEqual({ kind: "missing" });
    install(dirs(), launcher);
    expect(inspect(dirs(), launcher)).toEqual({ kind: "installed", link: path.join(writable, COMMAND_NAME) });
  });
});

describe("helpers", () => {
  it("lists Homebrew's directory, /usr/local/bin, then ~/.local/bin", () => {
    expect(linkDirectories("/Users/me")).toEqual(["/opt/homebrew/bin", "/usr/local/bin", "/Users/me/.local/bin"]);
  });

  it("checks a directory against a PATH string", () => {
    expect(isOnPath("/a", "/b:/a:/c")).toBe(true);
    expect(isOnPath("/a", "/b:/ab")).toBe(false);
  });
});
