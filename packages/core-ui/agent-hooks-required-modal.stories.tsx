import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { AgentHooksRequiredModal } from './agent-hooks-required-modal';

/**
 * The Install Hooks prompt opens as a one-shot native fit-height modal in the
 * desktop app, so this story is its only inspection surface. Switch the
 * "modalTheme" toolbar global to review the light appearance.
 */
function AgentHooksRequiredModalStory({ agentName, hookAgentId }: { agentName: string; hookAgentId?: string }) {
  return (
    <AgentHooksRequiredModal
      agentName={agentName}
      hookAgentId={hookAgentId}
      isOpen
      onClose={() => undefined}
      onInstall={() => undefined}
      onSkip={() => undefined}
    />
  );
}

const meta = {
  title: 'Modals/App Host/Install Hooks',
  parameters: {
    layout: 'fullscreen',
  },
  render: () => <AgentHooksRequiredModalStory agentName='Claude' hookAgentId='claude' />,
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Claude: Story = {};

/** A white-logo agent: the tint falls back to the foreground so it inverts with the theme. */
export const Codex: Story = {
  render: () => <AgentHooksRequiredModalStory agentName='Codex' hookAgentId='codex' />,
};

export const Gemini: Story = {
  render: () => <AgentHooksRequiredModalStory agentName='Gemini' hookAgentId='gemini' />,
};

/**
 * The desktop app opens this modal in a 570px-wide native child window that
 * fits its height to the content, so this variant applies the native body
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
      <AgentHooksRequiredModalStory agentName='Claude' hookAgentId='claude' />
    </div>
  );
}

export const DesktopWindow: Story = {
  render: () => <DesktopWindowStory />,
};

/** An agent without a known logo shows the generic connect glyph. */
export const UnknownAgent: Story = {
  render: () => <AgentHooksRequiredModalStory agentName='My Agent' />,
};
