export type PromptAssemblyInput = {
  guardBlock: string;
  personaBlock: string;
  memoryBlock: string;
  charBudget?: number;
};

export type PromptAssemblyResult = {
  combinedText: string;
  charCount: number;
  truncated: boolean;
  debug: {
    guardChars: number;
    personaChars: number;
    memoryChars: number;
    charBudget: number;
  };
};

function joinBlocks(guardBlock: string, personaBlock: string, memoryBlock: string) {
  return [guardBlock, personaBlock, memoryBlock].filter(Boolean).join("\n\n").trim();
}

export function assembleMiyaPromptPrefix(input: PromptAssemblyInput): PromptAssemblyResult {
  const charBudget = Math.max(input.charBudget ?? 4000, 80);
  let guardBlock = input.guardBlock.trim();
  let personaBlock = input.personaBlock.trim();
  let memoryBlock = input.memoryBlock.trim();

  let combined = joinBlocks(guardBlock, personaBlock, memoryBlock);
  let truncated = false;

  if (combined.length > charBudget && memoryBlock) {
    memoryBlock = "";
    combined = joinBlocks(guardBlock, personaBlock, memoryBlock);
    truncated = true;
  }

  if (combined.length > charBudget && personaBlock) {
    const personaLines = personaBlock.split(/\r?\n/);
    personaBlock = personaLines.slice(0, Math.max(personaLines.length - 2, 1)).join("\n");
    combined = joinBlocks(guardBlock, personaBlock, memoryBlock);
    truncated = true;
  }

  return {
    combinedText: combined,
    charCount: combined.length,
    truncated,
    debug: {
      guardChars: guardBlock.length,
      personaChars: personaBlock.length,
      memoryChars: memoryBlock.length,
      charBudget,
    },
  };
}
