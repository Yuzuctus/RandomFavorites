[CmdletBinding()]
param(
    [ValidateSet("stable", "ptb", "canary")]
    [string]$Branch = "stable",

    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "RandomFavoritesVencord"),

    [string]$VencordRepository = "https://github.com/Vendicated/Vencord.git",

    [string]$PluginRepository = "https://github.com/Yuzuctus/RandomFavorites.git",

    [switch]$SkipInject,

    [switch]$SkipRestart,

    [switch]$NonInteractive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$script:TranscriptStarted = $false
$script:LogPath = $null
$script:ResolvedInstallRoot = $null
$script:BootstrapDirectory = $null
$script:GitExecutable = $null
$script:NodeExecutable = $null
$script:NpmExecutable = $null
$script:OriginalPath = $env:Path

function Write-Banner {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  RandomFavorites - Vencord installer and update manager" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param(
        [int]$Number,
        [int]$Total,
        [string]$Message
    )

    Write-Host "[$Number/$Total] $Message" -ForegroundColor Cyan
}

function Test-Command {
    param([string]$Name)

    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Format-Command {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )

    $formattedArguments = $Arguments | ForEach-Object {
        if ($_ -match "\s") { '"{0}"' -f $_ } else { $_ }
    }

    return "$FilePath $($formattedArguments -join ' ')"
}

function Invoke-External {
    param(
        [string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory
    )

    Write-Host ("  > " + (Format-Command $FilePath $Arguments)) -ForegroundColor DarkGray

    if ($WorkingDirectory) {
        Push-Location -LiteralPath $WorkingDirectory
    }

    try {
        & $FilePath @Arguments
        $exitCode = $LASTEXITCODE

        if ($exitCode -ne 0) {
            throw "Command failed with exit code $exitCode`: $(Format-Command $FilePath $Arguments)"
        }
    } finally {
        if ($WorkingDirectory) {
            Pop-Location
        }
    }
}

function Invoke-ExternalCapture {
    param(
        [string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory
    )

    if ($WorkingDirectory) {
        Push-Location -LiteralPath $WorkingDirectory
    }

    try {
        $output = & $FilePath @Arguments 2>&1
        $exitCode = $LASTEXITCODE

        if ($exitCode -ne 0) {
            throw "Command failed with exit code $exitCode`: $(Format-Command $FilePath $Arguments)"
        }

        return ($output | Out-String).Trim()
    } finally {
        if ($WorkingDirectory) {
            Pop-Location
        }
    }
}

function Get-WindowsArchitecture {
    $architecture = if ($env:PROCESSOR_ARCHITEW6432) {
        $env:PROCESSOR_ARCHITEW6432
    } else {
        $env:PROCESSOR_ARCHITECTURE
    }

    switch -Regex ($architecture) {
        "ARM64" {
            return [PSCustomObject]@{
                GitAssetSuffix = "arm64"
                NodeArchiveSuffix = "win-arm64"
                NodeFileToken = "win-arm64-zip"
            }
        }
        "AMD64|x86_64" {
            return [PSCustomObject]@{
                GitAssetSuffix = "64-bit"
                NodeArchiveSuffix = "win-x64"
                NodeFileToken = "win-x64-zip"
            }
        }
        default {
            throw "RandomFavorites Manager supports 64-bit x64 and ARM64 Windows installations."
        }
    }
}

function Invoke-Download {
    param(
        [string]$Uri,
        [string]$Destination
    )

    Write-Host "  Downloading $Uri" -ForegroundColor DarkGray
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Destination
}

function Assert-Sha256 {
    param(
        [string]$Path,
        [string]$ExpectedHash
    )

    $actualHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if ($actualHash -ne $ExpectedHash.ToUpperInvariant()) {
        throw "SHA-256 verification failed for '$Path'."
    }
}

function Install-PortableGit {
    param([string]$BootstrapDirectory)

    $architecture = Get-WindowsArchitecture
    $release = Invoke-RestMethod `
        -Uri "https://api.github.com/repos/git-for-windows/git/releases/latest" `
        -Headers @{ "User-Agent" = "RandomFavoritesManager" }

    $assetPattern = "^MinGit-.+-$([regex]::Escape($architecture.GitAssetSuffix))\.zip$"
    $asset = $release.assets |
        Where-Object { $_.name -match $assetPattern -and $_.name -notmatch "busybox" } |
        Select-Object -First 1

    if ($null -eq $asset) {
        throw "The latest Git for Windows release does not contain a compatible MinGit archive."
    }

    $expectedHash = [string]$asset.digest
    if ($expectedHash -notmatch "^sha256:([a-fA-F0-9]{64})$") {
        throw "GitHub did not provide a SHA-256 digest for '$($asset.name)'."
    }
    $expectedHash = $Matches[1]

    $archivePath = Join-Path $BootstrapDirectory $asset.name
    $gitDirectory = Join-Path $BootstrapDirectory "git"

    Write-Host "  Git was not found; using temporary MinGit $($release.tag_name)." -ForegroundColor Yellow
    Invoke-Download $asset.browser_download_url $archivePath
    Assert-Sha256 $archivePath $expectedHash
    Expand-Archive -LiteralPath $archivePath -DestinationPath $gitDirectory -Force

    $gitExecutable = Join-Path $gitDirectory "cmd\git.exe"
    if (-not (Test-Path -LiteralPath $gitExecutable)) {
        throw "The MinGit archive did not contain '$gitExecutable'."
    }

    return $gitExecutable
}

function Ensure-Git {
    $existingGit = Get-Command "git.exe" -ErrorAction SilentlyContinue
    if ($null -ne $existingGit) {
        $script:GitExecutable = $existingGit.Source
        Write-Host "  Reusing the existing Git installation." -ForegroundColor Green
    } else {
        $script:GitExecutable = Install-PortableGit $script:BootstrapDirectory
        $env:Path = "$(Split-Path -Parent $script:GitExecutable);$env:Path"
    }

    $version = Invoke-ExternalCapture $script:GitExecutable @("--version")
    Write-Host "  $version" -ForegroundColor Green
}

function Get-NodeMajorVersion {
    param([string]$NodeExecutable)

    if (-not $NodeExecutable -or -not (Test-Path -LiteralPath $NodeExecutable)) {
        return 0
    }

    $version = Invoke-ExternalCapture $NodeExecutable @("--version")
    if ($version -notmatch "^v(\d+)") {
        return 0
    }

    return [int]$Matches[1]
}

function Install-PortableNode {
    param(
        [int]$RequiredMajor,
        [string]$BootstrapDirectory
    )

    $architecture = Get-WindowsArchitecture
    $nodeIndex = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json"
    $compatibleReleases = @($nodeIndex | Where-Object {
        $major = [int](($_.version -replace "^v", "").Split(".")[0])
        $major -ge $RequiredMajor -and $_.files -contains $architecture.NodeFileToken
    })

    $selectedRelease = $compatibleReleases | Where-Object { $_.lts } | Select-Object -First 1
    if ($null -eq $selectedRelease) {
        $selectedRelease = $compatibleReleases | Select-Object -First 1
    }
    if ($null -eq $selectedRelease) {
        throw "No compatible official Node.js Windows archive satisfies Vencord's Node.js requirement."
    }

    $version = [string]$selectedRelease.version
    $archiveName = "node-$version-$($architecture.NodeArchiveSuffix).zip"
    $releaseUri = "https://nodejs.org/dist/$version"
    $archivePath = Join-Path $BootstrapDirectory $archiveName
    $checksumsPath = Join-Path $BootstrapDirectory "node-SHASUMS256.txt"
    $extractDirectory = Join-Path $BootstrapDirectory "node"

    Write-Host "  A compatible Node.js was not found; using temporary Node.js $version." -ForegroundColor Yellow
    Invoke-Download "$releaseUri/$archiveName" $archivePath
    Invoke-Download "$releaseUri/SHASUMS256.txt" $checksumsPath

    $checksumLine = Get-Content -LiteralPath $checksumsPath |
        Where-Object { $_ -match "^([a-fA-F0-9]{64})\s+$([regex]::Escape($archiveName))$" } |
        Select-Object -First 1
    if (-not $checksumLine -or $checksumLine -notmatch "^([a-fA-F0-9]{64})") {
        throw "The official Node.js checksum file does not contain '$archiveName'."
    }

    Assert-Sha256 $archivePath $Matches[1]
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDirectory -Force

    $nodeDirectory = Join-Path $extractDirectory "node-$version-$($architecture.NodeArchiveSuffix)"
    $nodeExecutable = Join-Path $nodeDirectory "node.exe"
    $npmExecutable = Join-Path $nodeDirectory "npm.cmd"

    if (-not (Test-Path -LiteralPath $nodeExecutable) -or -not (Test-Path -LiteralPath $npmExecutable)) {
        throw "The Node.js archive is incomplete."
    }

    return [PSCustomObject]@{
        NodeExecutable = $nodeExecutable
        NpmExecutable = $npmExecutable
        NodeDirectory = $nodeDirectory
    }
}

function Ensure-Node {
    param([int]$RequiredMajor)

    $existingNode = Get-Command "node.exe" -ErrorAction SilentlyContinue
    $existingNpm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
    $installedMajor = if ($null -ne $existingNode) {
        Get-NodeMajorVersion $existingNode.Source
    } else {
        0
    }

    if ($installedMajor -ge $RequiredMajor -and $null -ne $existingNpm) {
        $script:NodeExecutable = $existingNode.Source
        $script:NpmExecutable = $existingNpm.Source
        Write-Host "  Reusing the existing Node.js installation." -ForegroundColor Green
    } else {
        $portableNode = Install-PortableNode $RequiredMajor $script:BootstrapDirectory
        $script:NodeExecutable = $portableNode.NodeExecutable
        $script:NpmExecutable = $portableNode.NpmExecutable
        $env:Path = "$($portableNode.NodeDirectory);$env:Path"
    }

    $version = Invoke-ExternalCapture $script:NodeExecutable @("--version")
    Write-Host "  Node.js $version" -ForegroundColor Green
}

function Normalize-Repository {
    param([string]$Repository)

    $candidate = $Repository.Trim()
    if (Test-Path -LiteralPath $candidate) {
        return ([IO.Path]::GetFullPath((Resolve-Path -LiteralPath $candidate).Path)).Replace("\", "/").TrimEnd("/").ToLowerInvariant()
    }

    if ($candidate -match "^git@([^:]+):(.+)$") {
        $candidate = "$($Matches[1])/$($Matches[2])"
    }

    $candidate = $candidate -replace "^https?://", ""
    $candidate = $candidate -replace "\.git$", ""
    return $candidate.Replace("\", "/").TrimEnd("/").ToLowerInvariant()
}

function Update-Repository {
    param(
        [string]$Repository,
        [string]$Destination,
        [string]$DisplayName
    )

    if (Test-Path -LiteralPath $Destination) {
        if (-not (Test-Path -LiteralPath (Join-Path $Destination ".git"))) {
            throw "$DisplayName already exists at '$Destination', but it is not a Git repository. Rename that folder and run the manager again."
        }

        $actualRemote = Invoke-ExternalCapture $script:GitExecutable @("-C", $Destination, "remote", "get-url", "origin")
        if ((Normalize-Repository $actualRemote) -ne (Normalize-Repository $Repository)) {
            throw "$DisplayName uses an unexpected Git remote: '$actualRemote'. Expected '$Repository'."
        }

        $trackedChanges = Invoke-ExternalCapture $script:GitExecutable @(
            "-C", $Destination,
            "status",
            "--porcelain",
            "--untracked-files=no"
        )

        if (-not [string]::IsNullOrWhiteSpace($trackedChanges)) {
            throw "$DisplayName contains local tracked changes. They were not overwritten. Commit or revert them, then run the manager again."
        }

        Write-Host "  Updating $DisplayName..." -ForegroundColor White
        Invoke-External $script:GitExecutable @("-C", $Destination, "pull", "--ff-only")
        return
    }

    $parent = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    Write-Host "  Installing $DisplayName..." -ForegroundColor White
    Invoke-External $script:GitExecutable @("clone", $Repository, $Destination)
}

function Get-VencordRequirements {
    param([string]$VencordDirectory)

    $packageJsonPath = Join-Path $VencordDirectory "package.json"
    if (-not (Test-Path -LiteralPath $packageJsonPath)) {
        throw "Vencord package.json was not found at '$packageJsonPath'."
    }

    $packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
    $nodeRange = [string]$packageJson.engines.node
    $packageManager = [string]$packageJson.packageManager

    if ($nodeRange -notmatch "(\d+)") {
        throw "Could not determine the Node.js version required by Vencord."
    }
    $nodeMajor = [int]$Matches[1]

    if ($packageManager -notmatch "^pnpm@(.+)$") {
        throw "Could not determine the pnpm version required by Vencord."
    }
    $pnpmVersion = $Matches[1]

    return [PSCustomObject]@{
        NodeMajor = $nodeMajor
        PnpmVersion = $pnpmVersion
    }
}

function Resolve-Pnpm {
    param(
        [string]$Version,
        [string]$ToolsDirectory
    )

    $existingPnpm = Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue
    if ($null -eq $existingPnpm) {
        $existingPnpm = Get-Command "pnpm" -ErrorAction SilentlyContinue
    }

    if ($null -ne $existingPnpm) {
        $existingVersion = Invoke-ExternalCapture $existingPnpm.Source @("--version")
        if ($existingVersion -eq $Version) {
            Write-Host "  pnpm $existingVersion" -ForegroundColor Green
            return $existingPnpm.Source
        }
    }

    if (-not (Test-Path -LiteralPath $ToolsDirectory)) {
        New-Item -ItemType Directory -Path $ToolsDirectory -Force | Out-Null
    }

    Write-Host "  Installing the Vencord-required pnpm $Version locally..." -ForegroundColor Yellow
    Invoke-External $script:NpmExecutable @(
        "install",
        "--prefix", $ToolsDirectory,
        "--no-save",
        "--no-package-lock",
        "pnpm@$Version"
    ) | Out-Host

    $localPnpm = Join-Path $ToolsDirectory "node_modules\.bin\pnpm.cmd"
    if (-not (Test-Path -LiteralPath $localPnpm)) {
        throw "The local pnpm installation did not create '$localPnpm'."
    }

    return $localPnpm
}

function Get-DiscordProcessName {
    param([string]$DiscordBranch)

    switch ($DiscordBranch) {
        "stable" { return "Discord" }
        "ptb" { return "DiscordPTB" }
        "canary" { return "DiscordCanary" }
    }
}

function Get-DiscordRootName {
    param([string]$DiscordBranch)

    switch ($DiscordBranch) {
        "stable" { return "Discord" }
        "ptb" { return "DiscordPTB" }
        "canary" { return "DiscordCanary" }
    }
}

function Stop-Discord {
    param([string]$DiscordBranch)

    $processName = Get-DiscordProcessName $DiscordBranch
    $processes = @(Get-Process -Name $processName -ErrorAction SilentlyContinue)

    if ($processes.Count -eq 0) {
        return
    }

    Write-Host "  Closing $processName so the Vencord installer can patch it..." -ForegroundColor Yellow
    $processes | Stop-Process -Force
}

function Test-VencordPatch {
    param(
        [string]$DiscordBranch,
        [string]$VencordDirectory
    )

    $discordRoot = Join-Path $env:LOCALAPPDATA (Get-DiscordRootName $DiscordBranch)
    if (-not (Test-Path -LiteralPath $discordRoot)) {
        throw "Discord $DiscordBranch was not found at '$discordRoot'."
    }

    $appAsar = Get-ChildItem -LiteralPath $discordRoot -Directory -Filter "app-*" |
        Sort-Object LastWriteTime -Descending |
        ForEach-Object { Join-Path $_.FullName "resources\app.asar" } |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1

    if (-not $appAsar) {
        throw "Could not find Discord's app.asar for branch '$DiscordBranch'."
    }

    $patchText = Get-Content -LiteralPath $appAsar -Raw
    $expectedPatcher = (Join-Path $VencordDirectory "dist\patcher.js").Replace("\", "\\")

    if (-not $patchText.Contains($expectedPatcher)) {
        throw "Discord was not patched to use the expected Vencord build '$expectedPatcher'."
    }
}

function Start-Discord {
    param([string]$DiscordBranch)

    $discordRoot = Join-Path $env:LOCALAPPDATA (Get-DiscordRootName $DiscordBranch)
    $updateExe = Join-Path $discordRoot "Update.exe"
    $processName = Get-DiscordProcessName $DiscordBranch
    $discordExe = "$processName.exe"

    if (-not (Test-Path -LiteralPath $updateExe)) {
        Write-Host "  Discord restart skipped because '$updateExe' was not found." -ForegroundColor Yellow
        return
    }

    Write-Host "  Restarting $processName..." -ForegroundColor White
    Start-Process -FilePath $updateExe -ArgumentList "--processStart", $discordExe
}

function Write-UpdateLauncher {
    param(
        [string]$RootDirectory,
        [string]$PluginDirectory
    )

    $sourceManager = Join-Path $PluginDirectory "scripts\RandomFavoritesManager.ps1"
    if (-not (Test-Path -LiteralPath $sourceManager)) {
        return
    }

    $managedDirectory = Join-Path $RootDirectory "manager"
    if (-not (Test-Path -LiteralPath $managedDirectory)) {
        New-Item -ItemType Directory -Path $managedDirectory -Force | Out-Null
    }

    $managedScript = Join-Path $managedDirectory "RandomFavoritesManager.ps1"
    Copy-Item -LiteralPath $sourceManager -Destination $managedScript -Force

    $launcherPath = Join-Path $RootDirectory "Update RandomFavorites.cmd"
    if (Test-Path -LiteralPath $launcherPath) {
        return
    }

    $lines = @(
        "@echo off",
        "setlocal",
        "title RandomFavorites - Vencord Manager",
        "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"%~dp0manager\RandomFavoritesManager.ps1`" -InstallRoot `"%~dp0.`" %*",
        "set `"EXIT_CODE=%ERRORLEVEL%`"",
        "echo.",
        "if `"%EXIT_CODE%`"==`"0`" (",
        "    echo RandomFavorites Manager finished successfully.",
        ") else (",
        "    echo RandomFavorites Manager failed with exit code %EXIT_CODE%.",
        ")",
        "if not defined RANDOM_FAVORITES_NO_PAUSE pause",
        "exit /b %EXIT_CODE%"
    )

    [IO.File]::WriteAllLines($launcherPath, $lines, [Text.Encoding]::ASCII)
}

function Write-State {
    param(
        [string]$RootDirectory,
        [string]$VencordDirectory,
        [string]$PluginDirectory,
        [string]$DiscordBranch
    )

    $state = [ordered]@{
        lastSuccessfulRun = [DateTime]::UtcNow.ToString("o")
        branch = $DiscordBranch
        vencordDirectory = $VencordDirectory
        pluginDirectory = $PluginDirectory
        vencordCommit = Invoke-ExternalCapture $script:GitExecutable @("-C", $VencordDirectory, "rev-parse", "HEAD")
        pluginCommit = Invoke-ExternalCapture $script:GitExecutable @("-C", $PluginDirectory, "rev-parse", "HEAD")
    }

    $statePath = Join-Path $RootDirectory "manager-state.json"
    $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
}

function Remove-BootstrapTools {
    if (-not $script:BootstrapDirectory -or -not (Test-Path -LiteralPath $script:BootstrapDirectory)) {
        return
    }

    if (-not $script:ResolvedInstallRoot) {
        throw "Refusing to clean temporary tools because the install root is unknown."
    }

    $resolvedRoot = [IO.Path]::GetFullPath($script:ResolvedInstallRoot).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    $resolvedBootstrap = [IO.Path]::GetFullPath($script:BootstrapDirectory).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    $expectedBootstrap = Join-Path $resolvedRoot ".bootstrap"

    if (-not $resolvedBootstrap.Equals($expectedBootstrap, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove unexpected temporary directory '$resolvedBootstrap'."
    }

    Write-Host "Removing temporary Git, Node.js and pnpm tools..." -ForegroundColor DarkGray
    Remove-Item -LiteralPath $resolvedBootstrap -Recurse -Force
}

function Main {
    Write-Banner

    $resolvedRoot = [IO.Path]::GetFullPath($InstallRoot)
    $vencordDirectory = Join-Path $resolvedRoot "Vencord"
    $pluginDirectory = Join-Path $vencordDirectory "src\userplugins\randomFavorites"
    $bootstrapDirectory = Join-Path $resolvedRoot ".bootstrap"
    $logsDirectory = Join-Path $resolvedRoot "logs"
    $script:ResolvedInstallRoot = $resolvedRoot
    $script:BootstrapDirectory = $bootstrapDirectory

    if (-not (Test-Path -LiteralPath $resolvedRoot)) {
        New-Item -ItemType Directory -Path $resolvedRoot -Force | Out-Null
    }
    if (-not (Test-Path -LiteralPath $logsDirectory)) {
        New-Item -ItemType Directory -Path $logsDirectory -Force | Out-Null
    }
    if (-not (Test-Path -LiteralPath $bootstrapDirectory)) {
        New-Item -ItemType Directory -Path $bootstrapDirectory -Force | Out-Null
    }

    $script:LogPath = Join-Path $logsDirectory ("manager-{0}.log" -f [DateTime]::Now.ToString("yyyyMMdd-HHmmss"))
    try {
        Start-Transcript -LiteralPath $script:LogPath -Force | Out-Null
        $script:TranscriptStarted = $true
    } catch {
        Write-Host "Warning: the transcript log could not be started: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    Write-Host "Install folder : $resolvedRoot"
    Write-Host "Discord branch: $Branch"
    Write-Host ""

    if (-not $NonInteractive) {
        Write-Host "This manager downloads source code, compiles Vencord, closes Discord during injection, and restarts it." -ForegroundColor Yellow
        $answer = Read-Host "Continue? [Y/n]"
        if ($answer -and $answer -notmatch "^(y|yes|o|oui)$") {
            Write-Host "Cancelled."
            return
        }
    }

    Write-Step 1 7 "Checking Git (temporary portable copy if needed)"
    Ensure-Git

    Write-Step 2 7 "Installing or updating Vencord"
    Update-Repository $VencordRepository $vencordDirectory "Vencord"

    $requirements = Get-VencordRequirements $vencordDirectory

    Write-Step 3 7 "Checking Node.js and pnpm (temporary portable copies if needed)"
    Ensure-Node $requirements.NodeMajor
    $pnpmToolsDirectory = Join-Path $bootstrapDirectory "pnpm"
    $pnpm = Resolve-Pnpm $requirements.PnpmVersion $pnpmToolsDirectory

    Write-Step 4 7 "Installing or updating RandomFavorites"
    $userPluginsDirectory = Split-Path -Parent $pluginDirectory
    if (-not (Test-Path -LiteralPath $userPluginsDirectory)) {
        New-Item -ItemType Directory -Path $userPluginsDirectory -Force | Out-Null
    }
    Update-Repository $PluginRepository $pluginDirectory "RandomFavorites"

    Write-Step 5 7 "Installing Vencord dependencies"
    Invoke-External $pnpm @("install", "--frozen-lockfile") $vencordDirectory

    Write-Step 6 7 "Compiling Vencord with RandomFavorites"
    Invoke-External $pnpm @("build") $vencordDirectory

    $patcherPath = Join-Path $vencordDirectory "dist\patcher.js"
    $rendererPath = Join-Path $vencordDirectory "dist\renderer.js"
    if (-not (Test-Path -LiteralPath $patcherPath) -or -not (Test-Path -LiteralPath $rendererPath)) {
        throw "The build command completed but the expected Vencord files are missing."
    }

    Write-Step 7 7 "Injecting the custom Vencord build"
    if ($SkipInject) {
        Write-Host "  Injection skipped by command-line option." -ForegroundColor Yellow
    } else {
        Stop-Discord $Branch
        Invoke-External $script:NodeExecutable @(
            "scripts\runInstaller.mjs",
            "--",
            "--install",
            "-branch", $Branch
        ) $vencordDirectory
        Test-VencordPatch $Branch $vencordDirectory

        if (-not $SkipRestart) {
            Start-Discord $Branch
        }
    }

    Write-UpdateLauncher $resolvedRoot $pluginDirectory
    Write-State $resolvedRoot $vencordDirectory $pluginDirectory $Branch

    Write-Host ""
    Write-Host "RandomFavorites is installed and up to date." -ForegroundColor Green
    Write-Host "Run '$(Join-Path $resolvedRoot "Update RandomFavorites.cmd")' later to update Vencord and the plugin." -ForegroundColor Green
    if ($script:LogPath) {
        Write-Host "Log: $script:LogPath" -ForegroundColor DarkGray
    }
}

$exitCode = 0
try {
    Main
} catch {
    $exitCode = 1
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    if ($script:LogPath) {
        Write-Host "Log: $script:LogPath" -ForegroundColor Yellow
    }
} finally {
    try {
        Remove-BootstrapTools
    } catch {
        $exitCode = 1
        Write-Host "ERROR while removing temporary tools: $($_.Exception.Message)" -ForegroundColor Red
    }
    $env:Path = $script:OriginalPath

    if ($script:TranscriptStarted) {
        Stop-Transcript | Out-Null
    }
}

exit $exitCode
