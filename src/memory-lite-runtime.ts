import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveMemoryLiteConfig, type MiyaPluginConfig } from "./config.ts";

export type MemoryLiteRecord = {
  id: string;
  text?: string;
  summary?: string;
  tags?: string[];
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  lastAccessAt?: string;
  importance?: number;
  embedding?: number[];
  tokenEstimate?: number;
};

export type MemoryLiteRecallItem = {
  id: string;
  content: string;
  score: number;
  tags: string[];
  usedSummary?: boolean;
};

export type MemoryLiteRecallResult = {
  enabled: boolean;
  provider: string;
  items: MemoryLiteRecallItem[];
  block: string;
  truncated: boolean;
  debug: {
    queryText: string;
    charBudget: number;
    indexPath: string;
    totalCandidates: number;
  };
};

function getIndexPath(config?: MiyaPluginConfig) {
  const pluginRoot = config?.pluginRoot?.trim() || "F:\\openclaw\\miya";
  return path.join(pluginRoot, "state", "memory-lite", "index.json");
}

function tokenize(text: string) {
  return Array.from(new Set((text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []).filter(Boolean)));
}

function computeEmbeddingHint(queryText: string): number[] | null {
  const tokens = tokenize(queryText);
  if (!tokens.length) {
    return null;
  }
  const desktopWords = ["excel", "desktop", "window", "click", "screen", "capture", "截图", "窗口", "桌面", "点击"];
  const personaWords = ["称呼", "persona", "宝宝", "喜欢", "偏好", "关系"];
  return [
    tokens.some((token) => desktopWords.some((word) => token.includes(word) || word.includes(token))) ? 1 : 0,
    tokens.some((token) => personaWords.some((word) => token.includes(word) || word.includes(token))) ? 1 : 0,
  ];
}

function dot(left: number[] | undefined, right: number[] | null) {
  if (!left || !right || left.length !== right.length) {
    return 0;
  }
  return left.reduce((sum, value, index) => sum + (value * right[index]), 0);
}

function scoreRecord(record: MemoryLiteRecord, queryText: string) {
  const queryTokens = tokenize(queryText);
  const content = `${record.text ?? ""} ${record.summary ?? ""} ${(record.tags ?? []).join(" ")}`.trim().toLowerCase();
  const tagSet = new Set((record.tags ?? []).map((tag) => String(tag).toLowerCase()));
  const tokenHits = queryTokens.filter((token) => content.includes(token)).length;
  const tagHits = queryTokens.filter((token) => tagSet.has(token)).length;
  const recency = record.lastAccessAt ? (Date.parse(record.lastAccessAt) / 1e12) : 0;
  const importance = Number(record.importance ?? 0);
  const embeddingScore = dot(record.embedding, computeEmbeddingHint(queryText));
  return (tokenHits * 3) + (tagHits * 2) + importance + embeddingScore + recency;
}

function buildBlock(items: MemoryLiteRecallItem[]) {
  if (!items.length) {
    return "";
  }
  return [
    "[Memory recall]",
    ...items.map((item, index) => `${index + 1}. ${item.content}`),
  ].join("\n");
}

export async function recallMemoryLite(
  queryText: string,
  config?: MiyaPluginConfig,
  options?: { charBudget?: number },
): Promise<MemoryLiteRecallResult> {
  const resolved = resolveMemoryLiteConfig(config);
  const indexPath = getIndexPath(config);
  const charBudget = Math.max(options?.charBudget ?? 1400, 80);
  if (!resolved.enabled || resolved.provider === "none") {
    return {
      enabled: false,
      provider: resolved.provider,
      items: [],
      block: "",
      truncated: false,
      debug: { queryText, charBudget, indexPath, totalCandidates: 0 },
    };
  }

  let rawItems: MemoryLiteRecord[] = [];
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    rawItems = [];
  }

  const ranked = rawItems
    .map((record) => ({
      record,
      score: scoreRecord(record, queryText),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(resolved.maxRecallItems ?? 4, 1))
    .map(({ record, score }) => ({
      id: record.id,
      content: String(record.text ?? record.summary ?? "").trim(),
      score,
      tags: Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)) : [],
      usedSummary: false,
      summary: String(record.summary ?? "").trim(),
    }));

  let truncated = false;
  for (const item of ranked) {
    const candidateBlock = buildBlock(ranked.map(({ summary, ...rest }) => rest));
    if (candidateBlock.length <= charBudget) {
      break;
    }
    if (item.summary && item.content !== item.summary) {
      item.content = item.summary;
      item.usedSummary = true;
      truncated = true;
    }
  }

  let compact = ranked.map(({ summary, ...rest }) => rest);
  while (buildBlock(compact).length > charBudget && compact.length > 0) {
    compact = compact.slice(0, -1);
    truncated = true;
  }

  return {
    enabled: true,
    provider: resolved.provider,
    items: compact,
    block: buildBlock(compact),
    truncated,
    debug: {
      queryText,
      charBudget,
      indexPath,
      totalCandidates: rawItems.length,
    },
  };
}
