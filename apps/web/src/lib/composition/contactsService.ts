import { checkContactInput } from "./contacts";
import type { ContactsApi } from "./contactsApi";
import * as contactsRepo from "./contactsRepo";

/** The desktop app's contacts, kept in the notes database (so a backup carries them). */
export type ContactsService = ContactsApi;

export const listContacts: ContactsService["listContacts"] = async () => contactsRepo.listContacts();

export const addContact: ContactsService["addContact"] = async (value) => {
  const { input, error } = checkContactInput(value);
  if (error !== undefined) throw new Error(error);
  return contactsRepo.addContact(input);
};

export const updateContact: ContactsService["updateContact"] = async (id, value) => {
  const { input, error } = checkContactInput(value);
  if (error !== undefined) throw new Error(error);
  const contact = contactsRepo.updateContact(id, input);
  if (!contact) throw new Error("That contact is no longer in your list.");
  return contact;
};

export const deleteContact: ContactsService["deleteContact"] = async (id) => {
  contactsRepo.deleteContact(id);
};
