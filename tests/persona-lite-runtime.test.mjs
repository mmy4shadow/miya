import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/persona-lite-runtime.ts")).href;
const { buildPersonaLiteBlock } = await import(moduleUrl);

test("buildPersonaLiteBlock produces a structured persona block with recalled context", () => {
  const result = buildPersonaLiteBlock({
    pluginRoot: "F:/openclaw/miya",
    personaLite: {
      enabled: true,
      profileName: "miya-default",
      styleTags: ["sweet", "playful"],
      injectionMode: "static",
      fallbackStrategy: "static-summary",
    },
  }, {
    items: [
      { id: "1", content: "偏好称呼：宝宝", score: 0.92, tags: ["persona"] },
      { id: "2", content: "点 Excel 前先截图", score: 0.88, tags: ["desktop"] },
    ],
  });

  assert.equal(result.enabled, true);
  assert.ok(result.block.includes("Identity"));
  assert.ok(result.block.includes("Tone"));
  assert.ok(result.block.includes("Boundaries"));
  assert.ok(result.block.includes("Relevant recalled context"));
  assert.ok(result.block.includes("偏好称呼：宝宝"));
  assert.ok(result.block.includes("点 Excel 前先截图"));
});
