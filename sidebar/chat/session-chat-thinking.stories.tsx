import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import type { SessionChatMessage } from "../../shared/session-chat";
import { SessionChatMessageList } from "./session-chat-message-list";

const STORY_MESSAGES: SessionChatMessage[] = [
  {
    id: "thought-plain-before",
    role: "reasoning",
    blocks: [{ type: "text", text: "Inspecting the current chat renderer" }],
    source: "transcript",
    timestamp: 1_000,
  },
  {
    id: "thought-with-tools",
    role: "reasoning",
    blocks: [{ type: "text", text: "Checking alignment and command previews" }],
    source: "transcript",
    timestamp: 2_000,
  },
  {
    id: "codex-exec-call",
    role: "tool",
    blocks: [
      {
        type: "tool-call",
        name: "exec",
        input: {
          cmd: "rg -n \"ghostex-chat-thinking\" sidebar/chat\nsed -n '230,330p' sidebar/styles/chat.css\nbun run typecheck\necho this-fourth-line-must-not-appear",
        },
      },
      {
        type: "tool-call",
        name: "bash",
        input:
          "git diff -- sidebar/chat/session-chat-message-list.tsx\ngit diff -- sidebar/styles/chat.css\nbun run build:sidebar-css\necho hidden-fourth-line",
      },
    ],
    source: "transcript",
    timestamp: 3_000,
  },
  {
    id: "tool-results",
    role: "tool",
    blocks: [
      { type: "tool-result", output: "Found the relevant selectors." },
      { type: "tool-result", output: "The focused build completed." },
    ],
    source: "transcript",
    timestamp: 4_000,
  },
  {
    id: "thought-plain-after",
    role: "reasoning",
    blocks: [{ type: "text", text: "Verifying the final visual rhythm" }],
    source: "transcript",
    timestamp: 5_000,
  },
  {
    id: "assistant-commentary",
    role: "assistant",
    blocks: [
      {
        type: "text",
        text: "The intermediate text reply is visible, but it must not own a copy control.",
      },
    ],
    source: "transcript",
    timestamp: 6_000,
  },
  {
    id: "assistant-final",
    role: "assistant",
    blocks: [
      {
        type: "text",
        text: "The final reply is the only agent text reply with a copy control.",
      },
    ],
    source: "transcript",
    timestamp: 7_000,
  },
];

function SessionChatThinkingStory({ verboseMode }: { verboseMode: boolean }) {
  return (
    <div
      className="ghostex-session-chat-scope flex h-screen min-h-[34rem] flex-col bg-background text-foreground"
      data-chat-theme="dark"
    >
      <SessionChatMessageList
        hasMore={false}
        isWorking={false}
        loadingEarlier={false}
        messages={STORY_MESSAGES}
        onLoadEarlier={() => undefined}
        verboseMode={verboseMode}
      />
    </div>
  );
}

function thinkingTextElements(canvasElement: HTMLElement): HTMLElement[] {
  return Array.from(
    canvasElement.querySelectorAll<HTMLElement>("[data-ghostex-thinking-text]"),
  );
}

function expectAlignedThinkingAndSpacing(canvasElement: HTMLElement): void {
  const thoughts = thinkingTextElements(canvasElement);
  expect(thoughts).toHaveLength(3);

  const rectangles = thoughts.map((thought) => thought.getBoundingClientRect());
  const leftOrigins = rectangles.map((rectangle) => rectangle.left);
  expect(Math.max(...leftOrigins) - Math.min(...leftOrigins)).toBeLessThanOrEqual(
    0.5,
  );

  expect((rectangles[1]?.top ?? 0) - (rectangles[0]?.bottom ?? 0)).toBeGreaterThanOrEqual(
    12.5,
  );
  expect((rectangles[2]?.top ?? 0) - (rectangles[1]?.bottom ?? 0)).toBeGreaterThanOrEqual(
    12.5,
  );
}

function horizontalCenter(element: Element): number {
  const rectangle = element.getBoundingClientRect();
  return rectangle.left + rectangle.width / 2;
}

const meta = {
  title: "Chat/Thinking and tool disclosures",
  component: SessionChatThinkingStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SessionChatThinkingStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const CollapsedAlignmentAndFinalCopy: Story = {
  args: { verboseMode: false },
  play: async ({ canvasElement }) => {
    expectAlignedThinkingAndSpacing(canvasElement);
    expect(
      within(canvasElement).getByRole("button", {
        name: "Checking alignment and command previews",
      }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      within(canvasElement).getAllByRole("button", { name: "Copy message" }),
    ).toHaveLength(1);
  },
};

export const ExpandedRailsAndCommandPreviews: Story = {
  args: { verboseMode: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const execRow = canvas.getByRole("button", { name: /^exec / });
    expect(execRow).toHaveTextContent(
      "rg -n \"ghostex-chat-thinking\" sidebar/chat sed -n '230,330p' sidebar/styles/chat.css bun run typecheck",
    );
    expect(execRow).not.toHaveTextContent("this-fourth-line-must-not-appear");
    expect(canvas.getByRole("button", { name: /^bash / })).toHaveTextContent(
      "git diff -- sidebar/chat/session-chat-message-list.tsx git diff -- sidebar/styles/chat.css bun run build:sidebar-css",
    );

    await userEvent.click(execRow);

    const thinkingIcon = canvasElement.querySelector(
      ".ghostex-chat-thinking-icon",
    );
    const thinkingRail = canvasElement.querySelector(
      ".ghostex-chat-thinking-detail > .ghostex-chat-expansion-rail",
    );
    const terminalIcon = execRow.querySelector(".ghostex-chat-work-icon");
    const terminalRail = execRow.parentElement?.querySelector(
      ".ghostex-chat-work-detail > .ghostex-chat-expansion-rail",
    );
    expect(thinkingIcon).not.toBeNull();
    expect(thinkingRail).not.toBeNull();
    expect(terminalIcon).not.toBeNull();
    expect(terminalRail).not.toBeNull();
    expect(
      Math.abs(
        horizontalCenter(thinkingIcon as Element) -
          horizontalCenter(thinkingRail as Element),
      ),
    ).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs(
        horizontalCenter(terminalIcon as Element) -
          horizontalCenter(terminalRail as Element),
      ),
    ).toBeLessThanOrEqual(0.5);
  },
};

export const WorkingTurnHasNoAgentCopyControl: Story = {
  args: { verboseMode: false },
  render: () => (
    <div
      className="ghostex-session-chat-scope flex h-screen min-h-[34rem] flex-col bg-background text-foreground"
      data-chat-theme="dark"
    >
      <SessionChatMessageList
        hasMore={false}
        isWorking
        loadingEarlier={false}
        messages={STORY_MESSAGES}
        onLoadEarlier={() => undefined}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).queryByRole("button", { name: "Copy message" }),
    ).not.toBeInTheDocument();
  },
};
