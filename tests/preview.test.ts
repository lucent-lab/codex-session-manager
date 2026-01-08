import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  extractMessageText,
  extractPreviewFromLine,
  readMessagePreview,
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

test("readMessagePreview returns first message", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codex-preview-"));
  const filePath = path.join(dir, "session.jsonl");
  const lines = [
    JSON.stringify({ type: "session_meta", payload: { id: "1" } }),
    JSON.stringify({ payload: { type: "event", content: [] } }),
    JSON.stringify({ payload: { type: "message", content: [{ text: "Hello world" }] } }),
    JSON.stringify({ payload: { type: "message", content: [{ text: "Later message" }] } }),
  ];
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  const preview = await readMessagePreview(filePath, 20);
  assert.equal(preview, "Hello world");
});

test("readMessagePreview returns null when no messages", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codex-preview-empty-"));
  const filePath = path.join(dir, "session.jsonl");
  const lines = [
    JSON.stringify({ type: "session_meta", payload: { id: "1" } }),
    JSON.stringify({ payload: { type: "event", content: [] } }),
  ];
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  const preview = await readMessagePreview(filePath, 50);
  assert.equal(preview, null);
});
