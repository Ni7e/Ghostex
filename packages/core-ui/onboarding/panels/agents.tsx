import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { AgentCliConnection } from '@/packages/shared/agent-cli-maintenance';
import { useAgentCliConnections } from '../../agent-cli/transport';
import { useAgentInstallRow, type AgentInstallEvent } from '../agent-install';
import { InstallGuidePopup } from '../install-guide-popup';
import {
  ONBOARDING_PRIMARY_AGENTS,
  allInstalledHaveHooks,
  catalogAgentName,
  defaultAgentId as resolveDefaultAgentId,
  installedAgents,
  missingAgents,
  type PanelProps,
} from '../onboarding-state';
import {
  COMPUTER_USE_LEAD,
  COMPUTER_USE_TERMS,
  ComputerUsePreview,
  ExtensionPanel,
  INTEGRATION_LEAD,
  INTEGRATION_TERMS,
  IntegrationPreview,
} from '../previews/agent-extension-panels';
import { AgentScanLog, type ScanExtraLine } from '../previews/agent-scan-log';
import {
  AgentLogo,
  Cta,
  FootActions,
  Eyebrow,
  Heading,
  Icon,
  OtherAgentsStrip,
  Spinner,
  Sub,
  Toggle,
  buttonProps,
  type IconName,
} from '../primitives';
import { box } from '../stage';

type RightTab = 'scan' | 'integration' | 'cu';
type Phase = 'active' | 'done' | 'here' | 'idle';

const RIGHT_TABS: readonly (readonly [RightTab, IconName, string])[] = [
  ['scan', 'terminal', 'Scan'],
  ['integration', 'pulse', 'Ghostex integration'],
  ['cu', 'monitor', 'Computer Use'],
];
const TRACK: readonly (readonly ['search' | 'found' | 'connected', string])[] = [
  ['search', 'Searching'],
  ['found', 'Found'],
  ['connected', 'Connected'],
];
/** How long "Connected" stays lit before the panel advances on its own. */
const CONNECTED_HOLD_MS = 900;

export function AgentsPanel({ props, flow, setFlow, go, toast }: PanelProps) {
  const { agents, agentsLoading, settings, computerUseState } = props;
  const installed = installedAgents(agents);
  const missing = missingAgents(agents);
  const defaultAgent = resolveDefaultAgentId(settings, agents);
  const allConnected = allInstalledHaveHooks(agents);
  const integrationOn = flow.integrationOn;
  const connected = integrationOn && allConnected;
  /** The gxserver connection of this computer; undefined where the page has no bootstrap (Install buttons hide). */
  const connections = useAgentCliConnections();
  const cliConnection = connections.find((connection) => connection.id === 'local') ?? connections[0];

  const [rightTab, setRightTab] = useState<RightTab>('scan');
  const [guideOpen, setGuideOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [computerUseRequested, setComputerUseRequested] = useState(false);
  const [extras, setExtras] = useState<ScanExtraLine[]>([]);
  const addExtra = (line: Omit<ScanExtraLine, 'at'>) =>
    setExtras((current) => [...current.filter((item) => item.id !== line.id), { ...line, at: new Date() }]);
  const removeExtra = (id: string) => setExtras((current) => current.filter((item) => item.id !== id));

  const hooksBefore = useRef(new Map(agents.map((agent) => [agent.agentId, agent.hooksInstalled])));
  useEffect(() => {
    for (const agent of installedAgents(agents)) {
      if (agent.hooksInstalled && hooksBefore.current.get(agent.agentId) === false) {
        addExtra({ id: 'connected-' + agent.agentId, text: `Connected ${agent.name}`, cls: 'ok' });
      }
    }
    hooksBefore.current = new Map(agents.map((agent) => [agent.agentId, agent.hooksInstalled]));
  }, [agents]);

  /**
   * An agent installed from this panel becomes the default when the configured default is one the host knows is
   * missing (or none is configured), so Get started lists it first and new sessions use it. Only rescans after a
   * real detection payload count: the first payload of a reopen must not rewrite an existing user's choice.
   */
  const installedBefore = useRef<Set<string> | null>(null);
  useEffect(() => {
    const now = installedAgents(agents);
    const before = installedBefore.current;
    if (agents.length > 0 && !agentsLoading) installedBefore.current = new Set(now.map((agent) => agent.agentId));
    if (!before || !settings || agentsLoading) return;
    const fresh = now.filter((agent) => !before.has(agent.agentId));
    if (fresh.length === 0) return;
    const configured = settings.defaultPromptAgentId;
    if (now.some((agent) => agent.agentId === configured)) return;
    const configuredKnownMissing = !configured || agents.some((agent) => agent.agentId === configured);
    if (!configuredKnownMissing) return;
    props.onChange({ ...settings, defaultPromptAgentId: now[0].agentId });
  }, [agents, agentsLoading]);

  useEffect(() => {
    if (!connecting || !connected) return;
    const timer = window.setTimeout(() => go(3), CONNECTED_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [connecting, connected, go]);

  /**
   * The helper install answers through one more `agentHookStatus` round trip, so its failure is visible only
   * as "loading ended and not every installed agent reports hooks". Release the CTA and Rescan on that falling
   * edge and say which agent did not connect; otherwise the panel stays locked on "Connecting…" forever.
   */
  const [connectErrors, setConnectErrors] = useState<string[]>([]);
  const wasLoading = useRef(agentsLoading);
  useEffect(() => {
    const loadingEnded = wasLoading.current && !agentsLoading;
    wasLoading.current = agentsLoading;
    if (!loadingEnded || !connecting || allInstalledHaveHooks(agents)) return;
    setConnecting(false);
    const errors: string[] = [];
    const hostError = props.agentHookStatus?.errorMessage?.trim();
    if (hostError) errors.push(hostError);
    for (const agent of installedAgents(agents)) {
      if (agent.hooksInstalled) continue;
      const item = props.agentHookStatus?.agents.find((entry) => entry.agentId === agent.agentId);
      const reason = item?.status === 'updateRequired' ? 'needs an update' : agent.detail || 'could not be connected';
      errors.push(`${agent.name}: ${reason}`);
    }
    setConnectErrors(errors);
    errors.forEach((text, index) => addExtra({ id: 'connect-error-' + index, text, cls: 'wait' }));
  }, [agentsLoading, connecting, agents, props.agentHookStatus]);

  useEffect(() => {
    if (computerUseState !== 'off') setComputerUseRequested(false);
    switch (computerUseState) {
      case 'installing':
        addExtra({ id: 'cu', text: 'Computer Use: installing…', cls: 'acc' });
        break;
      case 'permissions':
        addExtra({ id: 'cu', text: 'Computer Use: waiting for your permission', cls: 'wait' });
        break;
      case 'on':
        addExtra({ id: 'cu', text: 'Computer Use: on', cls: 'ok' });
        break;
      default:
        removeExtra('cu');
    }
  }, [computerUseState]);

  const computerUseOn = computerUseState !== 'off' || computerUseRequested;

  const pickDefault = (agentId: string) => {
    if (!settings) return;
    if (agentId !== defaultAgent) {
      const name = agents.find((agent) => agent.agentId === agentId)?.name ?? agentId;
      addExtra({ id: 'default', text: `${name} set as your default`, cls: 'acc' });
    }
    props.onChange({ ...settings, defaultPromptAgentId: agentId });
  };

  /** Every CLI install (panel rows and the Install guide popup) narrates itself here, then asks for a rescan. */
  const onRescanAgents = props.onRescanAgents;
  const onInstallEvent = useCallback(
    (event: AgentInstallEvent) => {
      switch (event.kind) {
        case 'started':
          setRightTab('scan');
          setExtras((current) =>
            current.filter((item) => !item.id.startsWith('install-') || !item.id.endsWith('-' + event.agentId))
          );
          addExtra({
            id: 'install-' + event.agentId,
            text: `Installing ${event.name} with ${event.methodLabel}…`,
            cls: 'acc',
          });
          break;
        case 'output':
          addExtra({ id: 'install-log-' + event.agentId, text: event.line, cls: 'acc' });
          break;
        case 'succeeded':
          removeExtra('install-log-' + event.agentId);
          addExtra({ id: 'install-done-' + event.agentId, text: `Installed ${event.name}`, cls: 'ok' });
          onRescanAgents();
          break;
        case 'failed':
          removeExtra('install-log-' + event.agentId);
          addExtra({ id: 'install-error-' + event.agentId, text: `${event.name}: ${event.error}`, cls: 'wait' });
          break;
      }
    },
    [onRescanAgents]
  );

  const connectAndContinue = () => {
    if (!integrationOn || connected || installed.length === 0) {
      go(3);
      return;
    }
    setRightTab('scan');
    setConnecting(true);
    setConnectErrors([]);
    setExtras((current) => current.filter((item) => !item.id.startsWith('connect-error-')));
    setFlow({ hooksRequested: true });
    props.onInstallAgentHooks(installed.map((agent) => agent.agentId));
  };

  const toggleComputerUse = () => {
    setRightTab('cu');
    if (computerUseState !== 'off' || computerUseRequested) return;
    setComputerUseRequested(true);
    props.onInstallComputerUse();
    toast('Computer Use is on. Your computer will ask for permission.');
  };

  const scanning = agentsLoading;
  const phases: Record<(typeof TRACK)[number][0], Phase> = {
    search: scanning ? 'active' : 'done',
    found: scanning ? 'idle' : connected || connecting ? 'done' : 'here',
    connected: connected ? 'here' : connecting ? 'active' : 'idle',
  };
  const pillFor = (hooksInstalled: boolean): readonly [string, string] => {
    if (scanning) return ['detpill wait', 'Scanning…'];
    if (integrationOn && hooksInstalled) return ['detpill on', 'Connected'];
    return ['detpill', 'Detected'];
  };
  const missingPrimary = ONBOARDING_PRIMARY_AGENTS.filter(
    ([agentId]) => !agents.some((agent) => agent.agentId === agentId && agent.installed)
  ).map(([agentId]) => ({ agentId, name: catalogAgentName(agents, agentId) }));
  const otherMissing = missing.filter((agent) => !ONBOARDING_PRIMARY_AGENTS.some(([id]) => id === agent.agentId));
  const otherNames = otherMissing.slice(0, 3).map((agent) => agent.name);
  const computerUsePill =
    computerUseState === 'installing' ? (
      <span className='perm-pill'>
        <Spinner /> Installing…
      </span>
    ) : computerUseState === 'permissions' ? (
      <span className='perm-pill'>Needs OS permission</span>
    ) : computerUseState === 'on' ? (
      <span className='perm-pill on'>On</span>
    ) : computerUseRequested ? (
      <span className='perm-pill'>Needs OS permission</span>
    ) : null;

  return (
    <>
      <Eyebrow x={48} y={120}>
        Agents
      </Eyebrow>
      <Heading x={48} y={150} w={720} size={46} l1='Use the agents you already have.' />
      <Sub x={48} y={212} w={720} size={16}>
        Ghostex finds the agents already installed, installs the ones you are missing, and asks which one should be your
        default.
      </Sub>
      <div className='agent-list' style={box(48, 264, 706, 228)} role='radiogroup' aria-label='Default agent'>
        {installed.map((agent) => {
          const selected = agent.agentId === defaultAgent;
          const [pillClass, pillText] = pillFor(agent.hooksInstalled);
          return (
            <div
              key={agent.agentId}
              role='radio'
              aria-checked={selected}
              tabIndex={0}
              className={'glass arow3' + (selected ? ' sel' : '') + (scanning ? ' pending' : '')}
              style={{ height: 68, flex: 'none' }}
              title={agent.detail}
              onClick={() => pickDefault(agent.agentId)}
              onKeyDown={(event) => event.key === ' ' && pickDefault(agent.agentId)}
            >
              <span className='radio' />
              <span className='abox'>
                <AgentLogo agentId={agent.agentId} size={28} />
              </span>
              <div className='arow-t'>
                <div className='nm lg'>{agent.name}</div>
                <div className='ss'>{agent.accountLabel ? `Installed • ${agent.accountLabel}` : 'Installed'}</div>
              </div>
              <span className={pillClass}>{pillText}</span>
            </div>
          );
        })}
        {missingPrimary.map((agent) => (
          <MissingAgentRow
            key={agent.agentId}
            agentId={agent.agentId}
            name={agent.name}
            connection={cliConnection}
            scanning={scanning}
            onEvent={onInstallEvent}
            onOpenGuide={() => setGuideOpen(true)}
          />
        ))}
      </div>
      <div className='glass arow3 other' style={box(48, 492, 706, 68)} {...buttonProps(() => setGuideOpen(true))}>
        <span className='radio off' />
        <span className='abox wide'>
          <OtherAgentsStrip size={19} more={otherMissing.length} />
        </span>
        <div className='arow-t'>
          <div className='nm lg'>Other agents{otherMissing.length > 0 ? ` (+${otherMissing.length})` : ''}</div>
          <div className='ss'>
            {otherNames.length > 0 ? `${otherNames.join(', ')}, and more.` : 'Pi Agent, OpenCode, Gemini, and more.'}
          </div>
        </div>
        <button type='button' className='guide-btn' tabIndex={-1}>
          Install guide
        </button>
      </div>
      <div
        className={'glass vrow' + (integrationOn ? ' on' : '')}
        style={box(48, 576, 706, 72)}
        {...buttonProps(() => setRightTab('integration'))}
      >
        <Icon n='pulse' size={22} className='vicon' />
        <div>
          <div className='nm lg'>Ghostex integration</div>
          <div className='ss'>
            Adds a small Ghostex helper to each agent's own settings, so you see its live status and can resume it.
          </div>
        </div>
        <Toggle
          on={integrationOn}
          onClick={() => {
            setFlow({ integrationOn: !integrationOn });
            setRightTab('integration');
          }}
          label='Ghostex integration'
        />
      </div>
      <div
        className={'glass curow' + (computerUseOn ? ' on' : '')}
        style={box(48, 660, 706, 72)}
        {...buttonProps(() => setRightTab('cu'))}
      >
        <Icon n='monitor' size={22} className='vicon' />
        <div>
          <div className='nm lg'>Computer Use</div>
          <div className='ss'>Let agents use apps outside Ghostex, off until you allow it.</div>
        </div>
        {computerUsePill}
        <Toggle size='md' on={computerUseOn} onClick={toggleComputerUse} label='Computer Use' />
      </div>
      <FootActions panel={2}>
        {integrationOn && !connected && installed.length > 0 && (
          <button type='button' className='ghost' onClick={() => go(3)}>
            Skip for now
          </button>
        )}
        <Cta filled onClick={connectAndContinue} disabled={scanning || connecting}>
          {!integrationOn || connected || installed.length === 0
            ? 'Next'
            : connecting
              ? 'Connecting…'
              : 'Connect & continue'}
        </Cta>
      </FootActions>
      {connectErrors.length > 0 && !connected && (
        <p
          className='note'
          role='alert'
          title={connectErrors.join('\n')}
          style={{
            position: 'absolute',
            left: 48,
            top: 812,
            width: 706,
            margin: 0,
            fontSize: 13,
            lineHeight: '18px',
            color: '#ff6b62',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {connectErrors.join(' · ')}
        </p>
      )}
      <div className='xtabs' style={box(885, 122, 700, 40)} role='tablist' aria-label='Right side'>
        {RIGHT_TABS.map(([id, icon, label]) => (
          <button
            key={id}
            type='button'
            role='tab'
            aria-selected={rightTab === id}
            className={'wtab' + (rightTab === id ? ' on' : '')}
            onClick={() => setRightTab(id)}
          >
            <Icon n={icon} size={14} />
            {label}
          </button>
        ))}
      </div>
      {rightTab === 'scan' && (
        <AgentScanLog
          agents={agents}
          loading={agentsLoading}
          defaultAgentId={defaultAgent}
          extras={extras}
          onRescan={props.onRescanAgents}
          rescanDisabled={connecting}
        />
      )}
      {rightTab === 'integration' && (
        <ExtensionPanel lead={INTEGRATION_LEAD} terms={INTEGRATION_TERMS}>
          <IntegrationPreview on={integrationOn} />
        </ExtensionPanel>
      )}
      {rightTab === 'cu' && (
        <ExtensionPanel lead={COMPUTER_USE_LEAD} terms={COMPUTER_USE_TERMS}>
          <ComputerUsePreview
            state={computerUseState}
            onOpenAccessibilityPreferences={props.onOpenAccessibilityPreferences}
            onOpenScreenRecordingPreferences={props.onOpenScreenRecordingPreferences}
          />
        </ExtensionPanel>
      )}
      <div className='track' style={box(900, 772, 670, 60)} aria-label='Progress'>
        {TRACK.map(([id, label], index) => (
          <Fragment key={id}>
            {index > 0 && <span className={'track-seg' + (phases[id] !== 'idle' ? ' on' : '')} />}
            <div className={'track-chip ' + phases[id]} data-phase={id}>
              {phases[id] === 'active' ? (
                <Spinner />
              ) : phases[id] === 'idle' ? (
                <span className='track-o' />
              ) : (
                <Icon n='checkCircle' size={20} sw={1.7} />
              )}
              {label}
            </div>
          </Fragment>
        ))}
      </div>
      {guideOpen && (
        <InstallGuidePopup
          agents={agents}
          connection={cliConnection}
          onInstallEvent={onInstallEvent}
          toast={toast}
          onClose={() => setGuideOpen(false)}
          onOpenUrl={props.onOpenExternalUrl}
          onOpenGuide={(url) => (props.onOpenInstallGuide ?? props.onOpenExternalUrl)(url)}
          onLater={() => {
            setFlow({ installQueued: true });
            setGuideOpen(false);
            toast('Install guide will open after setup');
          }}
        />
      )}
    </>
  );
}

/** A primary agent the host did not find: an Install button (gxserver job) or, without a connection, the guide. */
function MissingAgentRow({
  agentId,
  name,
  connection,
  scanning,
  onEvent,
  onOpenGuide,
}: {
  agentId: string;
  name: string;
  connection: AgentCliConnection | undefined;
  scanning: boolean;
  onEvent: (event: AgentInstallEvent) => void;
  onOpenGuide: () => void;
}) {
  const row = useAgentInstallRow({ agentId, name, connection, eager: Boolean(connection), onEvent });
  const subtitle = row.error
    ? row.error
    : row.running
      ? `Installing${row.method ? ` with ${row.method.label}` : ''}…`
      : row.installed
        ? 'Installed, press Rescan'
        : row.method
          ? `Not installed · ${row.method.label}`
          : 'Not installed';
  const action = scanning ? (
    <span className='detpill wait'>Scanning…</span>
  ) : row.running ? (
    <span className='detpill wait'>
      <Spinner /> Installing…
    </span>
  ) : row.checking ? (
    <span className='detpill wait'>Checking…</span>
  ) : row.installed ? null : connection && row.method ? (
    <button
      type='button'
      className='install-btn'
      onClick={row.install}
      disabled={Boolean(row.method.unavailableReason)}
      title={row.method.unavailableReason ?? row.method.command}
    >
      <Icon n={row.error ? 'refresh' : 'plus'} size={15} sw={2} />
      {row.error ? 'Retry' : 'Install'}
    </button>
  ) : (
    <button type='button' className='guide-btn' onClick={onOpenGuide}>
      Install guide
    </button>
  );
  return (
    <div
      className={'glass arow3 missing' + (scanning ? ' pending' : '')}
      style={{ height: 68, flex: 'none' }}
      data-agent={agentId}
    >
      <span className='radio-gap' />
      <span className='abox'>
        <AgentLogo agentId={agentId} size={28} />
      </span>
      <div className='arow-t'>
        <div className='nm lg'>{name}</div>
        <div className={'ss' + (row.error ? ' err' : '')} title={row.error} role={row.error ? 'alert' : undefined}>
          {subtitle}
        </div>
      </div>
      {action}
    </div>
  );
}
