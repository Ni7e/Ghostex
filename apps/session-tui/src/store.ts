import { join } from 'node:path';
import { Gxserver, type Catalog } from './gxserver';
import { Zmx, type Daemon } from './zmx';
import { readPreferences, type Preferences } from './preferences';
import { readJson, writePrivateJson, type Options } from './paths';
import { projectCatalog, type View, type ViewOptions } from './model';
export type Saved = { version: 1; catalog: Catalog; prefs: Preferences };
export class Store {
  readonly gx: Gxserver;
  readonly zmx: Zmx;
  catalog?: Catalog;
  prefs?: Preferences;
  view?: View;
  daemons: Daemon[] = [];
  online = false;
  serverError = '';
  zmxError = '';
  cacheError = '';
  refreshing = false;
  viewOptions: ViewOptions;
  onChange = () => {};
  constructor(readonly config: Options) {
    this.gx = new Gxserver(config);
    this.zmx = new Zmx(config);
    this.viewOptions = { spaceId: config.space, sortMode: 'lastActivity', showHidden: false, tags: [] };
  }
  async initialize() {
    try {
      const saved = await readJson<Saved>(join(this.config.stateDir, 'catalog.json'));
      if (saved?.version === 1 && Array.isArray(saved.catalog?.snapshot?.sessions) && saved.prefs?.collapse) {
        this.catalog = saved.catalog;
        this.prefs = saved.prefs;
        this.project();
      }
    } catch (error) {
      this.cacheError = `Saved layout: ${String(error)}`;
    }
    await this.refresh();
  }
  project() {
    if (!this.catalog || !this.prefs) return;
    this.view = projectCatalog(this.catalog, this.prefs, {
      ...this.viewOptions,
      nowMs: this.online ? Date.now() : Date.parse(this.catalog.capturedAt),
    });
    this.onChange();
  }
  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      await Promise.allSettled([
        (async () => {
          try {
            const [catalog, prefs] = await Promise.all([this.gx.catalog(), readPreferences()]);
            this.catalog = catalog;
            if (!this.prefs) this.prefs = prefs;
            else {
              this.prefs.settings = prefs.settings;
              this.prefs.hidden = prefs.hidden;
              this.prefs.source = prefs.source;
            }
            this.online = true;
            this.serverError = '';
            this.project();
            try {
              await writePrivateJson(this.config.stateDir, 'catalog.json', {
                version: 1,
                catalog,
                prefs: this.prefs,
              } satisfies Saved);
              this.cacheError = '';
            } catch (error) {
              this.cacheError = `Cache save failed: ${String(error)}`;
            }
          } catch (error) {
            this.online = false;
            this.serverError = String(error);
            this.project();
          }
        })(),
        (async () => {
          try {
            this.daemons = await this.zmx.list();
            this.zmxError = '';
            this.onChange();
          } catch (error) {
            this.daemons = [];
            this.zmxError = String(error);
          }
        })(),
      ]);
    } finally {
      this.refreshing = false;
      this.onChange();
    }
  }
  async syncPreferences() {
    this.prefs = await readPreferences();
    this.viewOptions.spaceId = undefined;
    this.project();
  }
  export() {
    return {
      online: this.online,
      capturedAt: this.catalog?.capturedAt,
      serverError: this.serverError || undefined,
      zmxError: this.zmxError || undefined,
      cacheError: this.cacheError || undefined,
      zmx: this.zmx.info,
      view: this.view,
      daemons: this.daemons,
    };
  }
}
