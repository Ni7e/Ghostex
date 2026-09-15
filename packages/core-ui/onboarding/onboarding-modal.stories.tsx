import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  AGENT_CLI_CATALOG,
  agentCliCatalogInstallCommand,
  type AgentCliConnection,
  type AgentCliJob,
  type AgentCliMethod,
} from '@/packages/shared/agent-cli-maintenance';
import { DEFAULT_ghostex_SETTINGS, type ghostexSettings } from '@/packages/shared/ghostex-settings';
import { DEFAULT_SIDEBAR_AGENTS } from '@/packages/shared/sidebar-agents';
import { setAgentCliConnectionSource } from '../agent-cli/transport';
import type { OnboardingComputerUseState, OnboardingDetectedAgent } from './contract';
import { OnboardingModal } from './onboarding-modal';

const INSTALLED_IDS = ['claude', 'codex', 'cursor'];
const ACCOUNT_LABELS: Record<string, string> = {
  claude: 'uses your Claude account',
  codex: 'uses your ChatGPT account',
  cursor: 'uses your Cursor account',
};

function mockAgents(installed: readonly string[], hooksInstalled: boolean): OnboardingDetectedAgent[] {
  return DEFAULT_SIDEBAR_AGENTS.map((agent) => ({
    agentId: agent.agentId,
    name: agent.agentId === 'claude' ? 'Claude Code' : agent.agentId === 'cursor' ? 'Cursor Agent' : agent.name,
    accountLabel: ACCOUNT_LABELS[agent.agentId],
    installed: installed.includes(agent.agentId),
    hooksInstalled: installed.includes(agent.agentId) && hooksInstalled,
    detail: installed.includes(agent.agentId)
      ? `/opt/homebrew/bin/${agent.command.split(' ')[0]}`
      : 'CLI was not found on PATH.',
  }));
}

/** What the mocked gxserver CLI connection reports: none at all (copy-the-command path), idle, a job already
 * running for Claude Code, or a failed Claude Code job. */
type StoryCli = 'none' | 'ready' | 'installing' | 'failed';

const STORY_METHODS: Record<string, AgentCliMethod[]> = {
  claude: [
    { id: 'native', label: 'Official installer', command: 'curl -fsSL https://claude.ai/install.sh | bash' },
    { id: 'npm', label: 'npm', command: 'npm install -g @anthropic-ai/claude-code@latest' },
    { id: 'brew', label: 'Homebrew', command: 'brew install --cask claude-code' },
  ],
  codex: [
    { id: 'npm', label: 'npm', command: 'npm install -g @openai/codex@latest' },
    { id: 'brew', label: 'Homebrew', command: 'brew install --cask codex' },
  ],
  cursor: [{ id: 'native', label: 'Official installer', command: 'curl -fsSL https://cursor.com/install | bash' }],
};
const STORY_OUTPUT = [
  'Resolving latest release…',
  'Downloading package (24.1 MB)…',
  'Verifying checksum…',
  'Linking binary into ~/.local/bin',
  'Done. Run the CLI once to sign in.',
];

/** A stand-in for gxserver's /api/agentCliMaintenance: installs "complete" a few seconds after they start. */
function createStoryCliConnection(mode: StoryCli, installedNow: Set<string>): AgentCliConnection {
  const jobs = new Map<string, AgentCliJob>();
  if (mode === 'installing') {
    jobs.set('claude', {
      id: 'story-running',
      operation: 'install',
      command: STORY_METHODS.claude[0].command,
      status: 'running',
      output: STORY_OUTPUT.slice(0, 2).join('\n') + '\n',
    });
  }
  if (mode === 'failed') {
    jobs.set('claude', {
      id: 'story-failed',
      operation: 'install',
      command: STORY_METHODS.claude[1].command,
      status: 'failed',
      output: 'npm ERR! code EACCES\nnpm ERR! syscall mkdir\nnpm ERR! path /usr/local/lib/node_modules/@anthropic-ai\n',
      error: 'Command exited with exit status: 243.',
    });
  }
  const methodsFor = (agentId: string): AgentCliMethod[] => {
    if (STORY_METHODS[agentId]) return STORY_METHODS[agentId];
    const entry = AGENT_CLI_CATALOG.find((candidate) => candidate.agentId === agentId);
    const command = entry ? agentCliCatalogInstallCommand(entry) : undefined;
    return command ? [{ id: 'npm', label: entry?.npmPackage ? 'npm' : 'Official installer', command }] : [];
  };
  return {
    id: 'local',
    label: 'This computer',
    request: async (request) => {
      const { agentId } = request;
      if (request.action === 'start') {
        const method = methodsFor(agentId).find((entry) => entry.id === request.methodId);
        if (!method) throw new Error('Unsupported installation method.');
        if ([...jobs.values()].some((job) => job.status === 'running')) {
          throw new Error('Another CLI install or update is still running. Wait for it to finish.');
        }
        const job: AgentCliJob = {
          id: `story-${agentId}-${Date.now()}`,
          operation: 'install',
          command: method.command,
          status: 'running',
          output: '',
        };
        jobs.set(agentId, job);
        STORY_OUTPUT.forEach((line, index) => {
          window.setTimeout(
            () => {
              const current = jobs.get(agentId);
              if (!current || current.id !== job.id) return;
              const output = current.output + line + '\n';
              const last = index === STORY_OUTPUT.length - 1;
              if (last) installedNow.add(agentId);
              jobs.set(agentId, { ...current, output, status: last ? 'succeeded' : 'running' });
            },
            1100 * (index + 1)
          );
        });
      }
      const binary = AGENT_CLI_CATALOG.find((entry) => entry.agentId === agentId)?.binary ?? agentId;
      return {
        agentId,
        platform: 'macos',
        methods: methodsFor(agentId),
        ...(installedNow.has(agentId) ? { executablePath: `/opt/homebrew/bin/${binary}` } : {}),
        ...(jobs.has(agentId) ? { job: jobs.get(agentId) } : {}),
      };
    },
  };
}

type StoryArgs = {
  initialPanel: number | 'finished';
  cli: StoryCli;
  installedAgents: readonly string[];
  hooksInstalled: boolean;
  agentsLoading: boolean;
  computerUseState: OnboardingComputerUseState;
  browserSkillInstalled: boolean;
  hasProjects: boolean;
  pickedProjectFolder?: string;
};

/** A stand-in for the modal-host adapter: settings and detection results live in local state. */
function OnboardingModalStory(args: StoryArgs) {
  const [settings, setSettings] = useState<ghostexSettings>({
    ...DEFAULT_ghostex_SETTINGS,
    defaultPromptAgentId: 'claude',
    codeViewTabHidden: true,
    kanbanViewTabHidden: true,
    automateViewTabHidden: true,
  });
  const [agents, setAgents] = useState(() => mockAgents(args.installedAgents, args.hooksInstalled));
  const [agentsLoading, setAgentsLoading] = useState(args.agentsLoading);
  const [computerUseState, setComputerUseState] = useState(args.computerUseState);
  const [browserSkillInstalled, setBrowserSkillInstalled] = useState(args.browserSkillInstalled);
  const [pickedProjectFolder, setPickedProjectFolder] = useState(args.pickedProjectFolder);
  const [open, setOpen] = useState(true);
  /** Agents installed through the mocked connection; a rescan reports them as detected. */
  const installedNow = useRef(new Set<string>());
  const connection = useMemo(
    () => (args.cli === 'none' ? undefined : createStoryCliConnection(args.cli, installedNow.current)),
    [args.cli]
  );
  useLayoutEffect(() => {
    setAgentCliConnectionSource(() => (connection ? [connection] : []));
    return () => setAgentCliConnectionSource(() => []);
  }, [connection]);
  const rescan = () => {
    setAgentsLoading(true);
    window.setTimeout(() => {
      setAgents(mockAgents([...args.installedAgents, ...installedNow.current], args.hooksInstalled));
      setAgentsLoading(false);
    }, 1400);
  };
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#040507' }}>
      {!open && (
        <button
          type='button'
          style={{ position: 'absolute', inset: 'auto 16px 16px auto', color: '#fff' }}
          onClick={() => setOpen(true)}
        >
          Reopen onboarding
        </button>
      )}
      <OnboardingModal
        isOpen={open}
        initialPanel={args.initialPanel}
        theme='dark-blue'
        hasProjects={args.hasProjects}
        settings={settings}
        onChange={setSettings}
        onClose={() => setOpen(false)}
        agents={agents}
        agentsLoading={agentsLoading}
        onRescanAgents={rescan}
        onInstallAgentHooks={(agentIds) => {
          window.setTimeout(
            () =>
              setAgents((current) =>
                current.map((agent) => (agentIds.includes(agent.agentId) ? { ...agent, hooksInstalled: true } : agent))
              ),
            900
          );
        }}
        onOpenInstallGuide={(url) => window.open(url, '_blank', 'noopener')}
        computerUseState={computerUseState}
        onInstallComputerUse={() => {
          setComputerUseState('installing');
          window.setTimeout(() => setComputerUseState('permissions'), 1800);
        }}
        onOpenAccessibilityPreferences={() => setComputerUseState('on')}
        onOpenScreenRecordingPreferences={() => setComputerUseState('on')}
        browserSkillInstalled={browserSkillInstalled}
        onInstallBrowserSkill={() => setBrowserSkillInstalled(true)}
        onUninstallBrowserSkill={() => setBrowserSkillInstalled(false)}
        onOpenRemoteSettings={() => window.alert('Settings -> Remote would open here')}
        onOpenExternalUrl={(url) => window.open(url, '_blank', 'noopener')}
        onPickProjectFolder={() => setPickedProjectFolder('~/Projects/my-app')}
        pickedProjectFolder={pickedProjectFolder}
        onFinishFirstLaunch={(options) => {
          console.info('onFinishFirstLaunch', options);
          return new Promise((resolve) => window.setTimeout(resolve, 900));
        }}
        onOpenSettings={() => window.alert('Settings would open here')}
      />
    </div>
  );
}

const meta = {
  title: 'Modals/Onboarding/Onboarding',
  parameters: { layout: 'fullscreen' },
  args: {
    initialPanel: 1,
    cli: 'none',
    installedAgents: INSTALLED_IDS,
    hooksInstalled: false,
    agentsLoading: false,
    computerUseState: 'off',
    browserSkillInstalled: true,
    hasProjects: false,
    pickedProjectFolder: '~/Projects/my-app',
  } satisfies StoryArgs,
  render: (args) => <OnboardingModalStory key={JSON.stringify(args)} {...args} />,
} satisfies Meta<StoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Welcome: Story = {};
export const Agents: Story = { args: { initialPanel: 2 } };
export const AgentsScanning: Story = { args: { initialPanel: 2, agentsLoading: true } };
export const AgentsAlreadyConnected: Story = { args: { initialPanel: 2, hooksInstalled: true } };
export const AgentsNoneInstalled: Story = { args: { initialPanel: 2, installedAgents: [] } };
/** gxserver reachable: every missing primary agent gets an Install button (the picked method in its subtitle). */
export const AgentsInstallAvailable: Story = { args: { initialPanel: 2, installedAgents: [], cli: 'ready' } };
export const AgentsInstallPartial: Story = { args: { initialPanel: 2, installedAgents: ['codex'], cli: 'ready' } };
/** A Claude Code install job is already running on the server: spinner on the row, its output in the scan log. */
export const AgentsInstalling: Story = { args: { initialPanel: 2, installedAgents: [], cli: 'installing' } };
export const AgentsInstallFailed: Story = { args: { initialPanel: 2, installedAgents: [], cli: 'failed' } };
export const ComputerUseInstalling: Story = { args: { initialPanel: 2, computerUseState: 'installing' } };
export const ComputerUsePermissions: Story = { args: { initialPanel: 2, computerUseState: 'permissions' } };
export const ComputerUseOn: Story = { args: { initialPanel: 2, computerUseState: 'on' } };
export const Workspace: Story = { args: { initialPanel: 3 } };
export const WorkspaceNoBrowserSkill: Story = { args: { initialPanel: 3, browserSkillInstalled: false } };
export const Mobile: Story = { args: { initialPanel: 4 } };
export const GetStarted: Story = { args: { initialPanel: 5 } };
export const GetStartedNoFolder: Story = { args: { initialPanel: 5, pickedProjectFolder: undefined } };
export const GetStartedNoFolderWithProjects: Story = {
  args: { initialPanel: 5, pickedProjectFolder: undefined, hasProjects: true },
};
export const Finished: Story = { args: { initialPanel: 'finished', hooksInstalled: true } };
