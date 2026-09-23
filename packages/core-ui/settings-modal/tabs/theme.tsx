import { useId, useState, type ReactNode, type RefObject } from 'react';
import { IconChevronRight } from '@tabler/icons-react';
import { cn } from '@/packages/components/utils';
import { Button } from '@/packages/components/ui/button';
import { SegmentedControl, SegmentedControlItem } from '@/packages/components/ui/segmented-control';
import {
  MAX_CUSTOM_SIDEBAR_TITLEBAR_BACKGROUND_DARKNESS_PERCENT,
  THEME_CONTRAST_MAX_POINTS,
  THEME_CONTRAST_MIN_POINTS,
  MAX_CUSTOM_SIDEBAR_TITLEBAR_LIGHT_BACKGROUND_LIGHTNESS_PERCENT,
  MAX_WINDOW_GLASS_WORK_AREA_TINT_PERCENT,
  MAX_WINDOW_GLASS_SIDEBAR_OPACITY_PERCENT,
  MIN_CUSTOM_SIDEBAR_TITLEBAR_BACKGROUND_DARKNESS_PERCENT,
  MIN_CUSTOM_SIDEBAR_TITLEBAR_LIGHT_BACKGROUND_LIGHTNESS_PERCENT,
  MIN_WINDOW_GLASS_WORK_AREA_TINT_PERCENT,
  MIN_WINDOW_GLASS_SIDEBAR_OPACITY_PERCENT,
  SESSION_CHAT_THEME_OPTIONS,
  WINDOW_GLASS_OPTIONS,
  WINDOW_GLASS_SOURCE_OPTIONS,
  WINDOW_GLASS_IMAGE_PLACEMENT_OPTIONS,
  getGhosttyThemeSettingOptions,
  type DarkThemePreset,
  type LightThemePreset,
  type WindowGlassMode,
  type WindowGlassSource,
  type WindowGlassImagePlacement,
  type ghostexSettings,
} from '../../../shared/ghostex-settings';
import { type SidebarAppIconStateMessage } from '../../../shared/session-grid-contract';
import {
  AppIconPickerField,
  SelectField,
  SettingRow,
  SettingsNativeScrollArea,
  SettingsSection,
  SliderNumberField,
  TextField,
  ToggleField,
  WebColorPickerField,
} from '../fields';
import { getRememberedThemeAdvancedOpen, rememberThemeAdvancedOpen } from '../navigation-memory';
import {
  APPEARANCE_CHOICES,
  THEME_CONTRAST_CHOICES,
  TRANSPARENCY_STRENGTH_MAX,
  TRANSPARENCY_STRENGTH_MIN,
  TRANSPARENCY_STRENGTH_STEP,
  ThemeCardGrid,
  darkThemeCards,
  isTransparencyEnabled,
  lightThemeCards,
  windowGlassForTransparency,
  windowGlassAvailable,
  themeContrastChoiceIndex,
  themeContrastPatch,
  transparencyStrengthFromSettings,
  transparencyStrengthPatch,
} from '../theme-simple-controls';
import { APP_ICON_CONTROLS_VISIBLE } from '../search-catalog';
import { type SettingModificationProps, type SettingsSectionSearchResult } from '../types';

const GHOSTTY_THEME_UNMANAGED_VALUE = '__ghostex_ghostty_theme_unmanaged__';

/** Every row that lives under Advanced, so a search hit on one of them opens it. */
const THEME_ADVANCED_SETTING_KEYS = [
  'themeSidebarContrast',
  'themeWorkAreaContrast',
  'customSidebarTitlebarBackgroundDarknessPercent',
  'customSidebarTitlebarBackgroundTintColor',
  'customSidebarTitlebarLightBackgroundLightnessPercent',
  'customSidebarTitlebarLightBackgroundTintColor',
  'showActivePaneOutline',
  'workspaceActivePaneBorderColor',
  'sessionChatTheme',
  'terminalColorScheme',
  'terminalGhosttyTheme',
  'terminalGhosttyLightTheme',
  'windowGlassSource',
  'windowGlassImagePlacement',
  'windowGlassImageDark',
  'windowGlassImageLight',
  'windowGlassSidebarOpacityDark',
  'windowGlassWorkAreaTintDark',
  'windowGlassSidebarOpacityLight',
  'windowGlassWorkAreaTintLight',
] as const;

type UpdateDraft = <Key extends keyof ghostexSettings>(key: Key, value: ghostexSettings[Key]) => void;

/**
 * CDXC:Theming 2026-09-23 DECISION:
 * User: "another agent should really organize the settings and make them way better … i want simple and then someone could click on advanced to customize extra", then picked the theme-card layout (option A of the Themes settings mockups) and asked to "make theme into it's own page in settings below General". Theme is its own Settings page: Appearance, a card per dark and light theme drawn as a small window in that theme's colours, and one Enable Transparency switch (the user renamed it from Frosted glass; on is glass in dark mode, off is opaque; Always glass stays under Advanced). Everything else sits under Advanced, closed by default, grouped as Colours, Chat and terminal, Glass (App icon is hidden; see APP_ICON_CONTROLS_VISIBLE), and links to the related rows on General. A search hit inside Advanced opens it.
 */
export function ThemeSettingsTab({
  appIconError,
  appIconSectionRef,
  appIconState,
  chooseAppIconFile,
  chooseWindowGlassImageFile,
  draft,
  getSettingModificationProps,
  nativeFilePickerAvailable,
  onOpenRelatedSetting,
  rowVisible,
  searchEmptyState,
  searchResults,
  selectAppIcon,
  showAppIcon,
  themingSectionRef,
  updateDraft,
  updateDraftDebounced,
  updateDraftMany,
}: {
  appIconError?: string;
  appIconSectionRef: RefObject<HTMLDivElement | null>;
  appIconState?: SidebarAppIconStateMessage;
  chooseAppIconFile: () => void;
  chooseWindowGlassImageFile: (appearance: 'dark' | 'light') => void;
  draft: ghostexSettings;
  getSettingModificationProps: <Key extends keyof ghostexSettings>(key: Key) => Required<SettingModificationProps>;
  nativeFilePickerAvailable: boolean;
  /** Opens General searched for a related setting's title. */
  onOpenRelatedSetting: (query: string) => void;
  /** Whether a row survives the current search; every row shows while nothing is searched. */
  rowVisible: (result: SettingsSectionSearchResult, settingKey: string) => boolean;
  searchEmptyState?: ReactNode;
  searchResults: { appIcon: SettingsSectionSearchResult; theming: SettingsSectionSearchResult };
  selectAppIcon: (sourceId: string) => void;
  showAppIcon: boolean;
  themingSectionRef: RefObject<HTMLDivElement | null>;
  updateDraft: UpdateDraft;
  updateDraftDebounced: UpdateDraft;
  /** Saves several settings in one change, for the friendly controls that drive the deeper ones. */
  updateDraftMany: (patch: Partial<ghostexSettings>) => void;
}) {
  const appearanceId = useId();
  const darkThemeId = useId();
  const lightThemeId = useId();
  const contrastId = useId();
  const [advancedOpen, setAdvancedOpenState] = useState(getRememberedThemeAdvancedOpen);
  const setAdvancedOpen = (open: boolean) => {
    rememberThemeAdvancedOpen(open);
    setAdvancedOpenState(open);
  };
  const theming = searchResults.theming;
  const isSearching = theming.isSearching;
  const visible = (key: string) => rowVisible(theming, key);
  const appIconVisible =
    APP_ICON_CONTROLS_VISIBLE && showAppIcon && rowVisible(searchResults.appIcon, 'appIconSourceId');
  const advancedHasSearchHit =
    isSearching && (THEME_ADVANCED_SETTING_KEYS.some((key) => visible(key)) || appIconVisible);
  const advancedShown = advancedOpen || advancedHasSearchHit;
  const simpleVisible = [
    'sidebarTheme',
    'darkThemePreset',
    'lightThemePreset',
    'themeSidebarContrast',
    'themeWorkAreaContrast',
    'windowGlass',
  ].some(visible);
  // Advanced is not open while searching unless a hit is inside it, so it counts only through its own hits.
  const anythingVisible = simpleVisible || advancedHasSearchHit || !isSearching;
  const glassOn = isTransparencyEnabled(draft.windowGlass);

  const darkCards = darkThemeCards(draft);
  const lightCards = lightThemeCards(draft);
  const strength = transparencyStrengthFromSettings(draft);
  const contrastIndex = themeContrastChoiceIndex(draft);
  const applyPatch = updateDraftMany;

  const selectDarkPreset = (preset: DarkThemePreset) => {
    updateDraft('darkThemePreset', preset);
    if (preset === 'custom') {
      setAdvancedOpen(true);
    }
  };
  const selectLightPreset = (preset: LightThemePreset) => {
    updateDraft('lightThemePreset', preset);
    if (preset === 'custom') {
      setAdvancedOpen(true);
    }
  };

  return (
    <SettingsNativeScrollArea className='settings-main-scroll h-full min-h-0'>
      <div className='settings-page-width flex flex-col gap-6 px-5 pb-5'>
        {!anythingVisible ? searchEmptyState : null}
        {simpleVisible ? (
          <SettingsSection
            description='Pick how Ghostex looks. Everything else is under Advanced.'
            sectionRef={themingSectionRef}
            title='Theme'
          >
            {visible('sidebarTheme') ? (
              <SettingRow
                description='System follows your computer’s light or dark mode.'
                htmlFor={appearanceId}
                label='Appearance'
                {...getSettingModificationProps('sidebarTheme')}
                advanced={false}
              >
                <SegmentedControl
                  aria-label='Appearance'
                  onValueChange={(value) => updateDraft('sidebarTheme', value as ghostexSettings['sidebarTheme'])}
                  value={draft.sidebarTheme}
                >
                  {APPEARANCE_CHOICES.map((choice, index) => (
                    <SegmentedControlItem
                      id={index === 0 ? appearanceId : undefined}
                      key={choice.value}
                      value={choice.value}
                    >
                      {choice.label}
                    </SegmentedControlItem>
                  ))}
                </SegmentedControl>
              </SettingRow>
            ) : null}
            {visible('darkThemePreset') ? (
              <SettingRow
                description='Used in dark mode. Custom lets you tune its contrast and tint under Advanced.'
                htmlFor={darkThemeId}
                label='Dark theme'
                wide
                {...getSettingModificationProps('darkThemePreset')}
                advanced={false}
              >
                <ThemeCardGrid
                  cards={darkCards}
                  id={darkThemeId}
                  label='Dark theme'
                  onSelect={selectDarkPreset}
                  value={draft.darkThemePreset}
                />
              </SettingRow>
            ) : null}
            {visible('lightThemePreset') ? (
              <SettingRow
                description='Used in light mode. Custom lets you tune its contrast and tint under Advanced.'
                htmlFor={lightThemeId}
                label='Light theme'
                wide
                {...getSettingModificationProps('lightThemePreset')}
                advanced={false}
              >
                <ThemeCardGrid
                  cards={lightCards}
                  id={lightThemeId}
                  label='Light theme'
                  onSelect={selectLightPreset}
                  value={draft.lightThemePreset}
                />
              </SettingRow>
            ) : null}
            {visible('themeSidebarContrast') || visible('themeWorkAreaContrast') ? (
              <SettingRow
                description={
                  contrastIndex < 0
                    ? 'The sidebar and work area are set apart under Advanced; pick a step to set both.'
                    : 'Higher makes dark backgrounds darker and light backgrounds whiter, for both dark and light mode.'
                }
                htmlFor={contrastId}
                label='Background contrast'
                {...getSettingModificationProps('themeSidebarContrast')}
                advanced={false}
              >
                <SegmentedControl
                  aria-label='Background contrast'
                  onValueChange={(value) => applyPatch(themeContrastPatch(draft, Number(value)))}
                  value={contrastIndex < 0 ? '' : String(THEME_CONTRAST_CHOICES[contrastIndex]!.value)}
                >
                  {THEME_CONTRAST_CHOICES.map((choice, index) => (
                    <SegmentedControlItem
                      id={index === 0 ? contrastId : undefined}
                      key={choice.value}
                      value={String(choice.value)}
                    >
                      {choice.label}
                    </SegmentedControlItem>
                  ))}
                </SegmentedControl>
              </SettingRow>
            ) : null}
            {windowGlassAvailable() && visible('windowGlass') ? (
              <ToggleField
                checked={glassOn}
                description='Let your desktop show softly through the window in dark mode. Always glass is under Advanced.'
                label='Enable Transparency'
                {...getSettingModificationProps('windowGlass')}
                advanced={false}
                onChange={(checked) =>
                  updateDraft('windowGlass', windowGlassForTransparency(draft.windowGlass, checked))
                }
              />
            ) : null}
            {windowGlassAvailable() && glassOn && visible('windowGlass') ? (
              <SliderNumberField
                description={
                  strength.exact === undefined
                    ? 'Tuned by hand under Advanced; moving this resets all four tint sliders.'
                    : 'Higher shows more of your desktop. Sets the sidebar and work area tints under Advanced.'
                }
                label='Transparency strength'
                {...getSettingModificationProps('windowGlassSidebarOpacityDark')}
                advanced={false}
                max={TRANSPARENCY_STRENGTH_MAX}
                min={TRANSPARENCY_STRENGTH_MIN}
                onChange={(value) => applyPatch(transparencyStrengthPatch(value))}
                onCommit={(value) => applyPatch(transparencyStrengthPatch(value))}
                step={TRANSPARENCY_STRENGTH_STEP}
                value={strength.nearest}
              />
            ) : null}
          </SettingsSection>
        ) : null}

        {!isSearching ? (
          <Button
            aria-expanded={advancedShown}
            className='theme-advanced-disclosure'
            onClick={() => setAdvancedOpen(!advancedOpen)}
            type='button'
            variant='ghost'
          >
            <span className='theme-advanced-disclosure-title'>Advanced</span>
            <span className='theme-advanced-disclosure-hint'>
              Colours, contrast, glass strength, chat and terminal themes
            </span>
            <IconChevronRight
              aria-hidden='true'
              className={cn('theme-advanced-disclosure-chevron', advancedShown && 'is-open')}
            />
          </Button>
        ) : null}

        {advancedShown ? (
          <>
            {/*
              CDXC:Theming 2026-06-15-13:22:
              Users should only pick the sidebar/titlebar background. The
              foreground is derived automatically from that background so
              light and dark custom colors keep readable chrome.

              CDXC:Theming 2026-06-15-13:45:
              Replace the freeform background color picker with a constrained
              contrast slider. The slider outputs calibrated dark
              backgrounds so sidebar row states remain predictable.

              CDXC:Theming 2026-06-15-15:01:
              Limit the contrast slider to 85-100 because lower values made
              custom sidebar chrome too gray.

              CDXC:Theming 2026-06-15-15:15:
              Call the user-facing control Contrast while keeping the stored
              background darkness key stable for existing settings and native
              startup compatibility.

              CDXC:Theming 2026-06-15-15:28:
              Add Background Tint as a web-only color picker. Do not use
              input[type=color], because macOS replaces that with a native
              color panel instead of the in-app picker requested here.
            */}
            <SettingsSection title='Colours'>
              {visible('themeSidebarContrast') ? (
                <SliderNumberField
                  description="The sidebar's contrast. Higher makes dark backgrounds darker and light backgrounds whiter; 0 is the theme's own."
                  label='Sidebar contrast'
                  {...getSettingModificationProps('themeSidebarContrast')}
                  max={THEME_CONTRAST_MAX_POINTS}
                  min={THEME_CONTRAST_MIN_POINTS}
                  onCommit={(value) => updateDraft('themeSidebarContrast', value)}
                  onChange={(value) => updateDraftDebounced('themeSidebarContrast', value)}
                  step={1}
                  value={draft.themeSidebarContrast}
                />
              ) : null}
              {visible('themeWorkAreaContrast') ? (
                <SliderNumberField
                  description="The work area's contrast (chat, terminals and views). Higher makes dark backgrounds darker and light backgrounds whiter; 0 is the theme's own."
                  label='Work area contrast'
                  {...getSettingModificationProps('themeWorkAreaContrast')}
                  max={THEME_CONTRAST_MAX_POINTS}
                  min={THEME_CONTRAST_MIN_POINTS}
                  onCommit={(value) => updateDraft('themeWorkAreaContrast', value)}
                  onChange={(value) => updateDraftDebounced('themeWorkAreaContrast', value)}
                  step={1}
                  value={draft.themeWorkAreaContrast}
                />
              ) : null}
              {draft.darkThemePreset === 'custom' && visible('customSidebarTitlebarBackgroundDarknessPercent') ? (
                <SliderNumberField
                  description='85 is softer gray; 100 is black. Text and icons adjust automatically.'
                  label='Dark theme background contrast'
                  {...getSettingModificationProps('customSidebarTitlebarBackgroundDarknessPercent')}
                  max={MAX_CUSTOM_SIDEBAR_TITLEBAR_BACKGROUND_DARKNESS_PERCENT}
                  min={MIN_CUSTOM_SIDEBAR_TITLEBAR_BACKGROUND_DARKNESS_PERCENT}
                  onCommit={(value) => updateDraft('customSidebarTitlebarBackgroundDarknessPercent', value)}
                  onChange={(value) => updateDraftDebounced('customSidebarTitlebarBackgroundDarknessPercent', value)}
                  step={1}
                  value={draft.customSidebarTitlebarBackgroundDarknessPercent}
                />
              ) : null}
              {draft.darkThemePreset === 'custom' && visible('customSidebarTitlebarBackgroundTintColor') ? (
                <WebColorPickerField
                  description='Applies a subtle hue to the dark sidebar and window chrome background.'
                  label='Dark theme background tint'
                  {...getSettingModificationProps('customSidebarTitlebarBackgroundTintColor')}
                  onChange={(value) => updateDraftDebounced('customSidebarTitlebarBackgroundTintColor', value)}
                  onCommit={(value) => updateDraft('customSidebarTitlebarBackgroundTintColor', value)}
                  value={draft.customSidebarTitlebarBackgroundTintColor}
                />
              ) : null}
              {draft.lightThemePreset === 'custom' &&
              visible('customSidebarTitlebarLightBackgroundLightnessPercent') ? (
                <SliderNumberField
                  description='60 is a deeper gray; 100 is white. Text and icons adjust automatically.'
                  label='Light theme background contrast'
                  {...getSettingModificationProps('customSidebarTitlebarLightBackgroundLightnessPercent')}
                  max={MAX_CUSTOM_SIDEBAR_TITLEBAR_LIGHT_BACKGROUND_LIGHTNESS_PERCENT}
                  min={MIN_CUSTOM_SIDEBAR_TITLEBAR_LIGHT_BACKGROUND_LIGHTNESS_PERCENT}
                  onCommit={(value) => updateDraft('customSidebarTitlebarLightBackgroundLightnessPercent', value)}
                  onChange={(value) =>
                    updateDraftDebounced('customSidebarTitlebarLightBackgroundLightnessPercent', value)
                  }
                  step={1}
                  value={draft.customSidebarTitlebarLightBackgroundLightnessPercent}
                />
              ) : null}
              {draft.lightThemePreset === 'custom' && visible('customSidebarTitlebarLightBackgroundTintColor') ? (
                <WebColorPickerField
                  description='Applies a subtle hue to the light sidebar and window chrome background.'
                  label='Light theme background tint'
                  {...getSettingModificationProps('customSidebarTitlebarLightBackgroundTintColor')}
                  onChange={(value) => updateDraftDebounced('customSidebarTitlebarLightBackgroundTintColor', value)}
                  onCommit={(value) => updateDraft('customSidebarTitlebarLightBackgroundTintColor', value)}
                  value={draft.customSidebarTitlebarLightBackgroundTintColor}
                />
              ) : null}
              {visible('showActivePaneOutline') ? (
                <ToggleField
                  checked={draft.showActivePaneOutline}
                  description='Show an outline around the currently focused pane.'
                  label='Show Active Pane Outline'
                  {...getSettingModificationProps('showActivePaneOutline')}
                  advanced={false}
                  onChange={(checked) => updateDraft('showActivePaneOutline', checked)}
                />
              ) : null}
              {draft.showActivePaneOutline && visible('workspaceActivePaneBorderColor') ? (
                <WebColorPickerField
                  dependent
                  description='Color of the outline around the currently focused pane.'
                  label='Active Pane Border'
                  {...getSettingModificationProps('workspaceActivePaneBorderColor')}
                  advanced={false}
                  onChange={(value) => updateDraftDebounced('workspaceActivePaneBorderColor', value)}
                  onCommit={(value) => updateDraft('workspaceActivePaneBorderColor', value)}
                  value={draft.workspaceActivePaneBorderColor}
                />
              ) : null}
            </SettingsSection>

            <SettingsSection title='Chat and terminal'>
              {visible('sessionChatTheme') ? (
                <SelectField
                  description='Follow the app theme, or choose a separate appearance for chat.'
                  label='Chat theme'
                  {...getSettingModificationProps('sessionChatTheme')}
                  onChange={(value) => updateDraft('sessionChatTheme', value as ghostexSettings['sessionChatTheme'])}
                  options={SESSION_CHAT_THEME_OPTIONS}
                  value={draft.sessionChatTheme}
                />
              ) : null}
              {visible('terminalColorScheme') ? (
                <SelectField
                  description='Follow the app theme, or choose a separate appearance for terminals.'
                  label='Terminal theme'
                  {...getSettingModificationProps('terminalColorScheme')}
                  onChange={(value) =>
                    updateDraft('terminalColorScheme', value as ghostexSettings['terminalColorScheme'])
                  }
                  options={SESSION_CHAT_THEME_OPTIONS}
                  value={draft.terminalColorScheme}
                />
              ) : null}
              {visible('terminalGhosttyTheme') ? (
                <SelectField
                  contentClassName='max-h-80'
                  description='Uses your configured Ghostty dark theme, or GitHub Dark when no theme is configured.'
                  label='Terminal dark palette'
                  {...getSettingModificationProps('terminalGhosttyTheme')}
                  onChange={(value) =>
                    updateDraft('terminalGhosttyTheme', value === GHOSTTY_THEME_UNMANAGED_VALUE ? '' : value)
                  }
                  options={getGhosttyThemeSettingOptions(draft.terminalGhosttyTheme)}
                  showScrollButtons={false}
                  value={draft.terminalGhosttyTheme || GHOSTTY_THEME_UNMANAGED_VALUE}
                />
              ) : null}
              {visible('terminalGhosttyLightTheme') ? (
                <SelectField
                  contentClassName='max-h-80'
                  description='Uses your configured Ghostty light theme, or GitHub Light when no theme is configured.'
                  label='Terminal light palette'
                  {...getSettingModificationProps('terminalGhosttyLightTheme')}
                  onChange={(value) => updateDraft('terminalGhosttyLightTheme', value)}
                  options={getGhosttyThemeSettingOptions(draft.terminalGhosttyLightTheme).filter(
                    (option) => option.value !== GHOSTTY_THEME_UNMANAGED_VALUE
                  )}
                  showScrollButtons={false}
                  value={draft.terminalGhosttyLightTheme}
                />
              ) : null}
            </SettingsSection>

            {windowGlassAvailable() ? (
              <SettingsSection title='Glass'>
                {visible('windowGlass') ? (
                  <SelectField
                    description='When the blurred desktop shows through the window. Glass in dark mode is what the Enable Transparency switch turns on.'
                    label='Window glass'
                    {...getSettingModificationProps('windowGlass')}
                    onChange={(value) => updateDraft('windowGlass', value as WindowGlassMode)}
                    options={WINDOW_GLASS_OPTIONS}
                    value={draft.windowGlass}
                  />
                ) : null}
                {glassOn && visible('windowGlassSource') ? (
                  <SelectField
                    dependent
                    description='Wallpaper only keeps other windows from showing through the glass. Custom image shows a picture you choose.'
                    label='Glass shows'
                    {...getSettingModificationProps('windowGlassSource')}
                    onChange={(value) => updateDraft('windowGlassSource', value as WindowGlassSource)}
                    options={WINDOW_GLASS_SOURCE_OPTIONS}
                    value={draft.windowGlassSource}
                  />
                ) : null}
                {glassOn &&
                (draft.windowGlassSource === 'wallpaper' || draft.windowGlassSource === 'customImage') &&
                visible('windowGlassImagePlacement') ? (
                  <SelectField
                    dependent
                    description='Where the picture sits behind the glass. Stays with the desktop can trail the window while you drag it.'
                    label='Glass picture position'
                    {...getSettingModificationProps('windowGlassImagePlacement')}
                    onChange={(value) => updateDraft('windowGlassImagePlacement', value as WindowGlassImagePlacement)}
                    options={WINDOW_GLASS_IMAGE_PLACEMENT_OPTIONS}
                    value={draft.windowGlassImagePlacement}
                  />
                ) : null}
                {glassOn && draft.windowGlassSource === 'customImage' && visible('windowGlassImageDark') ? (
                  <TextField
                    browseLabel='Choose image'
                    dependent
                    description={
                      draft.windowGlassImageDark
                        ? 'The picture the glass blurs in dark mode.'
                        : 'No image chosen, so dark mode shows the live blur.'
                    }
                    label='Glass image for dark mode'
                    {...getSettingModificationProps('windowGlassImageDark')}
                    onBrowse={nativeFilePickerAvailable ? () => chooseWindowGlassImageFile('dark') : undefined}
                    onChange={(value) => updateDraft('windowGlassImageDark', value.trim())}
                    placeholder='/Users/you/Pictures/dark.jpg'
                    value={draft.windowGlassImageDark}
                  />
                ) : null}
                {glassOn && draft.windowGlassSource === 'customImage' && visible('windowGlassImageLight') ? (
                  <TextField
                    browseLabel='Choose image'
                    dependent
                    description={
                      draft.windowGlassImageLight
                        ? 'The picture the glass blurs in light mode.'
                        : 'No image chosen, so light mode shows the live blur.'
                    }
                    label='Glass image for light mode'
                    {...getSettingModificationProps('windowGlassImageLight')}
                    onBrowse={nativeFilePickerAvailable ? () => chooseWindowGlassImageFile('light') : undefined}
                    onChange={(value) => updateDraft('windowGlassImageLight', value.trim())}
                    placeholder='/Users/you/Pictures/light.jpg'
                    value={draft.windowGlassImageLight}
                  />
                ) : null}
                {glassOn && visible('windowGlassSidebarOpacityDark') ? (
                  <SliderNumberField
                    dependent
                    description='How much of the desktop the sidebar hides in dark mode. Lower shows more of your desktop through it.'
                    label='Sidebar tint in dark mode'
                    {...getSettingModificationProps('windowGlassSidebarOpacityDark')}
                    max={MAX_WINDOW_GLASS_SIDEBAR_OPACITY_PERCENT}
                    min={MIN_WINDOW_GLASS_SIDEBAR_OPACITY_PERCENT}
                    onCommit={(value) => updateDraft('windowGlassSidebarOpacityDark', value)}
                    onChange={(value) => updateDraftDebounced('windowGlassSidebarOpacityDark', value)}
                    step={1}
                    value={draft.windowGlassSidebarOpacityDark}
                  />
                ) : null}
                {glassOn && visible('windowGlassWorkAreaTintDark') ? (
                  <SliderNumberField
                    dependent
                    description='How much of the desktop the work area hides in dark mode, set on its own so either area can be the darker one. Lower shows more of your desktop through it.'
                    label='Work area tint in dark mode'
                    {...getSettingModificationProps('windowGlassWorkAreaTintDark')}
                    max={MAX_WINDOW_GLASS_WORK_AREA_TINT_PERCENT}
                    min={MIN_WINDOW_GLASS_WORK_AREA_TINT_PERCENT}
                    onCommit={(value) => updateDraft('windowGlassWorkAreaTintDark', value)}
                    onChange={(value) => updateDraftDebounced('windowGlassWorkAreaTintDark', value)}
                    step={1}
                    value={draft.windowGlassWorkAreaTintDark}
                  />
                ) : null}
                {glassOn && visible('windowGlassSidebarOpacityLight') ? (
                  <SliderNumberField
                    dependent
                    description='How much of the desktop the sidebar hides in light mode. Lower shows more of your desktop through it.'
                    label='Sidebar tint in light mode'
                    {...getSettingModificationProps('windowGlassSidebarOpacityLight')}
                    max={MAX_WINDOW_GLASS_SIDEBAR_OPACITY_PERCENT}
                    min={MIN_WINDOW_GLASS_SIDEBAR_OPACITY_PERCENT}
                    onCommit={(value) => updateDraft('windowGlassSidebarOpacityLight', value)}
                    onChange={(value) => updateDraftDebounced('windowGlassSidebarOpacityLight', value)}
                    step={1}
                    value={draft.windowGlassSidebarOpacityLight}
                  />
                ) : null}
                {glassOn && visible('windowGlassWorkAreaTintLight') ? (
                  <SliderNumberField
                    dependent
                    description='How much of the desktop the work area hides in light mode, set on its own so either area can be the darker one. Lower shows more of your desktop through it.'
                    label='Work area tint in light mode'
                    {...getSettingModificationProps('windowGlassWorkAreaTintLight')}
                    max={MAX_WINDOW_GLASS_WORK_AREA_TINT_PERCENT}
                    min={MIN_WINDOW_GLASS_WORK_AREA_TINT_PERCENT}
                    onCommit={(value) => updateDraft('windowGlassWorkAreaTintLight', value)}
                    onChange={(value) => updateDraftDebounced('windowGlassWorkAreaTintLight', value)}
                    step={1}
                    value={draft.windowGlassWorkAreaTintLight}
                  />
                ) : null}
              </SettingsSection>
            ) : null}

            {/*
             * CDXC:Icons 2026-06-28-06:05:
             * The App Icon section is a custom-image control, not a bundled preset picker. Show one preview, one Select Image action, and an inline X on the custom preview to restore the default icon; omit separate reset and folder-reveal actions so the flow stays direct.
             */}
            {appIconVisible ? (
              <SettingsSection
                description='Changes the Dock and app-switcher icon. The app file icon may also change when the operating system allows it.'
                sectionRef={appIconSectionRef}
                title='App Icon'
              >
                <AppIconPickerField
                  advanced={false}
                  error={appIconError}
                  onChooseFile={chooseAppIconFile}
                  onSelect={selectAppIcon}
                  state={appIconState}
                />
              </SettingsSection>
            ) : null}

            {!isSearching ? (
              <SettingsSection title='Related settings on General'>
                <RelatedSettingLink label='Chat font and size' onOpen={() => onOpenRelatedSetting('Chat font')} />
                <RelatedSettingLink
                  label='Sidebar size'
                  onOpen={() => onOpenRelatedSetting('Sidebar Interface Size')}
                />
                <RelatedSettingLink
                  label='Terminal background colour and image'
                  onOpen={() => onOpenRelatedSetting('Terminal background')}
                />
              </SettingsSection>
            ) : null}
          </>
        ) : null}
      </div>
    </SettingsNativeScrollArea>
  );
}

function RelatedSettingLink({ label, onOpen }: { label: string; onOpen: () => void }) {
  const id = useId();
  return (
    <SettingRow htmlFor={id} label={label}>
      <Button className='h-8 px-3' id={id} onClick={onOpen} type='button' variant='outline'>
        Open
      </Button>
    </SettingRow>
  );
}
