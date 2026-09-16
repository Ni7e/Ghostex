import { useEffect, useRef } from 'react';
import { IconFolderOpen } from '@tabler/icons-react';
import type { SidebarGhostexFolderStatsMessage } from '@/packages/shared/session-grid-contract';
import { SettingButton, SettingsListItem, SettingsSection } from './fields';

export function FolderStorageStats({
  stats,
  isLoading,
  onRequest,
  onOpenFolder,
}: {
  stats?: SidebarGhostexFolderStatsMessage;
  isLoading: boolean;
  onRequest?: () => void;
  onOpenFolder?: () => void;
}) {
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current || stats || isLoading || !onRequest) return;
    requested.current = true;
    onRequest();
  }, [stats, isLoading, onRequest]);

  return (
    <SettingsSection title='Ghostex folder storage'>
      <SettingsListItem detail={stats?.folderPath ?? 'Ghostex data folder'} title='Ghostex folder'>
        <div className='flex flex-wrap gap-2'>
          <SettingButton
            disabled={!onRequest || isLoading}
            disabledReason={isLoading ? 'Folder sizes are loading.' : 'Folder statistics are unavailable here.'}
            onClick={onRequest}
            type='button'
            variant='outline'
          >
            {isLoading ? 'Loading...' : 'Refresh'}
          </SettingButton>
          <SettingButton
            disabled={!onOpenFolder}
            disabledReason='Folder access is unavailable here.'
            onClick={onOpenFolder}
            type='button'
            variant='outline'
          >
            <IconFolderOpen aria-hidden='true' className='size-4' />
            Open File/Folder Location
          </SettingButton>
        </div>
      </SettingsListItem>
      {!onRequest ? (
        <p className='text-sm text-muted-foreground'>Folder statistics are available in the desktop app.</p>
      ) : null}
      {isLoading && !stats ? <p className='text-sm text-muted-foreground'>Loading folder sizes...</p> : null}
      {stats?.errorMessage ? (
        <p role='alert' className='text-sm text-destructive'>
          {stats.errorMessage}
        </p>
      ) : null}
      {stats && !stats.errorMessage ? (
        <>
          {stats.folders.length ? (
            stats.folders.map((folder) => (
              <SettingsListItem key={folder.path} title={folder.name}>
                <span className='text-sm tabular-nums text-muted-foreground'>{formatBytes(folder.sizeBytes)}</span>
              </SettingsListItem>
            ))
          ) : (
            <p className='text-sm text-muted-foreground'>No folders found.</p>
          )}
          <SettingsListItem title='Total'>
            <span className='text-sm tabular-nums text-foreground'>{formatBytes(stats.totalBytes)}</span>
          </SettingsListItem>
        </>
      ) : null}
    </SettingsSection>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
