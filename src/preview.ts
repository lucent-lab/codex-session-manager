import { createReadStream } from "node:fs";
import readline from "node:readline";

type MessageContentPart = {
  text?: string;
  input_text?: string;
  output_text?: string;
};

type MessagePayload = {
  type?: string;
  content?: MessageContentPart[];
};

type JsonLine = {
  payload?: MessagePayload;
};

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function extractMessageText(payload: MessagePayload): string {
  if (!payload || payload.type !== "message") {
    return "";
  }
  const content = payload.content;
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const text =
      typeof part.text === "string"
        ? part.text
        : typeof part.input_text === "string"
        ? part.input_text
        : typeof part.output_text === "string"
        ? part.output_text
        : "";
    if (text) {
      parts.push(text);
    }
  }
  return normalizeWhitespace(parts.join(" "));
}

export function extractPreviewFromLine(line: string): string | null {
  let parsed: JsonLine;
  try {
    parsed = JSON.parse(line) as JsonLine;
  } catch {
    return null;
  }
  if (!parsed.payload || typeof parsed.payload !== "object") {
    return null;
  }
  const text = extractMessageText(parsed.payload);
  if (!text) {
    return null;
  }
  return text;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= 3) {
    return text.slice(0, maxChars);
  }
  return `${text.slice(0, maxChars - 3)}...`;
}

export async function readMessagePreview(
  filePath: string,
  maxChars: number
): Promise<string | null> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      const preview = extractPreviewFromLine(line);
      if (preview) {
        return truncate(preview, maxChars);
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return null;
}
