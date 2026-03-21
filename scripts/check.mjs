import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredPaths = [
  "openclaw.plugin.json",
  "package.json",
  "README.md",
  "src/index.ts",
  "src/config.ts",
  "src/desktop-tools.ts",
  "src/miya-runtime.ts",
  "src/sidecar-client.ts",
  "src/media-tools.ts",
  "src/voice-sidecar-client.ts",
  "src/image-sidecar-client.ts",
  "src/workflow-contract.ts",
  "src/workflow-state.ts",
  "src/workflow-queue.ts",
  "src/workflow-commands.ts",
  "src/workflow-render.ts",
  "src/workflow-start-parser.ts",
  "src/workloop.ts",
  "tests/dispatcher-selftest.test.mjs",
  "tests/workloop.test.mjs",
  "tests/workflow-queue.test.mjs",
  "worker/desktop_worker.py",
  "worker/image_sidecar.py",
  "worker/ping_worker.py",
  "worker/voice_sidecar.py",
  "skill/miya-probe/SKILL.md",
];

function fail(message) {
  console.error(`[miya-check] ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`[miya-check] ${message}`);
}

for (const rel of requiredPaths) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    fail(`missing required path: ${rel}`);
  }
}

const manifestPath = path.join(root, "openclaw.plugin.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.id !== "miya") {
  fail(`unexpected plugin id: ${manifest.id}`);
}
if (!Array.isArray(manifest.skills) || !manifest.skills.includes("./skill")) {
  fail("plugin manifest must expose ./skill");
}
if (!manifest.configSchema?.properties?.desktopWorker) {
  fail("plugin manifest missing desktopWorker schema");
}
if (!manifest.configSchema?.properties?.personaLite) {
  fail("plugin manifest missing personaLite schema");
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (packageJson.name !== "miya") {
  fail(`unexpected package name: ${packageJson.name}`);
}
if (!packageJson.openclaw?.extensions?.includes("./src/index.ts")) {
  fail("package.json missing ./src/index.ts in openclaw.extensions");
}

const workerDir = path.join(root, "worker");
const workerFiles = fs.readdirSync(workerDir).filter((name) => name.endsWith(".py"));
ok(`worker python files: ${workerFiles.join(", ") || "none"}`);

const srcDir = path.join(root, "src");
const tsFiles = fs.readdirSync(srcDir).filter((name) => name.endsWith(".ts"));
ok(`source modules: ${tsFiles.length}`);

const workflowQueuePath = path.join(root, "src", "workflow-queue.ts");
const workflowQueueSource = fs.readFileSync(workflowQueuePath, "utf8");
if (!workflowQueueSource.includes("const LIST_FIELDS = [\"acceptance\", \"verify\", \"artifacts\", \"notes\"] as const;")) {
  fail("workflow-queue parser is missing the shared list field contract");
}
if (!workflowQueueSource.includes("const listSections = new Set(LIST_FIELDS)")) {
  fail("workflow-queue parser is missing list section handling for shared TASK_QUEUE.md fields");
}
if (!workflowQueueSource.includes('if (listSections.has(key))')) {
  fail("workflow-queue parser no longer recognizes list section headers from TASK_QUEUE.md");
}
if (!workflowQueueSource.includes("function validateDoneTransition(")) {
  fail("workflow-queue is missing strict done-transition validation");
}
if (!workflowQueueSource.includes("export function applyWorkflowTaskPatchToMarkdown(")) {
  fail("workflow-queue is missing markdown patch helper coverage for workflow updates");
}

if (!process.exitCode) {
  ok("manifest, layout, and worker entrypoints look consistent");
}
