import type { Meta, StoryObj } from '@storybook/react-vite';
import { SessionChatLoadingState } from './session-chat-loading-state';

const meta = {
  title: 'Chat/Transcript Skeleton',
  component: SessionChatLoadingState,
  parameters: { layout: 'fullscreen' },
  args: { stage: 'indicator', onRetry: () => {} },
  argTypes: { stage: { control: 'inline-radio', options: ['blank', 'indicator', 'retry'] } },
  decorators: [
    (Story, context) => {
      const theme = context.name.includes('Light') ? 'light' : 'dark';
      return (
        <div
          className={`ghostex-session-chat-scope ${theme === 'dark' ? 'dark' : ''} flex h-screen flex-col bg-background text-foreground`}
          data-chat-theme={theme}
        >
          <Story />
        </div>
      );
    },
  ],
} satisfies Meta<typeof SessionChatLoadingState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Dark: Story = {};

export const Light: Story = {};

export const RetryOffered: Story = { args: { stage: 'retry' } };
