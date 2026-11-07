import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_CONTACT } from "./contacts";
import type { ContactInput } from "./contactsApi";

// Meilisearch isn't running in tests; indexing is best-effort, so a stub keeps the suite quiet.
vi.mock("./searchIndex", () => ({
  indexNote: vi.fn(async () => {}),
  deleteNoteFromIndex: vi.fn(async () => {}),
  searchNoteIds: vi.fn(async () => []),
  unavailableMessage: () => "Search is unavailable.",
}));

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-contacts-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

const ada: ContactInput = { ...EMPTY_CONTACT, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", birthDate: "1985-12-10" };
const grace: ContactInput = { ...EMPTY_CONTACT, kind: "work", firstName: "Grace", lastName: "Hopper", title: "Rear Admiral", manager: "Chester Nimitz" };

describe("the contacts service", () => {
  it("starts with no contacts", async () => {
    const { listContacts } = await import("./contactsService");

    expect(await listContacts()).toEqual([]);
  });

  it("adds a personal and a work contact and lists them in the order added", async () => {
    const { addContact, listContacts } = await import("./contactsService");

    const first = await addContact(ada);
    const second = await addContact(grace);

    expect(first).toMatchObject({ ...ada, id: expect.any(Number) });
    expect(second).toMatchObject({ kind: "work", title: "Rear Admiral", manager: "Chester Nimitz" });
    expect(first.createdAt).toBe(first.updatedAt);
    expect((await listContacts()).map((c) => c.firstName)).toEqual(["Ada", "Grace"]);
  });

  it("stores what the rule tidied, and nothing in a personal contact's work fields", async () => {
    const { addContact } = await import("./contactsService");

    const added = await addContact({ ...ada, firstName: "  Ada  ", title: "Countess", manager: "Byron" });

    expect(added).toMatchObject({ firstName: "Ada", title: "", manager: "" });
  });

  it("refuses a contact the rule refuses, and stores nothing", async () => {
    const { addContact, listContacts } = await import("./contactsService");

    await expect(addContact({ ...ada, firstName: "", lastName: "" })).rejects.toThrow(/first or a last name/);
    await expect(addContact({ ...ada, email: "nope" })).rejects.toThrow(/email/);
    await expect(addContact({ ...ada, birthDate: "2999-01-01" })).rejects.toThrow(/future/);
    await expect(addContact({ kind: "friend" } as never)).rejects.toThrow();
    expect(await listContacts()).toEqual([]);
  });

  it("replaces a contact's details, and clears the work fields when it becomes personal", async () => {
    const { addContact, updateContact, listContacts } = await import("./contactsService");
    const added = await addContact(grace);

    const updated = await updateContact(added.id, { ...grace, kind: "personal", phone: "555 0100" });

    expect(updated).toMatchObject({ id: added.id, kind: "personal", phone: "555 0100", title: "", manager: "" });
    expect(updated.createdAt).toBe(added.createdAt);
    expect(await listContacts()).toEqual([updated]);
  });

  it("refuses to change a contact that is gone, or to a contact the rule refuses", async () => {
    const { addContact, updateContact, listContacts } = await import("./contactsService");
    const added = await addContact(ada);

    await expect(updateContact(9999, ada)).rejects.toThrow(/no longer/);
    await expect(updateContact(added.id, { ...ada, firstName: "", lastName: "" })).rejects.toThrow();
    expect((await listContacts())[0].firstName).toBe("Ada");
  });

  it("deletes for good, and deleting one that is gone is not an error", async () => {
    const { addContact, deleteContact, listContacts } = await import("./contactsService");
    const added = await addContact(ada);
    await addContact(grace);

    await deleteContact(added.id);
    await deleteContact(added.id);

    expect((await listContacts()).map((c) => c.firstName)).toEqual(["Grace"]);
  });
});
