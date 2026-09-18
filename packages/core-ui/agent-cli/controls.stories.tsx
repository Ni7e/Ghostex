import { useMemo, useState } from 'react';
import { DragDropProvider } from '@dnd-kit/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SettingsAgentRow } from '../settings-modal/tabs/agents';
import { DEFAULT_SIDEBAR_AGENTS } from '@/packages/shared/sidebar-agents';
import type { AgentCliConnection, AgentCliState } from '@/packages/shared/agent-cli-maintenance';

const meta = { title: 'Modals/Settings Agent CLIs', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;

function Preview() {
  const [expanded, setExpanded] = useState(['zcode', 'claude', 'pi', 'grok', 'omp']);
  const connection = useMemo<AgentCliConnection>(() => {
    const states: Record<string, AgentCliState> = {
      zcode: {
        agentId: 'zcode',
        platform: 'macos',
        methods: [
          { id: 'mise', label: 'mise', command: "mise use --global --yes 'npm:zcode-app-cli[prerelease=true]@latest'" },
          { id: 'npm', label: 'npm', command: 'npm install -g zcode-app-cli@latest' },
        ],
      },
      claude: {
        agentId: 'claude',
        platform: 'macos',
        executablePath: '/home/you/.local/share/mise/installs/claude/2.1.267/claude',
        version: 'Claude Code 2.1.267',
        detectedMethodId: 'mise',
        methods: [{ id: 'mise', label: 'mise', command: "mise upgrade --bump --no-prune --yes 'claude'" }],
      },
      pi: {
        agentId: 'pi',
        platform: 'linux',
        executablePath: '/home/you/.local/bin/pi',
        version: '0.84.1',
        methods: [
          {
            id: 'npm',
            label: 'npm',
            command: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent@latest',
          },
          { id: 'bun', label: 'bun', command: 'bun install -g @earendil-works/pi-coding-agent@latest' },
        ],
      },
      grok: {
        agentId: 'grok',
        platform: 'macos',
        executablePath: '/Users/you/.local/bin/grok',
        version: 'grok 0.2.93',
        detectedMethodId: 'native',
        methods: [{ id: 'native', label: 'Official installer', command: 'grok update' }],
        job: {
          id: 'failed',
          status: 'failed',
          operation: 'update',
          command: 'grok update',
          output: 'Checking for updates…\nDownload failed: connection timed out.',
          error: 'Command exited with exit status: 1.',
        },
      },
      omp: {
        agentId: 'omp',
        platform: 'linux',
        methods: [
          {
            id: 'bun',
            label: 'bun',
            command: 'bun install -g @oh-my-pi/pi-coding-agent@latest',
            unavailableReason: 'Install bun on this computer first.',
          },
        ],
      },
    };
    return {
      id: 'preview',
      label: 'Preview computer',
      request: async (request) => {
        const state = states[request.agentId];
        if (request.action === 'start') {
          const method = state.methods.find((entry) => entry.id === request.methodId)!;
          state.job = {
            id: String(Date.now()),
            operation: request.operation!,
            command: method.command,
            status: 'running',
            output: 'Downloading CLI package…\n',
          };
          setTimeout(() => {
            state.executablePath ??= `/home/you/.local/bin/${request.agentId}`;
            state.version = 'Preview installed version';
            state.detectedMethodId = method.id;
            state.job = {
              ...state.job!,
              status: 'succeeded',
              output:
                Array.from({ length: 30 }, (_, index) => `Installation step ${index + 1} completed`).join('\n') +
                '\nCLI installation complete.',
            };
          }, 4000);
        }
        return structuredClone(state);
      },
    };
  }, []);
  return (
    <div className='ghostex-settings-shadcn mx-auto min-h-screen w-full max-w-3xl p-4 text-foreground'>
      <h1 className='mb-2 text-lg font-semibold'>Agents</h1>
      <p className='mb-4 text-sm text-muted-foreground'>
        Interactive preview. Install and update actions simulate progress without changing your computer.
      </p>
      <DragDropProvider>
        <div className='settings-list-rows rounded-lg border border-border'>
          {['zcode', 'claude', 'pi', 'grok', 'omp'].map((id, index) => {
            const definition = DEFAULT_SIDEBAR_AGENTS.find((agent) => agent.agentId === id)!;
            return (
              <SettingsAgentRow
                key={id}
                agent={{ ...definition, isDefault: true }}
                cliConnection={connection}
                acceptAllMode='inherit'
                index={index}
                isExpanded={expanded.includes(id)}
                isHookStatusLoading={false}
                isHookStatusPending={false}
                supportsHooks={false}
                preferredAgentInterface='terminal'
                onDelete={() => {}}
                onEdit={() => {}}
                onPreferredInterfaceOverrideChange={() => {}}
                onToggleExpanded={() =>
                  setExpanded((current) =>
                    current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
                  )
                }
              />
            );
          })}
        </div>
      </DragDropProvider>
    </div>
  );
}

export const InstallAndUpdate: StoryObj = { render: () => <Preview /> };
