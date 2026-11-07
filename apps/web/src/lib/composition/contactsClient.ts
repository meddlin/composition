import type { ContactsApi } from "./contactsApi";
import type {} from "./desktopBridge";

/**
 * The desktop app's contacts, reached over Electron IPC through the preload script's `window.composition`. Only the desktop
 * build uses it (the web app has no panels), so there is no Server Action twin.
 */

function bridge(): ContactsApi {
  const api = typeof window === "undefined" ? undefined : window.composition;
  if (!api) {
    throw new Error("The Composition desktop bridge is unavailable. Contacts only run inside the desktop app.");
  }
  return api;
}

export const listContacts: ContactsApi["listContacts"] = () => bridge().listContacts();
export const addContact: ContactsApi["addContact"] = (input) => bridge().addContact(input);
export const updateContact: ContactsApi["updateContact"] = (id, input) => bridge().updateContact(id, input);
export const deleteContact: ContactsApi["deleteContact"] = (id) => bridge().deleteContact(id);
