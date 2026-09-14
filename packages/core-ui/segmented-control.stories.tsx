/**
 * CDXC:DesignSystem 2026-08-24:
 * Reference story for the one segmented single-select control used across the
 * app (Settings, Add Worktree, Automate). It shows the stock shadcn
 * ButtonGroup shape — one bordered container, flat segments sharing a hairline,
 * only the outer corners rounded — with a highlighted selected segment, in both
 * the content-width and full-width layouts.
 */
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { IconFolderOpen, IconGitBranch } from '@tabler/icons-react';
import { SegmentedControl, SegmentedControlItem } from '@/packages/components/ui/segmented-control';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/packages/components/ui/tabs';

function SegmentedControlStory() {
  const [group, setGroup] = useState('button');
  const [preset, setPreset] = useState('recommended');
  const [mode, setMode] = useState('create');
  const [protocol, setProtocol] = useState('https');
  return (
    <div
      className='ghostex-root ghostex-settings-shadcn flex min-h-screen w-full flex-col gap-8 bg-[#0e0e0e] p-6'
      data-sidebar-theme='dark-2'
    >
      <section className='flex flex-col gap-2'>
        <span className='text-[13px] text-muted-foreground'>Content width</span>
        <SegmentedControl aria-label='Size' onValueChange={setGroup} value={group}>
          <SegmentedControlItem value='large'>Large</SegmentedControlItem>
          <SegmentedControlItem value='button'>Button</SegmentedControlItem>
          <SegmentedControlItem value='group'>Group</SegmentedControlItem>
        </SegmentedControl>
      </section>
      <section className='flex flex-col gap-2'>
        <span className='text-[13px] text-muted-foreground'>Full width (settings fields)</span>
        <SegmentedControl aria-label='Preset' onValueChange={setPreset} stretch value={preset}>
          <SegmentedControlItem value='recommended'>Recommended</SegmentedControlItem>
          <SegmentedControlItem value='codex'>Codex</SegmentedControlItem>
          <SegmentedControlItem value='minimal'>Minimal</SegmentedControlItem>
          <SegmentedControlItem value='detailed'>Detailed</SegmentedControlItem>
        </SegmentedControl>
      </section>
      <section className='flex flex-col gap-2'>
        <span className='text-[13px] text-muted-foreground'>With icons (Add Worktree)</span>
        <SegmentedControl aria-label='Worktree mode' onValueChange={setMode} stretch value={mode} variant='raised'>
          <SegmentedControlItem value='create'>
            <IconGitBranch aria-hidden='true' data-icon='inline-start' />
            Create New
          </SegmentedControlItem>
          <SegmentedControlItem value='openExisting'>
            <IconFolderOpen aria-hidden='true' data-icon='inline-start' />
            Open Existing
          </SegmentedControlItem>
        </SegmentedControl>
      </section>
      <section className='flex flex-col gap-2'>
        <span className='text-[13px] text-muted-foreground'>Compact size with a disabled segment</span>
        <SegmentedControl aria-label='Protocol' onValueChange={setProtocol} size='sm' value={protocol}>
          <SegmentedControlItem value='https'>HTTPS</SegmentedControlItem>
          <SegmentedControlItem value='http'>HTTP</SegmentedControlItem>
          <SegmentedControlItem disabled value='socks'>
            SOCKS
          </SegmentedControlItem>
        </SegmentedControl>
      </section>
    </div>
  );
}

const meta: Meta<typeof SegmentedControlStory> = {
  component: SegmentedControlStory,
  title: 'Components/Segmented Control',
};

export default meta;
type Story = StoryObj<typeof SegmentedControlStory>;

export const Default: Story = {};

const RAISED_EXAMPLES = [
  ['Saved Prompts', ['Saved', 'Recovered', 'Sent']],
  ['Sessions', ['All', 'Closed', 'External']],
  ['Add Worktree', ['Create New', 'Open Existing']],
  ['Add a machine', ['SSH details', 'Easy Connect code']],
  ['Easy Connect', ['Connect a phone', 'Connect a computer']],
  ['Browser History', ['All Projects', 'Current Project']],
  ['Automation timing', ['Repeat', 'Timer', 'Date']],
  ['Automation execution', ['Worktree', 'Local', 'Thread']],
] as const;

function RaisedExample({ title, labels }: { title: string; labels: readonly string[] }) {
  const [value, setValue] = useState(labels[0]);
  return (
    <section className='flex min-w-0 flex-col gap-2'>
      <span className='text-[13px]'>{title}</span>
      <SegmentedControl aria-label={title} onValueChange={setValue} size='sm' stretch value={value} variant='raised'>
        {labels.map((label) => (
          <SegmentedControlItem key={label} value={label}>
            {label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </section>
  );
}

function RaisedModalTabsStory() {
  return (
    <main className='grid min-h-screen gap-6 p-4 lg:grid-cols-2'>
      {(['plain-light', 'dark-2'] as const).map((theme) => (
        <div
          key={theme}
          className='ghostex-root ghostex-settings-shadcn flex min-w-0 flex-col gap-6 rounded-xl p-4'
          data-sidebar-theme={theme}
          style={{
            colorScheme: theme === 'plain-light' ? 'light' : 'dark',
            background: theme === 'plain-light' ? '#f5f5f5' : '#161616',
            color: theme === 'plain-light' ? '#262626' : '#f5f5f5',
          }}
        >
          <h2 className='m-0 text-base'>{theme === 'plain-light' ? 'Light' : 'Dark'}</h2>
          <section className='flex min-w-0 flex-col gap-2'>
            <span className='text-[13px]'>Agents Hub</span>
            <Tabs defaultValue='Skills'>
              <TabsList variant='raised' className='!h-10 w-full'>
                {['Skills', 'MDs', 'Hooks', 'Configs & MCPs'].map((label, index) => (
                  <TabsTrigger key={label} value={label}>
                    <span className='min-w-0 truncate'>{label}</span>
                    <kbd className='hidden text-[11px] sm:inline'>⌘{index + 1}</kbd>
                  </TabsTrigger>
                ))}
              </TabsList>
              {['Skills', 'MDs', 'Hooks', 'Configs & MCPs'].map((label) => (
                <TabsContent key={label} value={label} className='text-xs'>
                  {label} selected
                </TabsContent>
              ))}
            </Tabs>
          </section>
          {RAISED_EXAMPLES.map(([title, labels]) => (
            <RaisedExample key={title} title={title} labels={labels} />
          ))}
        </div>
      ))}
    </main>
  );
}

export const RaisedModalTabs: Story = { render: () => <RaisedModalTabsStory /> };
