import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_ISOLATED_GPUI_VARIANT = 'ghostex-3';

/**
 * CDXC:Build 2026-09-20 WHY:
 * A variant is one complete alternative app identity: its own app name, bundle id, storage root and
 * the three ports a running instance owns (gxserver, code-server, CEF remote debugging). Keeping
 * them in one table is what lets a second checkout build and run its own copy next to the user's
 * normal Ghostex without sharing state or fighting over a port, and every value here must stay
 * clear of the main instance (58744, 3777) and of every other row. Add a row to introduce a
 * variant; never branch the launcher on which one is selected.
 */
const ISOLATED_GPUI_VARIANTS = {
  /**
   * CDXC:Build 2026-09-13 DECISION:
   * User: ghostex-3 must start separately from the main Ghostex with separate configuration, sharing only the existing hooks via a symlink.
   * The bundle retains this environment so reopening it from Finder uses the same isolated instance.
   */
  'ghostex-3': {
    appName: 'Ghostex-3',
    bundleId: 'com.madda.ghostex.gpui.ghostex-3',
    storageDirectoryName: 'ghostex-3',
    gxserverDevPort: '58747',
    codeServerPort: '3778',
    cefRemoteDebuggingPort: '9337',
  },
  /**
   * CDXC:Build 2026-09-20 DECISION:
   * User: the UI revamp clone must launch its own app instance alongside the normal Ghostex.
   */
  'ui-revamp': {
    appName: 'Ghostex-UI-Revamp',
    bundleId: 'com.madda.ghostex.gpui.ui-revamp',
    storageDirectoryName: 'ghostex-ui-revamp',
    gxserverDevPort: '58751',
    codeServerPort: '3781',
    cefRemoteDebuggingPort: '9341',
  },
};

export function isolatedGpuiVariantNames() {
  return Object.keys(ISOLATED_GPUI_VARIANTS);
}

/**
 * Reads the `--isolated` / `--isolated=<variant>` argument shared by start-gpui.mjs and this
 * file's own entry point, so both select a variant the same way. Returns undefined for any other
 * argument.
 */
export function parseIsolatedGpuiArgument(argument) {
  if (argument === '--isolated') return DEFAULT_ISOLATED_GPUI_VARIANT;
  if (!argument.startsWith('--isolated=')) return undefined;
  const variant = argument.slice('--isolated='.length).trim();
  if (!variant) throw new Error(`Name the variant: --isolated=<${isolatedGpuiVariantNames().join('|')}>.`);
  return variant;
}

export function isolatedGpuiStartCommand(variant) {
  return variant === DEFAULT_ISOLATED_GPUI_VARIANT
    ? 'bun run start:isolated'
    : `bun tooling/start-gpui.mjs --isolated=${variant}`;
}

export function isolatedGpuiConfiguration(variantName = DEFAULT_ISOLATED_GPUI_VARIANT) {
  if (process.platform !== 'darwin') throw new Error('The isolated Ghostex launcher currently supports macOS.');
  const variant = Object.hasOwn(ISOLATED_GPUI_VARIANTS, variantName) ? ISOLATED_GPUI_VARIANTS[variantName] : undefined;
  if (!variant) {
    throw new Error(
      `Unknown isolated Ghostex variant: ${variantName}. Known variants: ${isolatedGpuiVariantNames().join(', ')}.`
    );
  }
  const home = path.join(homedir(), '.local', 'share', variant.storageDirectoryName);
  const installDir = path.join(homedir(), 'Applications');
  const gxserver = path.join(installDir, `${variant.appName}.app`, 'Contents/Resources/Web/gxserver/bin/gxserver');
  return {
    variant: variantName,
    appName: variant.appName,
    bundleId: variant.bundleId,
    installDir,
    environment: {
      GHOSTEX_HOME: home,
      GHOSTEX_GXSERVER_DEV_PORT: variant.gxserverDevPort,
      GHOSTEX_CODE_SERVER_PORT: variant.codeServerPort,
      CODE_SERVER_CONFIG: path.join(home, 'code-server-runtime-gpui/config.yaml'),
      GHOSTEX_GPUI_CEF_REMOTE_DEBUGGING_PORT: variant.cefRemoteDebuggingPort,
      GHOSTEX_GXSERVER_CLI: gxserver,
      GHOSTEX_GXSERVER_BIN: gxserver,
    },
  };
}

export function prepareIsolatedGpui(configuration) {
  const configuredData = process.env.XDG_DATA_HOME?.trim();
  const originalData =
    configuredData && path.isAbsolute(configuredData)
      ? path.join(configuredData, 'ghostex')
      : path.join(homedir(), '.local', 'share', 'ghostex');
  const originalHooks = path.join(originalData, 'hooks');
  if (!existsSync(originalHooks)) throw new Error(`Original Ghostex hooks are missing: ${originalHooks}`);
  const home = configuration.environment.GHOSTEX_HOME;
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(configuration.installDir, { recursive: true });
  const hooks = path.join(home, 'hooks');
  if (lstatSync(home).isSymbolicLink() || lstatSync(hooks, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error('The isolated storage root and hooks directory must be private directories.');
  }
  detachIsolatedVSCodeSettings(home);
  mkdirSync(hooks, { recursive: true, mode: 0o700 });
  // Link files individually: hook upgrades use atomic rename, so they can
  // replace a local link without writing through a shared directory.
  for (const entry of readdirSync(originalHooks, { withFileTypes: true })) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const source = path.join(originalHooks, entry.name);
    const target = path.join(hooks, entry.name);
    const existing = lstatSync(target, { throwIfNoEntry: false });
    if (existing?.isSymbolicLink() && realpathSync(target) !== realpathSync(source)) {
      throw new Error(`The existing hook link points elsewhere: ${target}`);
    }
    if (!existing) symlinkSync(source, target);
  }
}

// The first isolated build linked these entries back to the user's VS Code.
// Preserve their current contents as private copies before starting the editor.
function detachIsolatedVSCodeSettings(home) {
  const user = path.join(home, 'code-server-runtime-gpui/user-data/User');
  for (const name of ['settings.json', 'keybindings.json', 'snippets', 'mcp.json', 'tasks.json']) {
    const target = path.join(user, name);
    if (!lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) continue;
    const temporary = `${target}.isolated-${process.pid}`;
    cpSync(realpathSync(target), temporary, { recursive: true, dereference: true, errorOnExist: true, force: false });
    // POSIX rename replaces a file symlink directly. A copied snippets
    // directory needs its old directory symlink unlinked first.
    if (lstatSync(temporary).isDirectory()) unlinkSync(target);
    renameSync(temporary, target);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let variant = DEFAULT_ISOLATED_GPUI_VARIANT;
  const forwarded = [];
  for (const argument of process.argv.slice(2)) {
    const selected = parseIsolatedGpuiArgument(argument);
    if (selected) variant = selected;
    else forwarded.push(argument);
  }
  const configuration = isolatedGpuiConfiguration(variant);
  if (forwarded[0] === '--print') {
    process.stdout.write(`${JSON.stringify(configuration, null, 2)}\n`);
  } else {
    prepareIsolatedGpui(configuration);
    const cli = path.join(configuration.installDir, `${configuration.appName}.app`, 'Contents/Resources/CLI/ghostex');
    if (!existsSync(cli)) {
      throw new Error(`Build ${configuration.appName} first with ${isolatedGpuiStartCommand(variant)}.`);
    }
    const result = spawnSync(cli, forwarded, {
      env: { ...process.env, ...configuration.environment },
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
}
