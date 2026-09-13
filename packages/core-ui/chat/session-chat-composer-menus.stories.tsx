import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { DEFAULT_ACCOUNT_POLICY, type AgentAccountsState } from '@/packages/shared/agent-accounts';
import { SessionAccountsPanel } from '../accounts/session-panel';
import { SessionChatComposerActions } from './session-chat-composer-actions';

const accounts: AgentAccountsState = {
  accounts: ['Current account', 'Other account'].map((name, index) => ({
    id: String(index),
    provider: 'codex',
    selector: String(index + 1),
    name,
    email: '',
    color: 'neutral',
    eligible: true,
    registered: true,
    sharedHistory: true,
    status: 'ready',
    sessionCount: index === 0 ? 1 : 0,
    resetCredits: 2,
    usage: [
      { id: 'sevenDay', label: '7d', usedPercent: index === 0 ? 38 : 0 },
      { id: 'sparkFiveHour', label: 'Spark 5h', model: 'Spark', limitWindowSeconds: 18000, usedPercent: 0 },
      { id: 'sparkSevenDay', label: 'Spark 7d', model: 'Spark', limitWindowSeconds: 604800, usedPercent: 0 },
    ],
  })),
  helpers: [],
  defaults: { claude: DEFAULT_ACCOUNT_POLICY, codex: DEFAULT_ACCOUNT_POLICY },
  defaultAccounts: {},
  session: { provider: 'codex', accountId: '0', policy: DEFAULT_ACCOUNT_POLICY, override: null },
};

function ComposerMenus({ theme, accountPanel }: { theme: 'light' | 'dark'; accountPanel: boolean }) {
  useEffect(() => {
    const previous = document.body.dataset.sessionChatTheme;
    document.body.dataset.sessionChatTheme = theme;
    return () => {
      if (previous === undefined) delete document.body.dataset.sessionChatTheme;
      else document.body.dataset.sessionChatTheme = previous;
    };
  }, [theme]);
  return (
    <main
      className='ghostex-session-chat-scope flex flex-col gap-6 bg-background p-6 text-foreground'
      data-chat-theme={theme}
      style={{ minHeight: 'max(460px, 100dvh)' }}
    >
      <h1 className='text-lg font-medium'>Chat menus</h1>
      <p>Open More actions, then click Switch Account. The menu and submenu follow the chat palette.</p>
      <div className='mt-auto'>
        <SessionChatComposerActions
          sendBlocked={false}
          hasSendableDraft={false}
          maximized={false}
          onToggleMaximized={() => {}}
          onToggleVerbose={() => {}}
          sessionNoteActive={false}
          sessionNoteHasText={false}
          stashedPromptCount={0}
          summaryMode={false}
          verboseMode={false}
          hostActions={{
            onSwitchToTerminal: () => {},
            onAction: () => {},
            actions: [
              { id: 'rename', label: 'Rename' },
              { id: 'sleep', label: 'Sleep' },
              { id: 'fork', label: 'Fork Session' },
              {
                id: 'switchAccount',
                label: 'Switch Account',
                items: [{ id: 'other', label: 'Other account' }],
              },
            ],
          }}
          renderAccountMenu={
            accountPanel
              ? (close) => (
                  <SessionAccountsPanel
                    data={accounts}
                    busy={false}
                    error=''
                    request={async () => true}
                    close={close}
                  />
                )
              : undefined
          }
        />
      </div>
      <footer className='text-xs text-muted-foreground'>End of menu preview</footer>
    </main>
  );
}

export default {
  title: 'Chat/Composer Menus',
  component: ComposerMenus,
  parameters: { layout: 'fullscreen' },
  args: { theme: 'light', accountPanel: true },
  argTypes: { theme: { control: 'inline-radio', options: ['light', 'dark'] } },
} satisfies Meta<typeof ComposerMenus>;
type Story = StoryObj<typeof ComposerMenus>;
export const Light: Story = {};
export const Dark: Story = { args: { theme: 'dark' } };
export const AccountList: Story = { args: { accountPanel: false } };
