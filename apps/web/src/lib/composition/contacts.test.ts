import { describe, expect, it } from "vitest";
import { ageOn, checkContactInput, contactLetter, contactName, EMPTY_CONTACT, formatBirthDate, isBirthDate, matchesContact, sortContacts } from "./contacts";
import type { Contact, ContactInput } from "./contactsApi";

const input = (over: Partial<ContactInput> = {}): ContactInput => ({ ...EMPTY_CONTACT, firstName: "Ada", lastName: "Lovelace", ...over });
const contact = (id: number, over: Partial<Contact> = {}): Contact => ({ ...input(), id, createdAt: "", updatedAt: "", ...over });
const TODAY = "2026-11-06";

describe("checking a contact", () => {
  it("keeps a good contact as it is", () => {
    const full = input({ email: "ada@example.com", phone: "555 0100", notes: "Hi", birthDate: "1985-12-10" });
    expect(checkContactInput(full, TODAY)).toEqual({ input: full });
  });

  it("trims, puts names on one line and normalizes line breaks in the notes", () => {
    const { input: checked } = checkContactInput(input({ firstName: "  Ada \n May ", phone: " 555   0100 ", notes: "  a\r\nb  ", email: " ada@example.com " }), TODAY);
    expect(checked).toMatchObject({ firstName: "Ada May", phone: "555 0100", notes: "a\nb", email: "ada@example.com" });
  });

  it("needs a first or a last name, either one", () => {
    expect(checkContactInput(input({ firstName: " ", lastName: "" }), TODAY).error).toMatch(/first or a last name/);
    expect(checkContactInput(input({ firstName: "", lastName: "Lovelace" }), TODAY).error).toBeUndefined();
    expect(checkContactInput(input({ firstName: "Ada", lastName: "" }), TODAY).error).toBeUndefined();
  });

  it("refuses an email that is not one, and one that is too long", () => {
    for (const email of ["ada", "ada@", "@example.com", "a b@example.com", "a@@b"]) {
      expect(checkContactInput(input({ email }), TODAY).error).toMatch(/email/);
    }
    expect(checkContactInput(input({ email: `${"a".repeat(250)}@b.co` }), TODAY).error).toMatch(/too long/);
  });

  it("refuses a birth date that is not a date, is too early, or is in the future, and allows today", () => {
    for (const birthDate of ["1985-3-7", "1985-02-30", "1985-13-01", "yesterday", "1899-12-31", "2026-11-07"]) {
      expect(checkContactInput(input({ birthDate }), TODAY).error, birthDate).toBeDefined();
    }
    expect(checkContactInput(input({ birthDate: "2026-11-06" }), TODAY).error).toBeUndefined();
    expect(checkContactInput(input({ birthDate: "2024-02-29" }), TODAY).error).toBeUndefined();
  });

  it("empties a personal contact's title and manager, and keeps a work contact's", () => {
    const fields = { title: "  Engineer ", manager: "Grace Hopper" };
    expect(checkContactInput(input({ kind: "personal", ...fields }), TODAY).input).toMatchObject({ title: "", manager: "" });
    expect(checkContactInput(input({ kind: "work", ...fields }), TODAY).input).toMatchObject({ title: "Engineer", manager: "Grace Hopper" });
  });

  it("refuses what is not a contact: a wrong kind, a missing or non-text field, a non-object", () => {
    expect(checkContactInput(null, TODAY).error).toBeDefined();
    expect(checkContactInput([], TODAY).error).toBeDefined();
    expect(checkContactInput({ ...input(), kind: "friend" }, TODAY).error).toMatch(/personal or work/);
    expect(checkContactInput({ ...input(), email: 5 }, TODAY).error).toMatch(/email/);
    const { phone: _phone, ...missing } = input();
    void _phone;
    expect(checkContactInput(missing, TODAY).error).toMatch(/phone/);
  });

  it("drops fields it does not know, so nothing extra is stored", () => {
    expect(Object.keys(checkContactInput({ ...input(), id: 9, admin: true }, TODAY).input!).sort()).toEqual(Object.keys(EMPTY_CONTACT).sort());
  });
});

describe("birth dates", () => {
  it("know a real calendar date", () => {
    expect(isBirthDate("2000-02-29")).toBe(true);
    expect(isBirthDate("1900-02-29")).toBe(false);
    expect(isBirthDate("2001-02-29")).toBe(false);
  });

  it("are shown in words without a time zone moving them", () => {
    expect(formatBirthDate("1985-03-07", "en-US")).toBe("March 7, 1985");
    expect(formatBirthDate("1985-01-01", "en-US")).toBe("January 1, 1985");
    expect(formatBirthDate("nonsense")).toBe("nonsense");
  });

  it("give an age that turns over on the birthday", () => {
    expect(ageOn("1985-03-07", "2026-03-06")).toBe(40);
    expect(ageOn("1985-03-07", "2026-03-07")).toBe(41);
    expect(ageOn("2026-11-06", "2026-11-06")).toBe(0);
  });
});

describe("the list", () => {
  it("names a contact by whichever names it has", () => {
    expect(contactName(contact(1))).toBe("Ada Lovelace");
    expect(contactName(contact(1, { lastName: "" }))).toBe("Ada");
    expect(contactName(contact(1, { firstName: "" }))).toBe("Lovelace");
  });

  it("is filed by last name, then first name, ignoring case, then the order added", () => {
    const people = [
      contact(1, { firstName: "Zed", lastName: "adams" }),
      contact(2, { firstName: "Bea", lastName: "Baker" }),
      contact(3, { firstName: "Al", lastName: "Adams" }),
      contact(4, { firstName: "Cher", lastName: "" }),
      contact(5, { firstName: "Al", lastName: "Adams" }),
    ];
    expect(sortContacts(people).map((c) => c.id)).toEqual([3, 5, 1, 2, 4]);
  });

  it("files a contact with no last name under its first name, and a non-letter under #", () => {
    expect(contactLetter(contact(1))).toBe("L");
    expect(contactLetter(contact(1, { lastName: "", firstName: "cher" }))).toBe("C");
    expect(contactLetter(contact(1, { lastName: "Éclair" }))).toBe("E");
    expect(contactLetter(contact(1, { lastName: "3M" }))).toBe("#");
  });

  it("matches a search on every word, anywhere in the details", () => {
    const grace = contact(1, { firstName: "Grace", lastName: "Hopper", kind: "work", title: "Rear Admiral", manager: "Chester", email: "grace@navy.mil", notes: "COBOL" });
    expect(matchesContact(grace, "")).toBe(true);
    expect(matchesContact(grace, "hopper")).toBe(true);
    expect(matchesContact(grace, "ADMIRAL grace")).toBe(true);
    expect(matchesContact(grace, "navy.mil")).toBe(true);
    expect(matchesContact(grace, "cobol")).toBe(true);
    expect(matchesContact(grace, "chester")).toBe(true);
    expect(matchesContact(grace, "grace pascal")).toBe(false);
  });
});
