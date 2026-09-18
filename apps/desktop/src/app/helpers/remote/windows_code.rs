use crate::app::helpers::*;
use crate::*;
use std::path::Path;

/// CDXC:CodeEditor 2026-09-14 WHY:
/// Windows Ghostex ships its native editor beside the app. The downloadable
/// windows-x64 component contains the WSL editor, so a PowerShell remote must
/// use its installed native payload instead of uploading that Linux archive.
pub(crate) fn gpui_remote_windows_code_setup() -> String {
    format!(
        r#"{}
$gxApp=Split-Path (Split-Path (Split-Path $gxExe -Parent) -Parent) -Parent
$gxCodeCandidates=@((Join-Path $gxApp 'code-server'), (Join-Path $gxData 'code-server/package'))
$gxCode=$gxCodeCandidates | Where-Object {{ (Test-Path -LiteralPath (Join-Path $_ 'lib/node.exe')) -and (Test-Path -LiteralPath (Join-Path $_ 'lib/vscode/out/server-main.js')) }} | Select-Object -First 1
if (!$gxCode) {{ throw 'The Windows Ghostex installation is missing its native Code editor. Update Ghostex on that machine.' }}
"#,
        gpui_remote_windows_cli_setup()
    )
}

pub(crate) fn gpui_remote_windows_code_launch(project_path: &Path) -> String {
    format!(
        r#"{}
$gxRuntime=Join-Path $gxData 'code-server/runtime'
$gxUserData=Join-Path $gxRuntime 'user-data'
$gxExtensions=Join-Path $gxRuntime 'extensions'
[IO.Directory]::CreateDirectory($gxUserData) | Out-Null
[IO.Directory]::CreateDirectory($gxExtensions) | Out-Null
$gxHash=[Security.Cryptography.SHA256]::Create()
try {{ $gxDigest=$gxHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($gxUserData.Replace('/','\').ToLowerInvariant())) }} finally {{ $gxHash.Dispose() }}
$gxPipe='\\.\pipe\ghostex-code-'+([BitConverter]::ToString($gxDigest).Replace('-','').ToLowerInvariant())
$gxNode=Join-Path $gxCode 'lib/node.exe'
$gxEntry=Join-Path $gxCode 'out/node/entry.js'
$gxStart=[Diagnostics.ProcessStartInfo]::new()
$gxStart.FileName=$gxNode
$gxStart.WorkingDirectory={}
$gxStart.Arguments='"'+$gxEntry+'" --auth none --bind-addr 127.0.0.1:{} --disable-telemetry --disable-update-check --disable-workspace-trust --disable-getting-started-override --ignore-last-opened --app-name "ghostex Code" --user-data-dir "'+$gxUserData+'" --extensions-dir "'+$gxExtensions+'" --session-socket "'+$gxPipe+'"'
$gxStart.UseShellExecute=$false
$gxStart.CreateNoWindow=$true
$gxChild=[Diagnostics.Process]::Start($gxStart)
try {{ $gxChild.WaitForExit(); exit $gxChild.ExitCode }} finally {{ if (!$gxChild.HasExited) {{ $gxChild.Kill() }} }}
"#,
        gpui_remote_windows_code_setup(),
        gpui_powershell_quote(&project_path.to_string_lossy()),
        SOURCE_CODE_SERVER_REMOTE_PORT
    )
}
