/** Where the last sidebar projection spent its time, reported through the `native.sidebar.refresh` diagnostic log. */
export const nativeSidebarProjectionPhases: { current: Record<string, number> } = { current: {} };

export function addProjectionPhase(name: string, ms: number): void {
  nativeSidebarProjectionPhases.current[name] = (nativeSidebarProjectionPhases.current[name] ?? 0) + ms;
}
