/*
CDXC:SessionChat 2026-09-18 SEE-ALSO:
The one rule for turning a transcript image block into something a renderer can actually show.
React reads it through session-chat-image-viewer.tsx and the message-list rows; GPUI chat reads the
same fields off the projected wire item in apps/desktop/src/app/native_chat/images.rs. A picture
that renders in one surface and falls back to a named chip in the other is a bug in this file.
*/

import type { SessionChatImageRefBlock } from '../session-chat';

/** A composer paste writes `ghostex-paste-*.png`, which reads as "Pasted image" rather than a machine file name. */
export const SESSION_CHAT_PASTED_IMAGE_NAME = /^ghostex-paste-.+\.png$/i;

export function isSessionChatPastedImagePath(path: string | undefined): boolean {
  if (!path) {
    return false;
  }
  const segment = path.split(/[\\/]/).at(-1) ?? '';
  return SESSION_CHAT_PASTED_IMAGE_NAME.test(segment);
}

/** The name a picture answers to: its chip when the bytes cannot be read, and the viewer's title. */
export function sessionChatImageLabel(block: { alt?: string; path?: string; url?: string }): string {
  if (isSessionChatPastedImagePath(block.path)) {
    return 'Pasted image';
  }
  if (block.path) {
    return block.path.split(/[\\/]/).at(-1) ?? block.path;
  }
  return block.alt ?? block.url ?? 'Image';
}

/**
 * How a renderer obtains the bytes:
 * `url` renders the address as-is, `data` already carries the bytes inline, and
 * `read` is a path on the session's machine that only `readSessionChatImage` can open.
 * `none` is a block with neither, which stays a named chip.
 */
export type SessionChatImageTransport = 'url' | 'data' | 'read' | 'none';

export interface SessionChatImageSource {
  transport: SessionChatImageTransport;
  /** Absolute path on the session's machine; empty unless `transport` is `read`. */
  path: string;
  /** Directly renderable address; empty unless `transport` is `url` or `data`. */
  url: string;
  alt: string;
  label: string;
  /**
   * The location behind the picture, for "Copy path". A data URL is bytes rather than a
   * location, so it offers nothing to copy and this stays empty.
   */
  copyPath: string;
  /** File name suggested when the picture is saved. */
  fileName: string;
}

function downloadFileName(label: string, path: string, url: string): string {
  const source = path || url;
  const segment = source.split(/[?#]/, 1)[0]?.split(/[\\/]/).at(-1) ?? '';
  if (/\.[a-z0-9]{2,5}$/i.test(segment)) {
    return segment;
  }
  const base = label.replace(/[\\/:*?"<>|]+/gu, '-').trim() || 'image';
  return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.png`;
}

/** Classifies one transcript image block into a source both renderers can load. */
export function sessionChatImageSource(block: SessionChatImageRefBlock): SessionChatImageSource {
  const url = block.url ?? '';
  const path = block.path ?? '';
  const alt = block.alt ?? '';
  const label = sessionChatImageLabel(block);
  const transport: SessionChatImageTransport = /^data:/i.test(url)
    ? 'data'
    : /^https?:/i.test(url)
      ? 'url'
      : path.length > 0
        ? 'read'
        : 'none';
  return {
    transport,
    path: transport === 'read' ? path : '',
    url: transport === 'url' || transport === 'data' ? url : '',
    alt,
    label,
    copyPath: transport === 'read' ? path : transport === 'url' ? url : '',
    fileName: downloadFileName(label, path, url),
  };
}
