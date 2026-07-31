// FIFO tool-call/result pairing + tool-fold (orca §6.6b port).
// Our model's tool-results carry no back-reference to a call id, so the Nth
// call gets the Nth result in document order — the order providers emit them.

import type {
  SessionChatBlock,
  SessionChatMessage,
  SessionChatToolCallBlock,
  SessionChatToolResultBlock,
} from "../../shared/session-chat";

export function isToolOnlySessionChatMessage(message: SessionChatMessage): boolean {
  return (
    message.blocks.length > 0 &&
    message.blocks.every(
      (block) => block.type === "tool-call" || block.type === "tool-result",
    )
  );
}

/** Fold consecutive tool-only messages INTO their preceding assistant turn. */
export function foldSessionChatToolMessages(
  messages: readonly SessionChatMessage[],
): SessionChatMessage[] {
  const output: SessionChatMessage[] = [];
  let mutableAssistantIndex = -1;
  for (const message of messages) {
    const previous = output.at(-1);
    if (isToolOnlySessionChatMessage(message) && previous?.role === "assistant") {
      const index = output.length - 1;
      if (mutableAssistantIndex !== index) {
        output[index] = { ...previous, blocks: [...previous.blocks] };
        mutableAssistantIndex = index;
      }
      (output[index] as SessionChatMessage).blocks.push(...message.blocks);
    } else {
      output.push(message);
      mutableAssistantIndex = -1;
    }
  }
  return output;
}

export interface SessionChatToolPair {
  call?: SessionChatToolCallBlock;
  result?: SessionChatToolResultBlock;
}

/** Per-message-block-list FIFO pairing. */
export function pairSessionChatToolBlocks(
  blocks: readonly SessionChatBlock[],
  limit: number = Number.POSITIVE_INFINITY,
): SessionChatToolPair[] {
  const pairs: SessionChatToolPair[] = [];
  const callSlots: (number | null)[] = [];
  let resultOrdinal = 0;
  for (const block of blocks) {
    if (block.type === "tool-call") {
      if (pairs.length < limit) {
        callSlots.push(pairs.length);
        pairs.push({ call: block });
      } else {
        callSlots.push(null);
      }
    } else if (block.type === "tool-result") {
      const slot = callSlots[resultOrdinal];
      if (slot === undefined) {
        // Orphan result.
        if (pairs.length < limit) {
          pairs.push({ result: block });
        }
      } else {
        resultOrdinal += 1;
        if (slot !== null) {
          const pair = pairs[slot];
          if (pair) {
            pair.result = block;
          }
        }
      }
    }
  }
  return pairs;
}

export interface SessionChatSplitBlocks {
  prose: SessionChatBlock[];
  tools: (SessionChatToolCallBlock | SessionChatToolResultBlock)[];
}

export function splitSessionChatBlocks(
  blocks: readonly SessionChatBlock[],
): SessionChatSplitBlocks {
  const prose: SessionChatBlock[] = [];
  const tools: (SessionChatToolCallBlock | SessionChatToolResultBlock)[] = [];
  for (const block of blocks) {
    if (block.type === "tool-call" || block.type === "tool-result") {
      tools.push(block);
    } else {
      prose.push(block);
    }
  }
  return { prose, tools };
}
