import {
  isContactKind,
  MAX_CONTACT_EMAIL_LENGTH,
  MAX_CONTACT_MANAGER_LENGTH,
  MAX_CONTACT_NAME_LENGTH,
  MAX_CONTACT_NOTES_LENGTH,
  MAX_CONTACT_PHONE_LENGTH,
  MAX_CONTACT_TITLE_LENGTH,
  type Contact,
  type ContactInput,
} from "./contactsApi";

/** A contact with nothing filled in, which the form starts from. */
export const EMPTY_CONTACT: ContactInput = {
  kind: "personal",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  notes: "",
  birthDate: "",
  title: "",
  manager: "",
};

const FIELDS = ["firstName", "lastName", "email", "phone", "notes", "birthDate", "title", "manager"] as const;

/** The earliest birth year accepted; a typo like `0198` is far likelier than a contact who is 1,800 years old. */
const EARLIEST_BIRTH_YEAR = 1900;

const BIRTH_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today as `YYYY-MM-DD` in the machine's own time zone, which is the day a person means by "today". */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whether `value` is a real calendar date written `YYYY-MM-DD` (so not `2023-02-30`), from 1900 on. */
export function isBirthDate(value: string): boolean {
  const match = BIRTH_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < EARLIEST_BIRTH_YEAR) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A name, title or manager as it is stored: on one line, trimmed. */
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/** Loose on purpose: something before an `@`, something after it, no spaces. Whether the address works is for the mail server to say. */
const EMAIL = /^[^\s@]+@[^\s@]+$/;

type Checked = { input: ContactInput; error?: undefined } | { input?: undefined; error: string };

/**
 * What a form (or a call across the bridge) gave, checked and tidied into what is stored: every field present and a string, names
 * on one line, a name given, an email that looks like one, a birth date that exists and is not in the future, and nothing in
 * the work fields of a personal contact. The renderer, the bridge validator and the service all use it, so none can let
 * through what another refuses. `today` is only for tests.
 */
export function checkContactInput(value: unknown, today: string = localToday()): Checked {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { error: "That is not a contact." };
  const data = value as Record<string, unknown>;
  if (!isContactKind(data.kind)) return { error: "A contact is personal or work." };
  for (const field of FIELDS) if (typeof data[field] !== "string") return { error: `The ${field} of a contact must be text.` };
  const text = data as Record<(typeof FIELDS)[number], string>;

  const work = data.kind === "work";
  const input: ContactInput = {
    kind: data.kind,
    firstName: oneLine(text.firstName),
    lastName: oneLine(text.lastName),
    email: text.email.trim(),
    phone: oneLine(text.phone),
    notes: text.notes.replace(/\r\n?/g, "\n").trim(),
    birthDate: text.birthDate.trim(),
    title: work ? oneLine(text.title) : "",
    manager: work ? oneLine(text.manager) : "",
  };

  if (input.firstName === "" && input.lastName === "") return { error: "Give the contact a first or a last name." };
  if (input.firstName.length > MAX_CONTACT_NAME_LENGTH || input.lastName.length > MAX_CONTACT_NAME_LENGTH) return { error: "That name is too long." };
  if (input.email !== "") {
    if (input.email.length > MAX_CONTACT_EMAIL_LENGTH) return { error: "That email address is too long." };
    if (!EMAIL.test(input.email)) return { error: "That does not look like an email address." };
  }
  if (input.phone.length > MAX_CONTACT_PHONE_LENGTH) return { error: "That phone number is too long." };
  if (input.notes.length > MAX_CONTACT_NOTES_LENGTH) return { error: "The notes are too long." };
  if (input.birthDate !== "") {
    if (!isBirthDate(input.birthDate)) return { error: "That is not a birth date." };
    if (input.birthDate > today) return { error: "A birth date cannot be in the future." };
  }
  if (input.title.length > MAX_CONTACT_TITLE_LENGTH) return { error: "That title is too long." };
  if (input.manager.length > MAX_CONTACT_MANAGER_LENGTH) return { error: "That manager's name is too long." };
  return { input };
}

/** What a contact is called: "First Last", or whichever of the two there is. */
export function contactName(contact: Pick<Contact, "firstName" | "lastName">): string {
  return [contact.firstName, contact.lastName].filter((part) => part !== "").join(" ");
}

/** The name a contact is filed under, as in a rolodex: the last name, or the first when there is no last. */
function filingName(contact: Pick<Contact, "firstName" | "lastName">): string {
  return contact.lastName !== "" ? contact.lastName : contact.firstName;
}

/** The letter a contact is filed under (`#` for a name that starts with anything but a letter). */
export function contactLetter(contact: Pick<Contact, "firstName" | "lastName">): string {
  const first = filingName(contact).charAt(0).normalize("NFD").charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** The list as a rolodex is kept: by last name, then first, then the order they were added. */
export function sortContacts(contacts: readonly Contact[]): Contact[] {
  return [...contacts].sort(
    (a, b) => collator.compare(filingName(a), filingName(b)) || collator.compare(a.firstName, b.firstName) || a.id - b.id,
  );
}

/** Whether a contact matches what was typed in the search box: every word of it, anywhere in the contact's details. */
export function matchesContact(contact: Contact, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return true;
  const haystack = [contactName(contact), contact.email, contact.phone, contact.title, contact.manager, contact.notes].join("\n").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** `1985-03-07` as "March 7, 1985", in the reader's language. The date is read as a calendar date, not an instant, so no time zone moves it. */
export function formatBirthDate(birthDate: string, locale?: string): string {
  const match = BIRTH_DATE.exec(birthDate);
  if (!match) return birthDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString(locale, { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}

/** How old someone born on `birthDate` is on `today` (both `YYYY-MM-DD`). */
export function ageOn(birthDate: string, today: string = localToday()): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
