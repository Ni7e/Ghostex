import { type CSSProperties } from 'react';
import { cn } from '@/packages/components/utils';
import {
  DARK_THEME_PRESET_CONTROLS,
  DARK_THEME_PRESET_OPTIONS,
  LIGHT_THEME_PRESET_CONTROLS,
  LIGHT_THEME_PRESET_OPTIONS,
  SIDEBAR_THEME_SETTING_OPTIONS,
  getSessionChatBackgroundForChrome,
  getSidebarTitlebarBackgroundForDarkness,
  getSidebarTitlebarForegroundForBackground,
  getSidebarTitlebarLightBackgroundForLightness,
  resolveDarkChromeControls,
  resolveLightChromeControls,
  type DarkThemePreset,
  type LightThemePreset,
  type WindowGlassMode,
  type ghostexSettings,
} from '../../shared/ghostex-settings';
import { detectghostexHotkeyPlatform } from '../../shared/ghostex-hotkeys';

/**
 * The Theme page's simple choices (Appearance, the dark and light theme cards, Enable Transparency), shared by the
 * Settings Theme page and the onboarding's Get started panel so both offer the same options and write the same
 * settings. Each surface draws its own rows around them; the options, the theme previews and the transparency
 * mapping live only here.
 */

/** Appearance reads System, Light, Dark, left to right. */
const APPEARANCE_ORDER = ['system', 'plain-light', 'dark-2'] as const;

export const APPEARANCE_CHOICES: ReadonlyArray<{ label: string; value: ghostexSettings['sidebarTheme'] }> =
  APPEARANCE_ORDER.map((value) => ({
    label: SIDEBAR_THEME_SETTING_OPTIONS.find((option) => option.value === value)?.label ?? value,
    value,
  }));

/** Enable Transparency is on for every glass mode but Opaque. */
export function isTransparencyEnabled(windowGlass: WindowGlassMode): boolean {
  return windowGlass !== 'opaque';
}

/** Turning Enable Transparency on keeps an Always glass choice and otherwise picks glass in dark mode. */
export function windowGlassForTransparency(current: WindowGlassMode, enabled: boolean): WindowGlassMode {
  if (!enabled) {
    return 'opaque';
  }
  return current === 'opaque' ? 'auto' : current;
}

/** A little window drawn in one theme's colours: the sidebar, the work area and a composer. */
type ThemePreviewColors = {
  chrome: string;
  foreground: string;
  work: string;
};

export type ThemeCard<Preset extends string> = { colors: ThemePreviewColors; label: string; value: Preset };

function previewColors(chrome: string): ThemePreviewColors {
  return {
    chrome,
    foreground: getSidebarTitlebarForegroundForBackground(chrome),
    work: getSessionChatBackgroundForChrome(chrome),
  };
}

/** The dark theme cards; Custom previews the saved custom colours. */
export function darkThemeCards(
  settings: ghostexSettings,
  { includeCustom = true }: { includeCustom?: boolean } = {}
): ThemeCard<DarkThemePreset>[] {
  return DARK_THEME_PRESET_OPTIONS.filter((option) => includeCustom || option.value !== 'custom').map((option) => {
    const controls =
      option.value === 'custom'
        ? resolveDarkChromeControls({ ...settings, darkThemePreset: 'custom' })
        : DARK_THEME_PRESET_CONTROLS[option.value];
    return {
      colors: previewColors(getSidebarTitlebarBackgroundForDarkness(controls.darknessPercent, controls.tintColor)),
      label: option.label,
      value: option.value,
    };
  });
}

/** The light theme cards; Custom previews the saved custom colours. */
export function lightThemeCards(
  settings: ghostexSettings,
  { includeCustom = true }: { includeCustom?: boolean } = {}
): ThemeCard<LightThemePreset>[] {
  return LIGHT_THEME_PRESET_OPTIONS.filter((option) => includeCustom || option.value !== 'custom').map((option) => {
    const controls =
      option.value === 'custom'
        ? resolveLightChromeControls({ ...settings, lightThemePreset: 'custom' })
        : LIGHT_THEME_PRESET_CONTROLS[option.value];
    return {
      colors: previewColors(
        getSidebarTitlebarLightBackgroundForLightness(controls.lightnessPercent, controls.tintColor)
      ),
      label: option.label,
      value: option.value,
    };
  });
}

function ThemePreviewWindow({ colors }: { colors: ThemePreviewColors }) {
  return (
    <span
      aria-hidden='true'
      className='theme-preview-window'
      style={
        {
          '--theme-preview-chrome': colors.chrome,
          '--theme-preview-foreground': colors.foreground,
          '--theme-preview-work': colors.work,
        } as CSSProperties
      }
    >
      <span className='theme-preview-sidebar'>
        <span className='theme-preview-row' />
        <span className='theme-preview-row is-selected' />
        <span className='theme-preview-row' />
      </span>
      <span className='theme-preview-work'>
        <span className='theme-preview-bubble' />
        <span className='theme-preview-text' />
        <span className='theme-preview-text is-short' />
        <span className='theme-preview-composer' />
      </span>
    </span>
  );
}

export function ThemeCardGrid<Preset extends string>({
  cards,
  id,
  label,
  onSelect,
  value,
}: {
  id?: string;
  label: string;
  cards: ReadonlyArray<ThemeCard<Preset>>;
  onSelect: (value: Preset) => void;
  value: Preset;
}) {
  return (
    <div aria-label={label} className='theme-card-grid' id={id} role='radiogroup'>
      {cards.map((card) => (
        <button
          aria-checked={card.value === value}
          className={cn('theme-card', card.value === value && 'is-selected')}
          key={card.value}
          onClick={() => onSelect(card.value)}
          role='radio'
          type='button'
        >
          <ThemePreviewWindow colors={card.colors} />
          <span className='theme-card-name'>{card.value === 'custom' ? 'Custom…' : card.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Window glass is drawn only by the macOS app, so surfaces that can hide the switch elsewhere ask here. */
export function windowGlassAvailable(): boolean {
  return detectghostexHotkeyPlatform() === 'mac';
}
