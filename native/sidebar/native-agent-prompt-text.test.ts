import { describe, expect, test } from "bun:test";

import {
  AGENT_PROMPT_MAX_LINES_PER_CHUNK,
  splitAgentPromptTextIntoLineChunks,
} from "./native-agent-prompt-text";

describe("splitAgentPromptTextIntoLineChunks", () => {
  test("returns a single chunk when the prompt is within the line limit", () => {
    const prompt = Array.from({ length: AGENT_PROMPT_MAX_LINES_PER_CHUNK }, (_, index) => `line-${index + 1}`).join(
      "\n",
    );

    expect(splitAgentPromptTextIntoLineChunks(prompt)).toEqual([prompt]);
  });

  test("splits prompts into five-line chunks that reconstruct the original text", () => {
    const lineCount = AGENT_PROMPT_MAX_LINES_PER_CHUNK * 2 + 3;
    const prompt = Array.from({ length: lineCount }, (_, index) => `line-${index + 1}`).join("\n");
    const chunks = splitAgentPromptTextIntoLineChunks(prompt);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.split("\n")).toHaveLength(AGENT_PROMPT_MAX_LINES_PER_CHUNK);
    expect(chunks[1]?.split("\n")).toHaveLength(AGENT_PROMPT_MAX_LINES_PER_CHUNK);
    expect(chunks[2]?.split("\n")).toHaveLength(3);
    expect(chunks.join("\n")).toBe(prompt);
  });

  test("normalizes CRLF before chunking", () => {
    const prompt = "alpha\r\nbeta\r\ngamma";
    expect(splitAgentPromptTextIntoLineChunks(prompt)).toEqual(["alpha\nbeta\ngamma"]);
  });

  test("preserves blank lines across chunk boundaries", () => {
    const prompt = ["one", "two", "", "four"].join("\n");
    const chunks = splitAgentPromptTextIntoLineChunks(prompt, 2);

    expect(chunks).toEqual(["one\ntwo", "\nfour"]);
    expect(chunks.join("\n")).toBe(prompt);
  });
});
