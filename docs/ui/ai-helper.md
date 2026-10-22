# AI helper

Source: [`AssistantPanel.tsx`](../../apps/web/src/components/notes/AssistantPanel.tsx),
[`AssistantProvider.tsx`](../../apps/web/src/components/notes/AssistantProvider.tsx),
[`AssistantMarkdown.tsx`](../../apps/web/src/components/notes/AssistantMarkdown.tsx),
[`assistantDock.ts`](../../apps/web/src/components/notes/assistantDock.ts),
[`createNoteFromAnswer.ts`](../../apps/web/src/components/notes/createNoteFromAnswer.ts),
[`lib/composition/assistant/`](../../apps/web/src/lib/composition/assistant/),
[`AssistantSettings.tsx`](../../apps/web/src/app/settings/AssistantSettings.tsx) (web and desktop; the terminal app
doesn't have it yet). How it was researched and built: [ai-helper-research.md](../ai-helper-research.md),
[ai-helper-plan.md](../ai-helper-plan.md).

A chat panel beside a note, where you can ask a language model for guidance on what you are writing. The model runs
on **your own Ollama server**: on this computer, or on one you host. Nothing is sent to ChatGPT, OpenAI or any other
hosted service, and nothing the model says is written into your note.

## Set it up

1. Install [Ollama](https://ollama.com) and pull a model that can chat (`ollama pull <model>`).
2. In **Settings → AI helper**, leave the server address blank for Ollama on this computer
   (`http://127.0.0.1:11434`), or enter the address of a server you host. Press **Save**: it saves and then checks the
   connection, and lists the models it found. **Test connection** checks again later, for example after you start Ollama.
3. Optionally set the **context size**: how many tokens of the note and the conversation the model can read at once.
   The default is 8,192. A bigger window needs more memory on the server.

A server on another machine has to be reachable from this one (Ollama listens only on `127.0.0.1` unless
`OLLAMA_HOST` says otherwise). Ollama has no sign-in of its own, so put anything that needs one behind your own network
or VPN: this version sends no credentials, and a server that asks for them is reported as such.

## Use it

Open the panel with the **speech-bubble button** in a note's header, or **Cmd/Ctrl+Shift+L** in the focused pane. It
opens to the right of the note and takes the cursor; **Esc** in its question box gives the cursor back to the editor.
Drag the divider to resize it. In a pane narrower than 600 px it covers the note instead, and the button brings the note back.

- **Ask.** Type a question and press **Enter** (**Shift+Enter** for a new line). The answer streams in as formatted
  Markdown. **Stop** ends it and keeps what had arrived.
- **A part of the note.** Select text in the editor or the preview, then click into the question box: a chip shows
  *Selection (n characters)* and the question is about that text. The **×** on the chip drops it. It is sent with one
  question only.
- **Models.** The list is what the server has installed and can chat with. The choice is remembered on this computer.
- **Chats.** Each note has its own chats. **+** starts a new one; a switcher appears once there are two. They are kept
  while the app is open and **are not saved**: reloading or quitting forgets them. Deleting a note drops its chats.
- **Using an answer.** **Copy** copies it. **New note from this** makes a *separate* note in the same group, titled from
  the answer's first line, and opens it beside the note you asked about. Nothing is ever inserted into the note you are
  writing.
- **Several notes open.** Each pane has its own panel, about its own note.

## What is sent

Every question sends the **current note** (its title, description, tags and text, as you have it on screen even if
it has not saved yet; not its dates), the **selection** if you made one, and **the earlier questions and answers of
that chat**, to the server in Settings and nowhere else. The panel says where: *Runs on this computer* for a local
server, or *Sends your notes to* the host name. If the address is plain `http://` and not this computer, Settings
warns that the note crosses the network unencrypted. Other notes are never sent.

The line under the question box shows roughly how large that is (*Sends this note (about N tokens)*; it counts one token
per four characters, which is only an estimate). Close to the context size it warns; past it, it will not send and says
to raise the context size or select a part of the note. Ollama drops the oldest text without any error when a prompt
is too long for its window, so if its own count of what it read comes back far below the estimate, the panel says so.

## Cloud models are left out, on purpose

Ollama can also run models on its own cloud (ollama.com), and a request for one is forwarded there even when it is
not installed locally. The helper **hides and refuses** those: by name (`…:cloud`, or a tag ending `-cloud`), by what
the server says about a listed model (it runs on another host), and again at the server boundary, whatever the page
asks for. Settings says how many were left out.

## What an answer can't do

An answer is untrusted text. It is drawn by a separate renderer, not the note's: an **image** is shown as its alt text
and never fetched (otherwise a steered model could send your note's text to another site in an image address); a
**link** is text with its address in a tooltip and cannot be followed; **HTML** and the note components (`<Info>` and the
rest) appear as text. The panel is given the note to read and has no way to change it.

## Good to know

- **Backups** carry the server address and context size (they are settings). Chats are not saved, so they are not in a
  backup.
- **Web and desktop** make the request differently, for the same result: the web app through its own streaming route
  (a Server Action would hold back autosave while an answer streams, and the route refuses requests that do not come
  from the app), the desktop app from its main process over IPC, because its pages are allowed no network access. In both
  the server address comes from the saved settings, never from the request.
- **Not yet:** saved chats (local, in backups, following the note into the Trash Can, delete one or all), other local
  servers (LM Studio, llama.cpp, vLLM), sending other notes as context, images, and the terminal app.
- The shortcut has not been checked against Safari, where Cmd+Shift+L shows the sidebar, or Firefox; the header button
  does the same.
