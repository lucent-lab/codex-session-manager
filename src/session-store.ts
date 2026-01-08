import fs from "node:fs/promises";
import { createReadStream, type Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type { ArchiveFilter, CodexPaths, SessionRecord, SortOrder } from "./types";

type SessionMetaLine = {
  type?: string;
  payload?: Record<string, unknown>;
};

type SessionGit = {
  commit_hash?: string;
  branch?: string;
  repository_url?: string;
};

export function getDefaultPaths(): CodexPaths {
  const codexDir = path.join(os.homedir(), ".codex");
  return {
    codexDir,
    sessionsDir: path.join(codexDir, "sessions"),
    archivedDir: path.join(codexDir, "archived_sessions"),
  };
}

async function collectJsonlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return results;
    }
    throw err;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectJsonlFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(fullPath);
    }
  }

  return results;
}

async function readFirstLine(filePath: string): Promise<string | null> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  return new Promise((resolve, reject) => {
    let done = false;
    rl.on("line", (line) => {
      if (done) {
        return;
      }
      done = true;
      rl.close();
      stream.destroy();
      resolve(line);
    });
    rl.on("close", () => {
      if (!done) {
        resolve(null);
      }
    });
    rl.on("error", (err) => {
      if (!done) {
        reject(err);
      }
    });
    stream.on("error", (err) => {
      if (!done) {
        reject(err);
      }
    });
  });
}

function normalizeTags(value: unknown): string[] {
  if (value == null) {
    return [];
  }

  let raw: string[] = [];
  if (Array.isArray(value)) {
    raw = value.filter((item): item is string => typeof item === "string");
  } else if (typeof value === "string") {
    raw = value.split(/[\s,]+/);
  }

  return uniqueTags(raw.map((tag) => tag.trim()).filter(Boolean));
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(tag);
  }
  return result;
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed);
}

function parseDateFromFilename(fileName: string): Date | null {
  const match = fileName.match(
    /(20\d{2})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/
  );
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
}

function formatDateLabel(date: Date | null): string | undefined {
  if (!date || Number.isNaN(date.valueOf())) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

function pickTitle(payload: Record<string, unknown>): string | undefined {
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (title) {
    return title;
  }
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (name) {
    return name;
  }
  return undefined;
}

function deriveDisplayName(
  payload: Record<string, unknown>,
  fileName: string
): string {
  const title = pickTitle(payload);
  if (title) {
    return title;
  }
  const cwd = typeof payload.cwd === "string" ? payload.cwd.trim() : "";
  if (cwd) {
    return path.basename(cwd);
  }
  return fileName.replace(/\.jsonl$/, "");
}

function parseGit(payload: Record<string, unknown>): SessionRecord["git"] | undefined {
  const git = payload.git as SessionGit | undefined;
  if (!git || typeof git !== "object") {
    return undefined;
  }
  const repositoryUrl =
    typeof git.repository_url === "string" ? git.repository_url : undefined;
  const branch = typeof git.branch === "string" ? git.branch : undefined;
  const commitHash =
    typeof git.commit_hash === "string" ? git.commit_hash : undefined;
  if (!repositoryUrl && !branch && !commitHash) {
    return undefined;
  }
  return { repositoryUrl, branch, commitHash };
}

async function parseSessionFile(
  filePath: string,
  archived: boolean
): Promise<SessionRecord | null> {
  const firstLine = await readFirstLine(filePath);
  if (!firstLine) {
    return null;
  }

  let meta: SessionMetaLine;
  try {
    meta = JSON.parse(firstLine) as SessionMetaLine;
  } catch {
    return null;
  }

  if (meta.type !== "session_meta" || !meta.payload) {
    return null;
  }

  const payload = meta.payload;
  const timestamp = typeof payload.timestamp === "string" ? payload.timestamp : undefined;
  const fileName = path.basename(filePath);
  const stat = await fs.stat(filePath);
  const sortDate =
    parseTimestamp(timestamp) ||
    parseDateFromFilename(fileName) ||
    stat.mtime ||
    null;

  return {
    id: typeof payload.id === "string" ? payload.id : undefined,
    filePath,
    fileName,
    archived,
    cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
    title: pickTitle(payload),
    tags: normalizeTags(payload.tags),
    timestamp,
    dateLabel: formatDateLabel(sortDate),
    displayName: deriveDisplayName(payload, fileName),
    sortKey: sortDate ? sortDate.getTime() : 0,
    originator:
      typeof payload.originator === "string" ? payload.originator : undefined,
    cliVersion:
      typeof payload.cli_version === "string" ? payload.cli_version : undefined,
    source: typeof payload.source === "string" ? payload.source : undefined,
    modelProvider:
      typeof payload.model_provider === "string"
        ? payload.model_provider
        : undefined,
    git: parseGit(payload),
  };
}

export async function loadSessions(paths: CodexPaths): Promise<SessionRecord[]> {
  const [activeFiles, archivedFiles] = await Promise.all([
    collectJsonlFiles(paths.sessionsDir),
    collectJsonlFiles(paths.archivedDir),
  ]);

  const sessions: SessionRecord[] = [];
  for (const filePath of activeFiles) {
    const session = await parseSessionFile(filePath, false);
    if (session) {
      sessions.push(session);
    }
  }

  for (const filePath of archivedFiles) {
    const session = await parseSessionFile(filePath, true);
    if (session) {
      sessions.push(session);
    }
  }

  return sessions;
}

export function filterSessions(
  sessions: SessionRecord[],
  query: string,
  archiveFilter: ArchiveFilter
): SessionRecord[] {
  const trimmed = query.trim().toLowerCase();
  return sessions.filter((session) => {
    if (archiveFilter === "archived" && !session.archived) {
      return false;
    }
    if (archiveFilter === "active" && session.archived) {
      return false;
    }
    if (!trimmed) {
      return true;
    }
    const name = session.displayName.toLowerCase();
    const tags = session.tags.join(" ").toLowerCase();
    return name.includes(trimmed) || tags.includes(trimmed);
  });
}

export function parseTagsInput(input: string): string[] {
  if (!input.trim()) {
    return [];
  }
  return uniqueTags(
    input
      .split(/[\s,]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
  );
}

export function sortSessionsByDate(
  sessions: SessionRecord[],
  order: SortOrder
): SessionRecord[] {
  const sorted = [...sessions];
  if (order === "asc") {
    sorted.sort((a, b) => a.sortKey - b.sortKey);
    return sorted;
  }
  sorted.sort((a, b) => b.sortKey - a.sortKey);
  return sorted;
}

export async function updateSessionMetadata(
  filePath: string,
  updates: { title?: string; tags?: string[] }
): Promise<void> {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split("\n");
  if (!lines[0]) {
    throw new Error("Session file is empty.");
  }

  let meta: SessionMetaLine;
  try {
    meta = JSON.parse(lines[0]) as SessionMetaLine;
  } catch {
    throw new Error("Failed to parse session metadata.");
  }

  if (meta.type !== "session_meta" || !meta.payload) {
    throw new Error("First line is not session metadata.");
  }

  const payload = meta.payload as Record<string, unknown>;

  if (updates.title !== undefined) {
    const cleaned = updates.title.trim();
    if (cleaned) {
      payload.title = cleaned;
      payload.name = cleaned;
    } else {
      delete payload.title;
      delete payload.name;
    }
  }

  if (updates.tags !== undefined) {
    const cleanedTags = uniqueTags(
      updates.tags.map((tag) => tag.trim()).filter(Boolean)
    );
    if (cleanedTags.length) {
      payload.tags = cleanedTags;
    } else {
      delete payload.tags;
    }
  }

  meta.payload = payload;
  lines[0] = JSON.stringify(meta);
  await fs.writeFile(filePath, lines.join("\n"), "utf8");
}

async function moveFile(source: string, destination: string): Promise<void> {
  try {
    await fs.rename(source, destination);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "EXDEV") {
      throw err;
    }
    await fs.copyFile(source, destination);
    await fs.unlink(source);
  }
}

function resolveActivePath(
  fileName: string,
  timestamp: string | undefined,
  fallbackTime: Date,
  paths: CodexPaths
): string {
  const date = parseTimestamp(timestamp) || parseDateFromFilename(fileName) || fallbackTime;
  const dateLabel = formatDateLabel(date);
  if (!dateLabel) {
    throw new Error("Unable to determine session date.");
  }
  const [year, month, day] = dateLabel.split("-");
  return path.join(paths.sessionsDir, year, month, day, fileName);
}

export async function setArchiveStatus(
  session: SessionRecord,
  targetArchived: boolean,
  paths: CodexPaths
): Promise<string> {
  if (session.archived === targetArchived) {
    return session.filePath;
  }

  if (targetArchived) {
    const destination = path.join(paths.archivedDir, session.fileName);
    await fs.mkdir(paths.archivedDir, { recursive: true });
    try {
      await fs.access(destination);
      throw new Error("Archived session already exists.");
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        throw err;
      }
    }
    await moveFile(session.filePath, destination);
    return destination;
  }

  const stat = await fs.stat(session.filePath);
  const destination = resolveActivePath(
    session.fileName,
    session.timestamp,
    stat.mtime,
    paths
  );
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fs.access(destination);
    throw new Error("Active session already exists.");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw err;
    }
  }
  await moveFile(session.filePath, destination);
  return destination;
}
