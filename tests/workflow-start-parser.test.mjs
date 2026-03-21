import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const parserModule = await import(pathToFileURL(path.resolve("F:/openclaw/miya/src/workflow-start-parser.ts")).href);

test("parseWorkflowStartInput preserves JSON array values instead of splitting inner commas", () => {
  const result = parserModule.parseWorkflowStartInput(JSON.stringify({
    title: "Bulletproof parser",
    acceptance: ["Supports commas, like a, b, and c", "Keeps full string intact"],
    verify: ["node ./scripts/check.mjs"],
  }));

  assert.equal(result.title, "Bulletproof parser");
  assert.deepEqual(result.acceptance, [
    "Supports commas, like a, b, and c",
    "Keeps full string intact",
  ]);
  assert.deepEqual(result.verify, ["node ./scripts/check.mjs"]);
});

test("parseWorkflowStartInput supports multiline bullet sections for list fields", () => {
  const result = parserModule.parseWorkflowStartInput([
    "title: Workflow parser hardening",
    "priority: P1",
    "acceptance:",
    "  - Handles markdown bullet input",
    "  - Keeps multi word entries stable",
    "verify:",
    "  - npm test",
    "artifacts:",
    "  - tests/workflow-start-parser.test.mjs",
    "notes:",
    "  - Verified: parser accepts multiline bullets.",
    "next_action: Ship the parser improvement.",
  ].join("\n"));

  assert.deepEqual(result.acceptance, [
    "Handles markdown bullet input",
    "Keeps multi word entries stable",
  ]);
  assert.deepEqual(result.verify, ["npm test"]);
  assert.deepEqual(result.artifacts, ["tests/workflow-start-parser.test.mjs"]);
  assert.deepEqual(result.notes, ["Verified: parser accepts multiline bullets."]);
  assert.equal(result.next_action, "Ship the parser improvement.");
});
