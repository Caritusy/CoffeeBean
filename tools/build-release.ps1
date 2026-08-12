param(
    [string]$Version = "",
    [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))

if ([string]::IsNullOrWhiteSpace($Version)) {
    $manifest = Get-Content -LiteralPath (Join-Path $repoRoot "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $Version = [string]$manifest.version
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repoRoot "dist"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$launcher = Get-ChildItem -LiteralPath $repoRoot -File -Filter "*CoffeeBean.cmd" | Select-Object -First 1
if ($null -eq $launcher) {
    throw "CoffeeBean launcher was not found."
}

$releaseFiles = @(
    "README.md",
    $launcher.Name,
    "background.js",
    "coffee-main.js",
    "content-bridge.js",
    "manifest.json",
    "popup.css",
    "popup.html",
    "popup.js",
    "test/server.mjs",
    "test/serve.ps1",
    "game/iwpc/ADAM_RNG_WEIGHTS.md",
    "game/iwpc/README.md",
    "game/iwpc/game-hitbox.html",
    "game/iwpc/game.html",
    "game/iwpc/godot.js",
    "game/iwpc/index.audio.position.worklet.js",
    "game/iwpc/index.audio.worklet.js",
    "game/iwpc/index.html",
    "game/iwpc/workspace.js",
    "game/iwpc/index.pck",
    "game/iwpc/index.wasm",
    "game/iwpc/index_charge_fast.pck",
    "game/iwpc/index_hitbox.pck"
)

foreach ($relativePath in $releaseFiles) {
    $sourcePath = Join-Path $repoRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Release file is missing: $relativePath"
    }
}

$temporaryParent = Join-Path ([System.IO.Path]::GetTempPath()) ("CoffeeBean-release-" + [guid]::NewGuid().ToString("N"))
$temporaryRoot = Join-Path $temporaryParent "CoffeeBean"
$archivePath = Join-Path $OutputDirectory ("CoffeeBean-v$Version-windows.zip")

try {
    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
    foreach ($relativePath in $releaseFiles) {
        $sourcePath = Join-Path $repoRoot $relativePath
        $destinationPath = Join-Path $temporaryRoot $relativePath
        $destinationParent = Split-Path -Parent $destinationPath
        New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    }

    Compress-Archive -LiteralPath $temporaryRoot -DestinationPath $archivePath -CompressionLevel Optimal -Force
} finally {
    $resolvedTemporaryParent = [System.IO.Path]::GetFullPath($temporaryParent)
    $systemTemporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if ($resolvedTemporaryParent.StartsWith($systemTemporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedTemporaryParent).StartsWith("CoffeeBean-release-")) {
        Remove-Item -LiteralPath $resolvedTemporaryParent -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$archive = Get-Item -LiteralPath $archivePath
Write-Output ("CoffeeBean release: {0} ({1:N2} MB)" -f $archive.FullName, ($archive.Length / 1MB))
