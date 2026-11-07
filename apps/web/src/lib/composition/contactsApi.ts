/**
 * What the Contacts panel exchanges with the backend. Types only, apart from CONTACTS_METHODS and the limits, so it is safe
 * to import anywhere (renderer, preload, main). Desktop only, like the panels that show it.
 */

/** A personal contact stops at the basics; a work contact also has a title and a manager. */
export const CONTACT_KINDS = ["personal", "work"] as const;

export type ContactKind = (typeof CONTACT_KINDS)[number];

export const isContactKind = (value: unknown): value is ContactKind => CONTACT_KINDS.includes(value as ContactKind);

/** The longest each field may be. The form limits its inputs to these; the service refuses more. */
export const MAX_CONTACT_NAME_LENGTH = 100;
export const MAX_CONTACT_EMAIL_LENGTH = 254;
export const MAX_CONTACT_PHONE_LENGTH = 40;
export const MAX_CONTACT_NOTES_LENGTH = 10_000;
export const MAX_CONTACT_TITLE_LENGTH = 150;
export const MAX_CONTACT_MANAGER_LENGTH = 150;

/** What a person fills in. Every field but `kind` may be empty, except that a contact needs a first or a last name. */
export type ContactInput = {
  kind: ContactKind;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
  /** `YYYY-MM-DD`, or empty when it is not known. */
  birthDate: string;
  /** Work contacts only; always empty for a personal one. */
  title: string;
  /** Work contacts only: who they report to, as a name. Always empty for a personal one. */
  manager: string;
};

export type Contact = ContactInput & {
  id: number;
  createdAt: string;
  updatedAt: string;
};

export interface ContactsApi {
  /** Every contact, in no particular order (the panel sorts them). */
  listContacts(): Promise<Contact[]>;
  /** Adds a contact. Rejects one with no name, an email that is not one, or a birth date that is not a date. */
  addContact(input: ContactInput): Promise<Contact>;
  /** Replaces a contact's details. Rejects what `addContact` rejects, and a missing contact. */
  updateContact(id: number, input: ContactInput): Promise<Contact>;
  /** Deletes the contact, for good. Deleting one that is already gone is not an error. */
  deleteContact(id: number): Promise<void>;
}

/** Every method of ContactsApi, as data, so the preload script and the main process can't drift from it. */
export const CONTACTS_METHODS = ["listContacts", "addContact", "updateContact", "deleteContact"] as const satisfies readonly (keyof ContactsApi)[];

export type ContactsMethod = (typeof CONTACTS_METHODS)[number];

type MissingFromContactsMethods = Exclude<keyof ContactsApi, ContactsMethod>;
const _everyMethodListed: [MissingFromContactsMethods] extends [never] ? true : never = true;
void _everyMethodListed;
