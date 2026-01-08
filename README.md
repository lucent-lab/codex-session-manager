# Codex Session Manager

Simple TUI to rename, tag, and archive Codex CLI sessions stored under `~/.codex`.

## What it does

- Navigate sessions with arrow keys
- Rename sessions (stored as `title` and `name` in the session metadata line)
- Update tags (stored as `tags` array in the session metadata line)
- Archive/unarchive sessions (move files between `~/.codex/sessions` and `~/.codex/archived_sessions`)
- Search by name or tags and filter by archive status
- Toggle a details pane with metadata and a preview of the first message
- Tag autocomplete in the tag editor (press Tab)
- Toggle archive status for selected sessions

## Requirements

- Node.js 18.18+ or 20.9+ (or newer)

## Install

```bash
npm install
```

## Build and run

```bash
npm run build
npm start
```

## Quality checks

```bash
npm run typecheck
npm run lint
npm test
```

## Dev run (tsx)

```bash
npm run dev
```

## Controls

- Up/Down (j/k): select session
- / : search by name or tag
- f : show filter (active, archived, active+archived)
- s : toggle sort order (desc/asc)
- r : rename selected session
- t : edit tags (comma separated)
- a : toggle archive focused
- space : toggle selection for bulk actions
- A : select all visible
- I : invert selection
- C : clear selection
- B : toggle archive selected
- d : toggle details pane
- h or ? : toggle help
- g : jump to top
- G : jump to bottom
- q : quit

Note: In-app help (h/?) includes alternate keys like Home/End and Tab.

## Notes

- Session metadata is stored in the first JSON line (`session_meta`) inside each `.jsonl` file.
- This tool adds or updates `title`, `name`, and `tags` in that line.
- Archiving moves files into `~/.codex/archived_sessions` and restoring moves them back into the date-based folder.

## Example use cases

- Rename a session so it is easy to spot in `--resume` lists.
- Tag sessions with project names for quick filtering.
- Archive old sessions to keep the active list clean.
