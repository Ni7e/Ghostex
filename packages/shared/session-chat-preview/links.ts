import type { SessionChatMessage } from '../session-chat';
import { previewMessage } from './message';

/*
 * Every clickable reference the chat can draw, in one conversation.
 *
 * The lab shows the host request a click produces instead of opening anything,
 * so a pill clicked in the GPUI pane and the same pill clicked in the React
 * pane can be compared as the `openFile` / `openLink` payload each one sends.
 * The refusals matter as much as the references: ordinary code an agent writes
 * in the same sentence must stay plain inline code in both renderers.
 */

/** What somebody types into the composer: unmarked paths and explicit `@` mentions. */
const TYPED = `Please add both borders. The search row is in packages/core-ui/styles/chat.css:913 and the sidebar root is in @apps/desktop/src/app/native_sidebar/render.rs.

Notes are in @"sample notes/border plan.md" and the folder to look at is /sample/project/src. Run npm install first if node_modules is missing.`;

/**
 * An answer of the shape agents actually write: the paths that matter are
 * inline code in the middle of a sentence, beside inline code that is not a
 * path at all.
 */
const ANSWER = `Both borders are added and the desktop crate compiles cleanly.

**Search row bottom border** in \`apps/desktop/src/app/native_sidebar/navigation.rs:41\`. The Search row now draws a 1px bottom hairline using the same color as the Commands row's top hairline, \`chrome_ink().opacity(0.12)\`. Both rows now share a single \`border_color\` call, so they cannot drift apart.

**Sidebar right border** in \`apps/desktop/src/app/native_sidebar/render.rs:87\`. The sidebar root draws a 1px right edge with \`chrome_color(0x252525, 0xd4d4d4)\`, matching the hairline the titlebar already uses.

The shared rule that decides which of these is a reference is \`packages/shared/session-chat-presentation/file-paths.ts:116:3\`, and the two renderers read it through \`packages/core-ui/chat/session-chat-file-paths.ts\` and \`packages/shared/session-chat-presentation/native-markdown.ts\`.

Verification: \`cargo check\` from inside \`apps/desktop/\` finishes with no errors, and \`bun run typecheck\` is clean.`;

/** One message per reference family, so a pass can walk the whole vocabulary. */
const CATALOG = `## Markdown links

[Relative file](src/chat.ts:42:8) · [File with spaces](/sample/My%20Project/chat.ts:9) · [File URL](file:///sample/project/chat.ts:12) · [Website](https://example.com/docs)

Named references: [File #1](/sample/project/src/chat.ts), [Folder #2](/sample/project/src), [Image #3](/sample/project/media/shot.png), [$ghostex-help](/sample/home/.ghostex/skills/ghostex-help/SKILL.md).

## Inline code that is a file reference

Relative \`src/chat.ts\`, with a line \`src/chat.ts:42\`, with a line and column \`src/chat.ts:42:8\`, with a line range \`docs/plan.md:12-20\`, absolute \`/sample/project/src/chat.ts:7\`, home-relative \`~/.zshrc\`, dot-relative \`./scripts/build.sh\` and \`../shared/index.ts:3\`, Windows \`C:\\sample\\project\\chat.ts:9\`, and an extensionless name with a line \`Makefile:12\`.

## Inline code that is not a file reference

\`cargo check\`, \`chrome_ink().opacity(0.12)\`, \`npm install\`, \`Array.map\`, \`origin/main\`, \`v1.2.3\`, \`example.com/x.html\`, \`src/utils\`, \`text/plain\`, \`p99.9\`, \`apps/desktop/\`, \`--flag\`, \`key=value\`, \`README.md\`.

## Inside other blocks

- A list item naming \`packages/shared/session-chat-presentation/links.ts:16\`.

> [!NOTE]
> An alert naming \`server/src/agent_prompt_search.rs:88\` and [a link](src/chat.ts:5).

| Surface | File |
| --- | --- |
| Chat | \`packages/core-ui/chat/session-chat-markdown.tsx:892\` |
| Native | \`apps/desktop/src/app/native_chat/rich_markdown.rs:409\` |

## A fenced block that names its file

\`\`\`ts src/chat.ts
export const title = 'Shared conversation';
\`\`\`

A picture written into prose: ![Border sample](/sample/project/media/shot.png)

And a bare web address: https://example.com/reference`;

export const LINKS_PREVIEW_MESSAGES: SessionChatMessage[] = [
  previewMessage('1', 'user', TYPED),
  previewMessage('2', 'assistant', ANSWER),
  previewMessage('3', 'assistant', CATALOG),
];
