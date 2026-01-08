import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  filterSessions,
  loadSessions,
  parseTagsInput,
  setArchiveStatus,
  sortSessionsByDate,
  updateSessionMetadata,
} from "../src/session-store";
import type { CodexPaths, SessionRecord } from "../src/types";

async function makeCodexPaths(): Promise<CodexPaths> {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-rename-"));
  const sessionsDir = path.join(root, "sessions");
  const archivedDir = path.join(root, "archived_sessions");
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(archivedDir, { recursive: true });
  return { codexDir: root, sessionsDir, archivedDir };
}

async function writeSessionFile(filePath: string, payload: Record<string, unknown>): Promise<void> {
  const meta = {
    timestamp: payload.timestamp ?? new Date().toISOString(),
    type: "session_meta",
    payload,
  };
  const lines = [JSON.stringify(meta), JSON.stringify({ type: "noop" })].join("\n");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${lines}\n`, "utf8");
}

test("loadSessions reads active and archived sessions", async () => {
  const paths = await makeCodexPaths();
  const activeFile = path.join(
    paths.sessionsDir,
    "2025",
    "11",
    "03",
    "rollout-2025-11-03T14-19-52-abc.jsonl"
  );
  const archivedFile = path.join(
    paths.archivedDir,
    "rollout-2025-11-04T10-10-10-def.jsonl"
  );

  await writeSessionFile(activeFile, {
    id: "active",
    timestamp: "2025-11-03T05:19:52.935Z",
    cwd: "/tmp/project",
    title: "Active Session",
    tags: ["alpha", "beta"],
  });
  await writeSessionFile(archivedFile, {
    id: "archived",
    timestamp: "2025-11-04T05:19:52.935Z",
    cwd: "/tmp/archived",
    title: "Archived Session",
    tags: "gamma, delta",
  });

  const sessions = await loadSessions(paths);
  assert.equal(sessions.length, 2);
  const archived = sessions.find((session) => session.archived);
  const active = sessions.find((session) => !session.archived);

  assert.equal(active?.displayName, "Active Session");
  assert.deepEqual(active?.tags, ["alpha", "beta"]);
  assert.equal(archived?.displayName, "Archived Session");
  assert.deepEqual(archived?.tags, ["gamma", "delta"]);

  const filtered = filterSessions(sessions, "alpha", "all");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "active");
});

test("filterSessions respects archive filter", async () => {
  const paths = await makeCodexPaths();
  const activeFile = path.join(
    paths.sessionsDir,
    "2025",
    "11",
    "08",
    "rollout-2025-11-08T10-10-10-active.jsonl"
  );
  const archivedFile = path.join(
    paths.archivedDir,
    "rollout-2025-11-09T10-10-10-archived.jsonl"
  );

  await writeSessionFile(activeFile, {
    id: "active",
    timestamp: "2025-11-08T05:19:52.935Z",
    cwd: "/tmp/active",
  });
  await writeSessionFile(archivedFile, {
    id: "archived",
    timestamp: "2025-11-09T05:19:52.935Z",
    cwd: "/tmp/archived",
  });

  const sessions = await loadSessions(paths);
  assert.equal(filterSessions(sessions, "", "active").length, 1);
  assert.equal(filterSessions(sessions, "", "archived").length, 1);
  assert.equal(filterSessions(sessions, "", "all").length, 2);
});

test("updateSessionMetadata writes title and tags", async () => {
  const paths = await makeCodexPaths();
  const filePath = path.join(
    paths.sessionsDir,
    "2025",
    "11",
    "05",
    "rollout-2025-11-05T10-10-10-xyz.jsonl"
  );
  await writeSessionFile(filePath, {
    id: "update",
    timestamp: "2025-11-05T05:19:52.935Z",
    cwd: "/tmp/update",
  });

  await updateSessionMetadata(filePath, {
    title: "New Name",
    tags: ["Tag", "tag", ""],
  });

  const content = await readFile(filePath, "utf8");
  const meta = JSON.parse(content.split("\n")[0]) as {
    payload: Record<string, unknown>;
  };
  assert.equal(meta.payload.title, "New Name");
  assert.equal(meta.payload.name, "New Name");
  assert.deepEqual(meta.payload.tags, ["Tag"]);

  await updateSessionMetadata(filePath, { title: "", tags: [] });
  const cleared = JSON.parse((await readFile(filePath, "utf8")).split("\n")[0]) as {
    payload: Record<string, unknown>;
  };
  assert.equal("title" in cleared.payload, false);
  assert.equal("tags" in cleared.payload, false);
});

test("parseTagsInput normalizes input", () => {
  assert.deepEqual(parseTagsInput("alpha, beta beta"), ["alpha", "beta"]);
  assert.deepEqual(parseTagsInput(""), []);
});

test("setArchiveStatus moves sessions", async () => {
  const paths = await makeCodexPaths();
  const filePath = path.join(
    paths.sessionsDir,
    "2025",
    "11",
    "07",
    "rollout-2025-11-07T10-10-10-move.jsonl"
  );
  await writeSessionFile(filePath, {
    id: "move",
    timestamp: "2025-11-07T05:19:52.935Z",
    cwd: "/tmp/move",
  });

  const [session] = await loadSessions(paths);
  assert.ok(session);

  const archivedPath = await setArchiveStatus(session, true, paths);
  await access(archivedPath);

  const [archivedSession] = (await loadSessions(paths)).filter(
    (item) => item.archived
  );
  assert.ok(archivedSession);

  const restoredPath = await setArchiveStatus(archivedSession, false, paths);
  await access(restoredPath);
});

test("sortSessionsByDate orders sessions by sortKey", () => {
  const sessions = [
    { filePath: "a", sortKey: 2 },
    { filePath: "b", sortKey: 1 },
    { filePath: "c", sortKey: 3 },
  ] as SessionRecord[];
  const asc = sortSessionsByDate(sessions, "asc");
  assert.deepEqual(
    asc.map((session) => session.filePath),
    ["b", "a", "c"]
  );
  const desc = sortSessionsByDate(sessions, "desc");
  assert.deepEqual(
    desc.map((session) => session.filePath),
    ["c", "a", "b"]
  );
});
