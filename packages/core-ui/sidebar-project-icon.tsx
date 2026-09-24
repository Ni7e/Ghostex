import { useState } from 'react';
import {
  normalizeDiscoveredProjectIconDataUrl,
  resolveWorkspaceProjectIconDataUrl,
  type WorkspaceProjectIcon,
} from '../shared/workspace-project-appearance';
import { AppTooltip } from './app-tooltip';
import { SidebarCommandIconGlyph } from './sidebar-command-icon';

export type SidebarProjectIconProps = {
  discoveredIconDataUrl?: string;
  fallback?: 'folder' | 'folder-open' | 'worktree';
  icon?: WorkspaceProjectIcon;
  iconDataUrl?: string;
  title: string;
  tooltipDelay?: number;
};

export function SidebarProjectIcon({
  discoveredIconDataUrl,
  fallback = 'folder',
  icon,
  iconDataUrl,
  title,
  tooltipDelay,
}: SidebarProjectIconProps) {
  const [failedImage, setFailedImage] = useState<string>();
  const imageDataUrl = resolveWorkspaceProjectIconDataUrl({
    icon,
    iconDataUrl,
  });
  if (imageDataUrl && failedImage !== imageDataUrl) {
    return (
      <AppTooltip content={title} delay={tooltipDelay}>
        <img
          alt=''
          aria-hidden='true'
          className='sidebar-project-icon'
          data-icon-variant='image'
          src={imageDataUrl}
          onError={() => setFailedImage(imageDataUrl)}
        />
      </AppTooltip>
    );
  }

  const discovered = normalizeDiscoveredProjectIconDataUrl(discoveredIconDataUrl);
  if (discovered && failedImage !== discovered && !imageDataUrl) {
    return (
      <AppTooltip content={title} delay={tooltipDelay}>
        <img
          alt=''
          aria-hidden='true'
          className='sidebar-project-icon'
          data-icon-variant='discovered'
          src={discovered}
          onError={() => setFailedImage(discovered)}
        />
      </AppTooltip>
    );
  }

  if (icon?.kind === 'tabler') {
    return (
      <AppTooltip content={title} delay={tooltipDelay}>
        <span aria-hidden='true' className='sidebar-project-icon' data-icon-variant='tabler'>
          <SidebarCommandIconGlyph color={icon.color} icon={icon.icon} size={16} stroke={1.8} />
        </span>
      </AppTooltip>
    );
  }

  /**
   * CDXC:Icons 2026-09-24 DECISION:
   * User: when a project has no favicon, show a square with the first letter of its name instead of the folder icon.
   */
  return (
    <span
      aria-hidden='true'
      className='sidebar-project-icon'
      data-fallback-kind={fallback}
      data-icon-variant='initial'
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        borderRadius: 3,
        background: 'color-mix(in srgb, currentColor 12%, transparent)',
        fontSize: 10,
        fontWeight: 600,
        lineHeight: '16px',
        flexShrink: 0,
      }}
    >
      {Array.from(title.trim())[0]?.toUpperCase() || '?'}
    </span>
  );
}
