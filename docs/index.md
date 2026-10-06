# Docs

Landing place for documentation.

See [architecture.md](architecture.md) for how the app is put together and how data
flows through it.

See [ui/web-groups.md](ui/web-groups.md) for how groups are managed in the web app.

See [ui/web-trash-can.md](ui/web-trash-can.md) for the delete confirmation and the Trash Can on the Settings page.

See [ui/web-components.md](ui/web-components.md) for the shadcn/ui component setup and how its tokens map onto the color schemes.

See [desktop-app-plan.md](desktop-app-plan.md) for the proposed Electron desktop app, and
[desktop-app-research.md](desktop-app-research.md) for the research behind it.

See [desktop-build-and-release.md](desktop-build-and-release.md) for the step-by-step from
`git pull` to a local desktop build and a GitHub Release.

See [deployment/manual-build-release.md](deployment/manual-build-release.md) for getting an Apple
certificate and notarization key, and producing a signed, notarized desktop build by hand.

See [product-builds.md](product-builds.md) for which database each product (CLI, web,
desktop) uses today and is meant to use later.

See [feature-matrix.md](feature-matrix.md) for where the CLI, web and desktop apps differ.

See [ui/web-follow-the-sun.md](ui/web-follow-the-sun.md) for the sunrise/sunset color scheme.

See [feature-matrix.md](feature-matrix.md) for which features the CLI, web and desktop apps each have.

See [architecture/attachments.md](architecture/attachments.md) for files attached to a note (desktop only).

See [ui/mdx-components.md](ui/mdx-components.md) for the components (like `<Info>` and `<Warning>`) a note can use.


## Features

- [x] Create note
- [x] Delete note
    - [x] Confirm before deleting (web and desktop)
    - [x] Trash Can in Settings: restore recently deleted notes and groups; permanently deleted after 60 days (web and desktop)
- [x] Search across notes
- [x] Metadata support via front-matter
    - [] Support tags on notes, allow searching for notes via tags
- [x] Support note groups
    - [] Support filtering the list of notes by groups (a dedicated `group:` search token)
- [x] Image display support in Markdown content (web and desktop; see [architecture/images.md](architecture/images.md))
    - [x] Allow users to "upload" images directly into a note (paste)
    - [x] Show the image in a rendered version of the note
    - [] CLI support
- [x] Attach any type of file to a note, listed in a table on the note (desktop only; see [architecture/attachments.md](architecture/attachments.md))
    - [] Drag files in from Finder
    - [] Search attachment names
- [] Support cross-linking between files
    - I want to be able to link in one note file, to another one within the database

### Admin Features

- [] Support data backup & restore
    - [] Full database backup
    - [] Full notes backup to JSON files
- [x] Settings page for application configurations:
    - [x] Application data location
    - [x] Color scheme
        - [x] Web: "Follow the sun" scheme that tracks a saved city's sunrise and sunset

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
