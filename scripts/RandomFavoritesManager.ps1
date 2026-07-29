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
$script:OriginalProgressPreference = $ProgressPreference
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.IO.Compression.FileSystem

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
$script:TuiEnabled = $false
$script:TuiInitialized = $false
$script:TuiStages = @()
$script:TuiCurrentStage = 0
$script:TuiStageProgress = 0.0
$script:TuiDetail = ""
$script:TuiOutcome = "running"
$script:TuiTop = 0
$script:TuiHeight = 23
$script:TuiSpinnerIndex = 0
$script:TuiLastRender = [DateTime]::MinValue
$script:TuiOriginalCursorVisible = $true
$script:TuiOriginalForegroundColor = [ConsoleColor]::Gray
$script:TuiOriginalBackgroundColor = [ConsoleColor]::Black

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

function New-TuiStages {
    return @(
        [PSCustomObject]@{
            Number = 1
            Title = Get-UiText "Preparing the installer" "Preparation de l'installateur"
            Explanation = Get-UiText "Checking the tools needed for a safe installation." "Verification des outils necessaires a une installation sure."
            Weight = 10
            State = "Pending"
            StartedAt = $null
            Timer = $null
            Elapsed = [TimeSpan]::Zero
        },
        [PSCustomObject]@{
            Number = 2
            Title = Get-UiText "Preparing Vencord" "Preparation de Vencord"
            Explanation = Get-UiText "Downloading or updating the official Vencord source code." "Telechargement ou mise a jour du code officiel de Vencord."
            Weight = 15
            State = "Pending"
            StartedAt = $null
            Timer = $null
            Elapsed = [TimeSpan]::Zero
        },
        [PSCustomObject]@{
            Number = 3
            Title = Get-UiText "Preparing build tools" "Preparation des outils de compilation"
            Explanation = Get-UiText "Reusing compatible tools or preparing temporary portable copies." "Reutilisation des outils compatibles ou preparation de copies portables temporaires."
            Weight = 15
            State = "Pending"
            StartedAt = $null
            Timer = $null
            Elapsed = [TimeSpan]::Zero
        },
        [PSCustomObject]@{
            Number = 4
            Title = Get-UiText "Updating RandomFavorites" "Mise a jour de RandomFavorites"
            Explanation = Get-UiText "Fetching the newest public version of the plugin." "Recuperation de la derniere version publique du plugin."
            Weight = 10
            State = "Pending"
            StartedAt = $null
            Timer = $null
            Elapsed = [TimeSpan]::Zero
        },
        [PSCustomObject]@{
            Number = 5
            Title = Get-UiText "Preparing dependencies" "Preparation des dependances"
            Explanation = Get-UiText "Checking the exact files required to build Vencord." "Verification des fichiers exacts necessaires a la compilation de Vencord."
            Weight = 20
            State = "Pending"
            StartedAt = $null
            Timer = $null
            Elapsed = [TimeSpan]::Zero
        },
        [PSCustomObject]@{
            Number = 6
            Title = Get-UiText "Building the custom Discord mod" "Compilation du mod Discord personnalise"
            Explanation = Get-UiText "Creating Vencord with RandomFavorites included." "Creation de Vencord avec RandomFavorites inclus."
            Weight = 20
            State = "Pending"
            StartedAt = $null
            Timer = $null
            Elapsed = [TimeSpan]::Zero
        },
        [PSCustomObject]@{
            Number = 7
            Title = Get-UiText "Installing into Discord" "Installation dans Discord"
            Explanation = Get-UiText "Discord closes only now, then restarts automatically." "Discord se ferme seulement maintenant, puis redemarre automatiquement."
            Weight = 10
            State = "Pending"
            StartedAt = $null
            Timer = $null
            Elapsed = [TimeSpan]::Zero
        }
    )
}

function Limit-TuiText {
    param(
        [AllowNull()]
        [string]$Text,
        [int]$Width
    )

    if ($Width -le 0) {
        return ""
    }

    $singleLine = ([string]$Text) -replace "[\r\n]+", " "
    if ($singleLine.Length -le $Width) {
        return $singleLine
    }
    if ($Width -le 3) {
        return $singleLine.Substring(0, $Width)
    }

    return $singleLine.Substring(0, $Width - 3) + "..."
}

function Get-TuiFriendlyPath {
    param([AllowNull()][string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ""
    }

    $resolvedLocalAppData = [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd("\")
    $resolvedPath = [IO.Path]::GetFullPath($Path)
    if ($resolvedPath.StartsWith($resolvedLocalAppData + "\", [StringComparison]::OrdinalIgnoreCase)) {
        return "%LOCALAPPDATA%" + $resolvedPath.Substring($resolvedLocalAppData.Length)
    }

    return $resolvedPath
}

function Format-TuiColumns {
    param(
        [string]$Left,
        [string]$Right,
        [int]$Width
    )

    if ($Width -le 0) {
        return ""
    }

    $safeRight = Limit-TuiText $Right $Width
    $leftWidth = $Width - $safeRight.Length
    if ($safeRight.Length -gt 0) {
        $leftWidth--
    }

    $safeLeft = Limit-TuiText $Left ([Math]::Max(0, $leftWidth))
    $spacing = [Math]::Max(0, $Width - $safeLeft.Length - $safeRight.Length)
    return $safeLeft + (" " * $spacing) + $safeRight
}

function Format-TuiBoxLine {
    param(
        [string]$Text,
        [int]$Width
    )

    $innerWidth = [Math]::Max(0, $Width - 4)
    $content = (Limit-TuiText $Text $innerWidth).PadRight($innerWidth)
    return "| $content |"
}

function Get-TuiWidth {
    $availableWidth = [Math]::Max(1, [Console]::BufferWidth - 1)
    return [Math]::Min(96, $availableWidth)
}

function Write-TuiLine {
    param(
        [int]$Row,
        [string]$Text,
        [ConsoleColor]$Color = [ConsoleColor]::Gray
    )

    $bufferWidth = [Math]::Max(1, [Console]::BufferWidth - 1)
    $line = (Limit-TuiText $Text $bufferWidth).PadRight($bufferWidth)

    [Console]::SetCursorPosition(0, $script:TuiTop + $Row)
    [Console]::ForegroundColor = $Color
    [Console]::BackgroundColor = [ConsoleColor]::Black
    [Console]::Write($line)
}

function Get-TuiOverallProgress {
    $progress = 0.0

    foreach ($stage in $script:TuiStages) {
        if ($stage.State -eq "Completed") {
            $progress += [double]$stage.Weight
        } elseif ($stage.State -eq "Active" -or $stage.State -eq "Failed") {
            $progress += [double]$stage.Weight * $script:TuiStageProgress
        }
    }

    return [Math]::Max(0.0, [Math]::Min(100.0, $progress))
}

function Render-LiveTui {
    param([switch]$Force)

    if (-not $script:TuiEnabled -or -not $script:TuiInitialized) {
        return
    }

    $now = [DateTime]::Now
    if (-not $Force -and ($now - $script:TuiLastRender).TotalMilliseconds -lt 180) {
        return
    }
    $script:TuiLastRender = $now

    try {
        $width = Get-TuiWidth
        $innerWidth = [Math]::Max(1, $width - 4)
        $border = "+" + ("-" * [Math]::Max(0, $width - 2)) + "+"
        $outcomeLabel = switch ($script:TuiOutcome) {
            "success" { Get-UiText "COMPLETED" "TERMINEE" }
            "error" { Get-UiText "FAILED" "ECHEC" }
            default { Get-UiText "INSTALLATION" "INSTALLATION" }
        }
        $borderColor = switch ($script:TuiOutcome) {
            "success" { [ConsoleColor]::Green }
            "error" { [ConsoleColor]::Red }
            default { [ConsoleColor]::DarkCyan }
        }

        $header = Format-TuiColumns "RANDOMFAVORITES" $outcomeLabel $innerWidth
        $subtitle = Format-TuiColumns `
            (Get-UiText "Vencord installation and update" "Installation et mise a jour de Vencord") `
            ("Discord " + $Branch) `
            $innerWidth

        Write-TuiLine 0 $border $borderColor
        Write-TuiLine -Row 1 -Text (Format-TuiBoxLine $header $width) -Color Cyan
        Write-TuiLine -Row 2 -Text (Format-TuiBoxLine $subtitle $width) -Color DarkGray
        Write-TuiLine 3 $border $borderColor
        Write-TuiLine 4 ""
        Write-TuiLine -Row 5 -Text ("  " + (Get-UiText "OVERALL PROGRESS" "PROGRESSION GLOBALE")) -Color White

        $overallProgress = Get-TuiOverallProgress
        $overallPercent = [int][Math]::Floor($overallProgress)
        $barWidth = [Math]::Max(16, [Math]::Min(52, $width - 27))
        $filled = [Math]::Min($barWidth, [int][Math]::Floor(($overallProgress / 100.0) * $barWidth))
        $bar = ("#" * $filled) + ("-" * ($barWidth - $filled))
        $totalElapsed = Format-Elapsed $script:RunTimer.Elapsed
        $progressLine = "  [{0}] {1,3}%   {2} {3}" -f `
            $bar,
            $overallPercent,
            (Get-UiText "Total" "Total"),
            $totalElapsed
        Write-TuiLine -Row 6 -Text $progressLine -Color Cyan
        Write-TuiLine 7 ""

        for ($index = 0; $index -lt $script:TuiStages.Count; $index++) {
            $stage = $script:TuiStages[$index]
            $elapsed = $stage.Elapsed
            if ($stage.State -eq "Active" -and $null -ne $stage.Timer) {
                $elapsed = $stage.Timer.Elapsed
            }

            $icon = "[ ]"
            $right = ""
            $color = [ConsoleColor]::DarkGray

            switch ($stage.State) {
                "Active" {
                    $icon = "[>]"
                    $right = "{0,3}%  {1}" -f ([int][Math]::Floor($script:TuiStageProgress * 100)), (Format-Elapsed $elapsed)
                    $color = [ConsoleColor]::White
                }
                "Completed" {
                    $icon = "[OK]"
                    $right = Format-Elapsed $elapsed
                    $color = [ConsoleColor]::Green
                }
                "Failed" {
                    $icon = "[!!]"
                    $right = Format-Elapsed $elapsed
                    $color = [ConsoleColor]::Red
                }
            }

            $left = "  $icon $($stage.Number). $($stage.Title)"
            $stageLine = Format-TuiColumns $left $right $width
            Write-TuiLine (8 + $index) $stageLine $color
        }

        Write-TuiLine 15 ""
        $activityHeading = switch ($script:TuiOutcome) {
            "success" { Get-UiText "RESULT" "RESULTAT" }
            "error" { Get-UiText "ERROR" "ERREUR" }
            default { Get-UiText "CURRENT ACTIVITY" "ACTIVITE EN COURS" }
        }
        Write-TuiLine -Row 16 -Text ("  " + $activityHeading) -Color White
        $detail = if ([string]::IsNullOrWhiteSpace($script:TuiDetail)) {
            Get-UiText "Starting..." "Demarrage..."
        } else {
            $script:TuiDetail
        }
        $detailColor = if ($script:TuiOutcome -eq "error") {
            [ConsoleColor]::Red
        } else {
            [ConsoleColor]::Cyan
        }
        Write-TuiLine 17 ("  > " + $detail) $detailColor

        if ($script:TuiOutcome -eq "success") {
            $liveLine = Format-TuiColumns `
                ("  [OK] " + (Get-UiText "You can close this window." "Tu peux fermer cette fenetre.")) `
                ((Get-UiText "Total" "Total") + " " + (Format-Elapsed $script:RunTimer.Elapsed)) `
                $width
            Write-TuiLine -Row 18 -Text $liveLine -Color Green
        } elseif ($script:TuiOutcome -eq "error") {
            $liveLine = Format-TuiColumns `
                ("  [!!] " + (Get-UiText "Installation stopped." "Installation interrompue.")) `
                ("$(Get-UiText "Step" "Etape") $script:TuiCurrentStage/$($script:TuiStages.Count)") `
                $width
            Write-TuiLine -Row 18 -Text $liveLine -Color Red
        } else {
            $spinnerFrames = @("|", "/", "-", "\")
            $spinner = $spinnerFrames[$script:TuiSpinnerIndex % $spinnerFrames.Count]
            $stageCounter = if ($script:TuiCurrentStage -gt 0) {
                "$(Get-UiText "Step" "Etape") $script:TuiCurrentStage/$($script:TuiStages.Count)"
            } else {
                Get-UiText "Initialising" "Initialisation"
            }
            $liveLine = Format-TuiColumns ("  $spinner  " + (Get-UiText "Please wait" "Patiente...")) $stageCounter $width
            Write-TuiLine -Row 18 -Text $liveLine -Color DarkGray
        }
        Write-TuiLine 19 ""

        $footer = switch ($script:TuiOutcome) {
            "success" {
                if ($script:InstalledToDiscord) {
                    Get-UiText "Discord is ready with RandomFavorites." "Discord est pret avec RandomFavorites."
                } else {
                    Get-UiText "Build ready. Discord was not modified." "Compilation prete. Discord n'a pas ete modifie."
                }
            }
            "error" {
                Get-UiText "See the diagnostic log below. Discord was only closed during the final stage." "Consulte le journal ci-dessous. Discord est ferme uniquement a la derniere etape."
            }
            default {
                Get-UiText "Discord stays open until the final installation stage." "Discord reste ouvert jusqu'a l'installation finale."
            }
        }
        $footerColor = if ($script:TuiOutcome -eq "error") {
            [ConsoleColor]::Yellow
        } else {
            [ConsoleColor]::DarkGray
        }
        Write-TuiLine 20 ("  " + $footer) $footerColor

        $lastLine = if ($script:TuiOutcome -eq "success" -and $script:UpdateLauncherPath) {
            (Get-UiText "Update: " "MAJ : ") + (Get-TuiFriendlyPath $script:UpdateLauncherPath)
        } else {
            (Get-UiText "Log: " "Log : ") + (Get-TuiFriendlyPath $script:TechnicalLogPath)
        }
        Write-TuiLine -Row 21 -Text ("  " + $lastLine) -Color DarkGray
        Write-TuiLine 22 $border $borderColor
    } catch {
        Write-TechnicalLog "Live TUI rendering failed: $($_.Exception.Message)"
        $script:TuiEnabled = $false
        try {
            [Console]::CursorVisible = $script:TuiOriginalCursorVisible
            [Console]::ForegroundColor = $script:TuiOriginalForegroundColor
            [Console]::BackgroundColor = $script:TuiOriginalBackgroundColor
        } catch {
            # The console is no longer available.
        }
    }
}

function Initialize-LiveTui {
    if ($ShowDetails) {
        return
    }

    try {
        if ([Console]::IsOutputRedirected -or $Host.Name -ne "ConsoleHost" -or [Console]::BufferWidth -lt 70) {
            return
        }

        $script:TuiOriginalCursorVisible = [Console]::CursorVisible
        $script:TuiOriginalForegroundColor = [Console]::ForegroundColor
        $script:TuiOriginalBackgroundColor = [Console]::BackgroundColor
        Clear-Host
        $script:TuiTop = [Console]::CursorTop

        $requiredBufferHeight = $script:TuiTop + $script:TuiHeight + 2
        if ([Console]::BufferHeight -lt $requiredBufferHeight) {
            [Console]::BufferHeight = $requiredBufferHeight
        }

        [Console]::CursorVisible = $false
        $script:TuiEnabled = $true
        $script:TuiInitialized = $true
        Render-LiveTui -Force
    } catch {
        $script:TuiEnabled = $false
        $script:TuiInitialized = $false
        Write-TechnicalLog "Live TUI is unavailable: $($_.Exception.Message)"
    }
}

function Stop-LiveTui {
    if (-not $script:TuiInitialized) {
        return
    }

    try {
        if ($script:TuiEnabled) {
            Render-LiveTui -Force
        }
        $targetRow = [Math]::Min([Console]::BufferHeight - 1, $script:TuiTop + $script:TuiHeight)
        [Console]::SetCursorPosition(0, $targetRow)
        [Console]::ForegroundColor = $script:TuiOriginalForegroundColor
        [Console]::BackgroundColor = $script:TuiOriginalBackgroundColor
        [Console]::CursorVisible = $script:TuiOriginalCursorVisible
        [Console]::WriteLine("")
    } catch {
        Write-TechnicalLog "Could not restore the console after the live TUI: $($_.Exception.Message)"
    } finally {
        $script:TuiEnabled = $false
        $script:TuiInitialized = $false
    }
}

function Update-TuiActivity {
    param(
        [AllowNull()]
        [string]$Detail,
        [double]$Progress = -1,
        [switch]$Force
    )

    if (-not [string]::IsNullOrWhiteSpace($Detail)) {
        $script:TuiDetail = $Detail
    }

    if ($script:TuiCurrentStage -gt 0) {
        if ($Progress -ge 0) {
            $script:TuiStageProgress = [Math]::Max(
                $script:TuiStageProgress,
                [Math]::Min(0.95, $Progress)
            )
        } elseif ($script:TuiStageProgress -lt 0.90) {
            $remaining = 0.90 - $script:TuiStageProgress
            $script:TuiStageProgress += [Math]::Max(0.001, $remaining * 0.02)
        }
    }

    $script:TuiSpinnerIndex++
    Render-LiveTui -Force:$Force
}

function Write-Banner {
    Write-Host ""
    Write-Host "  +----------------------------------------------------------+" -ForegroundColor DarkCyan
    Write-Host "  |                    RANDOMFAVORITES                       |" -ForegroundColor Cyan
    $subtitle = Get-UiText "Simple Vencord installation and update" "Installation et mise a jour simple de Vencord"
    $subtitleLine = ("  |  " + $subtitle).PadRight(61).Substring(0, 61)
    Write-Host $subtitleLine -NoNewline -ForegroundColor White
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

    $timer = [Diagnostics.Stopwatch]::StartNew()
    Write-TechnicalLog "STAGE $Number/$Total - $Message - $Explanation"
    $script:CurrentStage = $Message
    $script:TuiCurrentStage = $Number
    $script:TuiStageProgress = 0.02
    $script:TuiDetail = $Explanation

    if ($script:TuiEnabled -and $Number -le $script:TuiStages.Count) {
        $stage = $script:TuiStages[$Number - 1]
        $stage.State = "Active"
        $stage.StartedAt = [DateTime]::Now
        $stage.Timer = $timer
        Update-TuiActivity $Explanation -Progress 0.02 -Force
    } else {
        $percent = [Math]::Floor((($Number - 1) / $Total) * 100)
        $filled = [Math]::Floor((($Number - 1) / $Total) * 24)
        $bar = ("#" * $filled).PadRight(24, "-")

        Write-Host ""
        Write-Host "  [$bar] $percent%  $(Get-UiText "Step" "Etape") $Number/$Total" -ForegroundColor Cyan
        Write-Host "  $Message" -ForegroundColor White
        Write-Host "  $Explanation" -ForegroundColor DarkGray
    }

    return $timer
}

function Complete-Step {
    param([Diagnostics.Stopwatch]$Timer)

    $Timer.Stop()
    if ($script:TuiEnabled -and $script:TuiCurrentStage -gt 0) {
        $stage = $script:TuiStages[$script:TuiCurrentStage - 1]
        $stage.State = "Completed"
        $stage.Elapsed = $Timer.Elapsed
        $script:TuiStageProgress = 1.0
        Render-LiveTui -Force
    } else {
        Write-Host "  [OK] $(Get-UiText "Completed in" "Termine en") $(Format-Elapsed $Timer.Elapsed)" -ForegroundColor Green
    }
}

function Set-LiveTuiFailure {
    param([string]$Message)

    $script:TuiOutcome = "error"
    $script:TuiDetail = (Get-UiText "Error: " "Erreur : ") + $Message

    if ($script:TuiCurrentStage -gt 0 -and $script:TuiCurrentStage -le $script:TuiStages.Count) {
        $stage = $script:TuiStages[$script:TuiCurrentStage - 1]
        $stage.State = "Failed"
        if ($null -ne $stage.Timer) {
            $stage.Elapsed = $stage.Timer.Elapsed
        }
    }

    Render-LiveTui -Force
}

function Write-FinalSuccess {
    param(
        [string]$UpdateLauncher,
        [bool]$InstalledToDiscord
    )

    if ($script:TuiEnabled) {
        $script:TuiOutcome = "success"
        $script:TuiDetail = if ($InstalledToDiscord) {
            Get-UiText "Installation completed. Discord has restarted." "Installation terminee. Discord a redemarre."
        } else {
            Get-UiText "Build completed. Discord was not modified." "Compilation terminee. Discord n'a pas ete modifie."
        }
        $script:UpdateLauncherPath = $UpdateLauncher
        Render-LiveTui -Force
        Stop-LiveTui
        return
    }

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

function ConvertTo-PowerShellSingleQuotedLiteral {
    param([AllowNull()][string]$Value)

    return "'" + ([string]$Value).Replace("'", "''") + "'"
}

function Invoke-LiveExternalCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory,
        [string]$CommandLog
    )

    $fileLiteral = ConvertTo-PowerShellSingleQuotedLiteral $FilePath
    $logLiteral = ConvertTo-PowerShellSingleQuotedLiteral $CommandLog
    $argumentLiterals = @($Arguments | ForEach-Object {
        ConvertTo-PowerShellSingleQuotedLiteral ([string]$_)
    })
    $argumentExpression = "@(" + ($argumentLiterals -join ", ") + ")"
    $workingDirectoryLine = if ($WorkingDirectory) {
        "Set-Location -LiteralPath $(ConvertTo-PowerShellSingleQuotedLiteral $WorkingDirectory)"
    } else {
        ""
    }

    $childScript = @"
`$ErrorActionPreference = "Continue"
try {
    $workingDirectoryLine
    `$commandArguments = $argumentExpression
    & $fileLiteral @commandArguments *> $logLiteral
    `$commandExitCode = `$LASTEXITCODE
    if (`$null -eq `$commandExitCode) {
        `$commandExitCode = 1
    }
    exit `$commandExitCode
} catch {
    (`$_ | Out-String) | Add-Content -LiteralPath $logLiteral -Encoding UTF8
    exit 1
}
"@

    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childScript))
    $processStartInfo = New-Object Diagnostics.ProcessStartInfo
    $processStartInfo.FileName = Join-Path $PSHOME "powershell.exe"
    $processStartInfo.Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encodedCommand"
    $processStartInfo.UseShellExecute = $false
    $processStartInfo.CreateNoWindow = $true
    $processStartInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden

    $process = New-Object Diagnostics.Process
    $process.StartInfo = $processStartInfo

    try {
        if (-not $process.Start()) {
            throw "The background command process could not be started."
        }

        while (-not $process.HasExited) {
            Update-TuiActivity $script:TuiDetail
            [Threading.Thread]::Sleep(120)
        }
        $process.WaitForExit()
        return [int]$process.ExitCode
    } finally {
        $process.Dispose()
    }
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
        if ($script:TuiEnabled) {
            $exitCode = Invoke-LiveExternalCommand $FilePath $Arguments $WorkingDirectory $commandLog
        } else {
            $previousErrorPreference = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            try {
                & $FilePath @Arguments *> $commandLog
            } finally {
                $ErrorActionPreference = $previousErrorPreference
            }
            $exitCode = $LASTEXITCODE
        }

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

function New-RandomFavoritesHttpClient {
    $client = New-Object Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromMinutes(30)
    $null = $client.DefaultRequestHeaders.TryAddWithoutValidation(
        "User-Agent",
        "RandomFavoritesManager/1.0"
    )
    return $client
}

function Wait-HttpTask {
    param(
        [Threading.Tasks.Task]$Task,
        [string]$Activity
    )

    while (-not $Task.IsCompleted) {
        Update-TuiActivity $Activity
        [Threading.Thread]::Sleep(120)
    }
}

function Invoke-JsonRequest {
    param(
        [string]$Uri,
        [string]$Activity
    )

    Write-TechnicalLog "JSON REQUEST: $Uri"
    $client = New-RandomFavoritesHttpClient

    try {
        $requestTask = $client.GetStringAsync($Uri)
        Wait-HttpTask $requestTask $Activity
        $json = $requestTask.GetAwaiter().GetResult()
        return ($json | ConvertFrom-Json)
    } finally {
        $client.Dispose()
    }
}

function Format-ByteCount {
    param([long]$Bytes)

    if ($Bytes -ge 1GB) {
        return "{0:N1} GB" -f ($Bytes / 1GB)
    }
    if ($Bytes -ge 1MB) {
        return "{0:N1} MB" -f ($Bytes / 1MB)
    }
    if ($Bytes -ge 1KB) {
        return "{0:N1} KB" -f ($Bytes / 1KB)
    }

    return "$Bytes B"
}

function Invoke-Download {
    param(
        [string]$Uri,
        [string]$Destination,
        [string]$DisplayName = "Download"
    )

    Write-TechnicalLog "DOWNLOAD: $Uri -> $Destination"
    $client = New-RandomFavoritesHttpClient
    $response = $null
    $networkStream = $null
    $fileStream = $null

    try {
        $responseTask = $client.GetAsync(
            [Uri]$Uri,
            [Net.Http.HttpCompletionOption]::ResponseHeadersRead
        )
        Wait-HttpTask $responseTask $DisplayName
        $response = $responseTask.GetAwaiter().GetResult()
        $response.EnsureSuccessStatusCode() | Out-Null

        $streamTask = $response.Content.ReadAsStreamAsync()
        Wait-HttpTask $streamTask $DisplayName
        $networkStream = $streamTask.GetAwaiter().GetResult()
        $fileStream = [IO.File]::Open(
            $Destination,
            [IO.FileMode]::Create,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None
        )

        $buffer = New-Object byte[] 65536
        $downloadedBytes = [long]0
        $totalBytes = $response.Content.Headers.ContentLength

        while ($true) {
            $readTask = $networkStream.ReadAsync($buffer, 0, $buffer.Length)
            while (-not $readTask.IsCompleted) {
                Update-TuiActivity $script:TuiDetail -Progress $script:TuiStageProgress
                [Threading.Thread]::Sleep(20)
            }

            $read = $readTask.GetAwaiter().GetResult()
            if ($read -le 0) {
                break
            }

            $fileStream.Write($buffer, 0, $read)
            $downloadedBytes += $read

            if ($null -ne $totalBytes -and [long]$totalBytes -gt 0) {
                $ratio = [Math]::Min(1.0, $downloadedBytes / [double]$totalBytes)
                $detail = "{0} : {1} / {2}" -f `
                    $DisplayName,
                    (Format-ByteCount $downloadedBytes),
                    (Format-ByteCount ([long]$totalBytes))
                Update-TuiActivity $detail -Progress (0.10 + ($ratio * 0.75))
            } else {
                $detail = "{0} : {1}" -f $DisplayName, (Format-ByteCount $downloadedBytes)
                Update-TuiActivity $detail
            }
        }

        $fileStream.Flush()
        Write-TechnicalLog "DOWNLOAD COMPLETE: $downloadedBytes bytes"
    } finally {
        if ($null -ne $fileStream) {
            $fileStream.Dispose()
        }
        if ($null -ne $networkStream) {
            $networkStream.Dispose()
        }
        if ($null -ne $response) {
            $response.Dispose()
        }
        $client.Dispose()
    }
}

function Expand-ZipArchive {
    param(
        [string]$ArchivePath,
        [string]$DestinationPath
    )

    if (Test-Path -LiteralPath $DestinationPath) {
        $existingItems = @(Get-ChildItem -LiteralPath $DestinationPath -Force)
        if ($existingItems.Count -gt 0) {
            throw "The extraction folder '$DestinationPath' is not empty."
        }
    } else {
        New-Item -ItemType Directory -Path $DestinationPath -Force | Out-Null
    }

    if ($script:TuiEnabled) {
        $archiveLiteral = ConvertTo-PowerShellSingleQuotedLiteral $ArchivePath
        $destinationLiteral = ConvertTo-PowerShellSingleQuotedLiteral $DestinationPath
        $extractScript = @"
`$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($archiveLiteral, $destinationLiteral)
"@
        $encodedExtractScript = [Convert]::ToBase64String(
            [Text.Encoding]::Unicode.GetBytes($extractScript)
        )
        Invoke-External (Join-Path $PSHOME "powershell.exe") @(
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy", "Bypass",
            "-EncodedCommand", $encodedExtractScript
        )
    } else {
        [IO.Compression.ZipFile]::ExtractToDirectory($ArchivePath, $DestinationPath)
    }
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
    $release = Invoke-JsonRequest `
        "https://api.github.com/repos/git-for-windows/git/releases/latest" `
        (Get-UiText "Looking for a portable Git version..." "Recherche d'une version portable de Git...")

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
    Invoke-Download `
        $asset.browser_download_url `
        $archivePath `
        (Get-UiText "Downloading portable Git" "Telechargement de Git portable")
    Update-TuiActivity (Get-UiText "Checking the Git download..." "Verification du telechargement de Git...") -Progress 0.88 -Force
    Assert-Sha256 $archivePath $expectedHash
    Update-TuiActivity (Get-UiText "Extracting portable Git..." "Extraction de Git portable...") -Progress 0.90 -Force
    Expand-ZipArchive $archivePath $gitDirectory

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
        Update-TuiActivity (Get-UiText "Using the Git installation already present." "Utilisation de Git deja present.") -Progress 0.65 -Force
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
    $nodeIndex = Invoke-JsonRequest `
        "https://nodejs.org/dist/index.json" `
        (Get-UiText "Looking for a compatible Node.js version..." "Recherche d'une version compatible de Node.js...")
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
    Invoke-Download `
        "$releaseUri/$archiveName" `
        $archivePath `
        (Get-UiText "Downloading portable Node.js" "Telechargement de Node.js portable")
    Invoke-Download `
        "$releaseUri/SHASUMS256.txt" `
        $checksumsPath `
        (Get-UiText "Downloading official checksums" "Telechargement des empreintes officielles")

    $checksumLine = Get-Content -LiteralPath $checksumsPath |
        Where-Object { $_ -match "^([a-fA-F0-9]{64})\s+$([regex]::Escape($archiveName))$" } |
        Select-Object -First 1
    if (-not $checksumLine -or $checksumLine -notmatch "^([a-fA-F0-9]{64})") {
        throw "The official Node.js checksum file does not contain '$archiveName'."
    }

    Update-TuiActivity (Get-UiText "Checking the Node.js download..." "Verification du telechargement de Node.js...") -Progress 0.88 -Force
    Assert-Sha256 $archivePath $Matches[1]
    Update-TuiActivity (Get-UiText "Extracting portable Node.js..." "Extraction de Node.js portable...") -Progress 0.90 -Force
    Expand-ZipArchive $archivePath $extractDirectory

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
        Update-TuiActivity (Get-UiText "Using the Node.js installation already present." "Utilisation de Node.js deja present.") -Progress 0.45 -Force
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
        Update-TuiActivity `
            (Get-UiText "Updating $DisplayName..." "Mise a jour de $DisplayName...") `
            -Progress 0.18 `
            -Force
        Invoke-External $script:GitExecutable @("-C", $Destination, "pull", "--ff-only")
        return
    }

    $parent = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    Write-TechnicalLog "Installing $DisplayName."
    Update-TuiActivity `
        (Get-UiText "Downloading $DisplayName..." "Telechargement de $DisplayName...") `
        -Progress 0.12 `
        -Force
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
    Update-TuiActivity `
        (Get-UiText "Preparing pnpm $Version..." "Preparation de pnpm $Version...") `
        -Progress 0.55 `
        -Force
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
        if ($script:TuiEnabled) {
            Update-TuiActivity `
                (Get-UiText "Discord could not be restarted automatically." "Discord n'a pas pu etre redemarre automatiquement.") `
                -Force
        } else {
            Write-Host "  Discord restart skipped because '$updateExe' was not found." -ForegroundColor Yellow
        }
        return
    }

    Write-TechnicalLog "Restarting $processName."
    Update-TuiActivity (Get-UiText "Restarting Discord..." "Redemarrage de Discord...") -Progress 0.88 -Force
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
    $script:TuiStages = @(New-TuiStages)
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

    Initialize-LiveTui

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
    Update-TuiActivity `
        (Get-UiText "Installing the exact Vencord dependencies..." "Installation des dependances exactes de Vencord...") `
        -Progress 0.08 `
        -Force
    Invoke-External $pnpm @("install", "--frozen-lockfile") $vencordDirectory
    Complete-Step $stageTimer

    $stageTimer = Write-Step 6 7 `
        (Get-UiText "Building the custom Discord mod" "Compilation du mod Discord personnalise") `
        (Get-UiText "Creating Vencord with RandomFavorites included. This can take a moment." "Creation de Vencord avec RandomFavorites inclus. Cette etape peut prendre un moment.")
    Update-TuiActivity `
        (Get-UiText "Compiling Vencord with RandomFavorites..." "Compilation de Vencord avec RandomFavorites...") `
        -Progress 0.05 `
        -Force
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
        if ($script:TuiEnabled) {
            Update-TuiActivity `
                (Get-UiText "Discord modification skipped by command-line option." "Modification de Discord ignoree par option de ligne de commande.") `
                -Progress 0.75 `
                -Force
        } else {
            Write-Host "  $(Get-UiText "Discord modification skipped by command-line option." "Modification de Discord ignoree par option de ligne de commande.")" -ForegroundColor Yellow
        }
        Write-TechnicalLog "Discord injection skipped by command-line option."
    } else {
        Update-TuiActivity (Get-UiText "Closing Discord..." "Fermeture de Discord...") -Progress 0.12 -Force
        Stop-Discord $Branch
        Update-TuiActivity (Get-UiText "Installing Vencord into Discord..." "Installation de Vencord dans Discord...") -Progress 0.25 -Force
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
    Update-TuiActivity (Get-UiText "Saving the update shortcut..." "Enregistrement du raccourci de mise a jour...") -Progress 0.92 -Force
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
    if ($script:TuiEnabled) {
        Set-LiveTuiFailure $_.Exception.Message
    } else {
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
    }
} finally {
    try {
        if ($script:TuiEnabled -and $script:Completed) {
            Update-TuiActivity (Get-UiText "Removing temporary build tools..." "Nettoyage des outils temporaires...") -Force
        }
        Remove-BootstrapTools
    } catch {
        $exitCode = 1
        Write-TechnicalLog "ERROR while removing temporary tools: $($_.Exception.ToString())"
        if ($script:TuiEnabled) {
            Set-LiveTuiFailure ((Get-UiText "Temporary-tool cleanup failed: " "Le nettoyage des outils temporaires a echoue : ") + $_.Exception.Message)
        } else {
            Write-Host "  $(Get-UiText "Temporary-tool cleanup failed:" "Le nettoyage des outils temporaires a echoue :") $($_.Exception.Message)" -ForegroundColor Red
        }
    }
    $env:Path = $script:OriginalPath
    $ProgressPreference = $script:OriginalProgressPreference

    if ($script:TranscriptStarted) {
        Stop-Transcript | Out-Null
    }
}

if ($exitCode -eq 0 -and $script:Completed) {
    Write-FinalSuccess $script:UpdateLauncherPath $script:InstalledToDiscord
} elseif ($script:TuiInitialized) {
    Stop-LiveTui
}

exit $exitCode
