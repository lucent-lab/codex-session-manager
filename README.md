# Codex Session Manager

Simple TUI to rename, tag, and archive Codex CLI sessions stored under `~/.codex`.

## What it does

- Browse sessions with a focused cursor and optional bulk selection
- Rename sessions and edit tags
- Archive or unarchive sessions
- Search by name or tag and filter by archive status
- Toggle a details pane with metadata and previews of the first and last messages
- Tag autocomplete in the tag editor
- Bulk toggle archive status for selected sessions

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

Navigation
- Up/Down (j/k): move focus
- p/n: page up/down
- g : jump to top
- G : jump to bottom

Filter and view
- / : search by name or tag
- f : show filter (active, archived, active+archived)
- s : toggle sort order (desc/asc)
- d : toggle details pane

Selection
- space : toggle selection for bulk actions
- A : select all visible
- I (capital i): invert selection
- C : clear selection

Actions
- r : rename session
- t : edit tags (comma separated)
- a : toggle archive focused
- B : toggle archive selected

Other
- h or ? : toggle help
- q : quit

Note: In-app help (h/?) includes alternate keys like Home/End and Tab.

## Notes

- Session metadata is stored in the first JSON line (`session_meta`) inside each `.jsonl` file.
- This tool adds or updates `title`, `name`, and `tags` in that line.
- Archiving moves files into `~/.codex/archived_sessions` and restoring moves them back into the date-based folder.
- Windows: Works in Windows Terminal or PowerShell 7+ (ANSI + raw mode). Session data still lives under `%USERPROFILE%\.codex`.

## Example use cases

- Rename a session so it is easy to spot in `--resume` lists.
- Tag sessions with project names for quick filtering.
- Archive old sessions to keep the active list clean.
