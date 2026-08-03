param(
    [Parameter(Mandatory = $true)][string]$Version,
    [ValidateSet("x64", "arm64")][string]$Arch = "x64",
    [string]$Output = ""
)

$ErrorActionPreference = "Stop"
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Version must be MAJOR.MINOR.PATCH, got $Version"
}
$NativeArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
$ExpectedNativeArch = if ($Arch -eq "arm64") { "arm64" } else { "x64" }
if ($NativeArch -ne $ExpectedNativeArch) {
    throw "Windows $Arch releases require a native $ExpectedNativeArch runner; this runner is $NativeArch"
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "../..")
if (-not $Output) {
    $Output = Join-Path $RepoRoot "build/release-gpui/$Version/windows-$Arch"
}
$AllowedRoot = Join-Path $RepoRoot "build/release-gpui"
$ResolvedParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $Output))
if (-not $ResolvedParent.StartsWith([System.IO.Path]::GetFullPath($AllowedRoot))) {
    throw "Release output must stay under $AllowedRoot"
}
if (Test-Path $Output) { Remove-Item -Recurse -Force $Output }
New-Item -ItemType Directory -Force -Path $Output | Out-Null

& bash (Join-Path $ScriptDir "prepare-references.sh")
if ($LASTEXITCODE -ne 0) { throw "GPUI reference preparation failed" }

$env:GHOSTEX_WINDOWS_ARCH = $Arch
$env:GHOSTEX_GPUI_MARKETING_VERSION = $Version
$env:GHOSTEX_ON_DEMAND_ASSETS = "1"
& (Join-Path $RepoRoot "gpui/scripts/build-windows-app.ps1")
if ($LASTEXITCODE -ne 0) { throw "Windows GPUI build failed" }

$AppDir = Join-Path $RepoRoot "gpui/build/windows/Ghostex"
foreach ($required in @("Ghostex.exe", "ghostex-gpui-runtime.exe", "ghostex-gpui-cef-helper.exe")) {
    if (-not (Test-Path (Join-Path $AppDir $required))) {
        throw "Windows staged app is missing $required"
    }
}
if (Test-Path (Join-Path $AppDir "libcef.dll")) {
    throw "Windows release build still bundles libcef.dll"
}
$WslArchive = Join-Path $AppDir "resources/wsl/gxserver-linux-$Arch.tar.gz"
$WslArchiveSha = "$WslArchive.sha256"
$WslCodeServerArchive = Join-Path $AppDir "resources/wsl/code-server-linux-$Arch.tar.gz"
$OnDemandManifestPath = Join-Path $AppDir "resources/on-demand-resources.json"
if (-not (Test-Path $OnDemandManifestPath)) {
    throw "Windows staged app is missing its sealed component manifest"
}
$OnDemandManifest = Get-Content -Raw $OnDemandManifestPath | ConvertFrom-Json
$CefComponent = $OnDemandManifest.components.cef
$CefAsset = $CefComponent.platforms."windows-$Arch"
if (-not $CefComponent.componentVersion -or $CefComponent.downloadTag -ne "cef-$($CefComponent.componentVersion)" -or $CefAsset.sha256 -cnotmatch '^[0-9a-f]{64}$') {
    throw "Windows staged app has an invalid CEF component entry"
}
if ($env:GHOSTEX_WINDOWS_REQUIRE_WSL_RUNTIME -ne "0") {
    if (-not (Test-Path $WslArchive)) {
        throw "Windows staged app is missing its WSL gxserver runtime: $WslArchive"
    }
    if (-not (Test-Path $WslArchiveSha)) {
        throw "Windows staged app is missing its WSL gxserver checksum: $WslArchiveSha"
    }
    $ExpectedWslSha = (Get-Content -Raw $WslArchiveSha).Trim()
    $ActualWslSha = (Get-FileHash -Algorithm SHA256 $WslArchive).Hash.ToLowerInvariant()
    if ($ExpectedWslSha -cnotmatch '^[0-9a-f]{64}$' -or $ExpectedWslSha -cne $ActualWslSha) {
        throw "Windows staged WSL gxserver checksum does not match its runtime archive"
    }
    if (Test-Path $WslCodeServerArchive) {
        throw "Windows staged app still bundles its optional WSL Source runtime"
    }
    $CodeServerComponent = $OnDemandManifest.components.'code-server'
    $CodeServerAsset = $CodeServerComponent.platforms."windows-$Arch"
    if (-not $CodeServerComponent.componentVersion -or $CodeServerAsset.sha256 -cnotmatch '^[0-9a-f]{64}$') {
        throw "Windows staged app has an invalid code-server component entry"
    }
}

$ComponentManifestPath = Join-Path $RepoRoot "build/on-demand-components/components.json"
$ComponentManifest = Get-Content -Raw $ComponentManifestPath | ConvertFrom-Json
$CodeServerComponentVersion = $ComponentManifest.components.'code-server'.componentVersion
$ComponentPublishes = @(
    @{ Name = "cef"; Version = $ComponentManifest.components.cef.componentVersion }
)
if ($CodeServerComponentVersion) {
    $ComponentPublishes += @{ Name = "code-server"; Version = $CodeServerComponentVersion }
}
foreach ($ComponentPublish in $ComponentPublishes) {
    & node (Join-Path $RepoRoot "scripts/release-gpui/publish-component.mjs") `
        --component $ComponentPublish.Name `
        --version $ComponentPublish.Version `
        --asset-dir (Join-Path $RepoRoot "build/on-demand-components/assets") `
        --output $ComponentManifestPath
    if ($LASTEXITCODE -ne 0) { throw "Publishing the Windows $($ComponentPublish.Name) component failed" }
}

$SigningPfx = $env:GHOSTEX_WINDOWS_SIGNING_PFX
$SigningPassword = $env:GHOSTEX_WINDOWS_SIGNING_PASSWORD
$RequireSigning = $env:GHOSTEX_WINDOWS_REQUIRE_SIGNING -ne "0"
if ($RequireSigning -and (-not $SigningPfx -or -not (Test-Path $SigningPfx) -or -not $SigningPassword)) {
    throw "GHOSTEX_WINDOWS_SIGNING_PFX and GHOSTEX_WINDOWS_SIGNING_PASSWORD are required"
}
$SignTool = $null
if ($RequireSigning) {
    $SignTool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe |
        Where-Object { $_.FullName -match "\\$ExpectedNativeArch\\signtool\.exe$" } |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if (-not $SignTool) { throw "A native $ExpectedNativeArch signtool.exe was not found" }
    foreach ($binary in @("Ghostex.exe", "ghostex-gpui-runtime.exe", "ghostex-gpui-cef-helper.exe")) {
        $binaryPath = Join-Path $AppDir $binary
        & $SignTool.FullName sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com /f $SigningPfx /p $SigningPassword $binaryPath
        if ($LASTEXITCODE -ne 0) { throw "Authenticode signing failed for $binary" }
        & $SignTool.FullName verify /pa /all $binaryPath
        if ($LASTEXITCODE -ne 0) { throw "Authenticode verification failed for $binary" }
    }
}

$MakeNsis = Get-Command makensis.exe -ErrorAction SilentlyContinue
if (-not $MakeNsis) {
    throw "makensis.exe is required to create the Windows installer"
}
$Installer = Join-Path $Output "ghostex-$Version-windows-$Arch.exe"
$NsiPath = Join-Path $Output "ghostex-installer.nsi"
$NsiAppDir = $AppDir
$NsiInstaller = $Installer
@"
Unicode True
Name "Ghostex $Version"
OutFile "$NsiInstaller"
InstallDir "`$LOCALAPPDATA\Programs\Ghostex"
RequestExecutionLevel user
SetCompressor /SOLID lzma

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Ghostex"
  SetOutPath "`$INSTDIR"
  File /r "$NsiAppDir\*"
  WriteUninstaller "`$INSTDIR\Uninstall.exe"
  CreateDirectory "`$SMPROGRAMS\Ghostex"
  CreateShortcut "`$SMPROGRAMS\Ghostex\Ghostex.lnk" "`$INSTDIR\Ghostex.exe"
  CreateShortcut "`$DESKTOP\Ghostex.lnk" "`$INSTDIR\Ghostex.exe"
SectionEnd

Section "Uninstall"
  Delete "`$DESKTOP\Ghostex.lnk"
  Delete "`$SMPROGRAMS\Ghostex\Ghostex.lnk"
  RMDir "`$SMPROGRAMS\Ghostex"
  RMDir /r "`$INSTDIR"
SectionEnd
"@ | Set-Content -Encoding UTF8 $NsiPath

& $MakeNsis.Source $NsiPath
if ($LASTEXITCODE -ne 0) { throw "NSIS packaging failed" }
Remove-Item $NsiPath
if (-not (Test-Path $Installer)) { throw "Installer was not produced: $Installer" }
if ($RequireSigning) {
    & $SignTool.FullName sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com /f $SigningPfx /p $SigningPassword $Installer
    if ($LASTEXITCODE -ne 0) { throw "Authenticode signing failed for the installer" }
    & $SignTool.FullName verify /pa /all $Installer
    if ($LASTEXITCODE -ne 0) { throw "Authenticode verification failed for the installer" }
}

$Archive = Join-Path $Output "ghostex-$Version-windows-$Arch-portable.zip"
Compress-Archive -Path (Join-Path $AppDir "*") -DestinationPath $Archive -CompressionLevel Optimal
$Artifacts = @($Installer, $Archive) | ForEach-Object {
    $item = Get-Item $_
    [ordered]@{
        name = $item.Name
        sha256 = (Get-FileHash -Algorithm SHA256 $item.FullName).Hash.ToLowerInvariant()
        size = $item.Length
    }
}
[ordered]@{
    artifacts = $Artifacts
    platform = "windows-$Arch"
    schemaVersion = 1
    version = $Version
} | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $Output "manifest.json")

Write-Host "Built Windows $Arch release payload in $Output"
