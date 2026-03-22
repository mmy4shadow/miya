import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/prompt-assembly.ts")).href;
const { assembleMiyaPromptPrefix } = await import(moduleUrl);

test("assembleMiyaPromptPrefix preserves block order guard -> persona -> recall", () => {
  const result = assembleMiyaPromptPrefix({
    guardBlock: "GUARD",
    personaBlock: "PERSONA",
    memoryBlock: "MEMORY",
    charBudget: 200,
  });

  assert.equal(result.combinedText.indexOf("GUARD") < result.combinedText.indexOf("PERSONA"), true);
  assert.equal(result.combinedText.indexOf("PERSONA") < result.combinedText.indexOf("MEMORY"), true);
  assert.equal(result.truncated, false);
});

test("assembleMiyaPromptPrefix trims memory first when over budget", () => {
  const result = assembleMiyaPromptPrefix({
    guardBlock: "GUARD",
    personaBlock: "PERSONA",
    memoryBlock: "M".repeat(500),
    charBudget: 40,
  });

  assert.equal(result.truncated, true);
  assert.ok(result.combinedText.includes("GUARD"));
  assert.ok(result.combinedText.includes("PERSONA"));
  assert.equal(result.combinedText.includes("MMMM"), false);
});
