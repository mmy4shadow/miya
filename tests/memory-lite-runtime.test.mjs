import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(path.resolve("F:/openclaw/miya/src/memory-lite-runtime.ts")).href;
const { recallMemoryLite } = await import(moduleUrl);

function makeConfig(root) {
  return {
    pluginRoot: root,
    modelRoot: path.join(root, "model"),
    memoryLite: {
      enabled: true,
      provider: "local-embedding",
      collection: "miya-test",
      maxRecallItems: 3,
      fallbackStrategy: "identity-only",
    },
  };
}

function writeIndex(root, items) {
  const dir = path.join(root, "state", "memory-lite");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({
    collection: "miya-test",
    createdAt: new Date().toISOString(),
    items,
  }, null, 2), "utf8");
}

test("recallMemoryLite ranks relevant items and respects maxRecallItems", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-memory-"));
  try {
    writeIndex(root, [
      {
        id: "1",
        text: "主人偏好在桌面自动化前先截图检查 Excel 窗口状态。",
        summary: "截图后再点 Excel",
        tags: ["desktop", "excel"],
        importance: 0.9,
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
        lastAccessAt: "2026-03-22T00:00:00.000Z",
        embedding: [0.92, 0.1],
      },
      {
        id: "2",
        text: "主人喜欢被叫作宝宝。",
        summary: "偏好称呼：宝宝",
        tags: ["persona"],
        importance: 0.7,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
        lastAccessAt: "2026-03-20T00:00:00.000Z",
        embedding: [0.1, 0.95],
      },
      {
        id: "3",
        text: "训练数据输出目录必须保留 adapter 权重和 metadata。",
        summary: "训练输出需保留权重和 metadata",
        tags: ["training"],
        importance: 0.8,
        createdAt: "2026-03-21T00:00:00.000Z",
        updatedAt: "2026-03-21T00:00:00.000Z",
        lastAccessAt: "2026-03-21T00:00:00.000Z",
        embedding: [0.7, 0.15],
      },
      {
        id: "4",
        text: "无关记忆。",
        summary: "无关",
        tags: ["other"],
        importance: 0.1,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
        lastAccessAt: "2026-03-01T00:00:00.000Z",
        embedding: [0.01, 0.01],
      },
    ]);

    const result = await recallMemoryLite("请帮我先看一下 Excel 窗口，再决定怎么点", makeConfig(root));
    assert.equal(result.enabled, true);
    assert.equal(result.items.length, 3);
    assert.equal(result.items[0].id, "1");
    assert.ok(result.block.includes("Excel"));
    assert.equal(result.truncated, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recallMemoryLite degrades long text to summary when budget is exceeded", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miya-memory-"));
  try {
    writeIndex(root, [
      {
        id: "1",
        text: "这是非常长的记忆。".repeat(200),
        summary: "长记忆摘要",
        tags: ["persona"],
        importance: 1,
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
        lastAccessAt: "2026-03-22T00:00:00.000Z",
        embedding: [1, 0],
      },
    ]);

    const result = await recallMemoryLite("请记住我的称呼偏好", makeConfig(root), { charBudget: 80 });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].content, "长记忆摘要");
    assert.equal(result.truncated, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
