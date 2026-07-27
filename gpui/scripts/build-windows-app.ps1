# CDXC:GPUIWindowsBringup 2026-07-04:
# Windows packaging skeleton for the GPUI app, mirroring the shape of
# build-macos-app.sh: build the sidebar bundle, build both Rust binaries,
# then stage a flat CEF-conventional layout. Written best-effort from macOS
# during P2 (Windows bring-up) — NEEDS-DEVICE-VERIFY: never executed on real
# Windows hardware. Deliberately not yet covered here (macOS-script parity
# items to port as Windows support matures): completion sound assets, CLI
# resources, portless admin runtime, remote gxserver Linux packages, updater
# framework, signing/notarization equivalents (signtool), and installer
# creation.
#
# Layout contract (all beside the executable, per CEF Windows conventions —
# libcef.dll, its DLLs, .pak/.dat/.bin resources, and locales/ must live in
# the executable directory):
#   build/windows/Ghostex/
#     Ghostex.exe
#     ghostex-gpui-cef-helper.exe      <- cef/windows.rs sets this as
#                                         browser_subprocess_path (sibling)
#     libcef.dll, chrome_elf.dll, ...  <- CEF Release/ payload
#     icudtl.dat, *.pak, locales/      <- CEF Resources/ payload
#     dist/sidebar/                    <- sidebar bundle; the /dist/sidebar/
#                                         path segment is load-bearing for the
#                                         CEF helper first-party URL check and
#                                         the sidebar_url() Windows arm.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$GpuiDir = Resolve-Path (Join-Path $ScriptDir "..")
$RepoRoot = Resolve-Path (Join-Path $GpuiDir "..")
$AppName = "Ghostex"
$AppDir = Join-Path $GpuiDir "build/windows/$AppName"
$ReleaseArch = if ($env:GHOSTEX_WINDOWS_ARCH) { $env:GHOSTEX_WINDOWS_ARCH } else { "x64" }
if ($ReleaseArch -notin @("x64", "arm64")) {
    throw "GHOSTEX_WINDOWS_ARCH must be x64 or arm64, got $ReleaseArch"
}

# Same CEF cache location contract as build-macos-app.sh: cef-dll-sys's build
# script downloads the CEF binary distribution into CEF_PATH.
$CefCacheDir = Join-Path $GpuiDir "build/cef-cache"
$env:CEF_PATH = $CefCacheDir
$env:ZIG_GLOBAL_CACHE_DIR = Join-Path $RepoRoot "build/zig-global-cache"
New-Item -ItemType Directory -Force -Path $env:ZIG_GLOBAL_CACHE_DIR | Out-Null

# 1) Sidebar bundle (same steps as the macOS script).
Push-Location $RepoRoot
try {
    bun run build:sidebar-css
    if ($LASTEXITCODE -ne 0) { throw "build:sidebar-css failed" }
    bunx vite build --config (Join-Path $GpuiDir "vite.config.ts")
    if ($LASTEXITCODE -ne 0) { throw "vite build failed" }
}
finally {
    Pop-Location
}

# 2) Rust binaries (main app + CEF helper). Requires MSVC toolchain, cmake,
# and ninja (cef-dll-sys builds libcef_dll_wrapper), plus a Zig 0.15.x for
# libghostty-vt (GHOSTEX_ZIG override honored by gpui/build.rs).
Push-Location $GpuiDir
try {
    cargo build --release --bins
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
}
finally {
    Pop-Location
}

# 3) Locate the extracted CEF distribution. cef-dll-sys may export either a
# flat Windows payload or the upstream Release/ + Resources/ layout.
$LibCef = Get-ChildItem -Path $CefCacheDir -Recurse -File -Filter "libcef.dll" |
    Select-Object -First 1
if (-not $LibCef) {
    throw "cef-rs did not produce libcef.dll under $CefCacheDir"
}
$CefRelease = $LibCef.Directory
$CefResources = $CefRelease.FullName
if (-not (Test-Path (Join-Path $CefResources "icudtl.dat"))) {
    $CefResources = Join-Path (Split-Path -Parent $CefRelease.FullName) "Resources"
    if (-not (Test-Path (Join-Path $CefResources "icudtl.dat"))) {
        throw "CEF resources with icudtl.dat were not found beside libcef.dll or at $CefResources"
    }
}

# 4) Stage the app directory. Clear generated contents without deleting the
# directory inode, because a terminal may still have the staged directory as
# its working directory after the previous app process exits.
if (Test-Path $AppDir) {
    Get-ChildItem -LiteralPath $AppDir -Force | Remove-Item -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

Copy-Item (Join-Path $GpuiDir "target/release/ghostex-gpui.exe") (Join-Path $AppDir "Ghostex.exe")
Copy-Item (Join-Path $GpuiDir "target/release/ghostex-gpui-cef-helper.exe") $AppDir
Copy-Item (Join-Path $CefRelease.FullName "*.dll") $AppDir
Copy-Item (Join-Path $CefRelease.FullName "*.pak") $AppDir
Copy-Item (Join-Path $CefRelease.FullName "*.dat") $AppDir
Copy-Item (Join-Path $CefRelease.FullName "*.bin") $AppDir
if ($CefResources -ne $CefRelease.FullName) {
    Copy-Item (Join-Path $CefResources "*.pak") $AppDir
    Copy-Item (Join-Path $CefResources "*.dat") $AppDir
    Copy-Item (Join-Path $CefResources "*.bin") $AppDir
}
$SwiftshaderIcd = @(
    (Join-Path $CefRelease.FullName "vk_swiftshader_icd.json"),
    (Join-Path $CefResources "vk_swiftshader_icd.json")
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($SwiftshaderIcd) { Copy-Item -LiteralPath $SwiftshaderIcd $AppDir }
$Locales = @(
    (Join-Path $CefRelease.FullName "locales"),
    (Join-Path $CefResources "locales")
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $Locales) {
    throw "CEF locales were not found beside libcef.dll or at $CefResources"
}
Copy-Item -Recurse -LiteralPath $Locales -Destination (Join-Path $AppDir "locales")
New-Item -ItemType Directory -Force -Path (Join-Path $AppDir "dist") | Out-Null
Copy-Item -Recurse (Join-Path $GpuiDir "dist/sidebar") (Join-Path $AppDir "dist/sidebar")

# Windows is WSL2-only for now. Every runnable staged app therefore carries the
# matching Linux gxserver+zmx, Source/code-server, and T3 Code runtimes unless
# a diagnostic build explicitly opts out with
# GHOSTEX_WINDOWS_REQUIRE_WSL_RUNTIME=0.
$WslArchive = $env:GHOSTEX_WINDOWS_WSL_GXSERVER_ARCHIVE
$WslCodeServerArchive = $env:GHOSTEX_WINDOWS_WSL_CODE_SERVER_ARCHIVE
$RequireWslArchive = $env:GHOSTEX_WINDOWS_REQUIRE_WSL_RUNTIME -ne "0"
if ($WslArchive -and (Test-Path $WslArchive)) {
    $WslResources = Join-Path $AppDir "resources/wsl"
    New-Item -ItemType Directory -Force -Path $WslResources | Out-Null
    $StagedWslArchive = Join-Path $WslResources "gxserver-linux-$ReleaseArch.tar.gz"
    Copy-Item $WslArchive $StagedWslArchive
    $Sha256 = [Security.Cryptography.SHA256]::Create()
    $ArchiveStream = [IO.File]::OpenRead($StagedWslArchive)
    try {
        $StagedWslSha = -join ($Sha256.ComputeHash($ArchiveStream) | ForEach-Object {
            $_.ToString("x2")
        })
    }
    finally {
        $ArchiveStream.Dispose()
        $Sha256.Dispose()
    }
    [IO.File]::WriteAllText(
        "$StagedWslArchive.sha256",
        "$StagedWslSha`n",
        [Text.UTF8Encoding]::new($false)
    )
}
elseif ($RequireWslArchive) {
    throw "Required WSL gxserver archive is missing: $WslArchive"
}
if ($WslCodeServerArchive -and (Test-Path $WslCodeServerArchive)) {
    $WslSourceEntries = & tar.exe -tzf $WslCodeServerArchive
    if ($LASTEXITCODE -ne 0) {
        throw "The WSL Source runtime archive could not be inspected: $WslCodeServerArchive"
    }
    if (-not ($WslSourceEntries | Where-Object {
        $_ -match '(^|/)t3code-server/dist/bin\.mjs$'
    })) {
        throw "The WSL Source runtime archive does not contain the managed T3 Code entrypoint"
    }
    if (-not ($WslSourceEntries | Where-Object {
        $_ -match '(^|/)t3code-server/lib/node$'
    })) {
        throw "The WSL Source runtime archive does not contain the managed T3 Code Node runtime"
    }
    $WslResources = Join-Path $AppDir "resources/wsl"
    New-Item -ItemType Directory -Force -Path $WslResources | Out-Null
    $StagedCodeServerArchive = Join-Path $WslResources "code-server-linux-$ReleaseArch.tar.gz"
    Copy-Item $WslCodeServerArchive $StagedCodeServerArchive
    $Sha256 = [Security.Cryptography.SHA256]::Create()
    $ArchiveStream = [IO.File]::OpenRead($StagedCodeServerArchive)
    try {
        $StagedCodeServerSha = -join ($Sha256.ComputeHash($ArchiveStream) | ForEach-Object {
            $_.ToString("x2")
        })
    }
    finally {
        $ArchiveStream.Dispose()
        $Sha256.Dispose()
    }
    [IO.File]::WriteAllText(
        "$StagedCodeServerArchive.sha256",
        "$StagedCodeServerSha`n",
        [Text.UTF8Encoding]::new($false)
    )
}
elseif ($RequireWslArchive) {
    throw "Required WSL Source archive is missing: $WslCodeServerArchive"
}

Write-Host "Staged $AppDir"
