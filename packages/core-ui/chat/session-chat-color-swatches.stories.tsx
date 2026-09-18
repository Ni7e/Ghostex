import type { Meta, StoryObj } from '@storybook/react-vite';
import { SessionChatMarkdown } from './session-chat-markdown';

const EXAMPLES = [
  'Updated sleeping sessions to keep normal title colors, including `#525252` in light mode. Their last-active time now has a subtle blue tint across themes.',
  '',
  'I suggest these neutral grays for the **last-active time**:',
  '',
  '| Theme | Awake | Sleeping |',
  '| --- | --- | --- |',
  '| Light | `#626262` | `#959595` |',
  '| Dark | `#A6A6A6` | `#686868` |',
  '',
  'Awake timestamps stay readable; sleeping timestamps recede. Session titles keep their normal color.',
  '',
  'Plain text: #fff, #000, #f80, #abcd, #33669980.',
  '',
  'Inline CSS: `color: #626262; background: #fff;`',
  '',
  'These are not color values: #12345, #1234567, #123456789, issue#123, /file#abc.',
  '',
  'Fenced code keeps its source presentation:',
  '',
  '```css',
  '.timestamp { color: #626262; }',
  '```',
].join('\n');

function ColorSwatches({ theme }: { theme: 'dark' | 'light' }) {
  return (
    <div
      className='ghostex-session-chat-scope bg-background text-foreground'
      data-chat-theme={theme}
      style={{ height: '100dvh', overflow: 'auto', padding: 20 }}
    >
      <div style={{ maxWidth: 720, marginInline: 'auto' }}>
        <SessionChatMarkdown markdown={EXAMPLES} />
      </div>
    </div>
  );
}

const meta = {
  component: ColorSwatches,
  parameters: { layout: 'fullscreen' },
  title: 'Chat/Color swatches',
} satisfies Meta<typeof ColorSwatches>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Dark: Story = { args: { theme: 'dark' } };
export const Light: Story = { args: { theme: 'light' } };
