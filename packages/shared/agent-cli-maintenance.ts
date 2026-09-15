import catalog from './agent-cli-catalog.json';

/**
 * CDXC:AgentProviders 2026-09-14 DECISION:
 * User: install and update agent CLIs from the Agents page, using each CLI's own commands, and link to each agent's installation docs.
 * ZCode uses npm install -g zcode-app-cli@latest, launches with zcode, and links to https://github.com/kingsword09/zcode-cli.
 * SEE-ALSO: agent-cli-catalog.json is also embedded by server/src/agent_cli/catalog.rs.
 */
export const AGENT_CLI_CATALOG: readonly AgentCliCatalogEntry[] = catalog;

/** One row of agent-cli-catalog.json: the agent's binary, docs, and the package sources gxserver can install from. */
export type AgentCliCatalogEntry = {
  agentId: string;
  binary: string;
  docsUrl: string;
  npmPackage?: string;
  npmFlags?: string[];
  packageManagers?: string[];
  brewFormula?: string;
  brewCask?: boolean;
  wingetId?: string;
  miseTool?: string;
  versionArgs?: string[];
  native?: { install: string; update?: string; windowsInstall?: string };
};

/**
 * The install command shown when no gxserver connection can compute the real method list (the copy-the-command
 * path of the onboarding Install guide): the agent's first package manager, otherwise its official installer,
 * otherwise Homebrew. Same order gxserver's own catalog uses after mise.
 */
export function agentCliCatalogInstallCommand(entry: AgentCliCatalogEntry): string | undefined {
  if (entry.npmPackage) {
    const manager = entry.packageManagers?.[0] ?? 'npm';
    const verb = manager === 'pnpm' ? 'add' : 'install';
    const flags = manager === 'npm' && entry.npmFlags?.length ? `${entry.npmFlags.join(' ')} ` : '';
    return `${manager} ${verb} -g ${flags}${entry.npmPackage}@latest`;
  }
  if (entry.native?.install) return entry.native.install;
  if (entry.brewFormula) return `brew install ${entry.brewCask ? '--cask ' : ''}${entry.brewFormula}`;
  return undefined;
}

export type AgentCliRequest = {
  action: 'read' | 'start';
  agentId: string;
  operation?: 'install' | 'update';
  methodId?: string;
};

export type AgentCliMethod = {
  id: string;
  label: string;
  command: string;
  unavailableReason?: string;
};

export type AgentCliJob = {
  id: string;
  operation: 'install' | 'update';
  command: string;
  status: 'running' | 'succeeded' | 'failed';
  output: string;
  error?: string;
};

export type AgentCliState = {
  agentId: string;
  platform: string;
  executablePath?: string;
  version?: string;
  versionError?: string;
  detectedMethodId?: string;
  methods: AgentCliMethod[];
  job?: AgentCliJob;
};

export type AgentCliConnection = {
  id: string;
  label: string;
  request: (request: AgentCliRequest) => Promise<AgentCliState>;
};
