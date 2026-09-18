import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import type { SidebarAgentButton } from '@/packages/shared/sidebar-agents';
import {
  ExportTranscriptModal,
  type ExportTranscriptModalStage,
  type ExportTranscriptMode,
} from './export-transcript-result-modal';

const noop = () => undefined;

const AGENTS: SidebarAgentButton[] = [
  { agentId: 'codex', command: 'codex', icon: 'codex', isDefault: true, name: 'Codex' },
  { agentId: 'claude', command: 'claude', icon: 'claude', isDefault: false, name: 'Claude Code' },
];

const DONE_STAGE: ExportTranscriptModalStage = {
  agentId: 'codex',
  canReveal: true,
  path: '/Users/story/.local/share/ghostex/exports/fix-hookless-agent-modal-g04t1-20260915-081928.md',
  stage: 'done',
};

/**
 * Handoff / Export opens as a one-shot native fit-height modal in the desktop
 * app, so these stories are its inspection surface. Switch the "modalTheme"
 * toolbar global to review the light appearance.
 */
function ExportTranscriptModalStory({
  agents = AGENTS,
  mode,
  stage = { stage: 'options' },
}: {
  agents?: SidebarAgentButton[];
  mode?: ExportTranscriptMode;
  stage?: ExportTranscriptModalStage;
}) {
  return (
    <ExportTranscriptModal
      agents={agents}
      defaultAgentId='codex'
      initialMode={mode}
      isOpen
      onClose={noop}
      onExport={noop}
      onRevealInFinder={noop}
      onStartNewConversation={noop}
      stage={stage}
    />
  );
}

const meta = {
  title: 'Modals/App Host/Handoff Export',
  parameters: {
    layout: 'fullscreen',
  },
  render: () => <ExportTranscriptModalStory mode='handoff' />,
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Handoff: Story = {};

export const Export: Story = {
  render: () => <ExportTranscriptModalStory mode='export' />,
};

export const Exporting: Story = {
  render: () => <ExportTranscriptModalStory mode='handoff' stage={{ stage: 'exporting' }} />,
};

/** Export mode after the daemon wrote the file: the toggles give way to the saved path. */
export const ExportDone: Story = {
  render: () => <ExportTranscriptModalStory mode='export' stage={DONE_STAGE} />,
};

export const Failed: Story = {
  render: () => (
    <ExportTranscriptModalStory
      mode='handoff'
      stage={{ message: 'This agent has no transcript to export yet.', stage: 'failed' }}
    />
  ),
};

/** No agent can take a handoff, so only the Export card is offered. */
export const NoAgents: Story = {
  render: () => <ExportTranscriptModalStory agents={[]} />,
};

/**
 * The desktop app opens this modal in a 570px-wide native child window that
 * fits its height to the content once, so this variant applies the native body
 * class and lets the dialog fill the canvas the way the app renders it.
 */
function DesktopWindowStory() {
  useEffect(() => {
    document.body.classList.add('app-modal-host-native-window-body');
    return () => {
      document.body.classList.remove('app-modal-host-native-window-body');
    };
  }, []);
  return (
    <div style={{ width: 570 }}>
      <ExportTranscriptModalStory mode='handoff' />
    </div>
  );
}

export const DesktopWindow: Story = {
  render: () => <DesktopWindowStory />,
};
