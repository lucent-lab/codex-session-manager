import process from "node:process";
import {
  filterSessions,
  getDefaultPaths,
  loadSessions,
  parseTagsInput,
  setArchiveStatus,
  sortSessionsByDate,
  updateSessionMetadata,
} from "./session-store";
import {
  applyTagSuggestion,
  buildTagIndex,
  getTagSuggestions,
} from "./ui-utils";
import { readMessagePreviews } from "./preview";
import type { ArchiveFilter, SessionRecord, SortOrder } from "./types";

type InputKind = "search" | "rename" | "tags";

type InputState = {
  kind: InputKind;
  prompt: string;
  value: string;
  onSubmit: (value: string) => Promise<void> | void;
};

type DetailState = {
  filePath: string | null;
  loading: boolean;
};

const state = {
  sessions: [] as SessionRecord[],
  filtered: [] as SessionRecord[],
  searchQuery: "",
  archiveFilter: "active" as ArchiveFilter,
  selectedIndex: 0,
  statusMessage: "",
  inputState: null as InputState | null,
  selectedPaths: new Set<string>(),
  tagIndex: [] as string[],
  showDetails: true,
  showHelp: false,
  sortOrder: "desc" as SortOrder,
  detailCache: new Map<string, { first: string; last: string } | null>(),
  detailState: { filePath: null, loading: false } as DetailState,
};

const DEFAULT_ROWS = 24;
const DEFAULT_COLUMNS = 80;
const TAG_SUGGESTION_LIMIT = 5;
const PREVIEW_CHAR_LIMIT = 240;
const DETAIL_MIN_COLUMNS = 80;
const LIST_WIDTH_RATIO = 0.45;
const LIST_MIN_WIDTH = 30;
const DETAIL_MIN_WIDTH = 20;
const DETAIL_SEPARATOR_WIDTH = 3;
const codexPaths = getDefaultPaths();

function setStatus(message: string): void {
  state.statusMessage = message;
}

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[0f");
}

function hideCursor(): void {
  process.stdout.write("\x1b[?25l");
}

function showCursor(): void {
  process.stdout.write("\x1b[?25h");
}

function truncate(text: string, width: number): string {
  if (text.length <= width) {
    return text;
  }
  if (width <= 3) {
    return text.slice(0, width);
  }
  return `${text.slice(0, width - 3)}...`;
}

function padRight(text: string, width: number): string {
  const clipped = truncate(text, width);
  if (clipped.length >= width) {
    return clipped;
  }
  return `${clipped}${" ".repeat(width - clipped.length)}`;
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0) {
    return [];
  }
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!word) {
      continue;
    }
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      let remaining = word;
      while (remaining.length > width) {
        lines.push(remaining.slice(0, width));
        remaining = remaining.slice(width);
      }
      current = remaining;
      continue;
    }
    if (!current) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }
  if (lines.length === 0) {
    lines.push("");
  }
  return lines.map((line) => truncate(line, width));
}

function formatSessionLine(
  session: SessionRecord,
  selected: boolean,
  current: boolean,
  width: number
): string {
  const cursor = current ? ">" : " ";
  const marker = selected ? "[x]" : "[ ]";
  const tagText = session.tags.length ? ` tags:${session.tags.join(",")}` : "";
  const archiveText = session.archived ? " [archived]" : "";
  const dateText = session.dateLabel ? ` ${session.dateLabel}` : "";
  return truncate(
    `${cursor} ${marker} ${session.displayName}${tagText}${archiveText}${dateText}`,
    width
  );
}

function getListWindow(listLength: number, viewSize: number): [number, number] {
  if (listLength <= viewSize) {
    return [0, listLength];
  }
  const half = Math.floor(viewSize / 2);
  let start = state.selectedIndex - half;
  if (start < 0) {
    start = 0;
  }
  if (start + viewSize > listLength) {
    start = Math.max(0, listLength - viewSize);
  }
  return [start, Math.min(listLength, start + viewSize)];
}

function pushWrapped(lines: string[], text: string, width: number): void {
  lines.push(...wrapText(text, width));
}

function buildDetailLines(session: SessionRecord, width: number): string[] {
  const lines: string[] = [];
  pushWrapped(lines, "Details", width);
  lines.push("");
  pushWrapped(lines, `Name: ${session.displayName}`, width);
  if (session.title) {
    pushWrapped(lines, `Title: ${session.title}`, width);
  }
  pushWrapped(lines, `Status: ${session.archived ? "archived" : "active"}`, width);
  if (session.timestamp) {
    pushWrapped(lines, `Timestamp: ${session.timestamp}`, width);
  }
  if (session.cwd) {
    pushWrapped(lines, `Cwd: ${session.cwd}`, width);
  }
  if (session.tags.length) {
    pushWrapped(lines, `Tags: ${session.tags.join(", ")}`, width);
  }
  if (session.id) {
    pushWrapped(lines, `Id: ${session.id}`, width);
  }
  if (session.originator) {
    pushWrapped(lines, `Originator: ${session.originator}`, width);
  }
  if (session.cliVersion) {
    pushWrapped(lines, `CLI: ${session.cliVersion}`, width);
  }
  if (session.modelProvider) {
    pushWrapped(lines, `Model: ${session.modelProvider}`, width);
  }
  if (session.git?.repositoryUrl) {
    pushWrapped(lines, `Repo: ${session.git.repositoryUrl}`, width);
  }
  if (session.git?.branch) {
    pushWrapped(lines, `Branch: ${session.git.branch}`, width);
  }
  if (session.git?.commitHash) {
    pushWrapped(lines, `Commit: ${session.git.commitHash}`, width);
  }

  lines.push("");
  pushWrapped(lines, "Preview:", width);

  const cache = state.detailCache;
  if (state.detailState.loading && state.detailState.filePath === session.filePath) {
    pushWrapped(lines, "(loading preview...)", width);
  } else if (cache.has(session.filePath)) {
    const preview = cache.get(session.filePath);
    if (preview) {
      pushWrapped(lines, "First:", width);
      pushWrapped(lines, preview.first, width);
      lines.push("");
      pushWrapped(lines, "Last:", width);
      pushWrapped(lines, preview.last, width);
    } else {
      pushWrapped(lines, "(no preview available)", width);
    }
  } else {
    pushWrapped(lines, "(preview unavailable)", width);
  }

  return lines;
}

function renderListWithDetails(
  listLines: string[],
  detailLines: string[],
  listWidth: number,
  detailWidth: number,
  listSize: number
): string[] {
  const result: string[] = [];
  const separator = " | ";
  for (let i = 0; i < listSize; i += 1) {
    const left = padRight(listLines[i] ?? "", listWidth);
    const right = padRight(detailLines[i] ?? "", detailWidth);
    result.push(`${left}${separator}${right}`);
  }
  return result;
}

function render(): void {
  const rows =
    typeof process.stdout.rows === "number" ? process.stdout.rows : DEFAULT_ROWS;
  const cols =
    typeof process.stdout.columns === "number"
      ? process.stdout.columns
      : DEFAULT_COLUMNS;

  if (state.showHelp) {
    clearScreen();
    const helpLines = [
      "Help (toggle with h or ?)",
      "",
      "Navigation",
      "  up/down (j/k): move selection",
      "  g or Home: jump to top",
      "  G or End: jump to bottom",
      "  /: search",
      "  f: show filter (active/archived/active+archived)",
      "  s: sort order (desc/asc)",
      "  d: toggle details pane",
      "",
      "Selection",
      "  space or Tab: toggle selected session",
      "  A: select all visible",
      "  I: invert selection (visible)",
      "  C: clear selection",
      "",
      "Actions",
      "  r: rename session",
      "  t: edit tags",
      "  a: toggle archive focused",
      "  B: toggle archive selected",
      "",
      "q: quit",
    ];
    const output = helpLines.map((line) => truncate(line, cols));
    process.stdout.write(output.join("\n"));
    return;
  }

  const hasStatus = Boolean(state.statusMessage);
  const tagSuggestions =
    state.inputState?.kind === "tags"
      ? getTagSuggestions(
          state.inputState.value,
          state.tagIndex,
          TAG_SUGGESTION_LIMIT
        )
      : [];
  const suggestionLine = tagSuggestions.length
    ? `Suggestions: ${tagSuggestions.join(", ")} (tab to autocomplete)`
    : "";
  const footerLines = 1 + (suggestionLine ? 1 : 0);
  const headerLines = 5 + (hasStatus ? 1 : 0);
  const listSize = Math.max(1, rows - headerLines - footerLines);

  clearScreen();

  const lines: string[] = [];
  const searchLabel = state.searchQuery.trim();
  const searchDisplay = searchLabel ? searchLabel : "none";
  lines.push("Codex Session Manager");
  const showLabel =
    state.archiveFilter === "all" ? "active+archived" : state.archiveFilter;
  lines.push(
    truncate(
      `Search (/): ${searchDisplay} | Show (f): ${showLabel} | Sort (s): ${state.sortOrder} | Details (d): ${state.showDetails ? "on" : "off"} | Help (h/?)`,
      cols
    )
  );
  lines.push(
    truncate(
      `Selected (space): ${state.selectedPaths.size} | Showing: ${state.filtered.length}/${state.sessions.length} | Nav: ↑/↓ | Top/Bottom: g/G | Quit: q`,
      cols
    )
  );
  lines.push(
    truncate(
      "Actions: rename (r) | tags (t) | toggle focused (a) | toggle selected (B)",
      cols
    )
  );
  lines.push(truncate("Selection: select all (A) | invert (I) | clear (C)", cols));
  if (hasStatus) {
    lines.push(`Status: ${state.statusMessage}`);
  }

  const [start, end] = getListWindow(state.filtered.length, listSize);
  const listLines: string[] = [];
  if (state.filtered.length === 0) {
    listLines.push("(no sessions match the filter)");
  } else {
    for (let i = start; i < end; i += 1) {
      const session = state.filtered[i];
      listLines.push(
        formatSessionLine(
          session,
          state.selectedPaths.has(session.filePath),
          i === state.selectedIndex,
          cols
        )
      );
    }
  }

  const useDetails = state.showDetails && cols >= DETAIL_MIN_COLUMNS;
  if (useDetails) {
    const separatorWidth = DETAIL_SEPARATOR_WIDTH;
    const minDetailWidth = DETAIL_MIN_WIDTH;
    let listWidth = Math.floor(cols * LIST_WIDTH_RATIO);
    listWidth = Math.max(LIST_MIN_WIDTH, listWidth);
    listWidth = Math.min(listWidth, cols - separatorWidth - minDetailWidth);
    const detailWidth = cols - listWidth - separatorWidth;
    const session = currentSession();
    const detailLines = session
      ? buildDetailLines(session, detailWidth)
      : ["(no session selected)"];
    const combined = renderListWithDetails(
      listLines.map((line) => truncate(line, listWidth)),
      detailLines,
      listWidth,
      detailWidth,
      listSize
    );
    lines.push(...combined);
  } else {
    for (let i = 0; i < listSize; i += 1) {
      lines.push(listLines[i] ?? "");
    }
  }

  if (suggestionLine) {
    lines.push(truncate(suggestionLine, cols));
  }

  if (state.inputState) {
    lines.push(truncate(`${state.inputState.prompt}${state.inputState.value}`, cols));
  } else {
    lines.push("");
  }

  process.stdout.write(lines.join("\n"));
}

function applyFilters(): void {
  const filtered = filterSessions(
    state.sessions,
    state.searchQuery,
    state.archiveFilter
  );
  state.filtered = sortSessionsByDate(filtered, state.sortOrder);
  if (state.selectedIndex >= state.filtered.length) {
    state.selectedIndex = Math.max(0, state.filtered.length - 1);
  }
}

function pruneSelection(): void {
  const valid = new Set(state.sessions.map((session) => session.filePath));
  for (const selected of state.selectedPaths) {
    if (!valid.has(selected)) {
      state.selectedPaths.delete(selected);
    }
  }
}

async function refreshSessions(): Promise<void> {
  state.sessions = await loadSessions(codexPaths);
  state.tagIndex = buildTagIndex(state.sessions);
  pruneSelection();
  applyFilters();
}

function currentSession(): SessionRecord | null {
  if (state.filtered.length === 0) {
    return null;
  }
  return state.filtered[state.selectedIndex] ?? null;
}

function startInput(
  kind: InputKind,
  prompt: string,
  value: string,
  onSubmit: InputState["onSubmit"]
): void {
  state.inputState = { kind, prompt, value, onSubmit };
}

function toggleSelection(session: SessionRecord): void {
  if (state.selectedPaths.has(session.filePath)) {
    state.selectedPaths.delete(session.filePath);
  } else {
    state.selectedPaths.add(session.filePath);
  }
}

function selectAllVisible(): void {
  for (const session of state.filtered) {
    state.selectedPaths.add(session.filePath);
  }
}

function invertSelectionVisible(): void {
  for (const session of state.filtered) {
    toggleSelection(session);
  }
}

function clearSelection(): void {
  state.selectedPaths.clear();
}

function selectedSessions(): SessionRecord[] {
  const map = new Map(state.sessions.map((session) => [session.filePath, session]));
  return Array.from(state.selectedPaths)
    .map((filePath) => map.get(filePath))
    .filter((session): session is SessionRecord => Boolean(session));
}

async function handleRename(session: SessionRecord): Promise<void> {
  startInput("rename", "Rename to: ", session.title ?? "", async (value) => {
    await updateSessionMetadata(session.filePath, { title: value });
    setStatus(value.trim() ? "Renamed session." : "Cleared session name.");
    await refreshSessions();
  });
}

async function handleTags(session: SessionRecord): Promise<void> {
  const existing = session.tags.join(", ");
  startInput("tags", "Tags (comma separated): ", existing, async (value) => {
    const tags = parseTagsInput(value);
    await updateSessionMetadata(session.filePath, { tags });
    setStatus(tags.length ? "Updated tags." : "Cleared tags.");
    await refreshSessions();
  });
}

async function handleArchiveToggle(session: SessionRecord): Promise<void> {
  const targetArchived = !session.archived;
  const wasSelected = state.selectedPaths.has(session.filePath);
  const newPath = await setArchiveStatus(session, targetArchived, codexPaths);
  if (wasSelected) {
    state.selectedPaths.delete(session.filePath);
    state.selectedPaths.add(newPath);
  }
  setStatus(targetArchived ? "Archived session." : "Restored session.");
  await refreshSessions();
  render();
}

async function toggleSelectedArchive(): Promise<void> {
  const selected = selectedSessions();
  if (selected.length === 0) {
    setStatus("No sessions selected.");
    return;
  }
  let archivedCount = 0;
  let restoredCount = 0;
  let failed = 0;

  for (const session of selected) {
    try {
      const targetArchived = !session.archived;
      await setArchiveStatus(session, targetArchived, codexPaths);
      if (targetArchived) {
        archivedCount += 1;
      } else {
        restoredCount += 1;
      }
    } catch {
      failed += 1;
    }
  }

  await refreshSessions();
  clearSelection();
  const parts: string[] = [];
  if (archivedCount > 0) {
    parts.push(`archived ${archivedCount}`);
  }
  if (restoredCount > 0) {
    parts.push(`restored ${restoredCount}`);
  }
  if (failed > 0) {
    parts.push(`failed ${failed}`);
  }
  const summary = parts.length ? parts.join(", ") : "no changes";
  setStatus(`Toggle selected: ${summary}.`);
}

function toggleArchiveFilter(): void {
  if (state.archiveFilter === "all") {
    state.archiveFilter = "active";
  } else if (state.archiveFilter === "active") {
    state.archiveFilter = "archived";
  } else {
    state.archiveFilter = "all";
  }
  applyFilters();
}

function toggleSortOrder(): void {
  state.sortOrder = state.sortOrder === "desc" ? "asc" : "desc";
  applyFilters();
}

function toggleDetails(): void {
  state.showDetails = !state.showDetails;
}

function toggleHelp(): void {
  state.showHelp = !state.showHelp;
}

function maybeLoadDetails(): void {
  if (!state.showDetails) {
    state.detailState = { filePath: null, loading: false };
    return;
  }
  const session = currentSession();
  if (!session) {
    state.detailState = { filePath: null, loading: false };
    return;
  }

  const cached = state.detailCache.has(session.filePath);
  if (state.detailState.filePath === session.filePath && cached) {
    return;
  }
  state.detailState = { filePath: session.filePath, loading: !cached };
  if (cached) {
    return;
  }

  void readMessagePreviews(session.filePath, PREVIEW_CHAR_LIMIT)
    .then((preview) => {
      state.detailCache.set(session.filePath, preview ?? null);
      if (state.detailState.filePath === session.filePath) {
        state.detailState.loading = false;
        render();
      }
    })
    .catch((error: unknown) => {
      state.detailCache.set(session.filePath, null);
      setStatus(error instanceof Error ? error.message : "Failed to load preview.");
      state.detailState.loading = false;
      render();
    });
}

function exit(): void {
  showCursor();
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
  clearScreen();
}

function handleInputKey(key: string): void {
  if (!state.inputState) {
    return;
  }
  if (key === "enter") {
    const submit = state.inputState.onSubmit;
    const value = state.inputState.value;
    state.inputState = null;
    Promise.resolve(submit(value))
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "Action failed.");
      })
      .finally(() => {
        render();
      });
    return;
  }
  if (key === "escape") {
    state.inputState = null;
    return;
  }
  if (key === "backspace") {
    state.inputState.value = state.inputState.value.slice(0, -1);
    return;
  }
  if (key === "tab" && state.inputState.kind === "tags") {
    const suggestions = getTagSuggestions(
      state.inputState.value,
      state.tagIndex,
      TAG_SUGGESTION_LIMIT
    );
    if (suggestions.length) {
      state.inputState.value = applyTagSuggestion(
        state.inputState.value,
        suggestions[0]
      );
    }
    return;
  }
  if (key.startsWith("char:")) {
    const char = key.slice(5);
    if (char >= " " && char !== "\x7f") {
      state.inputState.value += char;
    }
  }
}

function handleListKey(key: string): void {
  if (key === "up") {
    state.selectedIndex = Math.max(0, state.selectedIndex - 1);
    return;
  }
  if (key === "down") {
    state.selectedIndex = Math.min(
      Math.max(0, state.filtered.length - 1),
      state.selectedIndex + 1
    );
    return;
  }
  if (key === "quit") {
    exit();
    process.exit(0);
  }
  if (key === "search") {
    startInput("search", "Search: ", state.searchQuery, async (value) => {
      state.searchQuery = value;
      applyFilters();
    });
    return;
  }
  if (key === "filter") {
    toggleArchiveFilter();
    return;
  }
  if (key === "toggle-details") {
    toggleDetails();
    return;
  }
  if (key === "sort") {
    toggleSortOrder();
    return;
  }
  if (key === "help") {
    toggleHelp();
    return;
  }
  if (key === "top") {
    state.selectedIndex = 0;
    return;
  }
  if (key === "bottom") {
    state.selectedIndex = Math.max(0, state.filtered.length - 1);
    return;
  }
  if (key === "select-all") {
    selectAllVisible();
    return;
  }
  if (key === "invert-selection") {
    invertSelectionVisible();
    return;
  }
  if (key === "clear-selection") {
    clearSelection();
    return;
  }
  if (key === "bulk-archive") {
    void toggleSelectedArchive().catch((error: unknown) => {
      setStatus(
        error instanceof Error ? error.message : "Toggle selected failed."
      );
      render();
    });
    return;
  }

  const session = currentSession();
  if (!session) {
    return;
  }

  if (key === "toggle-selection") {
    toggleSelection(session);
    return;
  }
  if (key === "rename") {
    void handleRename(session);
    return;
  }
  if (key === "tags") {
    void handleTags(session);
    return;
  }
  if (key === "archive") {
    void handleArchiveToggle(session).catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : "Archive failed.");
      render();
    });
  }
}

function handleKey(key: string): void {
  if (state.showHelp && key !== "help" && key !== "quit") {
    return;
  }
  if (state.inputState) {
    handleInputKey(key);
  } else {
    handleListKey(key);
  }
  if (!state.inputState && !state.showHelp) {
    maybeLoadDetails();
  }
  render();
}

function handleData(data: Buffer): void {
  const text = data.toString("utf8");
  if (text === "\u0003") {
    exit();
    process.exit(0);
  }
  if (state.inputState) {
    if (text === "\x1b") {
      handleKey("escape");
      return;
    }
    if (text === "\r") {
      handleKey("enter");
      return;
    }
    if (text === "\t") {
      handleKey("tab");
      return;
    }
    if (text === "\x7f") {
      handleKey("backspace");
      return;
    }
    for (const char of text) {
      handleKey(`char:${char}`);
    }
    return;
  }
  if (text === "\x1b[A") {
    handleKey("up");
    return;
  }
  if (text === "\x1b[B") {
    handleKey("down");
    return;
  }
  if (text === "\x1b[H" || text === "\x1b[1~" || text === "\x1b[7~") {
    handleKey("top");
    return;
  }
  if (text === "\x1b[F" || text === "\x1b[4~" || text === "\x1b[8~") {
    handleKey("bottom");
    return;
  }
  if (text === "\x1b") {
    handleKey("escape");
    return;
  }
  if (text === "\r") {
    handleKey("enter");
    return;
  }
  if (text === "\t") {
    handleKey("toggle-selection");
    return;
  }
  if (text === "\x7f") {
    handleKey("backspace");
    return;
  }

  for (const char of text) {
    if (char === " ") {
      handleKey("toggle-selection");
      continue;
    }
    if (char === "/") {
      handleKey("search");
      continue;
    }
    if (char === "f") {
      handleKey("filter");
      continue;
    }
    if (char === "r") {
      handleKey("rename");
      continue;
    }
    if (char === "t") {
      handleKey("tags");
      continue;
    }
    if (char === "a") {
      handleKey("archive");
      continue;
    }
    if (char === "B") {
      handleKey("bulk-archive");
      continue;
    }
    if (char === "d") {
      handleKey("toggle-details");
      continue;
    }
    if (char === "s") {
      handleKey("sort");
      continue;
    }
    if (char === "g") {
      handleKey("top");
      continue;
    }
    if (char === "G") {
      handleKey("bottom");
      continue;
    }
    if (char === "h" || char === "?") {
      handleKey("help");
      continue;
    }
    if (char === "j") {
      handleKey("down");
      continue;
    }
    if (char === "k") {
      handleKey("up");
      continue;
    }
    if (char === "A") {
      handleKey("select-all");
      continue;
    }
    if (char === "I") {
      handleKey("invert-selection");
      continue;
    }
    if (char === "C") {
      handleKey("clear-selection");
      continue;
    }
    if (char === "q") {
      handleKey("quit");
      continue;
    }
    handleKey(`char:${char}`);
  }
}

async function main(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error("This tool requires a TTY.");
    process.exit(1);
  }

  hideCursor();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", handleData);

  await refreshSessions();
  maybeLoadDetails();
  render();
}

main().catch((error: unknown) => {
  exit();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
