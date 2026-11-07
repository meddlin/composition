// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_CONTACT } from "@/lib/composition/contacts";
import type { Contact, ContactInput, ContactsApi } from "@/lib/composition/contactsApi";
import { createContactsStore } from "@/lib/composition/contactsStore";
import type { WorkspaceStore } from "../notes/workspaceStore";
import { ContactsPanel } from "./ContactsPanel";
import { KINDS, type ContactsPanelState } from "./kinds";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom does no layout, so the width the panel measures is whatever the test says.
let containerWidth = 1000;
beforeEach(() => {
  containerWidth = 1000;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: containerWidth, height: 600, x: 0, y: 0, top: 0, left: 0, right: containerWidth, bottom: 600, toJSON() {} }));
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const person = (id: number, over: Partial<ContactInput> = {}): Contact => ({ ...EMPTY_CONTACT, firstName: "Ada", lastName: "Lovelace", ...over, id, createdAt: "", updatedAt: "" });

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

const START: ContactsPanelState = { selectedId: null, filter: "all", listWidth: 260 };

function setup(initial: Contact[] = [], start: ContactsPanelState = START) {
  const api = backend(initial);
  const contacts = createContactsStore(api);
  let state = start;
  const setPanelState = vi.fn((_id: string, next: unknown) => {
    state = next as ContactsPanelState;
    view.rerender(<ContactsPanel store={store} panelId="p1" state={state} />);
  });
  const store = { contacts, setPanelState } as unknown as WorkspaceStore;
  const view = render(<ContactsPanel store={store} panelId="p1" state={state} />);
  return { api, setPanelState };
}

const rowNames = () => within(screen.getByRole("list", { name: "Contacts" })).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
const badge = () => document.querySelector("[data-slot=badge]")?.textContent;
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("the Contacts panel", () => {
  it("says so when there are no contacts yet", async () => {
    setup();
    expect(await screen.findByText(/No contacts yet/)).toBeTruthy();
    expect(screen.getByText("Pick a contact, or add one")).toBeTruthy();
  });

  it("lists contacts like a rolodex: by last name, under letters", async () => {
    setup([person(1, { firstName: "Zed", lastName: "Young" }), person(2, { firstName: "Bea", lastName: "Adams" }), person(3, { firstName: "Cal", lastName: "Adler" })]);
    await screen.findByRole("button", { name: "Bea Adams" });

    expect(rowNames()).toEqual(["Bea Adams", "Cal Adler", "Zed Young"]);
    const list = screen.getByRole("list", { name: "Contacts" });
    expect(list.textContent).toMatch(/A.*Bea.*Cal.*Y.*Zed/);
    // One heading per letter, not per contact.
    expect(list.querySelectorAll("li[aria-hidden]").length).toBe(2);
  });

  it("shows a personal contact's card with the basics only", async () => {
    setup([person(1, { email: "ada@example.com", phone: "555 0100", birthDate: "1985-12-10", notes: "Met at a conference." })]);
    fireEvent.click(await screen.findByRole("button", { name: "Ada Lovelace" }));

    expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeTruthy();
    expect(badge()).toBe("Personal");
    // The row's second line shows the email too, so it is on screen twice.
    expect(screen.getAllByText("ada@example.com")).toHaveLength(2);
    expect(screen.getByText("555 0100")).toBeTruthy();
    expect(screen.getByText(/December 10, 1985 \(age \d+\)/)).toBeTruthy();
    expect(screen.getByText("Met at a conference.")).toBeTruthy();
    expect(screen.queryByText("Manager")).toBeNull();
  });

  it("shows a work contact's title and manager", async () => {
    setup([person(1, { kind: "work", firstName: "Grace", lastName: "Hopper", title: "Rear Admiral", manager: "Chester Nimitz" })]);
    fireEvent.click(await screen.findByRole("button", { name: "Grace Hopper" }));

    expect(badge()).toBe("Work");
    // The title is on the card, and the row shows it too.
    expect(screen.getAllByText("Rear Admiral").length).toBeGreaterThan(1);
    expect(screen.getByText("Manager")).toBeTruthy();
    expect(screen.getByText("Chester Nimitz")).toBeTruthy();
  });

  it("adds a personal contact with no title or manager fields, then opens it", async () => {
    const { api, setPanelState } = setup();
    await screen.findByText(/No contacts yet/);

    fireEvent.click(screen.getByRole("button", { name: "New contact" }));
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(screen.queryByLabelText("Manager")).toBeNull();
    fill("First name", "Ada");
    fill("Last name", "Lovelace");
    fill("Email", "ada@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeTruthy();
    expect(api.addContact).toHaveBeenCalledWith(expect.objectContaining({ kind: "personal", firstName: "Ada", email: "ada@example.com", title: "", manager: "" }));
    expect(setPanelState).toHaveBeenCalledWith("p1", expect.objectContaining({ selectedId: 100 }));
  });

  it("adds a work contact: choosing Work brings in the title and manager", async () => {
    const { api } = setup();
    await screen.findByText(/No contacts yet/);

    fireEvent.click(screen.getByRole("button", { name: "New contact" }));
    fireEvent.click(screen.getByRole("radio", { name: "Work" }));
    fill("First name", "Grace");
    fill("Title", "Rear Admiral");
    fill("Manager", "Chester Nimitz");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByRole("heading", { name: "Grace" });
    expect(api.addContact).toHaveBeenCalledWith(expect.objectContaining({ kind: "work", title: "Rear Admiral", manager: "Chester Nimitz" }));
  });

  it("starts a new contact as work when only work contacts are listed", async () => {
    setup([person(1, { kind: "work" })], { ...START, filter: "work" });
    await screen.findByRole("button", { name: "Ada Lovelace" });

    fireEvent.click(screen.getByRole("button", { name: "New contact" }));

    expect((screen.getByRole("radio", { name: "Work" }) as HTMLButtonElement).getAttribute("aria-checked")).toBe("true");
  });

  it("keeps the form open and says why when the contact is refused", async () => {
    const { api } = setup();
    await screen.findByText(/No contacts yet/);

    fireEvent.click(screen.getByRole("button", { name: "New contact" }));
    fill("First name", "Ada");
    fill("Email", "not an email");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/email/);
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Ada");
    expect(api.addContact).not.toHaveBeenCalled();
  });

  it("edits a contact, changing it from work to personal drops its work fields, and Cancel leaves it alone", async () => {
    const { api } = setup([person(1, { kind: "work", title: "Engineer", manager: "Grace" })]);
    fireEvent.click(await screen.findByRole("button", { name: "Ada Lovelace" }));

    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Engineer");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.updateContact).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Personal" }));
    fill("Phone", "555 0100");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("555 0100")).toBeTruthy());
    expect(api.updateContact).toHaveBeenCalledWith(1, expect.objectContaining({ kind: "personal", phone: "555 0100", title: "", manager: "" }));
  });

  it("searches names, details and notes, and says when nothing matches", async () => {
    setup([person(1, { firstName: "Bea", lastName: "Adams", notes: "likes sailing" }), person(2, { firstName: "Cal", lastName: "Young", email: "cal@work.example" })]);
    await screen.findByRole("button", { name: "Bea Adams" });

    fireEvent.change(screen.getByLabelText("Search contacts"), { target: { value: "sailing" } });
    expect(rowNames()).toEqual(["Bea Adams"]);

    fireEvent.change(screen.getByLabelText("Search contacts"), { target: { value: "work.example" } });
    expect(rowNames()).toEqual(["Cal Young"]);

    fireEvent.change(screen.getByLabelText("Search contacts"), { target: { value: "zzz" } });
    expect(screen.getByText("No contacts match.")).toBeTruthy();
  });

  it("lists only personal or only work contacts, and remembers the choice in the panel's state", async () => {
    const { setPanelState } = setup([person(1, { firstName: "Bea", lastName: "Adams" }), person(2, { kind: "work", firstName: "Cal", lastName: "Young" })]);
    await screen.findByRole("button", { name: "Bea Adams" });

    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    expect(setPanelState).toHaveBeenCalledWith("p1", expect.objectContaining({ filter: "work" }));
    expect(rowNames()).toEqual(["Cal Young"]);
  });

  it("deletes only after asking, for good", async () => {
    const { api } = setup([person(1), person(2, { firstName: "Bea", lastName: "Adams" })]);
    fireEvent.click(await screen.findByRole("button", { name: "Ada Lovelace" }));

    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(api.deleteContact).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/Ada Lovelace/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(api.deleteContact).toHaveBeenCalledWith(1));
    expect(rowNames()).toEqual(["Bea Adams"]);
  });

  it("shows the list or the contact, one at a time, in a narrow panel", async () => {
    containerWidth = 400;
    setup([person(1)], { ...START, selectedId: 1 });

    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Contacts" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to list" }));
    expect(screen.getByRole("list", { name: "Contacts" })).toBeTruthy();
  });

  it("says the contacts could not be loaded, and tries again", async () => {
    const api = backend([person(1)]);
    api.listContacts.mockRejectedValueOnce(new Error("Database is locked."));
    const store = { contacts: createContactsStore(api), setPanelState: vi.fn() } as unknown as WorkspaceStore;
    render(<ContactsPanel store={store} panelId="p1" state={START} />);

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: "Ada Lovelace" })).toBeTruthy();
  });

  it("starts with nothing open, and restores what it saved", () => {
    const context = { hasNote: () => false, hasNotebook: () => false };
    expect(KINDS.contacts.initialState()).toEqual(START);
    expect(KINDS.contacts.plugin).toBe("contacts");
    expect(KINDS.contacts.restore({ selectedId: 4, filter: "work", listWidth: 300 }, context)).toEqual({ selectedId: 4, filter: "work", listWidth: 300 });
    expect(KINDS.contacts.restore({ selectedId: "4", filter: "everyone", listWidth: -5 }, context)).toEqual({ selectedId: null, filter: "all", listWidth: 160 });
    expect(KINDS.contacts.restore({}, context)).toEqual(START);
    expect(KINDS.contacts.restore("nope", context)).toBeNull();
  });
});
