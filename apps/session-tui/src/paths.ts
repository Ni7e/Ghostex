import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}
const absoluteEnv = (name: string) => {
  const value = process.env[name];
  return value && isAbsolute(value) ? value : undefined;
};
const profile = absoluteEnv('GHOSTEX_HOME');
export const configDir =
  profile ?? join(absoluteEnv('XDG_CONFIG_HOME') ?? join(homedir(), '.config'), 'ghostex');
export const appStateDir = profile
  ? join(profile, 'state')
  : join(absoluteEnv('XDG_STATE_HOME') ?? join(homedir(), '.local/state'), 'ghostex');
export const appDataDir =
  profile ?? join(absoluteEnv('XDG_DATA_HOME') ?? join(homedir(), '.local/share'), 'ghostex');
export const daemonRoot = join(appStateDir, 'gxserver');
export type Options = {
  url: string;
  tokenFile: string;
  stateDir: string;
  zmx?: string;
  zmxDir?: string;
  offline: boolean;
  direct: boolean;
  json: boolean;
  space?: string;
};
export async function options(args: string[]): Promise<Options> {
  const value = (flag: string) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    if (!args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    return args[i + 1];
  };
  const metadata = await readJson<{ port?: number }>(join(daemonRoot, 'runtime/server.json')).catch(
    () => undefined
  );
  const port = process.env.GHOSTEX_GXSERVER_DEV_PORT ?? metadata?.port ?? 58744;
  const url = new URL(value('--url') ?? process.env.GHOSTEX_GXSERVER_BASE_URL ?? `http://127.0.0.1:${port}`);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error('This debugger connects to local gxserver only. Use a loopback URL.');
  }
  const namespace = createHash('sha256')
    .update(appStateDir + url.origin)
    .digest('hex')
    .slice(0, 12);
  return {
    url: url.origin,
    tokenFile:
      value('--token-file') ?? process.env.GHOSTEX_GXSERVER_AUTH_TOKEN_FILE ?? join(daemonRoot, 'auth/token'),
    stateDir:
      value('--state-dir') ??
      join(process.env.HERDR_PLUGIN_STATE_DIR ?? join(appStateDir, 'session-tui'), namespace),
    zmx: value('--zmx') ?? process.env.GHOSTEX_ZMX_BIN,
    zmxDir: value('--zmx-dir') ?? process.env.ZMX_DIR,
    offline: args.includes('--offline'),
    direct: args.includes('--direct'),
    json: args.includes('--json'),
    space: value('--space'),
  };
}
export async function writePrivateJson(dir: string, name: string, data: unknown): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, name);
  const temporary = path + '.' + randomUUID();
  await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
  await rename(temporary, path);
}
