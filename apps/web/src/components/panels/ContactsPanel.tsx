"use client";

import { ChevronLeftIcon, CopyIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { ageOn, contactLetter, contactName, EMPTY_CONTACT, formatBirthDate, localToday, matchesContact, sortContacts } from "@/lib/composition/contacts";
import {
  MAX_CONTACT_EMAIL_LENGTH,
  MAX_CONTACT_MANAGER_LENGTH,
  MAX_CONTACT_NAME_LENGTH,
  MAX_CONTACT_NOTES_LENGTH,
  MAX_CONTACT_PHONE_LENGTH,
  MAX_CONTACT_TITLE_LENGTH,
  type Contact,
  type ContactInput,
  type ContactKind,
} from "@/lib/composition/contactsApi";
import type { SaveResult } from "@/lib/composition/contactsStore";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../ConfirmDialog";
import { ResizeHandle } from "../notes/ResizeHandle";
import type { WorkspaceStore } from "../notes/workspaceStore";
import { CONTACT_CARD_MIN_WIDTH, CONTACTS_LIST_MIN_WIDTH, type ContactsFilter, type ContactsPanelState } from "./kinds";
import type { PanelId } from "./layoutTree";

/** From this container width the list and the contact sit side by side; below it the panel shows one at a time. */
export const CONTACTS_SIDE_BY_SIDE_MIN_WIDTH = 640;

const FILTERS: { value: ContactsFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "personal", label: "Personal" },
  { value: "work", label: "Work" },
];

/** A contact is being made (`"new"`), changed (its id), or neither (null). */
type Editing = "new" | number | null;

const initials = (contact: Contact) => (contact.firstName.charAt(0) + contact.lastName.charAt(0)).toUpperCase();

function ContactRow({ contact, selected, onPick }: { contact: Contact; selected: boolean; onPick: () => void }) {
  const name = contactName(contact);
  const detail = contact.kind === "work" ? contact.title || "Work" : contact.email || contact.phone;
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        aria-label={name}
        onClick={onPick}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
          selected && "bg-muted",
        )}
      >
        <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
          {initials(contact)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">{name}</span>
          {detail && <span className="truncate text-xs text-muted-foreground">{detail}</span>}
        </span>
      </button>
    </li>
  );
}

/** One line of a contact's card: what it is, and its value (with a button to copy it, for the two a person pastes). */
function Detail({ label, value, copy, multiline }: { label: string; value: string; copy?: string; multiline?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="flex items-start gap-1 text-sm">
        <span className={cn("min-w-0 flex-1 break-words", multiline && "whitespace-pre-wrap")}>{value}</span>
        {copy && (
          <Button variant="ghost" size="icon-xs" aria-label={copy} onClick={() => void navigator.clipboard?.writeText(value)}>
            <CopyIcon />
          </Button>
        )}
      </dd>
    </div>
  );
}

function ContactCard({ contact, onEdit, onDelete, onBackToList }: { contact: Contact; onEdit: () => void; onDelete: () => void; onBackToList: (() => void) | null }) {
  const work = contact.kind === "work";
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center gap-1 border-b px-2 py-1">
        {onBackToList && (
          <Button variant="ghost" size="xs" onClick={onBackToList}>
            <ChevronLeftIcon /> Back to list
          </Button>
        )}
        <span className="flex-1" />
        <Button variant="ghost" size="xs" onClick={onEdit}>
          <PencilIcon /> Edit
        </Button>
        <Button variant="ghost" size="xs" onClick={onDelete}>
          <Trash2Icon /> Delete
        </Button>
      </div>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold leading-tight break-words">{contactName(contact)}</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{work ? "Work" : "Personal"}</Badge>
            {work && contact.title && <span>{contact.title}</span>}
          </div>
        </div>
        <dl className="flex flex-col gap-3">
          {work && contact.manager && <Detail label="Manager" value={contact.manager} />}
          {contact.email && <Detail label="Email" value={contact.email} copy="Copy email" />}
          {contact.phone && <Detail label="Phone" value={contact.phone} copy="Copy phone number" />}
          {contact.birthDate && <Detail label="Birthday" value={`${formatBirthDate(contact.birthDate)} (age ${ageOn(contact.birthDate)})`} />}
          {contact.notes && <Detail label="Notes" value={contact.notes} multiline />}
        </dl>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  maxLength,
  type = "text",
  max,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  type?: "text" | "email" | "tel" | "date";
  max?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} maxLength={maxLength} max={max} autoFocus={autoFocus} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

/**
 * The form for a new contact or a changed one. Work contacts get a title and a manager; switching to personal hides them
 * (the service stores them empty), and switching back brings back what was typed, until the form is saved or closed.
 */
function ContactForm({
  label,
  initial,
  onSave,
  onCancel,
  onBackToList,
}: {
  label: "New contact" | "Edit contact";
  initial: ContactInput;
  onSave: (input: ContactInput) => Promise<SaveResult>;
  onCancel: () => void;
  onBackToList: (() => void) | null;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const notesId = useId();
  const set = <K extends keyof ContactInput>(key: K, value: ContactInput[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  async function submit() {
    setSaving(true);
    const result = await onSave(draft);
    // A save that went through closes the form, so only a refusal is left to show.
    if (result.error !== undefined) {
      setError(result.error);
      setSaving(false);
    }
  }

  return (
    <form
      aria-label={label}
      // The rule in contacts.ts says what is wrong, in the same words everywhere; the browser's own tooltips would not.
      noValidate
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {onBackToList && (
        <div className="border-b px-2 py-1">
          <Button type="button" variant="ghost" size="xs" onClick={onBackToList}>
            <ChevronLeftIcon /> Back to list
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-3 p-4">
        <RadioGroup
          aria-label="Kind of contact"
          value={draft.kind}
          onValueChange={(value) => set("kind", value as ContactKind)}
          className="flex w-fit gap-4"
        >
          {(["personal", "work"] as const).map((kind) => (
            <div key={kind} className="flex items-center gap-2">
              <RadioGroupItem value={kind} id={`contact-kind-${kind}`} />
              <Label htmlFor={`contact-kind-${kind}`}>{kind === "work" ? "Work" : "Personal"}</Label>
            </div>
          ))}
        </RadioGroup>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="First name" value={draft.firstName} maxLength={MAX_CONTACT_NAME_LENGTH} autoFocus onChange={(v) => set("firstName", v)} />
          <TextField label="Last name" value={draft.lastName} maxLength={MAX_CONTACT_NAME_LENGTH} onChange={(v) => set("lastName", v)} />
        </div>
        {draft.kind === "work" && (
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Title" value={draft.title} maxLength={MAX_CONTACT_TITLE_LENGTH} onChange={(v) => set("title", v)} />
            <TextField label="Manager" value={draft.manager} maxLength={MAX_CONTACT_MANAGER_LENGTH} onChange={(v) => set("manager", v)} />
          </div>
        )}
        <TextField label="Email" type="email" value={draft.email} maxLength={MAX_CONTACT_EMAIL_LENGTH} onChange={(v) => set("email", v)} />
        <TextField label="Phone" type="tel" value={draft.phone} maxLength={MAX_CONTACT_PHONE_LENGTH} onChange={(v) => set("phone", v)} />
        <TextField label="Birth date" type="date" value={draft.birthDate} max={localToday()} onChange={(v) => set("birthDate", v)} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={notesId}>Notes</Label>
          <Textarea id={notesId} rows={5} value={draft.notes} maxLength={MAX_CONTACT_NOTES_LENGTH} onChange={(event) => set("notes", event.target.value)} />
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving}>
            Save
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * The Contacts rolodex: people on the left, filed by last name under a letter, and on the right the one picked, as a card or
 * as a form to add or change one. The contacts are the workspace's, so every Contacts panel, in any window, shows the same
 * ones; the panel saves only which contact it has open, which kinds it lists and how wide its list is.
 */
export function ContactsPanel({ store, panelId, state }: { store: WorkspaceStore; panelId: PanelId; state: ContactsPanelState }) {
  const contactsStore = store.contacts;
  const { status, contacts, error } = useSyncExternalStore(contactsStore.subscribe, contactsStore.getSnapshot, contactsStore.getSnapshot);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // While a divider is dragged its width is kept here, and saved with the layout once it is let go.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragStart = useRef(0);
  // A narrow panel shows the list or the contact, not both.
  const [narrowList, setNarrowList] = useState(state.selectedId === null);

  useEffect(() => {
    void contactsStore.load();
  }, [contactsStore]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const sorted = useMemo(() => sortContacts(contacts), [contacts]);
  const shown = useMemo(
    () => sorted.filter((c) => (state.filter === "all" || c.kind === state.filter) && matchesContact(c, query)),
    [sorted, state.filter, query],
  );
  const selected = contacts.find((c) => c.id === state.selectedId) ?? null;
  const editedContact = typeof editing === "number" ? (contacts.find((c) => c.id === editing) ?? null) : null;
  const sideBySide = width >= CONTACTS_SIDE_BY_SIDE_MIN_WIDTH;

  const save = (patch: Partial<ContactsPanelState>) => store.setPanelState(panelId, { ...state, ...patch } satisfies ContactsPanelState);

  const pick = (id: number) => {
    setEditing(null);
    setNarrowList(false);
    if (id !== state.selectedId) save({ selectedId: id });
  };

  const startNew = () => {
    setEditing("new");
    setNarrowList(false);
  };

  async function submit(input: ContactInput): Promise<SaveResult> {
    const result = editing === "new" ? await contactsStore.add(input) : editing !== null ? await contactsStore.update(editing, input) : null;
    if (!result) return { error: "Nothing to save." };
    if (result.contact) pick(result.contact.id);
    return result;
  }

  const maxListWidth = Math.max(CONTACTS_LIST_MIN_WIDTH, width - CONTACT_CARD_MIN_WIDTH);
  const listWidth = Math.min(maxListWidth, Math.max(CONTACTS_LIST_MIN_WIDTH, dragWidth ?? state.listWidth));

  // Rows are grouped under the letter they are filed by; the letter is shown once, above its first contact.
  const rows = shown.map((contact, index) => ({ contact, letter: contactLetter(contact), first: index === 0 || contactLetter(shown[index - 1]) !== contactLetter(contact) }));

  const list = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2">
      <Button variant="default" size="sm" className="w-full" onClick={startNew}>
        <PlusIcon /> New contact
      </Button>
      <div className="relative">
        <SearchIcon aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search contacts"
          placeholder="Search..."
          value={query}
          spellCheck={false}
          className="h-8 pl-8 placeholder:text-foreground/60"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div role="group" aria-label="Show" className="flex gap-1">
        {FILTERS.map(({ value, label }) => (
          <Button key={value} size="xs" variant={state.filter === value ? "secondary" : "ghost"} aria-pressed={state.filter === value} onClick={() => state.filter !== value && save({ filter: value })}>
            {label}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {status === "error" ? (
          <div className="flex flex-col items-start gap-2 p-1 text-sm text-muted-foreground">
            <span>Contacts could not be loaded.</span>
            <Button size="sm" variant="outline" onClick={() => void contactsStore.load()}>
              Try again
            </Button>
          </div>
        ) : status !== "ready" ? (
          <p className="p-1 text-sm text-muted-foreground">Loading…</p>
        ) : contacts.length === 0 ? (
          <p className="p-1 text-sm text-muted-foreground">No contacts yet. Choose New contact to add one.</p>
        ) : shown.length === 0 ? (
          <p className="p-1 text-sm text-muted-foreground">No contacts match.</p>
        ) : (
          <ul aria-label="Contacts">
            {rows.map(({ contact, letter, first }) => (
              <Fragment key={contact.id}>
                {first && (
                  <li aria-hidden className="px-2 pt-2 pb-0.5 text-xs font-semibold text-muted-foreground">
                    {letter}
                  </li>
                )}
                <ContactRow contact={contact} selected={contact.id === state.selectedId} onPick={() => pick(contact.id)} />
              </Fragment>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const backToList = sideBySide ? null : () => setNarrowList(true);
  const detail =
    editing === "new" || editedContact ? (
      <ContactForm
        key={String(editing)}
        label={editing === "new" ? "New contact" : "Edit contact"}
        initial={editedContact ?? { ...EMPTY_CONTACT, kind: state.filter === "work" ? "work" : "personal" }}
        onSave={submit}
        onCancel={() => setEditing(null)}
        onBackToList={backToList}
      />
    ) : selected ? (
      <ContactCard key={selected.id} contact={selected} onEdit={() => setEditing(selected.id)} onDelete={() => setDeleting(selected)} onBackToList={backToList} />
    ) : (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground">Pick a contact, or add one</div>
    );

  return (
    <div ref={root} className="flex min-h-0 min-w-0 flex-1">
      {sideBySide ? (
        <>
          <div className="flex min-h-0 shrink-0 flex-col" style={{ width: listWidth }}>
            {list}
          </div>
          <ResizeHandle
            label="Resize the list"
            valueNow={Math.round(listWidth)}
            valueMin={CONTACTS_LIST_MIN_WIDTH}
            valueMax={Math.round(maxListWidth)}
            onResizeStart={() => {
              dragStart.current = listWidth;
            }}
            onResize={(delta) => setDragWidth(Math.min(maxListWidth, Math.max(CONTACTS_LIST_MIN_WIDTH, dragStart.current + delta)))}
            onResizeEnd={() => {
              if (dragWidth !== null) save({ listWidth: Math.round(dragWidth) });
              setDragWidth(null);
            }}
          />
          {detail}
        </>
      ) : editing === null && (narrowList || !selected) ? (
        list
      ) : (
        detail
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this contact?"
        description={
          deleting && (
            <>
              <strong>{contactName(deleting)}</strong> will be removed from your contacts for good. It is not sent to the Trash Can; a backup made earlier still has it.
            </>
          )
        }
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void contactsStore.remove(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
