import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { credentialsPathFor, deleteCredentials, readCredentials, writeCredentials } from "./credentials";

let dir: string;
beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-credentials-"))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const sample = { clientId: "c", hostId: "h", accessToken: "a", refreshToken: "r", expiresAt: 5, email: "me@example.com" };

describe("credentials file", () => {
  it("sits beside the settings file", () => {
    expect(credentialsPathFor("/x/y/settings.json")).toBe("/x/y/chatgpt-auth.json");
  });

  it("round-trips, readable only by the owner, creating the folder", () => {
    const file = path.join(dir, "nested", "chatgpt-auth.json");
    writeCredentials(file, sample);
    expect(readCredentials(file)).toEqual(sample);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["chatgpt-auth.json"]);
  });

  it("reads nothing from a missing, damaged or incomplete file", () => {
    const file = path.join(dir, "a.json");
    expect(readCredentials(file)).toBeUndefined();
    fs.writeFileSync(file, "{not json");
    expect(readCredentials(file)).toBeUndefined();
    fs.writeFileSync(file, JSON.stringify({ ...sample, refreshToken: "" }));
    expect(readCredentials(file)).toBeUndefined();
    fs.writeFileSync(file, JSON.stringify({ ...sample, expiresAt: "soon" }));
    expect(readCredentials(file)).toBeUndefined();
  });

  it("deleting a file that is not there is fine", () => {
    deleteCredentials(path.join(dir, "none.json"));
    const file = path.join(dir, "a.json");
    writeCredentials(file, sample);
    deleteCredentials(file);
    expect(fs.existsSync(file)).toBe(false);
  });
});
