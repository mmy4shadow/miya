import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/miya-runtime.ts")).href;
const { registerPromptProbe } = await import(moduleUrl);

test("registerPromptProbe assembles guard persona and memory blocks into prependSystemContext", async () => {
  const handlers = new Map();
  const api = {
    pluginConfig: {
      pluginRoot: "F:/openclaw/miya",
      memoryLite: {
        enabled: true,
        provider: "local-embedding",
        maxRecallItems: 2,
      },
      personaLite: {
        enabled: true,
        profileName: "miya-default",
        styleTags: ["sweet", "playful"],
      },
    },
    on(name, handler) {
      handlers.set(name, handler);
    },
    logger: {},
  };

  registerPromptProbe(api);
  const beforePromptBuild = handlers.get("before_prompt_build");
  assert.ok(beforePromptBuild);

  const result = await beforePromptBuild({
    prompt: "帮我记住你要先截图再点 Excel",
  });

  assert.ok(result.prependSystemContext.includes("[System: 核心身份与物理边界规约]"));
  assert.ok(result.prependSystemContext.includes("[Persona block]"));
  assert.ok(result.prependSystemContext.includes("[Memory recall]") || result.prependSystemContext.includes("Relevant recalled context"));
});
