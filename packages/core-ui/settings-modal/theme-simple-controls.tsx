import { type CSSProperties } from 'react';
import { cn } from '@/packages/components/utils';
import {
  DARK_THEME_PRESET_OPTIONS,
  LIGHT_THEME_PRESET_OPTIONS,
  SIDEBAR_THEME_SETTING_OPTIONS,
  getWorkAreaBackgroundForSettings,
  getSidebarTitlebarBackgroundForDarkness,
  getSidebarTitlebarForegroundForBackground,
  getSidebarTitlebarLightBackgroundForLightness,
  DEFAULT_CUSTOM_SIDEBAR_TITLEBAR_BACKGROUND_DARKNESS_PERCENT,
  DEFAULT_CUSTOM_SIDEBAR_TITLEBAR_LIGHT_BACKGROUND_LIGHTNESS_PERCENT,
  presetDarknessWithContrast,
  presetLightnessWithContrast,
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

function previewColors(chrome: string, work: string): ThemePreviewColors {
  return {
    chrome,
    foreground: getSidebarTitlebarForegroundForBackground(chrome),
    work,
  };
}

/** The dark theme cards; Custom previews the saved custom colours. */
export function darkThemeCards(
  settings: ghostexSettings,
  { includeCustom = true }: { includeCustom?: boolean } = {}
): ThemeCard<DarkThemePreset>[] {
  return DARK_THEME_PRESET_OPTIONS.filter((option) => includeCustom || option.value !== 'custom').map((option) => {
    // Presets preview with the theme contrast step applied, as the app paints them.
    const withPreset = { ...settings, darkThemePreset: option.value };
    const controls = resolveDarkChromeControls(withPreset);
    return {
      colors: previewColors(
        getSidebarTitlebarBackgroundForDarkness(controls.darknessPercent, controls.tintColor),
        getWorkAreaBackgroundForSettings(withPreset, false)
      ),
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
    const withPreset = { ...settings, lightThemePreset: option.value };
    const controls = resolveLightChromeControls(withPreset);
    return {
      colors: previewColors(
        getSidebarTitlebarLightBackgroundForLightness(controls.lightnessPercent, controls.tintColor),
        getWorkAreaBackgroundForSettings(withPreset, true)
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

/**
 * Window glass is drawn by the macOS and Windows apps, so surfaces that can hide the switch elsewhere ask here.
 *
 * CDXC:Theming 2026-09-25 DECISION:
 * User: "let's enable transparency on windows please also if possible. like it works on mac exactly." The glass
 * controls show on macOS and Windows. Glass shows (Wallpaper only, Custom image) stays macOS-only because only the
 * macOS window backend can draw a picture behind the glass, and on Windows turning glass on takes effect at the next
 * launch (see `note_main_window_background` in apps/desktop/src/app/helpers/window_glass.rs).
 */
export function windowGlassAvailable(): boolean {
  const platform = detectghostexHotkeyPlatform();
  return platform === 'mac' || platform === 'windows';
}

/** Whether the glass can show the wallpaper or a chosen picture instead of what is behind the window (macOS). */
export function windowGlassPicturesAvailable(): boolean {
  return detectghostexHotkeyPlatform() === 'mac';
}

/** A sentence for glass controls on Windows, where turning glass on waits for the next launch. */
export function windowGlassRestartNote(): string {
  return detectghostexHotkeyPlatform() === 'windows'
    ? ' On Windows, turning it on takes effect the next time Ghostex starts.'
    : '';
}

/**
 * The five background contrast steps, lowest first.
 *
 * CDXC:Theming 2026-09-23 DECISION:
 * User: "contrast values dont make sense please make it clearer.. you can change it's name ... and make the main one
 * outside of the advanced settings affect both at the same time (dark and light basically)". The control is Background
 * contrast, Lowest to Highest with Normal in the middle: higher makes dark backgrounds darker and light backgrounds
 * whiter, always for both appearances at once.
 */
export const THEME_CONTRAST_CHOICES: readonly { value: number; label: string }[] = [
  { value: -8, label: 'Lowest' },
  { value: -4, label: 'Low' },
  { value: 0, label: 'Normal' },
  { value: 2, label: 'High' },
  { value: 4, label: 'Highest' },
];

/** The five-step choice both contrast values sit on, or -1 when they differ or sit between steps. */
export function themeContrastChoiceIndex(settings: ghostexSettings): number {
  if (settings.themeSidebarContrast !== settings.themeWorkAreaContrast) {
    return -1;
  }
  return THEME_CONTRAST_CHOICES.findIndex((choice) => choice.value === settings.themeSidebarContrast);
}

/**
 * CDXC:Theming 2026-09-23 DECISION:
 * User: "add transparency strength selection" to the setup and the Theme page, then "it needs to make the sidebar
 * darker than main not vice versa", then "make it 7 point difference and make it a slider with more options".
 * Transparency strength is one 0-100 slider in steps of 5 (higher shows more of the desktop) that sets the four glass
 * tint sliders at once: the sidebar's tint falls from 95 (dark) / 98 (light) as it rises, and the work area is always
 * 7 points more see-through than the sidebar. The sliders under Settings -> Theme -> Advanced -> Glass stay the exact
 * controls.
 */
export const TRANSPARENCY_STRENGTH_MIN = 0;
export const TRANSPARENCY_STRENGTH_MAX = 100;
export const TRANSPARENCY_STRENGTH_STEP = 5;
const TRANSPARENCY_WORK_AREA_GAP = 7;

/** The four tint sliders one strength sets. */
export function transparencyStrengthPatch(strength: number): Partial<ghostexSettings> {
  const value = Math.max(TRANSPARENCY_STRENGTH_MIN, Math.min(TRANSPARENCY_STRENGTH_MAX, strength));
  const sidebarDark = Math.round(95 - value * 0.35);
  const sidebarLight = Math.round(98 - value * 0.25);
  return {
    windowGlassSidebarOpacityDark: sidebarDark,
    windowGlassWorkAreaTintDark: sidebarDark - TRANSPARENCY_WORK_AREA_GAP,
    windowGlassSidebarOpacityLight: sidebarLight,
    windowGlassWorkAreaTintLight: sidebarLight - TRANSPARENCY_WORK_AREA_GAP,
  };
}

/**
 * The strength the four tint sliders came from, or undefined once they were tuned by hand. `nearest` is where the
 * slider sits in that case, read from the dark sidebar tint.
 */
export function transparencyStrengthFromSettings(settings: ghostexSettings): { exact?: number; nearest: number } {
  const raw = (95 - settings.windowGlassSidebarOpacityDark) / 0.35;
  const nearest = Math.max(
    TRANSPARENCY_STRENGTH_MIN,
    Math.min(TRANSPARENCY_STRENGTH_MAX, Math.round(raw / TRANSPARENCY_STRENGTH_STEP) * TRANSPARENCY_STRENGTH_STEP)
  );
  const patch = transparencyStrengthPatch(nearest);
  const exact =
    patch.windowGlassSidebarOpacityDark === settings.windowGlassSidebarOpacityDark &&
    patch.windowGlassWorkAreaTintDark === settings.windowGlassWorkAreaTintDark &&
    patch.windowGlassSidebarOpacityLight === settings.windowGlassSidebarOpacityLight &&
    patch.windowGlassWorkAreaTintLight === settings.windowGlassWorkAreaTintLight
      ? nearest
      : undefined;
  return { exact, nearest };
}

/**
 * The settings patch for one contrast step: the sidebar and work area contrast together, and the dark and light Custom
 * contrast sliders under Advanced moved in step, so the friendly control drives whatever is painted.
 */
export function themeContrastPatch(_settings: ghostexSettings, points: number): Partial<ghostexSettings> {
  return {
    themeSidebarContrast: points,
    themeWorkAreaContrast: points,
    customSidebarTitlebarBackgroundDarknessPercent: presetDarknessWithContrast(
      DEFAULT_CUSTOM_SIDEBAR_TITLEBAR_BACKGROUND_DARKNESS_PERCENT,
      points
    ),
    customSidebarTitlebarLightBackgroundLightnessPercent: presetLightnessWithContrast(
      DEFAULT_CUSTOM_SIDEBAR_TITLEBAR_LIGHT_BACKGROUND_LIGHTNESS_PERCENT,
      points
    ),
  };
}

/** Each dark preset's nearest light preset, so picking one look fills in the other appearance to match. */
export const LIGHT_PRESET_FOR_DARK: Readonly<Record<Exclude<DarkThemePreset, 'custom'>, LightThemePreset>> = {
  gray: 'gray',
  black: 'white',
  blue: 'blue',
  green: 'green',
  red: 'orange',
  purple: 'pink',
};

export const DARK_PRESET_FOR_LIGHT: Readonly<Record<Exclude<LightThemePreset, 'custom'>, DarkThemePreset>> = {
  gray: 'gray',
  white: 'black',
  blue: 'blue',
  green: 'green',
  orange: 'red',
  pink: 'purple',
};
