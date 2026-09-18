/** CDXC:SessionChat 2026-09-13 DECISION:
 * User: diff paths start at the current folder; files outside the project keep their full path, with the home directory shortened to ~/ where possible.
 */
export function sessionChatFileChangeDisplayPath(path: string, workingDirectory?: string): string {
  if (!workingDirectory) return path;
  const windows = /^[A-Za-z]:[\\/]/.test(workingDirectory) || workingDirectory.startsWith('\\\\');
  const normalize = (value: string) => (windows ? value.replaceAll('\\', '/') : value).replace(/\/+$/, '');
  const directory = normalize(workingDirectory);
  const normalizedPath = normalize(path);
  const comparable = (value: string) => (windows ? value.toLowerCase() : value);
  const relativeTo = (root: string): string | undefined => {
    if (comparable(normalizedPath).startsWith(`${comparable(root)}/`)) {
      return normalizedPath.slice(root.length + 1);
    }
    return undefined;
  };
  const relative = relativeTo(directory);
  if (relative !== undefined) return relative;
  const home =
    /^(?:\/Users\/[^/]+|\/home\/[^/]+|\/root)(?=\/|$)/.exec(directory)?.[0] ??
    (windows ? /^[A-Za-z]:\/Users\/[^/]+(?=\/|$)/i.exec(directory)?.[0] : undefined);
  if (home) {
    const homeRelative = relativeTo(home);
    if (homeRelative !== undefined) return `~/${homeRelative}`;
  }
  return path;
}
