import { useState } from 'react';
import type { PreferredAgentInterface } from '@/packages/shared/ghostex-settings';
import {
  defaultAgentId as resolveDefaultAgentId,
  finishOnboarding,
  installedAgents,
  type PanelProps,
} from '../onboarding-state';
import {
  APPEARANCE_CHOICES,
  ThemeCardGrid,
  darkThemeCards,
  isTransparencyEnabled,
  lightThemeCards,
  windowGlassAvailable,
  windowGlassForTransparency,
} from '../../settings-modal/theme-simple-controls';
import { Cta, Eyebrow, FootActions, Heading, Icon, Spinner, Sub, Toggle } from '../primitives';
import { box } from '../stage';

const SESSION_VIEWS: readonly (readonly [PreferredAgentInterface, string, string])[] = [
  ['chat', 'Chat', 'Cleaner agent conversation'],
  ['terminal', 'Terminal', 'Raw CLI interface'],
];
/** The project card and the look card sit side by side, centred on the full-width stage. */
const CARDS_LEFT = 156;
const CARDS_TOP = 310;
const CARDS_WIDTH = 1360;
/**
 * CDXC:Onboarding 2026-09-15 WHY:
 * The prototype laid the "Start with" tiles out at a fixed pitch of card width over tile count, which squeezed
 * fifteen installed agent CLIs into 36px tiles with every name overlapping. The card is flow layout now: up to
 * this many choices keep the name-and-detail tiles in one row, more become name-only chips that wrap, and the
 * card grows with them.
 */
const MAX_TILE_ROW = 4;

export function GetStartedPanel({ props, flow, setFlow }: PanelProps) {
  const { settings, agents, pickedProjectFolder, hasProjects } = props;
  const defaultAgent = resolveDefaultAgentId(settings, agents);
  const installed = installedAgents(agents);
  const ordered = defaultAgent
    ? [
        installed.find((agent) => agent.agentId === defaultAgent)!,
        ...installed.filter((agent) => agent.agentId !== defaultAgent),
      ]
    : installed;
  const tiles: readonly { id: string; name: string; detail: string }[] = [
    ...ordered.map((agent) => ({
      id: agent.agentId,
      name: agent.name,
      detail: agent.agentId === defaultAgent ? 'Default agent' : 'Switch anytime',
    })),
    { id: 'terminal', name: 'Terminal', detail: 'No agent yet' },
  ];
  const startWith = flow.startWith ?? defaultAgent ?? 'terminal';
  const sessionView = settings?.preferredAgentInterface ?? 'chat';
  const folder = pickedProjectFolder?.trim() ?? '';
  const canOpen = folder.length > 0 || hasProjects === true;
  /** "Open Ghostex" is a host round trip: busy until the project and session exist, error stays on the panel. */
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string>();

  const setSessionView = (view: PreferredAgentInterface) => {
    if (!settings) return;
    props.onChange({ ...settings, preferredAgentInterface: view });
  };
  const updateSettings = (patch: Partial<NonNullable<typeof settings>>) => {
    if (!settings) return;
    props.onChange({ ...settings, ...patch });
  };
  const openGhostex = () => {
    if (folder) {
      if (opening) return;
      setOpening(true);
      setOpenError(undefined);
      props.onFinishFirstLaunch({ agentId: startWith, path: folder }).then(
        () => setFlow({ finishedPath: folder, finished: true }),
        (error: unknown) => {
          setOpening(false);
          setOpenError(error instanceof Error && error.message ? error.message : 'Ghostex could not open the project.');
        }
      );
      return;
    }
    if (hasProjects) finishOnboarding(props, flow);
  };
  const advancedLater = () => {
    props.onOpenSettings?.();
    props.onClose();
  };

  return (
    <>
      <Eyebrow x={486} y={150} w={700}>
        Get started
      </Eyebrow>
      <Heading x={336} y={182} w={1000} size={48} center l1='Open your first project in Ghostex.' />
      <Sub x={336} y={252} w={1000} size={16.5} center>
        One folder, one agent, one default view and a look you like. Everything else can change later.
      </Sub>
      <div className='pcol' style={box(CARDS_LEFT, CARDS_TOP, CARDS_WIDTH)}>
        <div className='pcards'>
          <div className='glass pcard'>
            <div className='label'>Project folder</div>
            <div className='pfield'>
              <Icon n='folder' size={22} className='dimc2' />
              <span className={'path' + (folder ? '' : ' dim')}>{folder || 'Choose a folder to start in'}</span>
              <button type='button' className='choose' onClick={props.onPickProjectFolder}>
                Choose folder
              </button>
            </div>
            <div className='label'>Start with</div>
            {tiles.length <= MAX_TILE_ROW ? (
              <div className='opts' style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
                {tiles.map((tile) => (
                  <button
                    key={tile.id}
                    type='button'
                    className={'opt' + (startWith === tile.id ? ' sel' : '')}
                    onClick={() => setFlow({ startWith: tile.id })}
                  >
                    <span className='nm'>{tile.name}</span>
                    <span className='ss'>{tile.detail}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className='chips'>
                {tiles.map((tile) => (
                  <button
                    key={tile.id}
                    type='button'
                    className={'opt chip' + (startWith === tile.id ? ' sel' : '')}
                    title={tile.detail}
                    onClick={() => setFlow({ startWith: tile.id })}
                  >
                    {tile.name}
                  </button>
                ))}
              </div>
            )}
            <div className='label'>Default session view</div>
            <div className='opts' style={{ gridTemplateColumns: `repeat(${SESSION_VIEWS.length}, minmax(0, 1fr))` }}>
              {SESSION_VIEWS.map(([id, name, detail]) => (
                <button
                  key={id}
                  type='button'
                  className={'opt' + (sessionView === id ? ' sel' : '')}
                  onClick={() => setSessionView(id)}
                >
                  <span className='nm'>{name}</span>
                  <span className='ss'>{detail}</span>
                </button>
              ))}
            </div>
          </div>
          {settings ? <LookCard settings={settings} onUpdate={updateSettings} /> : null}
        </div>
        <p className='sub center pnote-flow'>
          {openError ? (
            <span style={{ color: '#ff6b62' }} role='alert'>
              {openError}
            </span>
          ) : opening ? (
            'Adding the project and opening its first session…'
          ) : canOpen ? (
            "That's it. The workspace teaches the deeper features once you are inside."
          ) : (
            'Choose a folder above to open your first project.'
          )}
        </p>
      </div>
      <FootActions panel={5}>
        <button type='button' className='ghost' onClick={advancedLater} disabled={opening}>
          Advanced settings later
        </button>
        <Cta filled onClick={openGhostex} disabled={!canOpen || opening} arrow={!opening}>
          {opening ? (
            <>
              <Spinner /> Opening…
            </>
          ) : (
            'Open Ghostex'
          )}
        </Cta>
      </FootActions>
    </>
  );
}

/**
 * CDXC:Onboarding 2026-09-23 DECISION:
 * User: "please add the transparency setting and theme (just the non advanced stuff) to the onboarding setup's last
 * page". The Get started panel carries the Theme page's simple choices in a card beside the project card: Appearance,
 * the dark and light theme cards and Enable Transparency, from the same shared controls as Settings -> Theme
 * (settings-modal/theme-simple-controls.tsx), applied live. Custom is left out here because tuning it needs the
 * Advanced colour rows; it stays on the Theme page.
 */
function LookCard({
  settings,
  onUpdate,
}: {
  settings: NonNullable<PanelProps['props']['settings']>;
  onUpdate: (patch: Partial<NonNullable<PanelProps['props']['settings']>>) => void;
}) {
  const transparencyOn = isTransparencyEnabled(settings.windowGlass);
  return (
    <div className='glass pcard plook'>
      <div className='label'>Appearance</div>
      <div className='opts' style={{ gridTemplateColumns: `repeat(${APPEARANCE_CHOICES.length}, minmax(0, 1fr))` }}>
        {APPEARANCE_CHOICES.map((choice) => (
          <button
            key={choice.value}
            type='button'
            className={'opt appearance' + (settings.sidebarTheme === choice.value ? ' sel' : '')}
            onClick={() => onUpdate({ sidebarTheme: choice.value })}
          >
            <span className='nm'>{choice.label}</span>
          </button>
        ))}
      </div>
      <div className='label'>Dark theme</div>
      <ThemeCardGrid
        cards={darkThemeCards(settings, { includeCustom: false })}
        label='Dark theme'
        onSelect={(darkThemePreset) => onUpdate({ darkThemePreset })}
        value={settings.darkThemePreset}
      />
      <div className='label'>Light theme</div>
      <ThemeCardGrid
        cards={lightThemeCards(settings, { includeCustom: false })}
        label='Light theme'
        onSelect={(lightThemePreset) => onUpdate({ lightThemePreset })}
        value={settings.lightThemePreset}
      />
      {windowGlassAvailable() ? (
        <div className='ptoggle'>
          <span className='ptoggle-copy'>
            <span className='nm'>Enable Transparency</span>
            <span className='ss'>Let your desktop show softly through the window in dark mode.</span>
          </span>
          <Toggle
            size='md'
            on={transparencyOn}
            onClick={() => onUpdate({ windowGlass: windowGlassForTransparency(settings.windowGlass, !transparencyOn) })}
            label='Enable Transparency'
          />
        </div>
      ) : null}
    </div>
  );
}
