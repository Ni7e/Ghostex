import {
  IconBolt,
  IconBoltFilled,
  IconBrain,
  IconChartBar,
  IconCheck,
  IconInfoCircle,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconSwitchHorizontal,
  IconUser,
} from '@tabler/icons-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/packages/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/packages/components/ui/popover';
import { cn } from '@/packages/components/utils';
import { modelMenuProjection, type ModelMenuContext } from '@/packages/shared/session-chat-controller/model-menu';
import {
  modelFavorites,
  subscribeModelFavorites,
  toggleModelFavorite,
} from '@/packages/shared/session-chat-controller/model-favorites';
import {
  MODEL_MENU_FAVORITES_TAB,
  MODEL_MENU_KEY_HINTS,
  modelMenuNextTab,
  modelMenuReasoningFor,
  modelMenuStepEffort,
  type ModelMenuRow,
  type ModelMenuTabId,
  type ModelMenuTrait,
  type ModelMenuTraitChoice,
} from '@/packages/shared/session-chat-presentation/model-menu';
import type { ModelPickerProvider } from '@/packages/shared/session-chat-presentation/model-picker';
import { isSidebarAgentIcon } from '@/packages/shared/sidebar-agents';
import { getBrandAgentLogoStyle } from '../agent-logos';
import { useSidebarStore } from '../sidebar-store';
import {
  getghostexHotkeyActionIdForKey,
  ghostexHotkeyTextFromKeyboardEvent,
  normalizeghostexHotkeySettings,
} from '@/packages/shared/ghostex-hotkeys';
import { AppTooltip } from '../app-tooltip';
import './session-chat-model-menu.css';

/**
 * CDXC:SessionChat 2026-09-21 DECISION:
 * User: the composer's model and effort pills become one pill that opens one picker; a click on a model or a footer choice saves the agent's default, a right-click applies it to this session only, and there is no Also set as default switch. Reasoning, Context Window and Fast Mode are three buttons along the bottom, an icon beside each value; a button with at most two values toggles on click, a longer one opens a side list.
 * Everything drawn here comes from packages/shared/session-chat-presentation/model-menu.ts, which the GPUI picker draws too; this file owns only the tab, the search text, the keyboard cursor and the open side list.
 * SEE-ALSO: apps/desktop/src/app/native_chat/model_menu/ (the GPUI twin), packages/shared/session-chat-controller/model-menu.ts.
 */

/** A footer button the host adds after the shared ones, such as a draft's agent CLI switcher. */
export interface SessionChatModelMenuExtraRow extends ModelMenuTrait {
  onChoose: (choice: ModelMenuTraitChoice) => void;
}

export interface SessionChatModelMenuProps {
  context: ModelMenuContext;
  /** Agents whose models this session can reach: its own always, another's through Handoff or a draft switch. */
  canOfferProvider: (provider: ModelPickerProvider) => boolean;
  /** `effort` is set when the pick carries a reasoning level from the keyboard or the highlighted model's Reasoning list. */
  onPickRow: (row: ModelMenuRow, secondary: boolean, effort?: string) => void;
  onPickTrait: (trait: ModelMenuTrait, choice: ModelMenuTraitChoice, secondary: boolean) => void;
  extraRows?: readonly SessionChatModelMenuExtraRow[];
  /** Escape hands the keyboard back to the composer rather than to the pill. */
  onReturnFocus?: () => void;
  pill: {
    ariaLabel: string;
    disabled: boolean;
    icon?: ReactNode;
    loadingText?: string;
    /** Appended after the shared "High · 1M" values, for a value only this host detects. */
    suffixExtra?: string;
    tooltip: string;
    trailingIcon?: ReactNode;
  };
  /** Stories pin the opening state; the app leaves these unset. */
  defaultOpen?: boolean;
  initialTab?: ModelMenuTabId;
  initialFlyout?: number;
  popupClassName?: string;
}

/**
 * CDXC:SessionChat 2026-09-24 DECISION:
 * User: on the phone the effort picker must appear on screen instead of going off it. The side list opens to the right, else to the left, and when the card fills the screen width it opens above the button row inside the card.
 */
type FlyoutSide = 'right' | 'left' | 'above';

/** Host rows follow the shared buttons' rule: at most two values toggle, more open the side list. */
function toggleTarget(tray: ModelMenuTrait): ModelMenuTrait['toggle'] {
  if (tray.toggle) return tray.toggle;
  if (!('onChoose' in tray) || tray.choices.length > 2) return undefined;
  const next = tray.choices.find((choice) => !choice.selected);
  return next ? { value: next.value } : undefined;
}

function TraitIcon({ icon, on }: { icon: NonNullable<ModelMenuTrait['icon']>; on: boolean }) {
  if (icon === 'reasoning') return <IconBrain aria-hidden='true' size={14} stroke={1.8} />;
  if (icon === 'context') return <IconChartBar aria-hidden='true' size={14} stroke={1.8} />;
  if (icon === 'account') return <IconUser aria-hidden='true' size={14} stroke={1.8} />;
  return on ? <IconBoltFilled aria-hidden='true' size={14} /> : <IconBolt aria-hidden='true' size={14} stroke={1.8} />;
}

function AgentLogo({ icon, size }: { icon: string; size: number }) {
  if (!isSidebarAgentIcon(icon)) return null;
  return (
    <span
      aria-hidden='true'
      className='ghostex-chat-model-menu-logo'
      style={{ ...getBrandAgentLogoStyle(icon), '--logo-size': `${size}px` } as CSSProperties}
    />
  );
}

export function SessionChatModelMenu({
  canOfferProvider,
  context,
  defaultOpen = false,
  extraRows = [],
  initialFlyout,
  initialTab,
  onPickRow,
  onPickTrait,
  onReturnFocus,
  pill,
  popupClassName,
}: SessionChatModelMenuProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [view, setView] = useState<{ tab: ModelMenuTabId | null; query: string }>({
    tab: initialTab ?? null,
    query: '',
  });
  const [active, setActive] = useState(0);
  const [flyout, setFlyout] = useState<{ index: number; active: number; side: FlyoutSide } | null>(
    initialFlyout === undefined ? null : { index: initialFlyout, active: 0, side: 'right' }
  );
  const favorites = useSyncExternalStore(subscribeModelFavorites, modelFavorites, modelFavorites);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const returnFocus = useRef(false);
  /** Reasoning levels Left and Right have moved to this visit, by row key; a pick of that row carries its level. */
  const [efforts, setEfforts] = useState<Record<string, string>>({});
  /** Bumped when Left or Right can go no further, which replays the Reasoning button's shake. */
  const [shake, setShake] = useState(0);
  /** The model row the cursor last rested on, which the Reasoning button follows while the cursor is on the footer. */
  const lastRow = useRef<string | null>(null);
  const hotkeys = useSidebarStore((store) => store.hud.settings?.hotkeys);

  const projection = useMemo(
    () => modelMenuProjection(context, view),
    // `favorites` is read inside the projection; naming it here re-ranks the rows when a star changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [context, view, favorites]
  );
  const tabs = projection.tabs.filter((tab) => tab.id === MODEL_MENU_FAVORITES_TAB || canOfferProvider(tab.id));
  const rows = projection.rows.filter((row) => canOfferProvider(row.provider));
  const effortFor = (row: ModelMenuRow) => efforts[row.key] ?? row.effort ?? '';
  const browsedRow =
    active < rows.length
      ? rows[active]
      : (rows.find((row) => row.key === lastRow.current) ?? rows.find((row) => row.selected));
  // A host row carrying a footer icon stands in for the shared button of that kind (Cursor's detected context window).
  const trays: readonly (ModelMenuTrait | SessionChatModelMenuExtraRow)[] = [
    ...projection.traits
      .map((trait) => modelMenuReasoningFor(trait, browsedRow, browsedRow ? effortFor(browsedRow) : undefined))
      .map((trait) => extraRows.find((row) => row.icon && row.icon === trait.icon) ?? trait),
    ...extraRows.filter((row) => !row.icon || !projection.traits.some((trait) => trait.icon === row.icon)),
  ];
  const count = rows.length + trays.length;
  const selectedIndex = rows.findIndex((row) => row.selected);

  useLayoutEffect(() => {
    if (open) setActive(Math.max(selectedIndex, 0));
    // A star reorders the list, so the cursor goes home to the selected row rather than to a stale index.
  }, [open, view.tab, view.query, selectedIndex, favorites]);
  useEffect(() => {
    if (!open || active >= rows.length) return;
    lastRow.current = rows[active]?.key ?? null;
    listRef.current?.querySelector(`[data-row-index='${active}']`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, rows]);

  /**
   * CDXC:SessionChat 2026-09-24 DECISION:
   * User: "take away the quick picker" and "make it controllable with the keyboard from Option P. I don't want to
   * have two interfaces for picking the model." The model picker hotkey opens this pop-up on the focused chat pane,
   * and pressing it again closes it without saving; it replaces the full-screen picker.
   */
  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      const chord = ghostexHotkeyTextFromKeyboardEvent(event);
      if (
        !chord ||
        getghostexHotkeyActionIdForKey(normalizeghostexHotkeySettings(hotkeys), chord) !== 'openModelPicker'
      )
        return;
      if (!open) {
        if (pill.disabled) return;
        const pane = pillRef.current?.closest<HTMLElement>('.ghostex-session-chat-scope');
        if (!pane?.getClientRects().length || pane.closest('[aria-hidden="true"]')) return;
        const focusedPane = document.querySelector('.workspace-pane--focused');
        if (focusedPane && !focusedPane.contains(pane)) return;
        const inputPane = document.activeElement?.closest('.ghostex-session-chat-scope');
        if (!focusedPane && inputPane && inputPane !== pane) return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (open) {
        returnFocus.current = true;
        setOpen(false);
        return;
      }
      setView({ tab: null, query: '' });
      setFlyout(null);
      setEfforts({});
      setOpen(true);
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [hotkeys, open, pill.disabled]);

  // 232px card, 10px gap and a margin off the window edge.
  const flyoutSide = (bounds: DOMRect | undefined): FlyoutSide => {
    if (bounds === undefined || bounds.right + 250 <= window.innerWidth) return 'right';
    return bounds.left - 250 >= 0 ? 'left' : 'above';
  };
  const flyoutIndex = flyout?.index;
  // A side list pinned open from the start is measured once the card has been placed.
  useEffect(() => {
    if (flyoutIndex === undefined) return;
    const frame = window.requestAnimationFrame(() => {
      const side = flyoutSide(trayRef.current?.getBoundingClientRect());
      setFlyout((current) => (current && current.side !== side ? { ...current, side } : current));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [flyoutIndex, open]);

  const openFlyout = (index: number) => {
    const tray = trays[index];
    if (!tray || tray.disabled || projection.disabled) return;
    const bounds = trayRef.current?.getBoundingClientRect();
    setFlyout({
      index,
      active: Math.max(
        tray.choices.findIndex((choice) => choice.selected),
        0
      ),
      side: flyoutSide(bounds),
    });
    setActive(rows.length + index);
  };

  const pickRow = (row: ModelMenuRow | undefined, secondary: boolean, effort?: string) => {
    if (!row || projection.disabled) return;
    onPickRow(row, secondary, effort);
  };
  /** The keyboard's pick: the row with the reasoning level Left and Right left it on. */
  const pickWithEffort = (row: ModelMenuRow | undefined, secondary: boolean) => {
    if (!row) return;
    pickRow(row, secondary, row.efforts?.length ? effortFor(row) : undefined);
  };
  /** A two-value button applies its other value in place; a longer one opens its side list. */
  const activateTray = (index: number, secondary: boolean) => {
    const tray = trays[index];
    if (!tray || tray.disabled || projection.disabled) return;
    const target = toggleTarget(tray);
    if (!target) {
      if (flyout?.index === index) setFlyout(null);
      else openFlyout(index);
      return;
    }
    const choice = tray.choices.find((entry) => entry.value === target.value);
    pickChoice(index, choice ? { ...choice, exitPlan: target.exitPlan ?? choice.exitPlan } : undefined, secondary);
  };
  const pickChoice = (index: number, choice: ModelMenuTraitChoice | undefined, secondary: boolean) => {
    const tray = trays[index];
    if (!tray || !choice) return;
    // The Reasoning list follows the highlighted model; for any model but the one in use it only sets the level its pick will carry.
    if (tray.id === 'effort' && browsedRow) {
      setEfforts((current) => ({ ...current, [browsedRow.key]: choice.value }));
      if (!browsedRow.selected) {
        setFlyout(null);
        searchRef.current?.focus();
        return;
      }
    }
    if ('onChoose' in tray) tray.onChoose(choice);
    else onPickTrait(tray, choice, secondary);
    setFlyout(null);
    searchRef.current?.focus();
  };

  const step = (from: number, delta: number, size: number) => (size === 0 ? 0 : (from + delta + size) % size);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    const down = key === 'ArrowDown' || (event.ctrlKey && key === 'n');
    const up = key === 'ArrowUp' || (event.ctrlKey && key === 'p');
    if (flyout) {
      const choices = trays[flyout.index]?.choices ?? [];
      if (key === 'Escape' || key === 'ArrowLeft') setFlyout(null);
      else if (down || up) setFlyout({ ...flyout, active: step(flyout.active, down ? 1 : -1, choices.length) });
      else if (key === 'Enter') pickChoice(flyout.index, choices[flyout.active], event.shiftKey);
      else return;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.metaKey && /^[1-9]$/.test(key)) {
      // Only moves the highlight; Enter applies it.
      if (Number(key) <= rows.length) setActive(Number(key) - 1);
    } else if (key === 'Tab') {
      const next = modelMenuNextTab(tabs, event.shiftKey ? -1 : 1);
      if (next) setView((current) => ({ ...current, tab: next }));
    } else if ((key === 'ArrowRight' || key === 'ArrowLeft') && active < rows.length) {
      const row = rows[active];
      const next = row
        ? modelMenuStepEffort({ efforts: row.efforts ?? [] }, effortFor(row), key === 'ArrowRight' ? 1 : -1)
        : null;
      if (row && next !== null) setEfforts((current) => ({ ...current, [row.key]: next }));
      else setShake((count) => count + 1);
    } else if (down || up) {
      // The buttons are one row: Down from the last model lands on the first, and Up leaves them for the list.
      setActive((current) => {
        if (current >= rows.length) return down ? 0 : Math.max(rows.length - 1, 0);
        if (down && current === rows.length - 1 && trays.length > 0) return rows.length;
        if (up && current === 0 && trays.length > 0) return rows.length;
        return step(current, down ? 1 : -1, rows.length);
      });
    } else if ((key === 'ArrowRight' || key === 'ArrowLeft') && active >= rows.length) {
      setActive(rows.length + step(active - rows.length, key === 'ArrowRight' ? 1 : -1, trays.length));
    } else if (key === 'Enter') {
      // Enter uses the highlighted model and level in this session; Shift+Enter saves them as the agent's default.
      if (active >= rows.length) activateTray(active - rows.length, event.shiftKey);
      else pickWithEffort(rows[active], !event.shiftKey);
    } else if (key === 'Escape') {
      returnFocus.current = true;
      setOpen(false);
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const secondaryClick = (event: MouseEvent, run: () => void) => {
    event.preventDefault();
    run();
  };

  const suffix = [projection.pill.suffix, pill.suffixExtra].filter(Boolean).join(' · ');
  const loading = !projection.pill.label;
  const trigger = (
    <PopoverTrigger
      render={
        <Button
          aria-label={loading ? (pill.loadingText ?? pill.ariaLabel) : pill.ariaLabel}
          className='ghostex-chat-footer-control ghostex-chat-model-pill ghostex-chat-model-menu-pill rounded-full text-muted-foreground'
          disabled={pill.disabled}
          size='xs'
          variant='ghost'
        />
      }
    >
      {pill.icon}
      {loading ? (
        <span aria-hidden='true' className='ghostex-chat-pill-skeleton' data-pill='combined' />
      ) : (
        <>
          <span className='truncate'>{projection.pill.label}</span>
          {suffix ? <span className='ghostex-chat-model-menu-pill-suffix truncate'>{suffix}</span> : null}
          {pill.trailingIcon}
        </>
      )}
    </PopoverTrigger>
  );

  return (
    <Popover
      onOpenChange={(next) => {
        // Opening starts from the session's own tab and an empty search, never where the last visit ended.
        if (next) {
          setView({ tab: null, query: '' });
          setFlyout(null);
          setEfforts({});
        }
        setOpen(next);
      }}
      onOpenChangeComplete={(next) => {
        if (next || !returnFocus.current) return;
        returnFocus.current = false;
        window.requestAnimationFrame(() => onReturnFocus?.());
      }}
      open={open}
    >
      {/* The wrapper keeps the tooltip hoverable while the pill is disabled, and keeps the tree shape stable. */}
      <AppTooltip content={loading ? (pill.loadingText ?? pill.tooltip) : pill.tooltip}>
        <span className='inline-flex min-w-0' ref={pillRef}>
          {trigger}
        </span>
      </AppTooltip>
      <PopoverContent
        align='end'
        aria-label='Model picker'
        className={cn('ghostex-session-chat-popup ghostex-chat-model-menu', popupClassName)}
        initialFocus={searchRef}
        onKeyDown={onKeyDown}
        onMouseDown={(event) => {
          if (flyout && !(event.target as HTMLElement).closest('.ghostex-chat-model-menu-flyout')) setFlyout(null);
        }}
        side='top'
        sideOffset={6}
      >
        <div className='ghostex-chat-model-menu-tabs' role='tablist'>
          {tabs.map((tab) => (
            <button
              aria-label={tab.name}
              aria-selected={tab.active}
              className='ghostex-chat-model-menu-tab'
              data-chat-picker-option=''
              data-active={tab.active ? '' : undefined}
              key={tab.id}
              onClick={() => {
                setView((current) => ({ ...current, tab: tab.id }));
                searchRef.current?.focus();
              }}
              role='tab'
              tabIndex={-1}
              title={tab.handoff ? `${tab.name}: picking a model hands off to ${tab.name}` : tab.name}
              type='button'
            >
              {tab.icon ? <AgentLogo icon={tab.icon} size={16} /> : <IconStarFilled aria-hidden='true' size={15} />}
              {tab.handoff ? (
                <span className='ghostex-chat-model-menu-tab-handoff'>
                  <IconSwitchHorizontal aria-hidden='true' size={9} stroke={2.4} />
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <label className='ghostex-chat-model-menu-search'>
          <IconSearch aria-hidden='true' size={14} stroke={2} />
          <input
            aria-label={projection.placeholder}
            autoComplete='off'
            onChange={(event) => setView((current) => ({ ...current, query: event.target.value }))}
            placeholder={projection.placeholder}
            ref={searchRef}
            spellCheck={false}
            type='text'
            value={view.query}
          />
        </label>
        <div className='ghostex-chat-model-menu-list' ref={listRef} role='listbox'>
          {projection.error ? (
            <div className='ghostex-chat-model-menu-error'>
              <span>Not applied</span>
              <span>{projection.error}</span>
            </div>
          ) : null}
          {rows.length === 0 ? (
            <div className='ghostex-chat-model-menu-empty'>{projection.emptyText ?? 'No models'}</div>
          ) : null}
          {rows.map((row, index) => (
            <div
              aria-disabled={projection.disabled || undefined}
              aria-selected={row.selected}
              className='ghostex-chat-model-menu-row'
              data-active={index === active ? '' : undefined}
              data-row-index={index}
              data-selected={row.selected ? '' : undefined}
              key={row.key}
              onClick={() => pickRow(row, false, efforts[row.key])}
              onContextMenu={(event) => secondaryClick(event, () => pickRow(row, true, efforts[row.key]))}
              onMouseMove={() => setActive(index)}
              role='option'
              title={projection.scopeHint}
            >
              <span className='ghostex-chat-model-menu-row-body'>
                {row.showAgent ? <AgentLogo icon={row.icon} size={14} /> : null}
                <span className='ghostex-chat-model-menu-row-label'>{row.label}</span>
                {row.handoff ? (
                  <AppTooltip content={`Hands off to ${row.agentName}`}>
                    <span aria-label={`Hands off to ${row.agentName}`} className='ghostex-chat-model-menu-row-handoff'>
                      <IconSwitchHorizontal aria-hidden='true' size={13} stroke={1.8} />
                    </span>
                  </AppTooltip>
                ) : null}
              </span>
              {row.description ? (
                <AppTooltip content={row.description}>
                  <span
                    aria-label={`About ${row.label}`}
                    className='ghostex-chat-model-menu-row-about'
                    onClick={(event) => event.stopPropagation()}
                    onContextMenu={(event) => event.stopPropagation()}
                  >
                    <IconInfoCircle aria-hidden='true' size={13} stroke={1.8} />
                  </span>
                </AppTooltip>
              ) : null}
              {row.shortcut !== undefined ? <kbd className='ghostex-chat-model-menu-kbd'>⌘{row.shortcut}</kbd> : null}
              <button
                aria-label={row.favorite ? `Remove ${row.label} from favorites` : `Add ${row.label} to favorites`}
                aria-pressed={row.favorite}
                className='ghostex-chat-model-menu-star'
                data-chat-picker-option=''
                data-favorite={row.favorite ? '' : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleModelFavorite(row.key);
                }}
                onContextMenu={(event) => event.stopPropagation()}
                tabIndex={-1}
                type='button'
              >
                {row.favorite ? (
                  <IconStarFilled aria-hidden='true' size={13} />
                ) : (
                  <IconStar aria-hidden='true' size={13} stroke={1.8} />
                )}
              </button>
            </div>
          ))}
        </div>
        {trays.length > 0 ? (
          <div className='ghostex-chat-model-menu-tray' ref={trayRef}>
            {trays.map((tray, index) => {
              const opened = flyout?.index === index;
              const disabled = projection.disabled || tray.disabled === true;
              const toggles = toggleTarget(tray) !== undefined;
              const on = tray.icon === 'fast' && tray.valueLabel === 'On';
              const scoped = !('onChoose' in tray);
              return (
                <div
                  aria-disabled={disabled || undefined}
                  data-shake={tray.id === 'effort' && shake > 0 ? '' : undefined}
                  aria-expanded={toggles ? undefined : opened}
                  aria-haspopup={toggles ? undefined : 'listbox'}
                  aria-label={`${tray.label}${tray.valueLabel ? `: ${tray.valueLabel}` : ''}`}
                  aria-pressed={tray.icon === 'fast' ? on : undefined}
                  className='ghostex-chat-model-menu-tray-button'
                  data-active={opened || active === rows.length + index ? '' : undefined}
                  data-icon={tray.icon}
                  data-on={on ? '' : undefined}
                  // A new key restarts the shake animation each time Left or Right hits an end.
                  key={tray.id === 'effort' ? `${tray.id}:${shake}` : tray.id}
                  onClick={() => activateTray(index, false)}
                  onContextMenu={(event) => secondaryClick(event, () => activateTray(index, true))}
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseMove={() => setActive(rows.length + index)}
                  role='button'
                  title={[
                    `${tray.label}${tray.valueLabel ? `: ${tray.valueLabel}` : ''}`,
                    scoped ? projection.scopeHint : null,
                  ]
                    .filter(Boolean)
                    .join('\n')}
                >
                  {tray.icon ? (
                    <TraitIcon icon={tray.icon} on={on} />
                  ) : (
                    <span className='ghostex-chat-model-menu-tray-label'>{tray.label}</span>
                  )}
                  <span className='ghostex-chat-model-menu-tray-value'>
                    {tray.icon === 'fast' ? 'Fast' : tray.valueLabel}
                  </span>
                </div>
              );
            })}
            {flyout && trays[flyout.index] ? (
              <div className='ghostex-chat-model-menu-flyout' data-side={flyout.side} role='listbox'>
                <div className='ghostex-chat-model-menu-flyout-heading'>{trays[flyout.index]!.label}</div>
                <div className='ghostex-chat-model-menu-flyout-choices'>
                  {trays[flyout.index]!.choices.map((choice, choiceIndex) => (
                    <div
                      aria-selected={choice.selected}
                      className='ghostex-chat-model-menu-flyout-row'
                      data-active={choiceIndex === flyout.active ? '' : undefined}
                      key={`${choice.value}:${choice.label}`}
                      onClick={() => pickChoice(flyout.index, choice, false)}
                      onContextMenu={(event) => secondaryClick(event, () => pickChoice(flyout.index, choice, true))}
                      onMouseDown={(event) => event.stopPropagation()}
                      onMouseMove={() => setFlyout({ ...flyout, active: choiceIndex })}
                      role='option'
                      title={'onChoose' in trays[flyout.index]! ? undefined : projection.scopeHint}
                    >
                      <span className='ghostex-chat-model-menu-flyout-label'>{choice.label}</span>
                      {choice.isDefault ? <span className='ghostex-chat-model-menu-default'>Default</span> : null}
                      {choice.selected ? <IconCheck aria-hidden='true' size={14} stroke={2} /> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div aria-hidden='true' className='ghostex-chat-model-menu-keys'>
          {MODEL_MENU_KEY_HINTS.map((hint) => (
            <span key={hint.label}>
              <kbd>{hint.keys}</kbd>
              {hint.label}
            </span>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
