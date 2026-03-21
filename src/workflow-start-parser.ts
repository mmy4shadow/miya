import type { MiyaWorkflowStartInput } from "./workflow-commands.ts";

export function buildDefaultWorkflowStartInput(): MiyaWorkflowStartInput {
  return {
    title: "Miya workflow task",
    priority: "P2",
    acceptance: ["Replace scaffold acceptance with concrete criteria."],
    verify: ["Replace scaffold verification with concrete checks."],
    artifacts: ["Record relevant output artifacts."],
    notes: ["Created by miya-workflow-start queue-backed command."],
    next_action: "Refine this created workflow task, then let the workspace dispatcher pick it up.",
  };
}

function parseStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value).trim()).filter(Boolean);
  }
  const text = String(raw ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => String(value).trim()).filter(Boolean);
      }
    } catch {
      // Fall back to the legacy lightweight splitter for bracketed text.
    }

    return text
      .slice(1, -1)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return text
    .split(/\s*(?:\||,|;)\s*/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeParsedInput(input: Partial<MiyaWorkflowStartInput>): MiyaWorkflowStartInput {
  const defaults = buildDefaultWorkflowStartInput();
  return {
    ...defaults,
    ...input,
    title: input.title?.trim() || defaults.title,
    depends_on: input.depends_on === undefined ? defaults.depends_on : parseStringList(input.depends_on),
    acceptance: input.acceptance === undefined ? defaults.acceptance : parseStringList(input.acceptance),
    verify: input.verify === undefined ? defaults.verify : parseStringList(input.verify),
    artifacts: input.artifacts === undefined ? defaults.artifacts : parseStringList(input.artifacts),
    notes: input.notes === undefined ? defaults.notes : parseStringList(input.notes),
  };
}

export function parseWorkflowStartInput(raw?: string): MiyaWorkflowStartInput {
  const source = String(raw ?? "");
  const trimmed = source.trim();
  if (!trimmed) {
    return buildDefaultWorkflowStartInput();
  }

  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Partial<MiyaWorkflowStartInput>;
    return normalizeParsedInput(parsed);
  }

  const lines = source
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim().length > 0);

  if (lines.length === 1 && !/[:=]/.test(lines[0])) {
    return normalizeParsedInput({ title: lines[0].trim() });
  }

  const parsed: Partial<MiyaWorkflowStartInput> = {};
  let activeListKey: "depends_on" | "acceptance" | "verify" | "artifacts" | "notes" | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const bulletMatch = rawLine.match(/^\s*-\s+(.*)$/);
    if (bulletMatch && activeListKey) {
      const list = (parsed[activeListKey] ||= []);
      list.push(bulletMatch[1].trim());
      continue;
    }

    const match = line.match(/^([a-z_]+)\s*[:=]\s*(.*)$/i);
    if (!match) {
      activeListKey = null;
      (parsed.notes ||= []).push(line);
      continue;
    }

    const key = match[1].toLowerCase();
    const value = match[2].trim();
    switch (key) {
      case "title":
        activeListKey = null;
        parsed.title = value;
        break;
      case "status":
        activeListKey = null;
        parsed.status = value as MiyaWorkflowStartInput["status"];
        break;
      case "priority":
        activeListKey = null;
        parsed.priority = value;
        break;
      case "depends_on":
        activeListKey = "depends_on";
        parsed.depends_on = parseStringList(value);
        break;
      case "blocker_type":
        activeListKey = null;
        parsed.blocker_type = value as MiyaWorkflowStartInput["blocker_type"];
        break;
      case "next_action":
        activeListKey = null;
        parsed.next_action = value;
        break;
      case "acceptance":
        activeListKey = "acceptance";
        parsed.acceptance = parseStringList(value);
        break;
      case "verify":
        activeListKey = "verify";
        parsed.verify = parseStringList(value);
        break;
      case "artifacts":
        activeListKey = "artifacts";
        parsed.artifacts = parseStringList(value);
        break;
      case "notes":
        activeListKey = "notes";
        parsed.notes = parseStringList(value);
        break;
      default:
        activeListKey = null;
        (parsed.notes ||= []).push(`${key}: ${value}`);
        break;
    }
  }

  return normalizeParsedInput(parsed);
}
