import { access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { command } from './process';
import { appDataDir, readJson, writePrivateJson, type Options } from './paths';
export type Daemon = { name: string; pid?: number; clients?: number; cwd?: string; error?: string };
export type ZmxInfo = { binary: string; directory: string; generation: number };
export class Zmx {
  info?: ZmxInfo;
  constructor(readonly config: Options) {}
  env(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.ZMX_SESSION;
    delete env.ZMX_SESSION_PREFIX;
    delete env.ZMX_NO_DETACH_KEY;
    if (this.info?.directory ?? this.config.zmxDir) env.ZMX_DIR = this.info?.directory ?? this.config.zmxDir;
    return env;
  }
  async resolve(): Promise<ZmxInfo> {
    if (this.info) return this.info;
    const cached = await readJson<ZmxInfo>(join(this.config.stateDir, 'zmx.json')).catch(() => undefined);
    const candidates = this.config.zmx
      ? [this.config.zmx]
      : [
          cached?.binary,
          '/Applications/Ghostex.app/Contents/Resources/Web/bin/zmx',
          join(homedir(), 'Applications/Ghostex.app/Contents/Resources/Web/bin/zmx'),
          join(appDataDir, 'gxserver/package/bin/zmx'),
          join(appDataDir, 'gxserver/package/zmx/zig-out/bin/zmx'),
          ...(process.env.PATH ?? '').split(':').map((path) => join(path, 'zmx')),
        ].filter((path): path is string => !!path);
    const errors: string[] = [];
    for (const candidate of [...new Set(candidates)]) {
      try {
        await access(candidate, constants.X_OK);
        const binary = await realpath(candidate);
        const output = await command(binary, ['version'], this.env());
        const generation = Number(output.match(/^wire_generation\s+(\d+)/m)?.[1]);
        const directory =
          this.config.zmxDir ??
          (cached?.binary === candidate ? cached.directory : undefined) ??
          output.match(/^socket_dir\s+(.+)$/m)?.[1]?.trim();
        if (!generation || !directory) {
          errors.push(`${candidate}: missing Ghostex wire generation`);
          continue;
        }
        this.info = { binary, directory, generation };
        await writePrivateJson(this.config.stateDir, 'zmx.json', this.info).catch(() => {});
        return this.info;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(String(error));
      }
    }
    throw new Error(
      `No Ghostex-compatible zmx. Set --zmx /path/to/bundled/zmx. ${errors.slice(0, 2).join('; ')}`
    );
  }
  /** CDXC:Zmx 2026-09-17 DECISION:
   * User: list and attach to local zmx sessions even when gxserver is offline.
   * This path invokes zmx directly and must not auto-start the control plane.
   */
  async list(): Promise<Daemon[]> {
    const info = await this.resolve();
    const output = await command(info.binary, ['list'], this.env(), 8000);
    return output
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const fields = Object.fromEntries(
          line
            .trim()
            .replace(/^\*\s*/, '')
            .split('\t')
            .map((field) => {
              const i = field.indexOf('=');
              return [field.slice(0, i).trim(), field.slice(i + 1)];
            })
        );
        if (!fields.name) throw new Error('Unrecognized zmx list output. Refusing an incomplete inventory.');
        return {
          name: fields.name,
          pid: Number(fields.pid) || undefined,
          clients: Number(fields.clients) || 0,
          cwd: fields.cwd ?? fields.start_dir,
          error: fields.err ?? fields.error,
        };
      });
  }
  async requireExisting(name: string): Promise<ZmxInfo> {
    if (!name || name.startsWith('-') || /[\x00-\x1f\x7f]/u.test(name))
      throw new Error('Invalid daemon name.');
    const live = (await this.list()).find((row) => row.name === name);
    if (!live || live.error) throw new Error(live?.error ?? 'The selected zmx daemon is no longer running.');
    return this.info!;
  }
}
