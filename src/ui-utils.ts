import type { SessionRecord } from "./types";
import { parseTagsInput } from "./session-store";

export function buildTagIndex(sessions: SessionRecord[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const session of sessions) {
    for (const tag of session.tags) {
      const key = tag.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(tag);
    }
  }
  result.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return result;
}

export function getTagFragment(input: string): { prefix: string; fragment: string } {
  const match = input.match(/^(.*?)([^,\s]*)$/);
  if (!match) {
    return { prefix: input, fragment: "" };
  }
  return { prefix: match[1], fragment: match[2] };
}

export function getTagSuggestions(
  input: string,
  allTags: string[],
  limit: number
): string[] {
  if (!allTags.length) {
    return [];
  }
  const { fragment } = getTagFragment(input);
  const fragmentLower = fragment.toLowerCase();
  const used = parseTagsInput(input);
  const usedSet = new Set(used.map((tag) => tag.toLowerCase()));
  if (fragmentLower) {
    usedSet.delete(fragmentLower);
  }

  const matches = allTags.filter((tag) => {
    const lower = tag.toLowerCase();
    if (usedSet.has(lower)) {
      return false;
    }
    if (!fragmentLower) {
      return true;
    }
    return lower.startsWith(fragmentLower);
  });

  matches.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return matches.slice(0, limit);
}

export function applyTagSuggestion(input: string, suggestion: string): string {
  const { prefix } = getTagFragment(input);
  return `${prefix}${suggestion}`;
}
