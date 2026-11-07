# Manual test: the Contacts plugin

A walkthrough to run by hand in the desktop app. The automated tests cover the rules, the panel and the backup round trip; this checks
what they can't see (looks, windows, a real backup file on disk).
What the feature does: [ui/panels.md](../ui/panels.md#the-contacts-panel).

Use a scratch home so your own notes and settings are not touched: `HOME=$(mktemp -d) pnpm --dir apps/desktop dev`.

## 1. On by default

- [ ] Settings → Plugins: **Contacts** is **checked**. The plugin rail has a **Contacts** icon, and an empty panel offers **Contacts**.
- [ ] `Mod+Shift+P`, type *rolodex*: **Open Contacts** is listed. Enter opens the panel.

## 2. Add

- [ ] The panel says there are no contacts yet. Press **+**: a form opens with **Personal** chosen and no Title or Manager.
- [ ] Press **Save** with nothing typed: it says a first or last name is needed, and the form stays.
- [ ] Type a first name, an email of `nope`, and **Save**: it says that is not an email address. Fix it and **Save**: the card opens.
- [ ] Add a second contact, choose **Work**: Title and Manager appear. Fill both and save: the card shows the title under the name and a Manager line.
- [ ] Try a birth date in the future (type it by hand): it is refused. A real one shows in words with an age.

## 3. Find

- [ ] With several contacts: they are filed by last name under a letter. A contact with only a first name sits under that letter.
- [ ] Search for part of a name, then for a word that is only in a note, then for something that matches nothing ("No contacts match.").
- [ ] **Personal** lists only personal contacts, **Work** only work ones. With **Work** showing, **+** starts a work contact. Close and reopen the app: the choice is remembered.

## 4. Change and delete

- [ ] **Edit** a work contact, switch it to **Personal**, save: the title and manager are gone from the card. Switch it back to Work in the form before saving: what you typed earlier is still there.
- [ ] **Edit**, change something, **Cancel**: nothing changed.
- [ ] **Delete** names the contact and says it is gone for good. **Cancel** (the default button) and **Esc** delete nothing; confirming removes it.

## 5. Windows and panels

- [ ] Drag the panel to another position, and use **Move to New Window**: the pop-out shows the same contacts. Edit one in the pop-out; the main window's panel shows the change at once.
- [ ] Open a second Contacts panel with Split Right: it shows the same list, and picking a contact in one does not move the other.
- [ ] Narrow the panel under about 640 px: it shows the list or the card, with **Back to list**.
- [ ] Quit and reopen: the panel, the contact it had open and the list width come back.

## 6. Off, and backups

- [ ] Untick **Contacts** in Settings: the icon and palette command go, and an open panel says the plugin is off with **Turn on Contacts**. Turn it back on: the contacts are all there.
- [ ] Settings → Backup → **Create backup…**: the message ends with the number of contacts. Delete a contact and add another, then **Restore…** that file: the contacts are exactly as they were when it was made.
- [ ] Restore a backup made before this plugin existed (if you have one): the app opens with an empty rolodex and **+** works.
