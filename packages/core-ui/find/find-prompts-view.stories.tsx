/**
 * Search by Prompt (the GUI for `ghostex f`) with a canned transport, so the
 * loading skeleton, the loaded list, and the toolbar states render without
 * gxserver.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { FindPromptRow, SearchAgentPromptsResult } from '@/packages/shared/agent-prompt-search';
import { FindPromptsView } from './find-prompts-view';
import type { FindPromptsTransport } from './find-prompts-transport';

const AGENT_COLORS: Record<string, string> = {
  claude: '#d97757',
  codex: '#8b9bd8',
  cursor: '#8ad2a2',
  grok: '#c0c0c0',
  opencode: '#e9c46a',
  pi: '#f28ea3',
};

const SAMPLE_PROMPTS: [FindPromptRow['agent'], string, string, string, number][] = [
  [
    'claude',
    'please instead of the loading show skeleton that fits how the actual list shows up',
    'Find skeleton and toolbar',
    'Ghostex',
    120,
  ],
  ['codex', 'Fix light mode separators in the sidebar group headers', 'Fix light mode separators', 'Ghostex', 480],
  [
    'claude',
    'Windows & wmx & Powershell: make the ConPTY resize match zmx',
    'Windows & wmx & Powershell',
    'Ghostex',
    500,
  ],
  [
    'codex',
    'Active session sidebar styling should use the accent hairline',
    'Active session sidebar styling',
    'Ghostex',
    540,
  ],
  ['cursor', 'Add project button and auto-assign to space', 'Add project button', 'Ghostex', 1_320],
  [
    'claude',
    'Reduce clipboard app RAM usage by dropping the image cache',
    'Reduce clipboard app RAM usage',
    'clipboard-gx',
    4 * 3_600,
  ],
  ['pi', 'Review and merge PR #137 after the resume fix lands', 'Review and merge PR #137', 'Ghostex', 5 * 3_600],
  ['codex', 'Fix context menus and themes on the Kanban board', 'Fix context menus and themes', 'Ghostex', 26 * 3_600],
  [
    'claude',
    'Enable agent chat in React Native for the mobile app',
    'Enable agent chat in React Native',
    'Ghostex',
    27 * 3_600,
  ],
  ['opencode', 'Disable cua-driver MCP while the Tart VM is offline', 'Disable cua-driver MCP', 'Ghostex', 30 * 3_600],
  ['claude', 'Fix Claude status card sizing in the sidebar', 'Fix Claude status card', 'Ghostex', 50 * 3_600],
  ['grok', 'Write the changelog draft for 0.9.4 grouped by theme', 'Changelog draft', 'Ghostex', 52 * 3_600],
];

const NOW = Math.floor(Date.now() / 1000);

const ROWS: FindPromptRow[] = SAMPLE_PROMPTS.map(([agent, text, title, projectName, ageSeconds], index) => {
  const ts = NOW - ageSeconds;
  return {
    agent,
    agentColor: AGENT_COLORS[agent],
    dayKey: Math.floor(ts / 86_400),
    favorite: index === 1,
    highlights: [],
    index,
    key: `prompt-${index}`,
    meta: {
      model: 'claude-fable-5-1',
      plan: 'max',
      provider: 'anthropic',
      thinking: 'adaptive',
      usage: { cacheRead: 0, cacheWrite: 0, contextWindow: 0, cost: 0, input: 0, output: 0, ratePercent: 0, total: 0 },
    },
    project: `/Users/me/dev/${projectName}`,
    projectName,
    score: 1,
    sessionId: `session-${index}`,
    text,
    textLength: text.length,
    title,
    truncated: false,
    ts,
  };
});

function createStoryTransport(rows: readonly FindPromptRow[] | 'pending'): FindPromptsTransport {
  return {
    async copyText() {},
    async readText({ key }) {
      const row = ROWS.find((candidate) => candidate.key === key);
      return {
        key,
        text: row ? `${row.text}\n\nKeep the change scoped to the Find surface and match the Sessions tab sizes.` : '',
      };
    },
    async resolveLaunch() {
      throw new Error('Launching is not available in Storybook.');
    },
    search({ agents, project, query }) {
      if (rows === 'pending') {
        return new Promise<SearchAgentPromptsResult>(() => undefined);
      }
      const needle = (query ?? '').trim().toLowerCase();
      const matched = rows.filter(
        (row) =>
          (!needle || row.text.toLowerCase().includes(needle)) &&
          (!agents || agents.length === 0 || agents.includes(row.agent)) &&
          (!project || row.project === project)
      );
      return Promise.resolve({
        agents: Object.entries(AGENT_COLORS).map(([agent, color]) => ({
          agent: agent as FindPromptRow['agent'],
          color,
          present: true,
        })),
        indexEpoch: 1,
        indexedAt: NOW,
        matched: matched.length,
        offset: 0,
        projects: [
          { name: 'Ghostex', path: '/Users/me/dev/Ghostex' },
          { name: 'clipboard-gx', path: '/Users/me/dev/clipboard-gx' },
        ],
        rows: matched,
        total: rows.length,
      });
    },
    async toggleFavorite({ key }) {
      return { favorite: true, key };
    },
  };
}

function Frame({ transport }: { transport: FindPromptsTransport }) {
  return (
    <div className='ghostex-root h-screen w-full bg-[#111111] text-foreground dark' data-sidebar-theme='plain-dark'>
      <FindPromptsView transport={transport} />
    </div>
  );
}

const meta: Meta<typeof Frame> = {
  component: Frame,
  parameters: { layout: 'fullscreen' },
  title: 'Find/Search by Prompt',
};

export default meta;

type Story = StoryObj<typeof Frame>;

export const Loading: Story = { args: { transport: createStoryTransport('pending') } };
export const Loaded: Story = { args: { transport: createStoryTransport(ROWS) } };
