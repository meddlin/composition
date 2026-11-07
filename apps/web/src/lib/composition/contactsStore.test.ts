import { describe, expect, it, vi } from "vitest";
import { EMPTY_CONTACT } from "./contacts";
import type { Contact, ContactInput, ContactsApi } from "./contactsApi";
import { createContactsStore, unavailableContacts } from "./contactsStore";

const input = (over: Partial<ContactInput> = {}): ContactInput => ({ ...EMPTY_CONTACT, firstName: "Ada", lastName: "Lovelace", ...over });
const stored = (id: number, over: Partial<ContactInput> = {}): Contact => ({ ...input(over), id, createdAt: "", updatedAt: "" });

/** A backend that keeps its contacts in memory. */
function backend(initial: Contact[] = []) {
  let contacts = [...initial];
  let next = 100;
  return {
    listContacts: vi.fn(async () => contacts),
    addContact: vi.fn(async (value: ContactInput) => {
      const created = { ...value, id: next++, createdAt: "", updatedAt: "" };
      contacts = [...contacts, created];
      return created;
    }),
    updateContact: vi.fn(async (id: number, value: ContactInput) => {
      const updated = { ...value, id, createdAt: "", updatedAt: "" };
      contacts = contacts.map((c) => (c.id === id ? updated : c));
      return updated;
    }),
    deleteContact: vi.fn(async (id: number) => {
      contacts = contacts.filter((c) => c.id !== id);
    }),
  } satisfies ContactsApi;
}

describe("the contacts store", () => {
  it("loads once, tells the listeners, and does not load again once ready", async () => {
    const api = backend([stored(1)]);
    const store = createContactsStore(api);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.getSnapshot().status).toBe("idle");
    await Promise.all([store.load(), store.load()]);
    await store.load();

    expect(store.getSnapshot()).toMatchObject({ status: "ready", contacts: [stored(1)], error: null });
    expect(api.listContacts).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalled();
  });

  it("says a failed load is unknown rather than empty, and tries again next time", async () => {
    const api = backend([stored(1)]);
    api.listContacts.mockRejectedValueOnce(new Error("Database is locked."));
    const store = createContactsStore(api);

    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "error", error: "Database is locked." });

    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", contacts: [stored(1)] });
  });

  it("adds a contact once the backend has kept it, sending what the rule tidied", async () => {
    const api = backend();
    const store = createContactsStore(api);
    await store.load();

    const result = await store.add(input({ firstName: "  Ada " }));

    expect(result.contact).toMatchObject({ id: 100, firstName: "Ada" });
    expect(api.addContact).toHaveBeenCalledWith(expect.objectContaining({ firstName: "Ada" }));
    expect(store.getSnapshot().contacts.map((c) => c.id)).toEqual([100]);
  });

  it("refuses a bad contact without asking the backend, and reports a backend refusal without changing the list", async () => {
    const api = backend([stored(1)]);
    const store = createContactsStore(api);
    await store.load();

    expect((await store.add(input({ firstName: "", lastName: "" }))).error).toMatch(/first or a last name/);
    expect(api.addContact).not.toHaveBeenCalled();

    api.updateContact.mockRejectedValueOnce(new Error("That contact is no longer in your list."));
    expect(await store.update(1, input({ phone: "555" }))).toEqual({ error: "That contact is no longer in your list." });
    expect(store.getSnapshot().contacts).toEqual([stored(1)]);
  });

  it("changes a contact in place", async () => {
    const store = createContactsStore(backend([stored(1), stored(2, { firstName: "Grace" })]));
    await store.load();

    const result = await store.update(2, input({ firstName: "Grace", phone: "555 0100" }));

    expect(result.contact?.phone).toBe("555 0100");
    expect(store.getSnapshot().contacts.map((c) => [c.id, c.phone])).toEqual([[1, ""], [2, "555 0100"]]);
  });

  it("removes at once and, if the backend refuses, puts back what is really stored and says why", async () => {
    const api = backend([stored(1), stored(2)]);
    const store = createContactsStore(api);
    await store.load();

    expect(await store.remove(1)).toEqual({});
    expect(store.getSnapshot().contacts.map((c) => c.id)).toEqual([2]);

    api.deleteContact.mockRejectedValueOnce(new Error("Disk is full."));
    api.listContacts.mockResolvedValueOnce([stored(2)]);
    expect(await store.remove(2)).toEqual({ error: "Disk is full." });
    expect(store.getSnapshot()).toMatchObject({ contacts: [stored(2)], error: "Disk is full." });
  });

  it("reports that contacts are only in the desktop app when there is no backend", async () => {
    const store = createContactsStore(unavailableContacts);

    await store.load();

    expect(store.getSnapshot()).toMatchObject({ status: "error", error: expect.stringMatching(/desktop app/) });
  });
});
