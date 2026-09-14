param(
    [switch]$SkipDependencies,
    [switch]$SkipCompile
)

$ErrorActionPreference = "Stop"
# Keep esbuild's parallel native bundlers within a practical Windows memory budget.
if (!$env:GOMEMLIMIT) { $env:GOMEMLIMIT = "2GiB" }
if (!$env:GOGC) { $env:GOGC = "50" }
if (!$env:GOMAXPROCS) { $env:GOMAXPROCS = "4" }
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$CodeRoot = Join-Path $RepoRoot ".dependencies/code-server"
$VscodeRoot = Join-Path $CodeRoot "lib/vscode"
$OutputRoot = Join-Path $RepoRoot "apps/desktop/build/native-code-server"
$Platform = (& node -p "process.platform").Trim()
if ($Platform -ne "win32") { throw "The native Windows editor must be built on Windows." }
$Arch = (& node -p "process.arch").Trim()
if ($env:GHOSTEX_WINDOWS_ARCH -and $env:GHOSTEX_WINDOWS_ARCH -ne $Arch) {
    throw "Use native $env:GHOSTEX_WINDOWS_ARCH Node.js to build that Windows editor architecture."
}
if ($LASTEXITCODE -ne 0 -or $Arch -notin @("x64", "arm64")) {
    throw "Building the Windows editor requires native Windows Node.js."
}
if (!(Get-Command signtool.exe -ErrorAction SilentlyContinue)) {
    $SdkRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits/10/bin"
    $SdkBin = Get-ChildItem $SdkRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
        Sort-Object { [version]$_.Name } -Descending |
        ForEach-Object { Join-Path $_.FullName "$Arch" } |
        Where-Object { Test-Path (Join-Path $_ "signtool.exe") } |
        Select-Object -First 1
    if (!$SdkBin) { throw "The Windows SDK signtool.exe is required to package the native editor." }
    $env:PATH = "$SdkBin;$env:PATH"
}
$RequiredNode = (Get-Content (Join-Path $CodeRoot ".node-version") -Raw).Trim()
$NodeVersion = (& node -p "process.versions.node").Trim()
if ($NodeVersion -ne $RequiredNode) {
    throw "The Windows editor requires Node $RequiredNode; found $NodeVersion."
}
$GitPath = (Get-Command git.exe -ErrorAction Stop).Source
$GitRoot = Split-Path (Split-Path $GitPath -Parent) -Parent
$Bash = Join-Path $GitRoot "bin/bash.exe"
if (!(Test-Path $Bash)) { throw "Git for Windows bash.exe was not found beside git.exe." }
if (!(Test-Path (Join-Path $VscodeRoot "package.json"))) {
    throw "Initialize the code-server and nested VS Code submodules before building the Windows editor."
}

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Executable failed with exit code $LASTEXITCODE."
    }
}

$env:VERSION = (Get-Content (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json).version
$Revision = (& git -C $CodeRoot rev-parse HEAD).Trim()
$VscodeRevision = (& git -C $VscodeRoot rev-parse HEAD).Trim()
$SourceDiff = (& git -C $CodeRoot diff --binary HEAD -- src ci patches package.json package-lock.json) -join "\n"
$VscodeDiff = (& git -C $VscodeRoot diff --binary HEAD) -join "\n"
$ScriptHash = (Get-FileHash $PSCommandPath -Algorithm SHA256).Hash
$Inputs = "$Revision|$VscodeRevision|$SourceDiff|$VscodeDiff|$ScriptHash|$NodeVersion|$Arch|$env:VERSION"
$Sha = [Security.Cryptography.SHA256]::Create()
try { $Fingerprint = -join ($Sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Inputs)) | ForEach-Object { $_.ToString("x2") }) }
finally { $Sha.Dispose() }
$Stamp = Join-Path $OutputRoot "ghostex-build-fingerprint"
if (!$SkipCompile -and (Test-Path $Stamp) -and
    (Get-Content $Stamp -Raw).Trim() -eq $Fingerprint -and
    (Test-Path (Join-Path $OutputRoot "lib/node.exe")) -and
    (Test-Path (Join-Path $OutputRoot "lib/vscode/out/server-main.js"))) {
    Write-Host "Native Windows editor is current."
    return
}

Push-Location $CodeRoot
try {
    if (!$SkipDependencies) {
        Invoke-Checked "npm.cmd" @("ci", "--ignore-scripts", "--no-audit", "--no-fund")
        Push-Location $VscodeRoot
        try { Invoke-Checked "npm.cmd" @("ci", "--no-audit", "--no-fund") }
        finally { Pop-Location }
    }
    if (!$SkipCompile) {
        Invoke-Checked "node.exe" @("node_modules/typescript/bin/tsc")
        $env:VSCODE_TARGET = "win32-$Arch"
        $env:MINIFY = "true"
        # Copilot's build rewrites its manifest's whitespace. Preserve source formatting when its JSON is unchanged.
        $CopilotManifest = Join-Path $VscodeRoot "extensions/copilot/package.json"
        $CopilotBytes = [IO.File]::ReadAllBytes($CopilotManifest)
        $CopilotJson = ([Text.Encoding]::UTF8.GetString($CopilotBytes) | ConvertFrom-Json | ConvertTo-Json -Depth 100 -Compress)
        try { Invoke-Checked $Bash @("ci/build/build-vscode.sh") }
        finally {
            $BuiltJson = (Get-Content $CopilotManifest -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 100 -Compress)
            if ($BuiltJson -ceq $CopilotJson) { [IO.File]::WriteAllBytes($CopilotManifest, $CopilotBytes) }
        }
    }
    $VscodeOutput = Join-Path $CodeRoot "lib/vscode-reh-web-win32-$Arch"
    foreach ($path in @("out/server-main.js", "node.exe", "product.json")) {
        if (!(Test-Path (Join-Path $VscodeOutput $path))) {
            throw "The Windows editor build is incomplete: $path"
        }
    }
    # CDXC:CodeEditor 2026-09-14 WHY:
    # Native projects need a Windows REH payload and native Node dependencies, rather than the Linux archive staged for WSL.
    # Stage separately so neither environment can accidentally launch the other's executable files.
    New-Item -ItemType Directory -Force $OutputRoot | Out-Null
    Copy-Item (Join-Path $CodeRoot "out") $OutputRoot -Recurse -Force
    New-Item -ItemType Directory -Force (Join-Path $OutputRoot "lib") | Out-Null
    $TargetVscode = Join-Path $OutputRoot "lib/vscode"
    New-Item -ItemType Directory -Force $TargetVscode | Out-Null
    Copy-Item (Join-Path $VscodeOutput "*") $TargetVscode -Recurse -Force
    Copy-Item (Join-Path $VscodeOutput "node.exe") (Join-Path $OutputRoot "lib/node.exe") -Force
    New-Item -ItemType Directory -Force (Join-Path $OutputRoot "src/browser") | Out-Null
    Copy-Item (Join-Path $CodeRoot "src/browser/*") (Join-Path $OutputRoot "src/browser") -Recurse -Force
    foreach ($name in @("LICENSE", "package.json", "package-lock.json")) {
        Copy-Item (Join-Path $CodeRoot $name) $OutputRoot -Force
    }
    Copy-Item (Join-Path $VscodeRoot "ThirdPartyNotices.txt") $OutputRoot -Force
    Push-Location $OutputRoot
    try {
        Invoke-Checked "npm.cmd" @("ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund")
    }
    finally { Pop-Location }
    # The packaged wrapper reports the same code-server revision as the editor.
    $PackagePath = Join-Path $OutputRoot "package.json"
    $Package = Get-Content $PackagePath -Raw | ConvertFrom-Json
    $Package.version = $env:VERSION
    $Package | Add-Member -NotePropertyName commit -NotePropertyValue ((& git rev-parse HEAD).Trim()) -Force
    [IO.File]::WriteAllText($PackagePath, ($Package | ConvertTo-Json -Depth 100), [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($Stamp, $Fingerprint, [Text.UTF8Encoding]::new($false))
    Write-Host "Native Windows editor staged at $OutputRoot"
}
finally { Pop-Location }
