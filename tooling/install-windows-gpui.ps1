param(
    [Parameter(Mandatory = $true)]
    [string]$StagedAppPath,

    [switch]$Elevated
)

$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
    return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$StagedAppPath = [IO.Path]::GetFullPath($StagedAppPath)
$StagedExecutable = Join-Path $StagedAppPath "Ghostex.exe"
if (-not (Test-Path -LiteralPath $StagedExecutable -PathType Leaf)) {
    throw "The staged Ghostex executable is missing: $StagedExecutable"
}

if (-not (Test-IsAdministrator)) {
    if ($Elevated) {
        throw "Ghostex installation requires administrator access."
    }

    $Arguments = @(
        "-NoProfile"
        "-ExecutionPolicy"
        "Bypass"
        "-File"
        "`"$PSCommandPath`""
        "-StagedAppPath"
        "`"$StagedAppPath`""
        "-Elevated"
    )
    $Installer = Start-Process `
        -FilePath "powershell.exe" `
        -Verb RunAs `
        -ArgumentList $Arguments `
        -Wait `
        -PassThru
    if ($Installer.ExitCode -ne 0) {
        throw "The elevated Ghostex installer failed with exit code $($Installer.ExitCode)."
    }
    exit 0
}

$ProgramFiles = $env:ProgramW6432
if (-not $ProgramFiles) {
    $ProgramFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
}
if (-not $ProgramFiles) {
    throw "Windows did not report its Program Files directory."
}
$InstallDir = Join-Path $ProgramFiles "Ghostex"
$InstalledExecutable = Join-Path $InstallDir "Ghostex.exe"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
<#
CDXC:Build 2026-09-23 WHY:
The server removes its HTTP endpoint before its workers finish shutting down. Wait for that installed process to exit before copying its executable; loss of the health response alone does not release Windows' image lock.
#>
$InstalledServer = Join-Path $InstallDir "resources/native/gxserver.exe"
foreach ($ServerProcess in @(Get-Process gxserver -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $InstalledServer })) {
    if (-not $ServerProcess.WaitForExit(30000)) {
        throw "The previous gxserver process (pid $($ServerProcess.Id)) has not finished shutting down."
    }
}
$StagedHash = (Get-FileHash -LiteralPath $StagedExecutable -Algorithm SHA256).Hash
<#
CDXC:Build 2026-09-22 WHY:
Persistent Windows sessions keep wmx.exe mapped after the app closes. Windows permits moving that image but cannot overwrite it; retain it outside the mirrored payload so installing a compatible provider preserves live sessions.
#>
$RetiredNativeDir = Join-Path $InstallDir ".retired-native"
$StagedWmx = Join-Path $StagedAppPath "resources/native/wmx.exe"
$InstalledWmx = Join-Path $InstallDir "resources/native/wmx.exe"
if ((Test-Path -LiteralPath $StagedWmx -PathType Leaf) -and (Test-Path -LiteralPath $InstalledWmx -PathType Leaf)) {
    $StagedWmxHash = (Get-FileHash -LiteralPath $StagedWmx -Algorithm SHA256).Hash
    $InstalledWmxHash = (Get-FileHash -LiteralPath $InstalledWmx -Algorithm SHA256).Hash
    if ($StagedWmxHash -ne $InstalledWmxHash) {
        $RetiredVersionDir = Join-Path $RetiredNativeDir ([Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Path $RetiredVersionDir | Out-Null
        Move-Item -LiteralPath $InstalledWmx -Destination (Join-Path $RetiredVersionDir "wmx.exe")
    }
}
& robocopy.exe $StagedAppPath $InstallDir /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XD $RetiredNativeDir
$RobocopyExitCode = $LASTEXITCODE
if ($RobocopyExitCode -gt 7) {
    throw "Installing Ghostex into $InstallDir failed with robocopy exit code $RobocopyExitCode."
}
if (-not (Test-Path -LiteralPath $InstalledExecutable -PathType Leaf)) {
    throw "The installed Ghostex executable is missing: $InstalledExecutable"
}

<#
CDXC:Build 2026-09-20 DECISION:
User: a rebuild must always replace the executable in Program Files, so an install may not report success while
the installed app is still the previous binary. Existence alone cannot tell a fresh copy from one that a
locked file or a skipped mirror entry left behind, so compare the installed executable with the staged one
and name whatever still holds it open.
#>
$InstalledHash = (Get-FileHash -LiteralPath $InstalledExecutable -Algorithm SHA256).Hash
if ($InstalledHash -ne $StagedHash) {
    $Holders = @(
        Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -eq $InstalledExecutable } |
            ForEach-Object { "$($_.ProcessName) (pid $($_.Id))" }
    )
    $Detail = if ($Holders.Count -gt 0) { " Still holding it open: $($Holders -join ', ')." } else { "" }
    throw "$InstalledExecutable still has the previous build after installing (staged $StagedHash, installed $InstalledHash).$Detail"
}
if (Test-Path -LiteralPath $StagedWmx -PathType Leaf) {
    if ((Get-FileHash -LiteralPath $InstalledWmx -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $StagedWmx -Algorithm SHA256).Hash) {
        throw "The installed Windows session provider does not match the rebuilt binary."
    }
}

$ProgramsDir = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonPrograms)
if (-not $ProgramsDir) {
    throw "Windows did not report its all-users Start Menu directory."
}
$ShortcutDir = Join-Path $ProgramsDir "Ghostex"
$ShortcutPath = Join-Path $ShortcutDir "Ghostex.lnk"
New-Item -ItemType Directory -Force -Path $ShortcutDir | Out-Null

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $InstalledExecutable
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.Description = "Ghostex"
$Shortcut.IconLocation = "$InstalledExecutable,0"
$Shortcut.Save()

Write-Host "Installed Ghostex to $InstallDir (Ghostex.exe verified as the rebuilt binary, SHA256 $($StagedHash.Substring(0, 12)))"
Write-Host "Created Start Menu shortcut at $ShortcutPath"
exit 0
