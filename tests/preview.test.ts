import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  extractMessageText,
  extractPreviewFromLine,
  readMessagePreviews,
} from "../src/preview";

test("extractMessageText joins message parts", () => {
  const text = extractMessageText({
    type: "message",
    content: [{ text: "Hello" }, { input_text: "world" }],
  });
  assert.equal(text, "Hello world");
});

test("extractPreviewFromLine returns message preview", () => {
  const line = JSON.stringify({
    payload: {
      type: "message",
      content: [{ text: "Preview text" }],
    },
  });
  assert.equal(extractPreviewFromLine(line), "Preview text");
});

test("readMessagePreviews returns first and last messages", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codex-preview-"));
  const filePath = path.join(dir, "session.jsonl");
  const lines = [
    JSON.stringify({ type: "session_meta", payload: { id: "1" } }),
    JSON.stringify({ payload: { type: "event", content: [] } }),
    JSON.stringify({ payload: { type: "message", content: [{ text: "Hello world" }] } }),
    JSON.stringify({ payload: { type: "message", content: [{ text: "Later message" }] } }),
  ];
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  const previews = await readMessagePreviews(filePath, 20);
  assert.deepEqual(previews, {
    first: "Hello world",
    last: "Later message",
  });
});

test("readMessagePreviews returns same first and last for single message", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codex-preview-single-"));
  const filePath = path.join(dir, "session.jsonl");
  const lines = [
    JSON.stringify({ type: "session_meta", payload: { id: "1" } }),
    JSON.stringify({ payload: { type: "message", content: [{ text: "Only message" }] } }),
  ];
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  const previews = await readMessagePreviews(filePath, 50);
  assert.deepEqual(previews, {
    first: "Only message",
    last: "Only message",
  });
});

test("readMessagePreviews returns null when no messages", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codex-preview-empty-"));
  const filePath = path.join(dir, "session.jsonl");
  const lines = [
    JSON.stringify({ type: "session_meta", payload: { id: "1" } }),
    JSON.stringify({ payload: { type: "event", content: [] } }),
  ];
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  const previews = await readMessagePreviews(filePath, 50);
  assert.equal(previews, null);
});
