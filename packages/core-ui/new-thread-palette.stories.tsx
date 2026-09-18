import type { Meta, StoryObj } from '@storybook/react-vite';
import type { SidebarAgentButton } from '@/packages/shared/sidebar-agents';
import { NewThreadPalette } from './new-thread-palette';

const noop = () => undefined;

const AGENTS: SidebarAgentButton[] = [
  { agentId: 'codex', command: 'codex', icon: 'codex', isDefault: true, name: 'Codex' },
  { agentId: 'claude', command: 'claude', icon: 'claude', isDefault: false, name: 'Claude' },
  { agentId: 'cursor', command: 'cursor-agent', icon: 'cursor-cli', isDefault: false, name: 'Cursor CLI' },
  { agentId: 'grok', command: 'grok', icon: 'grok-build', isDefault: false, name: 'Grok Build' },
  { agentId: 'hermes', command: 'hermes', icon: 'hermes-agent', isDefault: false, name: 'Hermes Agent' },
  { agentId: 'pi', command: 'pi', icon: 'pi', isDefault: false, name: 'Pi Agent' },
  { agentId: 'omp', command: 'omp', icon: 'omp', isDefault: false, name: 'OMP' },
  { agentId: 'antigravity', command: 'agy', icon: 'antigravity-cli', isDefault: false, name: 'Antigravity CLI' },
  { agentId: 'zcode', command: 'zcode', icon: 'zcode', isDefault: false, name: 'ZCode' },
];

/**
 * The New Thread palette (Cmd+Shift+T) is drawn natively in the desktop app,
 * so these stories are the React twin the native picker is compared against.
 * Switch the "modalTheme" toolbar global to review the light appearance.
 */
function NewThreadPaletteStory({ agents = AGENTS }: { agents?: SidebarAgentButton[] }) {
  return (
    <NewThreadPalette
      agents={agents}
      isOpen
      onOpenChange={noop}
      openRequestSequence={1}
      vscode={{ postMessage: noop }}
    />
  );
}

const meta = {
  title: 'Modals/App Host/New Thread',
  parameters: {
    layout: 'fullscreen',
  },
  render: () => <NewThreadPaletteStory />,
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Agents: Story = {};

export const Light: Story = {
  globals: { modalTheme: 'light' },
};

/** Only the Browser and Terminal rows remain when no agent is configured. */
export const NoAgents: Story = {
  render: () => <NewThreadPaletteStory agents={[]} />,
};
