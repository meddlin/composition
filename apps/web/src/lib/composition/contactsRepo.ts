import { getDb } from "./db";
import type { Contact, ContactInput, ContactKind } from "./contactsApi";

type ContactRow = {
  id: number;
  kind: ContactKind;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  notes: string;
  birth_date: string;
  title: string;
  manager: string;
  created_at: string;
  updated_at: string;
};

function fromRow(row: ContactRow): Contact {
  return {
    id: row.id,
    kind: row.kind === "work" ? "work" : "personal",
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    birthDate: row.birth_date,
    title: row.title,
    manager: row.manager,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listContacts(): Contact[] {
  return (getDb().prepare("SELECT * FROM contacts ORDER BY id").all() as ContactRow[]).map(fromRow);
}

export function getContact(id: number): Contact | null {
  const row = getDb().prepare("SELECT * FROM contacts WHERE id = ?").get(id) as ContactRow | undefined;
  return row ? fromRow(row) : null;
}

export function addContact(input: ContactInput): Contact {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO contacts (kind, first_name, last_name, email, phone, notes, birth_date, title, manager, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.kind, input.firstName, input.lastName, input.email, input.phone, input.notes, input.birthDate, input.title, input.manager, now, now);
  const contact = getContact(Number(result.lastInsertRowid));
  if (!contact) throw new Error("Failed to read back the contact that was just added");
  return contact;
}

/** Replaces a contact's details. Null when the contact is gone. */
export function updateContact(id: number, input: ContactInput): Contact | null {
  const result = getDb()
    .prepare(
      `UPDATE contacts SET kind = ?, first_name = ?, last_name = ?, email = ?, phone = ?, notes = ?, birth_date = ?, title = ?, manager = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(input.kind, input.firstName, input.lastName, input.email, input.phone, input.notes, input.birthDate, input.title, input.manager, new Date().toISOString(), id);
  return result.changes === 0 ? null : getContact(id);
}

export function deleteContact(id: number): void {
  getDb().prepare("DELETE FROM contacts WHERE id = ?").run(id);
}
