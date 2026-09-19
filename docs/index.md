# Docs

Landing place for documentation.

See [architecture.md](architecture.md) for how the app is put together and how data
flows through it.


## Features

- [x] Create note
- [x] Delete note
- [x] Search across notes
- [x] Metadata support via front-matter
    - [] Support tags on notes, allow searching for notes via tags
- [x] Support note groups
    - [] Support filtering the list of notes by groups (a dedicated `group:` search token)
- [] Image display support in Markdown content
    - Allow users to "upload" images directly into a note
    - Show the image in a rendered version of the note
- [] Support cross-linking between files
    - I want to be able to link in one note file, to another one within the database

### Admin Features

- [] Support data backup & restore
    - [] Full database backup
    - [] Full notes backup to JSON files
- [x] Settings page for application configurations:
    - [x] Database location
    - [] Notes storage location (if different from the database?)
    - [x] Color scheme

### Editing

- [] Generate a table of contents, at the top of the file
- [] Stylized render for Markdown content
    - Headers are bolded. Italics work. Underline support.
- [] Syntax highlighting support
    - Provide different colors for headers, etc.
- [] Checklist support
    - Allow creating checklists with `[]`, `[x]` syntax support

### SDLC + Engineering Standards

- [] GitHub actions to run unit tests on each PR
- [x] Dependabot automation

### Deployment

Should this be deployed via PyPi? a full desktop app?

How to automate builds and deployments?


### Extra Ideas

How should a potential web application be handled?


## Feature - Search across notes

Fuzzy text search and filter across all notes. 

- basic fuzzy text search
- filter queries
    Examples: `tag: software`, `createdOn: >2026-05-30`, `title: Next.js`

### Implementation

Put a search bar at the top of the UI on the main view

Allow fuzzy text search and filtering from this input

Filter the notes list on the left, live with the search/filter functionality

Debounce user input in search bar, by 350ms

### Testing

- Create a loading script that will load 100 dummy note files
- Test the search capability with this data set