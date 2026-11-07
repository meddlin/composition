import { checkContactInput } from "./contacts";
import type { Contact, ContactInput, ContactsApi } from "./contactsApi";

/** What the store reaches outside for: the contacts' backend. */
export type ContactsDeps = ContactsApi;

export type ContactsSnapshot = {
  /** `idle` until the first `load`; `error` if that failed (the contacts are then unknown, not empty). */
  status: "idle" | "loading" | "ready" | "error";
  contacts: Contact[];
  /** Why the last load or removal failed, until the next one succeeds. A refused save is reported to the form instead. */
  error: string | null;
};

/** What a save reports: the contact as stored, or why it was refused. */
export type SaveResult = { contact: Contact; error?: undefined } | { contact?: undefined; error: string };

export type ContactsStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ContactsSnapshot;
  /** Reads the contacts from the backend. Does nothing once they are loaded (or while they load); after a failure it tries again. */
  load(): Promise<void>;
  /** Adds a contact. Nothing is shown until the backend has kept it; a refusal comes back as `error` so the form can stay open. */
  add(input: ContactInput): Promise<SaveResult>;
  /** Replaces a contact's details, the same way. */
  update(id: number, input: ContactInput): Promise<SaveResult>;
  /** Removes the contact at once, for good. */
  remove(id: number): Promise<{ error?: string }>;
};

export const NO_CONTACTS: ContactsSnapshot = { status: "idle", contacts: [], error: null };

const reason = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");

/**
 * The contacts, with no React in it, so every panel showing them (in any window) sees the same ones. A save waits for the
 * backend, because the form is still open to correct it; a removal shows at once and, if the backend refuses it, the list is
 * read again so the screen shows what is really stored.
 */
export function createContactsStore(deps: ContactsDeps): ContactsStore {
  let state: ContactsSnapshot = NO_CONTACTS;
  const listeners = new Set<() => void>();
  let loading: Promise<void> | null = null;

  function set(next: Partial<ContactsSnapshot>) {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  }

  function load(): Promise<void> {
    if (state.status === "ready") return Promise.resolve();
    if (loading) return loading;
    set({ status: "loading", error: null });
    loading = deps
      .listContacts()
      .then((contacts) => set({ status: "ready", contacts, error: null }))
      .catch((error) => set({ status: "error", error: reason(error) }))
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  async function add(value: ContactInput): Promise<SaveResult> {
    const { input, error } = checkContactInput(value);
    if (error !== undefined) return { error };
    try {
      const contact = await deps.addContact(input);
      set({ contacts: [...state.contacts, contact], error: null });
      return { contact };
    } catch (failure) {
      return { error: reason(failure) };
    }
  }

  async function update(id: number, value: ContactInput): Promise<SaveResult> {
    const { input, error } = checkContactInput(value);
    if (error !== undefined) return { error };
    try {
      const contact = await deps.updateContact(id, input);
      set({ contacts: state.contacts.map((c) => (c.id === id ? contact : c)), error: null });
      return { contact };
    } catch (failure) {
      return { error: reason(failure) };
    }
  }

  async function remove(id: number): Promise<{ error?: string }> {
    set({ contacts: state.contacts.filter((c) => c.id !== id), error: null });
    try {
      await deps.deleteContact(id);
      return {};
    } catch (failure) {
      const message = reason(failure);
      try {
        set({ contacts: await deps.listContacts(), error: message });
      } catch {
        set({ error: message });
      }
      return { error: message };
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => state,
    load,
    add,
    update,
    remove,
  };
}

const UNAVAILABLE = "Contacts are only available in the desktop app.";

/** For a workspace with no contacts backend (the web app has no Contacts panel): loading them reports that. */
export const unavailableContacts: ContactsDeps = {
  listContacts: () => Promise.reject(new Error(UNAVAILABLE)),
  addContact: () => Promise.reject(new Error(UNAVAILABLE)),
  updateContact: () => Promise.reject(new Error(UNAVAILABLE)),
  deleteContact: () => Promise.reject(new Error(UNAVAILABLE)),
};
