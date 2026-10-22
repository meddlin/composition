# Manual test: the AI helper

A walkthrough to run by hand against a real Ollama, for web and for desktop. The automated tests and the desktop
smoke test use stand-in servers; this is what checks the real thing, and the parts a script can't see (looks, focus,
what a model actually says). What the feature does: [ui/ai-helper.md](../ui/ai-helper.md).

Use a scratch home so your own notes and settings are not touched:
`HOME=$(mktemp -d) pnpm --dir apps/web dev` (web), or `pnpm smoke`'s throwaway home for the desktop checks that a
script covers. You need Ollama running with one small chat model (for example `qwen3:0.6b`).

## 1. Connect

- [ ] Settings → AI helper: **Save** with the address blank. Status says *Saved. Found N models on
  http://127.0.0.1:11434* and lists them. An embedding-only model (such as `nomic-embed-text`) is **not** listed.
- [ ] Type `192.168.1.250:11434`. A warning about an unencrypted network appears at once. **Save**: the settings
  save, then an error says it can't reach that computer (or times out after about 10 seconds). Reload: the address is
  still there.
- [ ] Type `ftp://nas`, then `http://nas:22`. Each is refused with a reason and nothing is saved.
- [ ] Set the context size to `12` and Save: refused, with the allowed range.

## 2. Ask

- [ ] Open a note with a few lines. Press **Cmd/Ctrl+Shift+L**: the panel opens to the right and the cursor is in the
  question box. Press the shortcut again: it closes and the cursor is back in the editor.
- [ ] Pick the small model. Ask *Suggest two things for day two. Be brief.* The answer streams in, formatted. The note
  text did not change.
- [ ] **Copy**, then paste into another note: the answer's Markdown.
- [ ] **New note from this**: a second note appears to the right, titled from the answer's first line, in the same
  group, holding the answer. The first note is unchanged.
- [ ] Ask something that needs a long answer and press **Stop** part-way: it ends with *Stopped.* and keeps the text.
  `~/.ollama/logs/server.log` shows `cancel task` shortly after.
- [ ] **+** starts a new chat; the old one is in the switcher and switching back shows it. Reload the page: both are gone.

## 3. Selection

- [ ] Select a sentence **in the preview**, then click into the question box: the chip *Selection (n characters)*
  appears. Ask about it; the answer is about that sentence; the chip is gone afterwards.
- [ ] Do the same with a selection **in the editor**, using the keyboard to move into the panel (Tab).
- [ ] Select, then click **×** on the chip, then ask: the question is sent without it.

## 4. Size

- [ ] Set the context size to `1024`. Open a note of a few pages: the line under the box warns, then (longer) says it
  is too large and **Enter does nothing**. Select a short part: it can be sent again.
- [ ] Context size back to `8192`; paste a long note (several thousand words) and ask about the **first paragraph**
  only. Answers that ignore the beginning, with the note *only read part of this conversation* under the answer,
  mean Ollama dropped text and the panel noticed.

## 5. Failure states (each shows its own message)

- [ ] **Quit Ollama**, open the panel: an alert says it can't reach Ollama, with **Check again** and a link to Settings.
  Start Ollama, **Check again**: the models appear.
- [ ] With Ollama running, rename or remove the model you chose (`ollama rm`), then ask: the answer shows that it is not
  installed and gives the `ollama pull` command.
- [ ] A server with no models: the panel says how to pull one.
- [ ] If you can sign in to Ollama's cloud and have a `:cloud` model: it does **not** appear in the list, Settings says
  how many were left out, and no request goes to ollama.com. (Not testable without a cloud account.)

## 6. Layout

- [ ] With one note open and a wide window, the panel sits beside the note and **Split** is still offered when it fits;
  make the window narrower and Split gives way to Markdown, then the panel covers the note below about 600 px wide.
- [ ] Open a second note beside the first (**Open to the side**): each pane has its own panel and chat. Closing the
  other pane does not lose the first pane's chat.
- [ ] Drag the divider: the panel resizes between 280 px and 60% of the pane.

## 7. An answer you shouldn't trust

- [ ] Ask the model to reply with exactly `![chart](https://example.com/p.png?d=hello) and [a link](https://example.com)`.
  The reply shows *[image: chart]* and the link text; **no image is requested** (check the browser's network tab) and
  the link does nothing.
- [ ] Ask it to reply with `<script>alert(1)</script> <Info>x</Info>`: both appear as text.

## 8. Desktop only

- [ ] The same walkthrough in the app. The window's own CSP still blocks the page from reaching the network
  (`pnpm smoke` checks this, but only in a packaged run).
- [ ] Quit the app while an answer is streaming: Ollama's log shows the request cancelled.
