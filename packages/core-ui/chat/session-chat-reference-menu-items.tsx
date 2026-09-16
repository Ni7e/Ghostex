import { IconBrowser, IconCode, IconCopy, IconExternalLink, IconFileText } from '@tabler/icons-react';
import { ContextMenuItem } from '@/packages/components/ui/context-menu';
import {
  classifySessionChatLinkHref,
  sessionChatFilePositionFromHref,
  useSessionChatHostLinks,
} from './session-chat-links';
import { playCopySound } from '../copy-sound';
import { sessionChatReferenceKind } from './session-chat-reference-pills';

/**
 * CDXC:SessionChat 2026-09-12 DECISION:
 * User: keep Copy Path and remove Locate File from reference menus, superseding the September 9 menu choice.
 * URLs offer Copy URL and opening in the embedded or external browser.
 */
export function SessionChatReferenceMenuItems(reference: { href: string } | { filePath: string }) {
  const links = useSessionChatHostLinks();
  const target = 'filePath' in reference
    ? { kind: 'file' as const, path: reference.filePath }
    : classifySessionChatLinkHref(reference.href);
  const copy = (text: string): void => {
    playCopySound();
    void navigator.clipboard.writeText(text).catch((error: unknown) => {
      console.error('[session-chat] reference clipboard write failed', error);
    });
  };
  if (target.kind === 'url') {
    return (
      <>
        <ContextMenuItem onClick={() => copy(target.url)}>
          <IconCopy aria-hidden='true' />
          Copy URL
        </ContextMenuItem>
        {links?.openUrl ? (
          <>
            <ContextMenuItem onClick={() => links.openUrl?.(target.url, { external: false, forceEmbedded: true })}>
              <IconBrowser aria-hidden='true' />
              Open in Embedded Browser
            </ContextMenuItem>
            <ContextMenuItem onClick={() => links.openUrl?.(target.url, { external: true })}>
              <IconExternalLink aria-hidden='true' />
              Open in External Browser
            </ContextMenuItem>
          </>
        ) : null}
      </>
    );
  }
  if (target.kind !== 'file') return null;
  const position = 'href' in reference ? sessionChatFilePositionFromHref(reference.href) : undefined;
  const isFolder = sessionChatReferenceKind('', target.path) === 'folder';
  const supportsDocs = /\.(?:md|markdown|mdown|mkdn|htm|html|excalidraw)$/i.test(target.path);
  return (
    <>
      {!isFolder && links?.openFileInCode ? (
        <ContextMenuItem onClick={() => links.openFileInCode?.(target.path, position)}>
          <IconCode aria-hidden='true' />
          Open in Code
        </ContextMenuItem>
      ) : null}
      {supportsDocs && links?.openFileInDocs ? (
        <ContextMenuItem onClick={() => links.openFileInDocs?.(target.path, position)}>
          <IconFileText aria-hidden='true' />
          Open in Docs
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onClick={() => copy(target.path)}>
        <IconCopy aria-hidden='true' />
        Copy Path
      </ContextMenuItem>
    </>
  );
}
