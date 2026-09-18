import { command } from './process';
import type { Options } from './paths';
import type { ZmxInfo } from './zmx';
import { clean } from './render';
export const PLUGIN_ID = 'ghostex.sessions';
const binary = () => process.env.HERDR_BIN_PATH || 'herdr';
function invocationContext(): { focused_pane_id?: string; workspace_id?: string } {
  try {
    return JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON ?? '{}');
  } catch {
    return {};
  }
}
export const herdrPaneId = () => process.env.HERDR_PANE_ID || invocationContext().focused_pane_id;
function checkedResult(output: string) {
  const parsed = JSON.parse(output);
  if (parsed.error) throw new Error(parsed.error.message ?? JSON.stringify(parsed.error));
  return parsed;
}
function contextArgs(split: boolean): string[] {
  // CDXC:Terminal 2026-09-17 WHY: Herdr rejects workspace_id on split requests even when target_pane_id is supplied; workspace targeting is only for tabs.
  if (split) {
    const paneId = herdrPaneId();
    if (!paneId) throw new Error('Open a Herdr terminal pane and run ghostex-debug there.');
    return ['--target-pane', paneId];
  }
  const workspaceId = process.env.HERDR_WORKSPACE_ID || invocationContext().workspace_id;
  return workspaceId ? ['--workspace', workspaceId] : [];
}
export async function openBrowser(floating = false): Promise<void> {
  if (floating) {
    checkedResult(
      await command(binary(), [
        'plugin',
        'pane',
        'open',
        '--plugin',
        PLUGIN_ID,
        '--entrypoint',
        'floating',
        '--focus',
      ])
    );
    return;
  }
  checkedResult(
    await command(binary(), [
      'plugin',
      'pane',
      'open',
      '--plugin',
      PLUGIN_ID,
      '--entrypoint',
      'sessions',
      '--placement',
      'split',
      '--direction',
      'right',
      '--focus',
      ...contextArgs(true),
    ])
  );
}
export async function openHerdrSession(
  name: string,
  info: ZmxInfo,
  config: Options,
  placement: 'split' | 'tab',
  title: string = name
): Promise<void> {
  const args = [
    'plugin',
    'pane',
    'open',
    '--plugin',
    PLUGIN_ID,
    '--entrypoint',
    'attach',
    '--placement',
    placement,
    '--focus',
  ];
  args.push(...contextArgs(placement === 'split'));
  if (placement === 'split') args.push('--direction', 'right');
  for (const [key, value] of Object.entries({
    GHOSTEX_DEBUG_ZMX_NAME: name,
    GHOSTEX_DEBUG_SESSION_TITLE: clean(title).trim() || name,
    GHOSTEX_ZMX_BIN: info.binary,
    ZMX_DIR: info.directory,
    GHOSTEX_DEBUG_STATE_DIR: config.stateDir,
    GHOSTEX_GXSERVER_BASE_URL: config.url,
    GHOSTEX_GXSERVER_AUTH_TOKEN_FILE: config.tokenFile,
  }))
    args.push('--env', `${key}=${value}`);
  checkedResult(await command(binary(), args));
}

/** CDXC:Terminal 2026-09-17 DECISION:
 * User: panes launched from ghostex-debug must use the session name instead of "Ghostex terminal".
 */
export async function nameAttachedPane(): Promise<void> {
  const pane = process.env.HERDR_PANE_ID;
  const title = process.env.GHOSTEX_DEBUG_SESSION_TITLE;
  if (pane && title) checkedResult(await command(binary(), ['pane', 'rename', pane, '--', clean(title)]));
}
