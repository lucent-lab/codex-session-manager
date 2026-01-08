import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTagSuggestion,
  buildTagIndex,
  getTagFragment,
  getTagSuggestions,
} from "../src/ui-utils";
import type { SessionRecord } from "../src/types";

test("buildTagIndex dedupes and sorts", () => {
  const sessions = [
    { filePath: "a", tags: ["Beta", "alpha"] },
    { filePath: "b", tags: ["alpha", "gamma"] },
  ] as SessionRecord[];
  const tags = buildTagIndex(sessions);
  assert.deepEqual(tags, ["alpha", "Beta", "gamma"]);
});

test("getTagSuggestions matches fragment and excludes used", () => {
  const suggestions = getTagSuggestions(
    "alpha, b",
    ["beta", "bravo", "alpha"],
    5
  );
  assert.deepEqual(suggestions, ["beta", "bravo"]);
});

test("getTagSuggestions supports empty fragment and limit", () => {
  const suggestions = getTagSuggestions("", ["beta", "alpha", "gamma"], 2);
  assert.deepEqual(suggestions, ["alpha", "beta"]);
});

test("getTagFragment splits prefix and fragment", () => {
  assert.deepEqual(getTagFragment("alpha, be"), {
    prefix: "alpha, ",
    fragment: "be",
  });
});

test("applyTagSuggestion replaces fragment", () => {
  assert.equal(applyTagSuggestion("alpha, b", "beta"), "alpha, beta");
});
