/**
 * CDXC:Hotkeys 2026-05-15-20:44:
 * Hotkey labels are shown in both the Cmd-hold overlay and the command
 * palette. Keep one formatter so Settings values, palette shortcuts, and the
 * discovery overlay use the same Mac glyphs for the same stored hotkey text.
 *
 * CDXC:Hotkeys 2026-06-14-19:40:
 * Display shortcut chords as compact Mac labels without literal plus signs.
 * The Cmd-hold overlay should read like native menu shortcuts, e.g. `⌘L`
 * instead of `⌘+L`, while preserving spaces between multi-step chords.
 */
export function formatSidebarHotkeyLabel(hotkey: string): string {
  return hotkey
    .split(" ")
    .map((chord) =>
      chord
        .split("+")
        .map(formatSidebarHotkeyPart)
        .join(""),
    )
    .join(" ");
}

function formatSidebarHotkeyPart(part: string): string {
  switch (part) {
    case "cmd":
      return "⌘";
    case "ctrl":
      return "⌃";
    case "alt":
      return "⌥";
    case "shift":
      return "⇧";
    case "up":
      return "↑";
    case "right":
      return "→";
    case "down":
      return "↓";
    case "left":
      return "←";
    case "tab":
      return "Tab";
    default:
      if (/^f\d+$/u.test(part)) {
        return part.toUpperCase();
      }
      return part.length === 1 ? part.toUpperCase() : part;
  }
}
