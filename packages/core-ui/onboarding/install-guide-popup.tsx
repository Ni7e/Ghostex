import {
  AGENT_CLI_CATALOG,
  agentCliCatalogInstallCommand,
  type AgentCliCatalogEntry,
  type AgentCliConnection,
} from '@/packages/shared/agent-cli-maintenance';
import { useAgentInstallRow, type AgentInstallEvent } from './agent-install';
import type { OnboardingDetectedAgent } from './contract';
import { ONBOARDING_PRIMARY_AGENTS, ONBOARDING_INSTALL_GUIDE_URL, catalogAgentName } from './onboarding-state';
import { AgentLogo, Cta, Icon, Popup, Spinner } from './primitives';

const noEvent = () => undefined;

/** Every catalog agent the host did not find, the three primary ones first, in catalog order after that. */
function missingCatalogEntries(agents: readonly OnboardingDetectedAgent[]): AgentCliCatalogEntry[] {
  const installed = new Set(agents.filter((agent) => agent.installed).map((agent) => agent.agentId));
  const missing = AGENT_CLI_CATALOG.filter((entry) => !installed.has(entry.agentId));
  const rank = (entry: AgentCliCatalogEntry) => {
    const index = ONBOARDING_PRIMARY_AGENTS.findIndex(([id]) => id === entry.agentId);
    return index === -1 ? ONBOARDING_PRIMARY_AGENTS.length : index;
  };
  return [...missing].sort((a, b) => rank(a) - rank(b));
}

export function InstallGuidePopup({
  agents = [],
  connection,
  onInstallEvent = noEvent,
  onClose,
  onLater,
  toast,
  onOpenUrl,
  onOpenGuide,
}: {
  /** Detection result; installed agents are left out of the list. */
  agents?: readonly OnboardingDetectedAgent[];
  /** When present every row gets a real Install button (gxserver job); otherwise rows copy their command. */
  connection?: AgentCliConnection;
  onInstallEvent?: (event: AgentInstallEvent) => void;
  onClose: () => void;
  /** Queue the guide for after onboarding; omitted on the finished screen, where the guide opens right away. */
  onLater?: () => void;
  toast: (message: string) => void;
  onOpenUrl: (url: string) => void;
  onOpenGuide: (url: string) => void;
}) {
  const copy = (command: string) => {
    navigator.clipboard?.writeText(command).catch(() => undefined);
    toast(`Copied ${command}`);
  };
  return (
    <Popup title='Install another agent' onClose={onClose} width={620}>
      <p className='modal-p'>
        {connection
          ? 'Ghostex runs any agent CLI installed on your computer. Install one here with its official command; it shows up in the list once the scan finds it.'
          : `Ghostex runs any agent CLI already installed on your computer. Install one, then ${
              onLater ? 'press Rescan' : 'rescan in Settings → Agents'
            }.`}
      </p>
      <div className='install-list'>
        {missingCatalogEntries(agents).map((entry) => (
          <InstallGuideRow
            key={entry.agentId}
            entry={entry}
            name={catalogAgentName(agents, entry.agentId)}
            connection={connection}
            onEvent={onInstallEvent}
            onCopy={copy}
            onOpenUrl={onOpenUrl}
          />
        ))}
      </div>
      <div className='modal-actions'>
        <button type='button' className='ghost guide-link' onClick={() => onOpenGuide(ONBOARDING_INSTALL_GUIDE_URL)}>
          <Icon n='external' size={14} />
          Full install guide
        </button>
        {onLater ? (
          <>
            <button type='button' className='ghost' onClick={onClose}>
              Close
            </button>
            <Cta filled arrow={false} className='sm' onClick={onLater}>
              Open after onboarding
            </Cta>
          </>
        ) : (
          <Cta filled arrow={false} className='sm' onClick={onClose}>
            Done
          </Cta>
        )}
      </div>
    </Popup>
  );
}

function InstallGuideRow({
  entry,
  name,
  connection,
  onEvent,
  onCopy,
  onOpenUrl,
}: {
  entry: AgentCliCatalogEntry;
  name: string;
  connection: AgentCliConnection | undefined;
  onEvent: (event: AgentInstallEvent) => void;
  onCopy: (command: string) => void;
  onOpenUrl: (url: string) => void;
}) {
  // Lazy: the popup lists 20+ agents, so gxserver is asked for a row's methods only when its Install is pressed.
  const row = useAgentInstallRow({ agentId: entry.agentId, name, connection, eager: false, onEvent });
  const command = row.method?.command ?? agentCliCatalogInstallCommand(entry);
  return (
    <div className='install-row' data-agent={entry.agentId}>
      <AgentLogo agentId={entry.agentId} size={18} />
      <button type='button' className='nm link' onClick={() => onOpenUrl(entry.docsUrl)} title={entry.docsUrl}>
        {name}
      </button>
      {row.error ? (
        <span className='install-err' role='alert' title={row.error}>
          {row.error}
        </span>
      ) : (
        <code title={command}>{command ?? 'See the install docs'}</code>
      )}
      {row.running ? (
        <span className='detpill wait'>
          <Spinner /> Installing…
        </span>
      ) : row.installed ? (
        <span className='detpill on'>Installed</span>
      ) : connection ? (
        <button type='button' className='install-btn' onClick={row.install} title={command}>
          <Icon n={row.error ? 'refresh' : 'plus'} size={14} sw={2} />
          {row.error ? 'Retry' : 'Install'}
        </button>
      ) : command ? (
        <button
          type='button'
          className='icon-btn'
          onClick={() => onCopy(command)}
          aria-label={`Copy ${name} install command`}
        >
          <Icon n='copy' size={15} />
        </button>
      ) : null}
    </div>
  );
}
