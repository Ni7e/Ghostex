import type { ghostexSettings } from '@/packages/shared/ghostex-settings';
import { SelectField, TextField } from '../fields';
import type { SettingModificationProps } from '../types';

type Key = 'windowsTerminalBackend' | 'windowsWslDistribution';

export function WindowsTerminalFields({
  settings, visible, onBackend, onDistribution, modification,
}: {
  settings: Pick<ghostexSettings, Key>;
  visible: (key: Key) => boolean;
  onBackend: (value: ghostexSettings['windowsTerminalBackend']) => void;
  onDistribution: (value: string) => void;
  modification: (key: Key) => SettingModificationProps;
}) {
  return <>
    {visible('windowsTerminalBackend') ? (
      <SelectField
        label='Windows Environment'
        description='PowerShell runs native Windows projects and agents without WSL. WSL uses your Linux projects. Restart Ghostex after changing environments; existing sessions stay in their original environment.'
        options={[{ label: 'PowerShell (native Windows)', value: 'powershell' }, { label: 'WSL (Linux)', value: 'wsl' }]}
        value={settings.windowsTerminalBackend}
        onChange={(value) => onBackend(value === 'powershell' ? 'powershell' : 'wsl')}
        {...modification('windowsTerminalBackend')}
      />
    ) : null}
    {settings.windowsTerminalBackend === 'wsl' && visible('windowsWslDistribution') ? (
      <TextField
        description='Leave blank to use an initialized WSL2 distribution, or enter its exact name from wsl.exe --list --verbose.'
        label='WSL Distribution'
        placeholder='Automatic'
        value={settings.windowsWslDistribution}
        onChange={onDistribution}
        {...modification('windowsWslDistribution')}
      />
    ) : null}
  </>;
}
