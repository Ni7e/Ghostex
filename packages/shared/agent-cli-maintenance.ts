import catalog from './agent-cli-catalog.json';

/**
 * CDXC:AgentProviders 2026-09-14 DECISION:
 * User: install and update agent CLIs from the Agents page, using each CLI's own commands, and link to each agent's installation docs.
 * ZCode uses npm install -g zcode-app-cli@latest, launches with zcode, and links to https://github.com/kingsword09/zcode-cli.
 * SEE-ALSO: agent-cli-catalog.json is also embedded by server/src/agent_cli/catalog.rs.
 */
export const AGENT_CLI_CATALOG = catalog;

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
