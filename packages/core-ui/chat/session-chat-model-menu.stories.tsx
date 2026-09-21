import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { getDefaultSidebarAgentByIcon } from '@/packages/shared/sidebar-agents';
import { toggleModelFavorite, modelFavorites } from '@/packages/shared/session-chat-controller/model-favorites';
import type { ModelMenuContext } from '@/packages/shared/session-chat-controller/model-menu';
import type { ModelMenuTabId } from '@/packages/shared/session-chat-presentation/model-menu';
import { TooltipProvider } from '../app-tooltip';
import { ProjectAgentLauncherIcon } from '../project-agent-launcher-icon';
import { SessionChatModelMenu } from './session-chat-model-menu';
import { sessionChatSessionOptionCatalog, type SessionChatOptionState } from './session-chat-session-options';

const STARRED = ['claude:opus', 'codex:gpt-6-astra', 'cursor:auto'];

function ModelMenuStory({
  theme,
  tab,
  flyout,
  error,
  otherAgents,
  open,
}: {
  theme: 'light' | 'dark';
  tab?: ModelMenuTabId;
  flyout?: number;
  error: boolean;
  otherAgents: boolean;
  open: boolean;
}) {
  const [state, setState] = useState<SessionChatOptionState>({
    model: { value: 'opus[1m]', source: 'detected' },
    effort: { value: 'high', source: 'detected' },
  });
  const [log, setLog] = useState(
    'Click a model to save it as the default; right-click applies it to this session only.'
  );
  useEffect(() => {
    const previous = document.body.dataset.sessionChatTheme;
    document.body.dataset.sessionChatTheme = theme;
    for (const key of STARRED) if (!modelFavorites().includes(key)) toggleModelFavorite(key);
    return () => {
      if (previous === undefined) delete document.body.dataset.sessionChatTheme;
      else document.body.dataset.sessionChatTheme = previous;
    };
  }, [theme]);
  const catalog = sessionChatSessionOptionCatalog('claude');
  const claude = getDefaultSidebarAgentByIcon('claude');
  if (!catalog) return null;
  const context: ModelMenuContext = {
    provider: 'claude',
    modelId: catalog.model.id,
    modelDefault: catalog.model.defaultValue,
    modelLabel: null,
    descriptors: catalog.optionsForModel(state.model?.value ?? ''),
    state,
    caps: { canPickModel: true, queuedControls: true, canSendKey: true },
    selectionError: error ? 'Claude Code does not list Fable 5.1 for this account.' : null,
    disabled: false,
  };
  const scope = (secondary: boolean) => (secondary ? 'this session only' : 'saved as default');
  return (
    <TooltipProvider theme={theme}>
      <main
        className='ghostex-session-chat-scope flex flex-col gap-4 bg-background p-6 text-foreground'
        data-chat-theme={theme}
        style={{ minHeight: 'max(560px, 100dvh)' }}
      >
        <h1 className='text-lg font-medium'>Model picker</h1>
        <p className='text-sm text-muted-foreground'>{log}</p>
        <div className='mt-auto flex justify-end pr-64'>
          <SessionChatModelMenu
            canOfferProvider={(provider) => otherAgents || provider === 'claude'}
            context={context}
            defaultOpen={open}
            initialFlyout={flyout}
            initialTab={tab}
            onPickRow={(row, secondary) => {
              if (row.provider !== 'claude') {
                setLog(`Handoff opens with ${row.agentName} selected, starting on ${row.label}.`);
                return;
              }
              const value = row.variants.find((variant) => variant.value === state.model?.value)?.value ?? row.value;
              setState((current) => ({ ...current, model: { value, source: 'dispatched' } }));
              setLog(`${row.label}: ${scope(secondary)}.`);
            }}
            onPickTrait={(trait, choice, secondary) => {
              const id = trait.id === 'context' ? 'model' : trait.id;
              setState((current) => ({ ...current, [id]: { value: choice.value, source: 'dispatched' } }));
              setLog(`${trait.label} ${choice.label}: ${scope(secondary)}.`);
            }}
            pill={{
              ariaLabel: 'Model',
              disabled: false,
              icon: (
                <span className='ghostex-chat-model-pill-icon' data-icon='inline-start'>
                  <ProjectAgentLauncherIcon
                    agent={claude ? { ...claude, isDefault: true } : undefined}
                    colorMode='brand'
                  />
                </span>
              ),
              tooltip: 'Model and reasoning (⌥P)',
            }}
          />
        </div>
        <footer className='text-xs text-muted-foreground'>End of model picker preview</footer>
      </main>
    </TooltipProvider>
  );
}

export default {
  title: 'Chat/Model Menu',
  component: ModelMenuStory,
  parameters: { layout: 'fullscreen' },
  args: { theme: 'dark', error: false, otherAgents: true, open: true },
  argTypes: { theme: { control: 'inline-radio', options: ['light', 'dark'] } },
} satisfies Meta<typeof ModelMenuStory>;
type Story = StoryObj<typeof ModelMenuStory>;
export const Dark: Story = {};
export const Light: Story = { args: { theme: 'light' } };
export const Favorites: Story = { args: { tab: 'favorites' } };
export const ReasoningOpen: Story = { args: { flyout: 0 } };
export const NotApplied: Story = { args: { error: true } };
export const PillOnly: Story = { args: { open: false } };
export const OwnAgentOnly: Story = { args: { otherAgents: false } };
