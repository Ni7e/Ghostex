import { classifySessionChatLinkHref, sessionChatFilePositionFromHref } from './links';
import { sessionChatReferenceKind } from './reference-pills';

export interface SessionChatReferenceMenuRow {
  command: Record<string, unknown>;
  iconPath: string;
  label: string;
}

/** The Docs surface opens these; everything else belongs to Code. */
const DOCS_PATH_PATTERN = /\.(?:md|markdown|mdown|mkdn|htm|html|excalidraw)$/i;

/**
 * CDXC:SessionChat 2026-09-18 SEE-ALSO:
 * The React rows are `packages/core-ui/chat/session-chat-reference-menu-items.tsx`; both renderers
 * offer the same entries in the same order for a composer pill or a transcript link.
 */
export function sessionChatReferenceMenuRows(href: string): SessionChatReferenceMenuRow[] {
  const target = classifySessionChatLinkHref(href);
  if (target.kind === 'url') {
    return [
      { command: { text: target.url, type: 'copyText' }, iconPath: 'titlebar/copy.svg', label: 'Copy URL' },
      {
        command: { action: 'openLink', external: false, forceEmbedded: true, type: 'host', url: target.url },
        iconPath: 'titlebar/world.svg',
        label: 'Open in Embedded Browser',
      },
      {
        command: { action: 'openLink', external: true, type: 'host', url: target.url },
        iconPath: 'titlebar/link.svg',
        label: 'Open in External Browser',
      },
    ];
  }
  if (target.kind !== 'file') return [];
  const position = sessionChatFilePositionFromHref(href) ?? {};
  const rows: SessionChatReferenceMenuRow[] = [];
  if (sessionChatReferenceKind('', target.path) !== 'folder') {
    rows.push({
      command: { action: 'openFile', path: target.path, type: 'host', view: 'code', ...position },
      iconPath: 'titlebar/code.svg',
      label: 'Open in Code',
    });
  }
  if (DOCS_PATH_PATTERN.test(target.path)) {
    rows.push({
      command: { action: 'openFile', path: target.path, type: 'host', view: 'docs', ...position },
      iconPath: 'titlebar/file-text.svg',
      label: 'Open in Docs',
    });
  }
  rows.push({ command: { text: target.path, type: 'copyText' }, iconPath: 'titlebar/copy.svg', label: 'Copy Path' });
  rows.push({
    command: { action: 'locateFile', path: target.path, type: 'host' },
    iconPath: 'titlebar/folder-open.svg',
    label: 'Open File/Folder Location',
  });
  return rows;
}
