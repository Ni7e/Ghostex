import type { Meta, StoryObj } from '@storybook/react-vite';
import { SessionChatCardGallery } from './session-chat-card-gallery';

/*
The gallery on its own, so the composer cards can be compared without the
Codex transcript card above them. The same component is also mounted under
"Chat/Codex Transcript Card".
*/
function CardGalleryPreview({ theme }: { theme: 'dark' | 'light' }) {
  return (
    <div
      className={`ghostex-session-chat-scope ${theme} flex h-screen items-start justify-center overflow-y-auto bg-background p-6 text-foreground [--radius:0.625rem]`}
      data-chat-theme={theme}
    >
      <div className='flex w-full max-w-2xl flex-col gap-4'>
        <SessionChatCardGallery />
      </div>
    </div>
  );
}

const meta = {
  title: 'Chat/Card gallery',
  component: CardGalleryPreview,
  parameters: { layout: 'fullscreen' },
  args: { theme: 'dark' },
  argTypes: { theme: { control: 'inline-radio', options: ['dark', 'light'] } },
} satisfies Meta<typeof CardGalleryPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Dark: Story = {};
export const Light: Story = { args: { theme: 'light' } };
