import type { Key } from 'node:readline';
import { DEFAULT_PROJECT_SESSION_SECTION_COLLAPSE_STATE } from '@/packages/core-ui/sidebar-app/project-session-section-model';
import { Store } from './store';
import type { Row } from './model';
import { clean, paint, textWidth, type Line } from './render';
import { TerminalInput, enableMouse, disableMouse, type MouseInput } from './input';
import { attach } from './attach';
import { openHerdrSession, herdrPaneId } from './herdr';
import { wrapSpaces } from './space-header';
import { readJson, writePrivateJson } from './paths';
import { join } from 'node:path';
import {
  normalizeSidebarUiCollapseState,
  type SidebarUiCollapseState,
} from '@/packages/core-ui/sidebar-app/collapse-state';

type MenuItem = { id: string; label: string; agentId?: string };
type Menu = { kind: 'spaces' | 'projects' | 'agents'; items: MenuItem[]; index: number; projectId?: string };
type MouseTarget = { kind: 'row' | 'space' | 'menu' | 'key'; id: string };
type HitRegion = { x: number; end: number; y: number; target: MouseTarget };
type PopupState = {
  version: 1;
  selectedId: string;
  spaceId?: string;
  query: string;
  offset: number;
  direct: boolean;
  sortMode: 'manual' | 'lastActivity';
  showHidden: boolean;
  collapse?: SidebarUiCollapseState;
};
export class TerminalUI {
  input = new TerminalInput(
    (text, key) => this.onKey(text, key),
    (event) => this.onMouse(event)
  );
  hits: HitRegion[] = [];
  pressed?: MouseTarget;
  direct: boolean;
  query = '';
  searching = false;
  selectedId = '';
  offset = 0;
  bodyCapacity = 1;
  message = 'Enter opens a session. Ctrl+\\ detaches back to this list.';
  menu?: Menu;
  suspended = false;
  busy = false;
  closed = false;
  help = false;
  helpOffset = 0;
  timer?: ReturnType<typeof setInterval>;
  constructor(
    readonly store: Store,
    readonly floating = false
  ) {
    this.direct = store.config.direct;
  }
  rows(): Row[] {
    const rows = this.direct
      ? this.store.daemons.map((d) => ({
          id: d.name,
          type: 'session' as const,
          label: d.name,
          depth: 0,
          zmxName: d.name,
        }))
      : (this.store.view?.rows ?? []);
    if (!this.query) return rows;
    return rows.filter(
      (row) =>
        (row.type === 'session' || row.type === 'project') &&
        `${row.label} ${row.zmxName ?? ''}`.toLowerCase().includes(this.query.toLowerCase())
    );
  }
  selection(): Row | undefined {
    return this.rows().find((row) => row.id === this.selectedId);
  }
  normalizeSelection() {
    const rows = this.rows();
    if (!rows.some((r) => r.id === this.selectedId))
      this.selectedId = (rows.find((r) => r.type === 'session') ?? rows[0])?.id ?? '';
  }
  enter() {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write('\x1b[?1049h\x1b[?25l' + enableMouse);
    this.suspended = false;
    this.input.start();
  }
  leave() {
    this.suspended = true;
    this.input.stop();
    this.pressed = undefined;
    this.hits = [];
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(disableMouse + '\x1b[0m\x1b[?25h\x1b[?1049l');
  }
  async start() {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error('An interactive terminal is required. Use --json for a read-only snapshot.');
    this.enter();
    process.stdout.on('resize', this.draw);
    process.on('SIGINT', this.onSignal);
    process.on('SIGTERM', this.onSignal);
    process.on('exit', this.onExit);
    this.store.onChange = this.draw;
    this.message = 'Connecting to gxserver and scanning local zmx...';
    this.draw();
    await this.store.initialize();
    if (this.closed) return;
    if (this.floating) {
      try {
        const saved = await readJson<PopupState>(join(this.store.config.stateDir, 'popup-ui.json'));
        if (saved?.version === 1) {
          this.selectedId = typeof saved.selectedId === 'string' ? saved.selectedId : '';
          this.query = typeof saved.query === 'string' ? saved.query : '';
          this.offset = Number.isFinite(saved.offset) ? Math.max(0, saved.offset) : 0;
          this.direct = !!saved.direct;
          this.store.viewOptions.spaceId = saved.spaceId;
          this.store.viewOptions.sortMode = saved.sortMode === 'manual' ? 'manual' : 'lastActivity';
          this.store.viewOptions.showHidden = !!saved.showHidden;
          if (saved.collapse && this.store.prefs)
            this.store.prefs.collapse = normalizeSidebarUiCollapseState(saved.collapse);
          this.store.project();
        }
      } catch (error) {
        this.message = `Could not restore popup: ${String(error)}`;
      }
    }
    if (this.closed) return;
    if (!this.store.view) this.direct = true;
    this.message =
      this.store.cacheError ||
      (this.direct
        ? 'Direct zmx. Enter attaches; Ctrl+\\ returns here.'
        : (this.store.prefs?.source ?? 'Ready.'));
    this.draw();
    this.timer = setInterval(() => {
      if (!this.suspended && !this.busy) void this.store.refresh();
    }, 5000);
  }
  onExit = () => {
    if (!this.suspended && !this.closed) this.leave();
  };
  onSignal = () => {
    if (!this.suspended) this.close();
  };
  /** CDXC:Terminal 2026-09-17 DECISION:
   * User: show and hide ghostex-debug as a floating Herdr window.
   * Herdr popup processes are transient, so save the view before closing and restore it on the next open.
   */
  async hide() {
    if (this.floating)
      await writePrivateJson(this.store.config.stateDir, 'popup-ui.json', {
        version: 1,
        selectedId: this.selectedId,
        spaceId: this.store.view?.spaceId,
        query: this.query,
        offset: this.offset,
        direct: this.direct,
        sortMode: this.store.viewOptions.sortMode,
        showHidden: this.store.viewOptions.showHidden,
        collapse: this.store.prefs?.collapse,
      } satisfies PopupState);
    this.close();
  }
  close() {
    if (this.timer) clearInterval(this.timer);
    this.store.onChange = () => {};
    process.stdout.off('resize', this.draw);
    process.off('SIGINT', this.onSignal);
    process.off('SIGTERM', this.onSignal);
    process.off('exit', this.onExit);
    if (!this.suspended) this.leave();
    this.closed = true;
  }
  draw = () => {
    if (this.suspended || this.closed) return;
    this.normalizeSelection();
    this.hits = [];
    const height = process.stdout.rows ?? 24;
    const width = Math.max(1, (process.stdout.columns ?? 80) - 1);
    let capacity = Math.max(1, height - 10);
    this.bodyCapacity = capacity;
    const status = this.store.online
      ? 'ONLINE'
      : `OFFLINE${this.store.catalog ? ' / cached ' + this.store.catalog.capturedAt.slice(11, 19) : ' / no cache'}`;
    const lines: Line[] = [
      { text: `GHOSTEX DEBUG  |  ${status}  |  ${this.direct ? 'DIRECT ZMX' : 'SESSIONS'}`, style: 'cyan' },
    ];
    if (this.menu) {
      lines.push(
        {
          text: `Choose ${this.menu.kind === 'agents' ? 'agent to launch' : this.menu.kind === 'projects' ? 'project' : 'space'}${this.menu.projectId ? ' / ' + this.menu.projectId : ''}`,
          style: 'cyan',
        },
        { text: '' }
      );
      const start = Math.max(0, this.menu.index - capacity + 1);
      lines.push(
        ...this.menu.items.slice(start, start + capacity).map((item, i) => {
          this.hits.push({
            x: 1,
            end: width,
            y: 4 + i,
            target: { kind: 'menu', id: `${this.menu!.kind}:${this.menu!.projectId ?? ''}:${item.id}` },
          });
          return {
            text: `${start + i === this.menu!.index ? '>' : ' '} ${item.label}`,
            style: start + i === this.menu!.index ? ('selected' as const) : undefined,
          };
        })
      );
    } else if (this.help) {
      const helpLines = [
        'NAVIGATION',
        'Mouse       click rows, headings, spaces and buttons',
        'Wheel       scroll the list, menus or help',
        '↑↓ / j k    select row    PgUp/PgDn scroll',
        'Enter       attach or expand/collapse',
        '← →         collapse / expand section',
        '[ ] / 1..9  change space    w all spaces',
        '/           search    Esc clear/back',
        'z           switch Ghostex / raw zmx list',
        'ACTIONS',
        'n           create session (choose agent)',
        's / t       open Herdr split / tab',
        'o           switch manual/activity sort',
        'H           show/hide hidden projects',
        'g           reload saved GPUI preferences',
        'r           refresh    q quit',
        'ATTACHED TERMINAL',
        'Ctrl+\\     detach this client; return to list',
        'Offline: only live zmx daemons can attach.',
      ];
      this.helpOffset = Math.max(0, Math.min(this.helpOffset, Math.max(0, helpLines.length - (height - 7))));
      lines.push(
        ...helpLines
          .slice(this.helpOffset, this.helpOffset + Math.max(1, height - 7))
          .map((text) => ({ text }))
      );
    } else {
      const view = this.store.view;
      if (this.direct)
        lines.push({ text: `zmx: ${this.store.zmx.info?.directory ?? 'resolving...'}`, style: 'dim' });
      else {
        const spaces = wrapSpaces(view?.spaces ?? [], view?.spaceId, width);
        const start = lines.length + 1;
        lines.push(...spaces.lines.map((text) => ({ text, style: 'dim' as const })));
        this.hits.push(
          ...spaces.hits.map((hit) => ({
            x: hit.x,
            end: hit.end,
            y: start + hit.line,
            target: { kind: 'space' as const, id: hit.id },
          }))
        );
      }
      lines.push({
        text: `${this.searching ? '>' : ' '} / ${this.query}${this.searching ? '_' : ''}  ${this.direct ? '' : `sort:${this.store.viewOptions.sortMode}  ${this.store.viewOptions.showHidden ? 'hidden:on' : ''}`}`,
        style: 'dim',
      });
      this.hits.push({ x: 1, end: width, y: lines.length, target: { kind: 'key', id: '/' } });
      const rowStart = lines.length + 1;
      capacity = Math.max(1, height - lines.length - 7);
      this.bodyCapacity = capacity;
      const rows = this.rows(),
        index = rows.findIndex((r) => r.id === this.selectedId);
      this.offset = Math.max(0, Math.min(this.offset, Math.max(0, rows.length - capacity)));
      if (index >= 0 && index < this.offset) this.offset = index;
      if (index >= this.offset + capacity) this.offset = index - capacity + 1;
      lines.push(
        ...rows.slice(this.offset, this.offset + capacity).map((row, i) => {
          this.hits.push({ x: 1, end: width, y: rowStart + i, target: { kind: 'row', id: row.id } });
          const selected = row.id === this.selectedId;
          let state = '';
          if (row.type === 'session') {
            const daemon = this.store.daemons.find((d) => d.name === row.zmxName);
            state = this.direct
              ? `${daemon?.error ?? `${daemon?.clients ?? 0} clients`}`
              : !this.store.online
                ? this.store.zmxError
                  ? 'availability unknown'
                  : daemon && !daemon.error
                    ? 'live zmx'
                    : 'no daemon'
                : row.session?.isSleeping
                  ? 'sleep'
                  : (row.session?.activity ?? '');
          }
          const marker =
            row.type === 'session' ? '' : row.type === 'more' ? '' : row.collapsed ? '[+] ' : '[-] ';
          return {
            text: `${selected ? '>' : ' '} ${'  '.repeat(row.depth)}${marker}${row.label}${row.count !== undefined ? ` (${row.count})` : ''}${state ? '  · ' + state : ''}`,
            style: selected ? ('selected' as const) : row.type === 'section' ? ('dim' as const) : undefined,
          };
        })
      );
      if (!rows.length)
        lines.push({
          text:
            this.store.zmxError && this.direct
              ? 'Discovery failed. See status below.'
              : this.query
                ? 'No matches.'
                : this.direct
                  ? 'No zmx sessions in this namespace.'
                  : 'No sessions in this space.',
          style: 'yellow',
        });
    }
    while (lines.length < height - 6) lines.push({ text: '' });
    const selected = this.selection();
    lines.push({ text: selected?.zmxName ? `daemon ${selected.zmxName}` : '', style: 'dim' });
    const error =
      this.store.zmxError ||
      this.store.cacheError ||
      (!this.store.online && !this.store.config.offline ? this.store.serverError : '');
    lines.push({ text: error, style: 'yellow' });
    lines.push({ text: this.busy ? 'Working...' : this.message, style: 'dim' });
    const buttons = (items: [string, string][]) => {
      let text = '';
      for (const [label, key] of items) {
        const x = textWidth(text) + 1;
        const button = `[${this.floating && label === 'Quit' ? 'Hide F8' : label}]`;
        this.hits.push({
          x,
          end: x + textWidth(button) - 1,
          y: lines.length + 1,
          target: { kind: 'key', id: key },
        });
        text += button + ' ';
      }
      lines.push({ text, style: 'cyan' });
    };
    if (this.menu)
      buttons([
        ['Confirm', 'return'],
        ['Back', 'escape'],
        ['Quit', 'quit'],
      ]);
    else if (this.searching)
      buttons([
        ['Done', 'return'],
        ['Clear', 'escape'],
        ['Quit', 'quit'],
      ]);
    else if (this.help)
      buttons([
        ['Up', 'pageup'],
        ['Down', 'pagedown'],
        ['Back', 'escape'],
        ['Quit', 'quit'],
      ]);
    else {
      buttons([
        ['Open', 'return'],
        ['New', 'n'],
        ['Spaces', 'w'],
        ['Zmx', 'z'],
        ['Find', '/'],
        ['Help', '?'],
        ['Quit', 'q'],
      ]);
      buttons([
        ['Split', 's'],
        ['Tab', 't'],
        ['Sort', 'o'],
        ['Hidden', 'H'],
        ['Sync', 'g'],
        ['Refresh', 'r'],
      ]);
    }
    paint(lines);
  };
  onMouse(event: MouseInput) {
    if (this.suspended || this.closed || this.busy) {
      this.pressed = undefined;
      return;
    }
    if (
      event.x < 1 ||
      event.x >= (process.stdout.columns ?? 80) ||
      event.y < 1 ||
      event.y > (process.stdout.rows ?? 24)
    )
      return;
    if (event.button & 64) {
      this.pressed = undefined;
      if (!event.release && (event.button & 3) < 2) this.scroll(event.button & 1 ? 3 : -3);
      return;
    }
    if (event.button & (32 | 128)) return;
    const hit = this.hits.find((h) => h.y === event.y && event.x >= h.x && event.x <= h.end)?.target;
    if (!event.release) {
      this.pressed = (event.button & 3) === 0 ? hit : undefined;
      if (this.pressed?.kind === 'row') {
        this.selectedId = this.pressed.id;
        this.draw();
      }
      return;
    }
    const pressed = this.pressed;
    this.pressed = undefined;
    if (!hit || !pressed || hit.kind !== pressed.kind || hit.id !== pressed.id) return;
    if (hit.kind === 'space') {
      this.searching = false;
      this.chooseSpace(hit.id);
    } else if (hit.kind === 'row') {
      this.searching = false;
      this.selectedId = hit.id;
      void this.action(() => this.activate());
    } else if (hit.kind === 'menu' && this.menu) {
      const menu = this.menu;
      const index = menu.items.findIndex(
        (item) => `${menu.kind}:${menu.projectId ?? ''}:${item.id}` === hit.id
      );
      if (index >= 0) {
        menu.index = index;
        void this.action(() => this.confirmMenu());
      }
    } else if (hit.kind === 'key') {
      if (hit.id === 'quit') void this.action(() => this.hide());
      else if (hit.id === '/') this.searching = true;
      else this.onKey(hit.id.length === 1 ? hit.id : '', { name: hit.id });
    }
    this.draw();
  }
  scroll(amount: number) {
    if (this.help) this.helpOffset += amount;
    else if (this.menu)
      this.menu.index = Math.max(0, Math.min(this.menu.items.length - 1, this.menu.index + amount));
    else {
      const rows = this.rows();
      const capacity = this.bodyCapacity;
      this.offset = Math.max(0, Math.min(Math.max(0, rows.length - capacity), this.offset + amount));
      const index = rows.findIndex((row) => row.id === this.selectedId);
      this.selectedId = rows[Math.max(this.offset, Math.min(this.offset + capacity - 1, index))]?.id ?? '';
    }
    this.draw();
  }
  onKey = (text: string, key: Key) => {
    if (this.suspended || this.closed) return;
    if (key.ctrl && key.name === 'c') {
      this.close();
      return;
    }
    if (this.busy) return;
    if (this.floating && (key.name === 'f8' || key.name === 'escape')) {
      void this.action(() => this.hide());
      return;
    }
    if (this.help) {
      if (key.name === 'up' || text === 'k') this.helpOffset--;
      else if (key.name === 'down' || text === 'j') this.helpOffset++;
      else if (key.name === 'pageup') this.helpOffset -= 10;
      else if (key.name === 'pagedown') this.helpOffset += 10;
      else if (key.name === 'escape' || text === '?') this.help = false;
      else if (text === 'q') void this.action(() => this.hide());
      this.draw();
      return;
    }
    if (this.searching) {
      if (key.name === 'escape') {
        this.searching = false;
        this.query = '';
      } else if (key.name === 'return') this.searching = false;
      else if (key.name === 'backspace') this.query = Array.from(this.query).slice(0, -1).join('');
      else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/u.test(text)) this.query += text;
      this.draw();
      return;
    }
    if (this.menu) {
      if (key.name === 'escape') this.menu = undefined;
      else if (key.name === 'up' || text === 'k') this.menu.index = Math.max(0, this.menu.index - 1);
      else if (key.name === 'down' || text === 'j')
        this.menu.index = Math.min(this.menu.items.length - 1, this.menu.index + 1);
      else if (key.name === 'return') void this.action(() => this.confirmMenu());
      this.draw();
      return;
    }
    const rows = this.rows(),
      index = rows.findIndex((r) => r.id === this.selectedId);
    const move = (n: number) => {
      this.selectedId = rows[Math.max(0, Math.min(rows.length - 1, index + n))]?.id ?? '';
    };
    if (key.name === 'down' || text === 'j') move(1);
    else if (key.name === 'up' || text === 'k') move(-1);
    else if (key.name === 'pagedown') move(this.bodyCapacity);
    else if (key.name === 'pageup') move(-this.bodyCapacity);
    else if (key.name === 'home') this.selectedId = rows[0]?.id ?? '';
    else if (key.name === 'end') this.selectedId = rows.at(-1)?.id ?? '';
    else if (key.name === 'return') void this.action(() => this.activate());
    else if (key.name === 'left' || key.name === 'right') this.toggle(key.name === 'left');
    else if (text === '/') this.searching = true;
    else if (key.name === 'escape') {
      this.help = false;
      this.query = '';
    } else if (text === 'q') void this.action(() => this.hide());
    else if (text === '?') this.help = !this.help;
    else if (text === 'z') {
      this.direct = !this.direct;
      this.query = '';
      this.offset = 0;
    } else if (text === 'r') void this.store.refresh();
    else if (text === 'g') void this.action(() => this.store.syncPreferences());
    else if (text === 'H') {
      this.store.viewOptions.showHidden = !this.store.viewOptions.showHidden;
      this.store.project();
    } else if (text === 'o') {
      this.store.viewOptions.sortMode =
        this.store.viewOptions.sortMode === 'manual' ? 'lastActivity' : 'manual';
      this.store.project();
    } else if (text === 'n') void this.action(() => this.newSession());
    else if (text === 's' || text === 't')
      void this.action(() => this.activate(text === 's' ? 'split' : 'tab'));
    else if (text === 'w')
      this.menu = {
        kind: 'spaces',
        items: this.store.view?.spaces.map((s) => ({ id: s.id, label: s.name })) ?? [],
        index: 0,
      };
    else if (text === '[' || text === ']') {
      const spaces = this.store.view?.spaces ?? [],
        i = spaces.findIndex((s) => s.id === this.store.view?.spaceId);
      this.chooseSpace(spaces[(i + (text === ']' ? 1 : -1) + spaces.length) % spaces.length]?.id);
    } else if (/^[1-9]$/.test(text ?? '')) this.chooseSpace(this.store.view?.spaces[Number(text) - 1]?.id);
    this.draw();
  };
  chooseSpace(id?: string) {
    if (!id) return;
    this.direct = false;
    this.query = '';
    this.store.viewOptions.spaceId = id;
    this.offset = 0;
    this.store.project();
  }
  toggle(force?: boolean) {
    const row = this.selection(),
      prefs = this.store.prefs;
    if (!row || !prefs) return;
    const value = force ?? !row.collapsed;
    const set = (map: Record<string, true>, key: string) => {
      if (value) map[key] = true;
      else delete map[key];
    };
    if (row.type === 'project') set(prefs.collapse.collapsedGroupsById, row.id);
    if (row.type === 'collection') set(prefs.collapse.collapsedProjectCollectionsByKey, row.id);
    if (row.type === 'section' && row.storageId && row.section) {
      const states = prefs.collapse.collapsedProjectSessionSectionsById;
      states[row.storageId] = {
        ...(states[row.storageId] ?? DEFAULT_PROJECT_SESSION_SECTION_COLLAPSE_STATE),
        [row.section]: value,
      };
    }
    if (row.type === 'more' && row.storageId) {
      const expanded = prefs.collapse.expandedProjectSessionListsById;
      if (expanded[row.storageId]) delete expanded[row.storageId];
      else expanded[row.storageId] = true;
    }
    this.store.project();
  }
  async action(run: () => Promise<void>) {
    this.busy = true;
    this.draw();
    try {
      await run();
    } catch (error) {
      this.message = clean(error instanceof Error ? error.message : error);
    } finally {
      this.busy = false;
      this.draw();
    }
  }
  async activate(destination?: 'split' | 'tab') {
    const row = this.selection();
    if (!row) return;
    if (row.type !== 'session') {
      this.toggle();
      return;
    }
    if (row.session?.kind === 'browser' || row.session?.sessionKind === 'browser')
      throw new Error('Browser rows do not have a zmx terminal.');
    if (!row.zmxName) throw new Error('This row has no terminal daemon identity.');
    const live = this.store.daemons.find((d) => d.name === row.zmxName && !d.error);
    if (!live && !this.direct) {
      if (!this.store.online)
        throw new Error('No running daemon. gxserver must reconnect to wake this session.');
      if (!row.projectId || !row.sessionId) throw new Error('Missing managed session identity.');
      await this.store.gx.wake(row.projectId, row.sessionId);
    }
    const info = await this.store.zmx.requireExisting(row.zmxName);
    if (destination || herdrPaneId()) {
      if (!process.env.HERDR_SOCKET_PATH)
        throw new Error('Splits and tabs require Herdr. Enter attaches in this terminal.');
      await openHerdrSession(row.zmxName, info, this.store.config, destination ?? 'split', row.label);
      this.message = 'Opened in Herdr.';
      if (this.floating) {
        await this.hide();
        return;
      }
    } else {
      this.leave();
      try {
        await attach(this.store.zmx, row.zmxName);
        this.message = 'Detached. The daemon keeps running.';
      } finally {
        if (!this.closed) this.enter();
      }
    }
    await this.store.refresh();
  }
  async newSession() {
    if (!this.store.online) throw new Error('Creating sessions requires gxserver.');
    const projectId = this.selection()?.projectId;
    if (projectId) await this.chooseAgent(projectId);
    else
      this.menu = {
        kind: 'projects',
        items: this.store.view?.projects.map((p) => ({ id: p.id, label: p.title })) ?? [],
        index: 0,
      };
  }
  async chooseAgent(projectId: string) {
    const hud = await this.store.gx.agents(projectId);
    this.menu = {
      kind: 'agents',
      projectId,
      index: 0,
      items: [
        ...hud.agents
          .filter((a) => a.command)
          .map((a) => ({ id: a.agentId, label: a.name, agentId: a.agentId })),
        { id: 'shell', label: 'Shell' },
      ],
    };
  }
  async confirmMenu() {
    const menu = this.menu,
      item = menu?.items[menu.index];
    if (!menu || !item) return;
    if (menu.kind === 'spaces') {
      this.menu = undefined;
      this.chooseSpace(item.id);
      return;
    }
    if (menu.kind === 'projects') {
      await this.chooseAgent(item.id);
      return;
    }
    this.menu = undefined;
    const created = await this.store.gx.create(menu.projectId!, item.agentId);
    this.message = `Created ${created.sessionId}. Starting terminal...`;
    await this.store.gx.wake(created.projectId, created.sessionId);
    const info = await this.store.zmx.requireExisting(created.zmxName);
    if (herdrPaneId()) {
      await this.store.refresh();
      const title =
        this.store.catalog?.snapshot.sessions.find(
          (s) => s.projectId === created.projectId && s.sessionId === created.sessionId
        )?.title || item.label;
      await openHerdrSession(created.zmxName, info, this.store.config, 'split', title);
      if (this.floating) {
        await this.hide();
        return;
      }
    } else {
      this.leave();
      try {
        await attach(this.store.zmx, created.zmxName);
      } finally {
        if (!this.closed) this.enter();
      }
    }
    await this.store.refresh();
  }
}
