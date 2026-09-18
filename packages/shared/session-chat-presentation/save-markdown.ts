export function localDateDirectory(date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizedMarkdownStem(value: string): string {
  return value.trim().replace(/\.md$/iu, '').trim();
}

export function normalizedFolderPath(value: string): string {
  return value
    .trim()
    .split('/')
    .map((segment) => segment.trim())
    .join('/');
}

export function folderPathError(value: string): string | undefined {
  const path = normalizedFolderPath(value);
  if (path === '') {
    return 'Enter a folder name.';
  }
  if (path.length > 240) {
    return 'Use a folder path of 240 characters or fewer.';
  }
  for (const segment of path.split('/')) {
    if (segment === '') {
      return 'Enter a folder name between each slash.';
    }
    if (segment === '.' || segment === '..' || /[. ]$/u.test(segment)) {
      return 'Folder names cannot be a period or end with a period or space.';
    }
    if (/[\\<>:"|?*\u0000-\u001f]/u.test(segment)) {
      return 'A folder name contains a character that cannot be used in a path.';
    }
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(segment)) {
      return 'A folder name is reserved by the operating system.';
    }
  }
  return undefined;
}

function sessionMarkdownBase(sessionTitle: string): string {
  const title = sessionTitle
    .trim()
    .replace(/[\\/<>:"|?*\u0000-\u001f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/[. ]+$/gu, '')
    .trim();
  return (title || 'Saved response').slice(0, 110).trimEnd();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function suggestedMarkdownStem(
  sessionTitle: string,
  folderPath: string,
  existingPaths: readonly string[]
): string {
  const base = sessionMarkdownBase(sessionTitle);
  const suffixSeparator = base.includes('-') ? '-' : ' ';
  const prefix = `docs/${normalizedFolderPath(folderPath)}/`;
  const numberedName = new RegExp(`^${escapeRegExp(base)}${escapeRegExp(suffixSeparator)}(\\d+)\\.md$`, 'iu');
  let highestSuffix = 0;
  for (const path of existingPaths) {
    if (!path.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
      continue;
    }
    const name = path.slice(prefix.length);
    if (name.includes('/')) {
      continue;
    }
    const match = numberedName.exec(name);
    const suffix = match?.[1] ? Number.parseInt(match[1], 10) : 0;
    highestSuffix = Math.max(highestSuffix, suffix);
  }
  return `${base}${suffixSeparator}${highestSuffix + 1}`;
}

export function markdownStemError(value: string): string | undefined {
  const stem = normalizedMarkdownStem(value);
  if (stem === '') {
    return 'Enter a file name.';
  }
  if (stem.length > 120) {
    return 'Use a file name of 120 characters or fewer.';
  }
  if (/[\\/<>:"|?*\u0000-\u001f]/u.test(stem)) {
    return 'The file name contains a character that cannot be used in a path.';
  }
  if (stem === '.' || stem === '..' || /[. ]$/u.test(stem)) {
    return 'Enter a file name without a trailing period or space.';
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(stem)) {
    return 'That file name is reserved by the operating system.';
  }
  return undefined;
}
