[CmdletBinding()]
param(
    [ValidateSet("stable", "ptb", "canary")]
    [string]$Branch = "stable",

    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "RandomFavoritesVencord"),

    [string]$VencordRepository = "https://github.com/Vendicated/Vencord.git",

    [string]$PluginRepository = "https://github.com/Yuzuctus/RandomFavorites.git",

    [switch]$SkipInject,

    [switch]$SkipRestart,

    [switch]$NonInteractive,

    [switch]$ShowDetails
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$script:TranscriptStarted = $false
$script:LogPath = $null
$script:TechnicalLogPath = $null
$script:ResolvedInstallRoot = $null
$script:BootstrapDirectory = $null
$script:GitExecutable = $null
$script:NodeExecutable = $null
$script:NpmExecutable = $null
$script:OriginalPath = $env:Path
$script:IsFrench = [Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq "fr"
$script:RunTimer = [Diagnostics.Stopwatch]::StartNew()
$script:CommandCounter = 0
$script:CurrentStage = $null
$script:Completed = $false
$script:UpdateLauncherPath = $null
$script:InstalledToDiscord = $false

function Get-UiText {
    param(
        [string]$English,
        [string]$French
    )

    if ($script:IsFrench) {
        return $French
    }

    return $English
}

function Format-Elapsed {
    param([TimeSpan]$Elapsed)

    if ($Elapsed.TotalHours -ge 1) {
        return "{0:00}:{1:00}:{2:00}" -f [int]$Elapsed.TotalHours, $Elapsed.Minutes, $Elapsed.Seconds
    }

    return "{0:00}:{1:00}" -f [int]$Elapsed.TotalMinutes, $Elapsed.Seconds
}

function Write-TechnicalLog {
    param([string]$Message)

    if (-not $script:TechnicalLogPath) {
        return
    }

    $timestamp = [DateTime]::Now.ToString("yyyy-MM-dd HH:mm:ss")
    Add-Content -LiteralPath $script:TechnicalLogPath -Value "[$timestamp] $Message" -Encoding UTF8
}

function Write-Banner {
    Write-Host ""
    Write-Host "  +----------------------------------------------------------+" -ForegroundColor DarkCyan
    Write-Host "  |                    RANDOMFAVORITES                       |" -ForegroundColor Cyan
    Write-Host "  |  $(Get-UiText "Simple Vencord installation and update" "Installation et mise a jour simple de Vencord")".PadRight(59).Substring(0, 59) -NoNewline -ForegroundColor White
    Write-Host "|" -ForegroundColor DarkCyan
    Write-Host "  +----------------------------------------------------------+" -ForegroundColor DarkCyan
    Write-Host ""
}

function Write-Step {
    param(
        [int]$Number,
        [int]$Total,
        [string]$Message,
        [string]$Explanation
    )

    $percent = [Math]::Floor(($Number / $Total) * 100)
    $filled = [Math]::Floor(($Number / $Total) * 24)
    $bar = ("#" * $filled).PadRight(24, "-")
    $timer = [Diagnostics.Stopwatch]::StartNew()

    Write-Host ""
    Write-Host "  [$bar] $percent%  $(Get-UiText "Step" "Etape") $Number/$Total" -ForegroundColor Cyan
    Write-Host "  $Message" -ForegroundColor White
    Write-Host "  $Explanation" -ForegroundColor DarkGray
    Write-TechnicalLog "STAGE $Number/$Total - $Message - $Explanation"
    $script:CurrentStage = $Message

    return $timer
}

function Complete-Step {
    param([Diagnostics.Stopwatch]$Timer)

    $Timer.Stop()
    Write-Host "  [OK] $(Get-UiText "Completed in" "Termine en") $(Format-Elapsed $Timer.Elapsed)" -ForegroundColor Green
}

function Write-FinalSuccess {
    param(
        [string]$UpdateLauncher,
        [bool]$InstalledToDiscord
    )

    Write-Host ""
    Write-Host "  +----------------------------------------------------------+" -ForegroundColor Green
    Write-Host "  |  $(Get-UiText "INSTALLATION COMPLETED" "INSTALLATION TERMINEE")".PadRight(59).Substring(0, 59) -NoNewline -ForegroundColor Green
    Write-Host "|" -ForegroundColor Green
    Write-Host "  +----------------------------------------------------------+" -ForegroundColor Green
    if ($InstalledToDiscord) {
        Write-Host "  $(Get-UiText "Discord is ready with RandomFavorites." "Discord est pret avec RandomFavorites.")" -ForegroundColor White
    } else {
        Write-Host "  $(Get-UiText "The build is ready. Discord was not modified." "La compilation est prete. Discord n'a pas ete modifie.")" -ForegroundColor White
    }
    Write-Host "  $(Get-UiText "Total time:" "Temps total :") $(Format-Elapsed $script:RunTimer.Elapsed)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  $(Get-UiText "For future updates, double-click:" "Pour les prochaines mises a jour, double-clique :")" -ForegroundColor White
    Write-Host "  $UpdateLauncher" -ForegroundColor Cyan
    if ($script:TechnicalLogPath) {
        Write-Host ""
        Write-Host "  $(Get-UiText "Diagnostic log:" "Journal de diagnostic :") $script:TechnicalLogPath" -ForegroundColor DarkGray
    }
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

    $formattedCommand = Format-Command $FilePath $Arguments
    Write-TechnicalLog "COMMAND: $formattedCommand"

    $script:CommandCounter++
    $commandLog = "$script:TechnicalLogPath.command-$($script:CommandCounter).tmp"

    if ($WorkingDirectory) {
        Push-Location -LiteralPath $WorkingDirectory
    }

    try {
        $previousErrorPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            & $FilePath @Arguments *> $commandLog
        } finally {
            $ErrorActionPreference = $previousErrorPreference
        }
        $exitCode = $LASTEXITCODE
        $output = if (Test-Path -LiteralPath $commandLog) {
            Get-Content -LiteralPath $commandLog -Raw -ErrorAction SilentlyContinue
        } else {
            ""
        }

        if (-not [string]::IsNullOrWhiteSpace($output)) {
            Add-Content -LiteralPath $script:TechnicalLogPath -Value $output -Encoding UTF8
            if ($ShowDetails) {
                Write-Host $output.TrimEnd() -ForegroundColor DarkGray
            }
        }

        if ($exitCode -ne 0) {
            Write-TechnicalLog "COMMAND FAILED with exit code $exitCode`: $formattedCommand"
            throw (Get-UiText `
                "A technical command stopped unexpectedly (code $exitCode). See the diagnostic log below." `
                "Une commande technique s'est arretee de facon inattendue (code $exitCode). Consulte le journal de diagnostic ci-dessous.")
        }
    } finally {
        if (Test-Path -LiteralPath $commandLog) {
            Remove-Item -LiteralPath $commandLog -Force
        }
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
        $formattedCommand = Format-Command $FilePath $Arguments
        Write-TechnicalLog "COMMAND (capture): $formattedCommand"
        $previousErrorPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $output = & $FilePath @Arguments 2>&1
        } finally {
            $ErrorActionPreference = $previousErrorPreference
        }
        $exitCode = $LASTEXITCODE
        $outputText = ($output | Out-String).Trim()
        if (-not [string]::IsNullOrWhiteSpace($outputText)) {
            Write-TechnicalLog "OUTPUT: $outputText"
        }

        if ($exitCode -ne 0) {
            Write-TechnicalLog "COMMAND FAILED with exit code $exitCode`: $formattedCommand"
            throw (Get-UiText `
                "A technical command stopped unexpectedly (code $exitCode). See the diagnostic log below." `
                "Une commande technique s'est arretee de facon inattendue (code $exitCode). Consulte le journal de diagnostic ci-dessous.")
        }

        return $outputText
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

    Write-TechnicalLog "DOWNLOAD: $Uri -> $Destination"
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

    Write-TechnicalLog "Git was not found; using temporary MinGit $($release.tag_name)."
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
        Write-TechnicalLog "Reusing the existing Git installation."
    } else {
        $script:GitExecutable = Install-PortableGit $script:BootstrapDirectory
        $env:Path = "$(Split-Path -Parent $script:GitExecutable);$env:Path"
    }

    $version = Invoke-ExternalCapture $script:GitExecutable @("--version")
    Write-TechnicalLog "Git version: $version"
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

    Write-TechnicalLog "A compatible Node.js was not found; using temporary Node.js $version."
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
        Write-TechnicalLog "Reusing the existing Node.js installation."
    } else {
        $portableNode = Install-PortableNode $RequiredMajor $script:BootstrapDirectory
        $script:NodeExecutable = $portableNode.NodeExecutable
        $script:NpmExecutable = $portableNode.NpmExecutable
        $env:Path = "$($portableNode.NodeDirectory);$env:Path"
    }

    $version = Invoke-ExternalCapture $script:NodeExecutable @("--version")
    Write-TechnicalLog "Node.js version: $version"
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

        Write-TechnicalLog "Updating $DisplayName."
        Invoke-External $script:GitExecutable @("-C", $Destination, "pull", "--ff-only")
        return
    }

    $parent = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    Write-TechnicalLog "Installing $DisplayName."
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
            Write-TechnicalLog "Reusing pnpm $existingVersion."
            return $existingPnpm.Source
        }
    }

    if (-not (Test-Path -LiteralPath $ToolsDirectory)) {
        New-Item -ItemType Directory -Path $ToolsDirectory -Force | Out-Null
    }

    Write-TechnicalLog "Installing the Vencord-required pnpm $Version temporarily."
    Invoke-External $script:NpmExecutable @(
        "install",
        "--prefix", $ToolsDirectory,
        "--no-save",
        "--no-package-lock",
        "pnpm@$Version"
    )

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

    Write-TechnicalLog "Closing $processName so the Vencord installer can patch it."
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

    Write-TechnicalLog "Restarting $processName."
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
        "title RandomFavorites - Mise a jour",
        "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"%~dp0manager\RandomFavoritesManager.ps1`" -InstallRoot `"%~dp0.`" %*",
        "set `"EXIT_CODE=%ERRORLEVEL%`"",
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

    Write-TechnicalLog "Removing temporary Git, Node.js and pnpm tools."
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

    $runId = [DateTime]::Now.ToString("yyyyMMdd-HHmmss")
    $script:LogPath = Join-Path $logsDirectory "manager-$runId.log"
    $script:TechnicalLogPath = Join-Path $logsDirectory "details-$runId.log"
    New-Item -ItemType File -Path $script:TechnicalLogPath -Force | Out-Null
    try {
        Start-Transcript -LiteralPath $script:LogPath -Force | Out-Null
        $script:TranscriptStarted = $true
    } catch {
        Write-TechnicalLog "The UI transcript could not be started: $($_.Exception.Message)"
    }

    Write-TechnicalLog "Install root: $resolvedRoot"
    Write-TechnicalLog "Discord branch: $Branch"
    Write-TechnicalLog "Vencord repository: $VencordRepository"
    Write-TechnicalLog "Plugin repository: $PluginRepository"

    Write-Host "  $(Get-UiText "Installation folder:" "Dossier d'installation :") $resolvedRoot" -ForegroundColor DarkGray
    Write-Host "  $(Get-UiText "Discord version:" "Version de Discord :") $Branch" -ForegroundColor DarkGray
    Write-Host ""

    if (-not $NonInteractive) {
        Write-Host "  $(Get-UiText "Discord stays open while files are prepared." "Discord reste ouvert pendant la preparation des fichiers.")" -ForegroundColor White
        Write-Host "  $(Get-UiText "It will close only during the final installation, then restart automatically." "Il se fermera seulement pendant l'installation finale, puis redemarrera automatiquement.")" -ForegroundColor White
        Write-Host ""
        $answer = Read-Host "  $(Get-UiText "Continue? [Y/n]" "Continuer ? [O/n]")"
        if ($answer -and $answer -notmatch "^(y|yes|o|oui)$") {
            Write-Host "  $(Get-UiText "Installation cancelled. Nothing was changed." "Installation annulee. Rien n'a ete modifie.")" -ForegroundColor Yellow
            Write-TechnicalLog "Installation cancelled by the user."
            return
        }
    }

    $stageTimer = Write-Step 1 7 `
        (Get-UiText "Preparing the installer" "Preparation de l'installateur") `
        (Get-UiText "Checking the tools needed for a safe installation." "Verification des outils necessaires a une installation sure.")
    Ensure-Git
    Complete-Step $stageTimer

    $stageTimer = Write-Step 2 7 `
        (Get-UiText "Preparing Vencord" "Preparation de Vencord") `
        (Get-UiText "Downloading or updating the official Vencord source code." "Telechargement ou mise a jour du code officiel de Vencord.")
    Update-Repository $VencordRepository $vencordDirectory "Vencord"
    $requirements = Get-VencordRequirements $vencordDirectory
    Complete-Step $stageTimer

    $stageTimer = Write-Step 3 7 `
        (Get-UiText "Preparing build tools" "Preparation des outils de compilation") `
        (Get-UiText "Reusing compatible tools or preparing temporary portable copies." "Reutilisation des outils compatibles ou preparation de copies portables temporaires.")
    Ensure-Node $requirements.NodeMajor
    $pnpmToolsDirectory = Join-Path $bootstrapDirectory "pnpm"
    $pnpm = Resolve-Pnpm $requirements.PnpmVersion $pnpmToolsDirectory
    Complete-Step $stageTimer

    $stageTimer = Write-Step 4 7 `
        (Get-UiText "Updating RandomFavorites" "Mise a jour de RandomFavorites") `
        (Get-UiText "Fetching the newest public version of the plugin." "Recuperation de la derniere version publique du plugin.")
    $userPluginsDirectory = Split-Path -Parent $pluginDirectory
    if (-not (Test-Path -LiteralPath $userPluginsDirectory)) {
        New-Item -ItemType Directory -Path $userPluginsDirectory -Force | Out-Null
    }
    Update-Repository $PluginRepository $pluginDirectory "RandomFavorites"
    Complete-Step $stageTimer

    $stageTimer = Write-Step 5 7 `
        (Get-UiText "Preparing dependencies" "Preparation des dependances") `
        (Get-UiText "Checking the exact files required to build Vencord." "Verification des fichiers exacts necessaires a la compilation de Vencord.")
    Invoke-External $pnpm @("install", "--frozen-lockfile") $vencordDirectory
    Complete-Step $stageTimer

    $stageTimer = Write-Step 6 7 `
        (Get-UiText "Building the custom Discord mod" "Compilation du mod Discord personnalise") `
        (Get-UiText "Creating Vencord with RandomFavorites included. This can take a moment." "Creation de Vencord avec RandomFavorites inclus. Cette etape peut prendre un moment.")
    Invoke-External $pnpm @("build") $vencordDirectory

    $patcherPath = Join-Path $vencordDirectory "dist\patcher.js"
    $rendererPath = Join-Path $vencordDirectory "dist\renderer.js"
    if (-not (Test-Path -LiteralPath $patcherPath) -or -not (Test-Path -LiteralPath $rendererPath)) {
        throw "The build command completed but the expected Vencord files are missing."
    }
    Complete-Step $stageTimer

    $stageTimer = Write-Step 7 7 `
        (Get-UiText "Installing into Discord" "Installation dans Discord") `
        (Get-UiText "Discord closes only now, then restarts automatically." "Discord se ferme seulement maintenant, puis redemarre automatiquement.")
    if ($SkipInject) {
        Write-Host "  $(Get-UiText "Discord modification skipped by command-line option." "Modification de Discord ignoree par option de ligne de commande.")" -ForegroundColor Yellow
        Write-TechnicalLog "Discord injection skipped by command-line option."
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

    $updateLauncher = Join-Path $resolvedRoot "Update RandomFavorites.cmd"
    Write-UpdateLauncher $resolvedRoot $pluginDirectory
    Write-State $resolvedRoot $vencordDirectory $pluginDirectory $Branch
    Complete-Step $stageTimer

    $script:UpdateLauncherPath = $updateLauncher
    $script:InstalledToDiscord = -not $SkipInject
    $script:Completed = $true
}

$exitCode = 0
try {
    Main
} catch {
    $exitCode = 1
    Write-TechnicalLog "ERROR: $($_.Exception.ToString())"
    Write-Host ""
    Write-Host "  +----------------------------------------------------------+" -ForegroundColor Red
    Write-Host "  |  $(Get-UiText "INSTALLATION FAILED" "ECHEC DE L'INSTALLATION")".PadRight(59).Substring(0, 59) -NoNewline -ForegroundColor Red
    Write-Host "|" -ForegroundColor Red
    Write-Host "  +----------------------------------------------------------+" -ForegroundColor Red
    if ($script:CurrentStage) {
        Write-Host "  $(Get-UiText "Stage:" "Etape :") $script:CurrentStage" -ForegroundColor Yellow
    }
    Write-Host "  $(Get-UiText "Reason:" "Raison :") $($_.Exception.Message)" -ForegroundColor White
    Write-Host ""
    Write-Host "  $(Get-UiText "Discord was not closed unless the final installation stage had started." "Discord n'a pas ete ferme sauf si l'etape finale d'installation avait commence.")" -ForegroundColor DarkGray
    Write-Host "  $(Get-UiText "Diagnostic log:" "Journal de diagnostic :") $script:TechnicalLogPath" -ForegroundColor Yellow
} finally {
    try {
        Remove-BootstrapTools
    } catch {
        $exitCode = 1
        Write-TechnicalLog "ERROR while removing temporary tools: $($_.Exception.ToString())"
        Write-Host "  $(Get-UiText "Temporary-tool cleanup failed:" "Le nettoyage des outils temporaires a echoue :") $($_.Exception.Message)" -ForegroundColor Red
    }
    $env:Path = $script:OriginalPath

    if ($script:TranscriptStarted) {
        Stop-Transcript | Out-Null
    }
}

if ($exitCode -eq 0 -and $script:Completed) {
    Write-FinalSuccess $script:UpdateLauncherPath $script:InstalledToDiscord
}

exit $exitCode
