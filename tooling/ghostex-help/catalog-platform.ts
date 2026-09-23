/**
 * CDXC:AgentSkills 2026-09-23 WHY:
 * The committed Help catalog uses macOS shortcut labels and lists Windows/Linux bindings separately. Bun exposes the host OS through navigator, so select the catalog platform before importing Settings modules that compute labels at module load.
 */
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    platform: 'MacIntel',
    userAgent: 'Ghostex Help catalog (Macintosh)',
  },
});
