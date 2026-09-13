import type { Meta, StoryObj } from '@storybook/react-vite';
import { SidebarStoryHarness } from './sidebar-story-harness';
import { createSidebarStoryMessage } from './sidebar-story-fixtures';
import { DEFAULT_SIDEBAR_STORY_ARGS, SIDEBAR_STORY_DECORATORS } from './sidebar-story-meta';
import { DEFAULT_ghostex_SETTINGS, normalizeghostexSettings } from '@/packages/shared/ghostex-settings';
import type { SidebarThemeSetting } from '@/packages/shared/session-grid-contract';

function SidebarAppearance({ appearance }: { appearance: SidebarThemeSetting }) {
  const message = createSidebarStoryMessage({
    ...DEFAULT_SIDEBAR_STORY_ARGS,
    fixture: 'scroll-end-retention',
    theme: 'dark-2',
  });
  message.hud.settings = normalizeghostexSettings({ ...DEFAULT_ghostex_SETTINGS, sidebarTheme: appearance });
  return (
    <div className='native-sidebar-shell' data-sidebar-mode='combined'>
      <main className='native-sidebar-main'>
        <SidebarStoryHarness message={message} />
      </main>
    </div>
  );
}

const meta = {
  title: 'Sidebar/Appearance',
  component: SidebarAppearance,
  decorators: SIDEBAR_STORY_DECORATORS,
  args: { appearance: 'dark-2' },
  argTypes: { appearance: { control: 'select', options: ['dark-2', 'plain-light', 'system'] } },
} satisfies Meta<typeof SidebarAppearance>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Dark: Story = {};
export const Light: Story = { args: { appearance: 'plain-light' } };
export const System: Story = { args: { appearance: 'system' } };
