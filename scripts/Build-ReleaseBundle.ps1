[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RandomFavoritesDirectory,

    [Parameter(Mandatory = $true)]
    [string]$VencordDirectory,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [Parameter(Mandatory = $true)]
    [ValidatePattern("^v[0-9]+\.[0-9]+\.[0-9]+$")]
    [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Resolve-ExistingDirectory {
    param([string]$Path, [string]$DisplayName)

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$DisplayName directory was not found at '$Path'."
    }

    return [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).Path)
}

function Get-GitCommit {
    param([string]$RepositoryDirectory)

    $commit = & git -C $RepositoryDirectory rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($commit)) {
        throw "Could not resolve the Git commit for '$RepositoryDirectory'."
    }

    return $commit.Trim()
}

$randomFavoritesRoot = Resolve-ExistingDirectory $RandomFavoritesDirectory "RandomFavorites"
$vencordRoot = Resolve-ExistingDirectory $VencordDirectory "Vencord"
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$stagingRoot = Join-Path $outputRoot (".bundle-" + [Guid]::NewGuid().ToString("N"))
$distRoot = Join-Path $stagingRoot "dist"
$toolsRoot = Join-Path $stagingRoot "tools"
$licensesRoot = Join-Path $stagingRoot "licenses"
$bundlePath = Join-Path $outputRoot "RandomFavoritesBundle.zip"

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
New-Item -ItemType Directory -Force -Path $distRoot, $toolsRoot, $licensesRoot | Out-Null

try {
    Get-ChildItem -LiteralPath (Join-Path $vencordRoot "dist") -File |
        Where-Object { $_.Name -match '^(package\.json|patcher\.|preload\.|renderer\.)' } |
        Copy-Item -Destination $distRoot -Force

    $requiredDistFiles = @("patcher.js", "preload.js", "renderer.js", "renderer.css")
    foreach ($requiredFile in $requiredDistFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $distRoot $requiredFile) -PathType Leaf)) {
            throw "The compiled Vencord file '$requiredFile' is missing."
        }
    }

    $officialInstallerPath = Join-Path $toolsRoot "VencordInstallerCli.exe"
    $officialChecksumsPath = Join-Path $toolsRoot "checksums.sha256"
    Invoke-WebRequest `
        -Uri "https://github.com/Vencord/Installer/releases/latest/download/VencordInstallerCli.exe" `
        -OutFile $officialInstallerPath `
        -UseBasicParsing
    Invoke-WebRequest `
        -Uri "https://github.com/Vencord/Installer/releases/latest/download/checksums.sha256" `
        -OutFile $officialChecksumsPath `
        -UseBasicParsing

    $checksumLine = Get-Content -LiteralPath $officialChecksumsPath |
        Where-Object { $_ -match '\sVencordInstallerCli\.exe$' } |
        Select-Object -First 1
    if (-not $checksumLine) {
        throw "VencordInstallerCli.exe is missing from the official checksum file."
    }

    $expectedInstallerHash = ($checksumLine -split '\s+')[0]
    $actualInstallerHash = (Get-FileHash -LiteralPath $officialInstallerPath -Algorithm SHA256).Hash
    if ($actualInstallerHash -ne $expectedInstallerHash) {
        throw "The official Vencord installer checksum does not match."
    }
    Remove-Item -LiteralPath $officialChecksumsPath

    Invoke-WebRequest `
        -Uri "https://raw.githubusercontent.com/Vencord/Installer/main/LICENSE" `
        -OutFile (Join-Path $licensesRoot "Vencord-Installer-LICENSE") `
        -UseBasicParsing
    Copy-Item `
        -LiteralPath (Join-Path $vencordRoot "LICENSE") `
        -Destination (Join-Path $licensesRoot "Vencord-LICENSE")
    Copy-Item `
        -LiteralPath (Join-Path $randomFavoritesRoot "LICENSE") `
        -Destination (Join-Path $licensesRoot "RandomFavorites-LICENSE")
    Copy-Item `
        -LiteralPath (Join-Path $randomFavoritesRoot "installer\THIRD_PARTY_NOTICES.md") `
        -Destination $stagingRoot

    $manifest = [ordered]@{
        version = $Version
        vencordCommit = Get-GitCommit $vencordRoot
        pluginCommit = Get-GitCommit $randomFavoritesRoot
        builtAtUtc = [DateTimeOffset]::UtcNow.ToString("o")
        requiredFiles = @(
            "dist/patcher.js"
            "dist/preload.js"
            "dist/renderer.js"
            "dist/renderer.css"
            "tools/VencordInstallerCli.exe"
        )
    }
    $manifestPath = Join-Path $stagingRoot "manifest.json"
    $manifest | ConvertTo-Json -Depth 4 |
        Set-Content -LiteralPath $manifestPath -Encoding utf8
    Copy-Item `
        -LiteralPath $manifestPath `
        -Destination (Join-Path $outputRoot "RandomFavoritesBundle.manifest.json") `
        -Force

    Compress-Archive `
        -Path (Join-Path $stagingRoot "*") `
        -DestinationPath $bundlePath `
        -CompressionLevel Optimal `
        -Force
    $bundleHash = (Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash.ToLowerInvariant()
    "$bundleHash  RandomFavoritesBundle.zip" |
        Set-Content -LiteralPath "$bundlePath.sha256" -Encoding ascii -NoNewline

    Write-Host "Built $bundlePath"
    Write-Host "Vencord commit: $($manifest.vencordCommit)"
    Write-Host "RandomFavorites commit: $($manifest.pluginCommit)"
} finally {
    $resolvedStaging = [IO.Path]::GetFullPath($stagingRoot)
    $resolvedOutput = [IO.Path]::GetFullPath($outputRoot).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    if ((Test-Path -LiteralPath $resolvedStaging) -and
        $resolvedStaging.StartsWith(
            $resolvedOutput + [IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase
        )) {
        Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
}
