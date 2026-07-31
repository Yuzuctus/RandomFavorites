using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using RandomFavorites.Setup.Core.Models;

namespace RandomFavorites.Setup.Core.Services;

public sealed class InstallerService : IDisposable
{
    private const int MaximumBundleEntries = 2048;
    private const long MaximumExtractedBundleBytes = 512L * 1024 * 1024;
    private static readonly string[] RequiredBundleFiles =
    [
        "dist/patcher.js",
        "dist/preload.js",
        "dist/renderer.js",
        "dist/renderer.css",
        "tools/VencordInstallerCli.exe",
    ];

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    private readonly InstallerLayout _layout;
    private readonly ReleaseClient _releaseClient;
    private readonly string _logFile;

    public InstallerService(
        InstallerLayout? layout = null,
        ReleaseClient? releaseClient = null)
    {
        _layout = layout ?? InstallerLayout.ForCurrentUser();
        _releaseClient = releaseClient ?? new ReleaseClient();
        _layout.EnsureDirectories();
        _logFile = Path.Combine(_layout.Logs, $"setup-{DateTime.Now:yyyyMMdd-HHmmss}.log");
    }

    public event Action<string>? LogLine;

    public InstallerLayout Layout => _layout;

    public IReadOnlyList<DiscordInstallation> DiscoverDiscordInstallations()
    {
        var candidates = new[]
        {
            new DiscordInstallation(
                DiscordBranch.Stable,
                "Discord Stable",
                Path.Combine(_layout.LocalAppData, "Discord"),
                "Discord",
                "Discord.exe"),
            new DiscordInstallation(
                DiscordBranch.Ptb,
                "Discord PTB",
                Path.Combine(_layout.LocalAppData, "DiscordPTB"),
                "DiscordPTB",
                "DiscordPTB.exe"),
            new DiscordInstallation(
                DiscordBranch.Canary,
                "Discord Canary",
                Path.Combine(_layout.LocalAppData, "DiscordCanary"),
                "DiscordCanary",
                "DiscordCanary.exe"),
        };

        return candidates.Where(candidate => Directory.Exists(candidate.RootPath)).ToArray();
    }

    public InstallState? ReadState()
    {
        if (!File.Exists(_layout.StateFile)) return null;

        try
        {
            var state = JsonSerializer.Deserialize<InstallState>(
                File.ReadAllText(_layout.StateFile),
                JsonOptions);
            if (state is null) return null;
            if (!Enum.IsDefined(state.Branch))
                throw new InvalidDataException("La version de Discord enregistrée est invalide.");

            _layout.EnsureSafeDeleteTarget(
                state.ActiveVersionDirectory,
                _layout.Versions);
            return state;
        }
        catch (Exception error)
        {
            WriteLog($"État local illisible, une réparation complète sera proposée : {error.Message}");
            return null;
        }
    }

    public async Task<InstallResult> InstallOrUpdateAsync(
        DiscordInstallation discord,
        IProgress<InstallerProgress>? progress,
        CancellationToken cancellationToken)
    {
        var previousState = ReadState();
        string? stagedDirectory = null;
        var restartDiscord = false;

        try
        {
            WriteLog($"Installation demandée pour {discord.DisplayName}.");
            var bundlePath = await _releaseClient.DownloadVerifiedBundleAsync(
                _layout,
                progress,
                cancellationToken);

            progress?.Report(new InstallerProgress(
                0.52,
                "Préparation de RandomFavorites",
                "Extraction sécurisée de la version compilée…",
                true));
            stagedDirectory = Path.Combine(_layout.Versions, $".staging-{Guid.NewGuid():N}");
            var manifest = await ExtractAndValidateBundleAsync(
                bundlePath,
                stagedDirectory,
                cancellationToken);
            var finalDirectory = ActivateStagedVersion(stagedDirectory, manifest, previousState);
            stagedDirectory = null;

            progress?.Report(new InstallerProgress(
                0.68,
                "Installation dans Discord",
                "Discord va se fermer pendant quelques secondes…"));
            await StopDiscordAsync(discord, cancellationToken);
            restartDiscord = true;

            try
            {
                await RunVencordCliAsync(
                    Path.Combine(finalDirectory, "tools", "VencordInstallerCli.exe"),
                    "--repair",
                    discord,
                    finalDirectory,
                    cancellationToken);
                ValidateDiscordPatch(discord, Path.Combine(finalDirectory, "dist", "patcher.js"));
            }
            catch (Exception installError)
            {
                WriteLog($"La nouvelle version n'a pas pu être activée : {installError.Message}");
                if (previousState is not null
                    && Directory.Exists(previousState.ActiveVersionDirectory)
                    && File.Exists(Path.Combine(
                        previousState.ActiveVersionDirectory,
                        "tools",
                        "VencordInstallerCli.exe")))
                {
                    WriteLog("Tentative de restauration de la dernière version fonctionnelle.");
                    try
                    {
                        await RunVencordCliAsync(
                            Path.Combine(
                                previousState.ActiveVersionDirectory,
                                "tools",
                                "VencordInstallerCli.exe"),
                            "--repair",
                            discord,
                            previousState.ActiveVersionDirectory,
                            cancellationToken);
                        WriteState(previousState);
                        WriteLog("La version précédente a été restaurée.");
                    }
                    catch (Exception rollbackError)
                    {
                        throw new AggregateException(
                            "L'installation et la restauration ont échoué.",
                            installError,
                            rollbackError);
                    }
                }

                throw;
            }

            var state = new InstallState
            {
                Version = manifest.Version,
                Branch = discord.Branch,
                ActiveVersionDirectory = finalDirectory,
                InstalledAtUtc = DateTimeOffset.UtcNow,
            };
            WriteState(state);
            PruneInactiveVersions(finalDirectory);
            StartDiscord(discord);
            restartDiscord = false;
            progress?.Report(new InstallerProgress(
                1,
                "Installation terminée",
                $"RandomFavorites {manifest.Version} est prêt."));
            WriteLog($"RandomFavorites {manifest.Version} installé avec succès.");
            return new InstallResult(
                true,
                "RandomFavorites est installé",
                "Discord a été redémarré. Active le plugin dans Paramètres > Vencord > Plugins si nécessaire.",
                manifest.Version);
        }
        catch (OperationCanceledException)
        {
            WriteLog("Opération annulée.");
            throw;
        }
        catch (Exception error)
        {
            WriteLog($"Échec : {error}");
            return new InstallResult(false, "L'installation a échoué", error.Message);
        }
        finally
        {
            if (restartDiscord)
            {
                WriteLog("Redémarrage de Discord après l'interruption de l'opération.");
                StartDiscord(discord);
            }

            if (stagedDirectory is not null && Directory.Exists(stagedDirectory))
                SafeDeleteDirectory(stagedDirectory, _layout.Versions);
        }
    }

    public Task<InstallResult> RepairAsync(
        DiscordInstallation discord,
        IProgress<InstallerProgress>? progress,
        CancellationToken cancellationToken)
    {
        WriteLog("Réparation demandée : le bundle stable sera vérifié puis réappliqué.");
        return InstallOrUpdateAsync(discord, progress, cancellationToken);
    }

    public async Task<InstallResult> UninstallAsync(
        DiscordInstallation discord,
        UninstallMode mode,
        bool removeRandomFavoritesSettings,
        IProgress<InstallerProgress>? progress,
        CancellationToken cancellationToken)
    {
        var restartDiscord = false;

        try
        {
            WriteLog($"Désinstallation demandée : {mode}.");
            var officialInstaller = await _releaseClient.DownloadOfficialInstallerAsync(
                _layout,
                progress,
                cancellationToken);

            progress?.Report(new InstallerProgress(
                0.5,
                "Préparation de la désinstallation",
                "Discord va se fermer pendant quelques secondes…"));
            await StopDiscordAsync(discord, cancellationToken);
            restartDiscord = true;

            if (mode == UninstallMode.RandomFavoritesOnly)
            {
                progress?.Report(new InstallerProgress(
                    0.64,
                    "Conservation de Vencord",
                    "Remplacement par la version officielle de Vencord…",
                    true));
                await RunVencordCliAsync(
                    officialInstaller,
                    "--repair",
                    discord,
                    customDataDirectory: null,
                    cancellationToken);

                if (removeRandomFavoritesSettings)
                {
                    var backup = VencordSettingsEditor.RemoveRandomFavoritesSettings(
                        _layout.VencordSettingsFile);
                    if (backup is not null)
                        WriteLog($"Réglages RandomFavorites retirés. Sauvegarde : {backup}");
                }

                RemoveCustomPayload();
                StartDiscord(discord);
                restartDiscord = false;
                progress?.Report(new InstallerProgress(
                    1,
                    "RandomFavorites est désinstallé",
                    "Vencord officiel et ses autres réglages sont conservés."));
                return new InstallResult(
                    true,
                    "RandomFavorites est désinstallé",
                    "Vencord officiel et tous les autres plugins/réglages sont conservés.");
            }

            progress?.Report(new InstallerProgress(
                0.64,
                "Désinstallation de Vencord",
                "Restauration de Discord d'origine…",
                true));
            await RunVencordCliAsync(
                officialInstaller,
                "--uninstall",
                discord,
                customDataDirectory: null,
                cancellationToken);
            RemoveCustomPayload();

            if (mode == UninstallMode.VencordRemoveData && Directory.Exists(_layout.VencordData))
            {
                _layout.EnsureSafeDeleteTarget(_layout.VencordData, _layout.RoamingAppData);
                Directory.Delete(_layout.VencordData, recursive: true);
                WriteLog($"Données Vencord supprimées : {_layout.VencordData}");
            }

            StartDiscord(discord);
            restartDiscord = false;
            progress?.Report(new InstallerProgress(
                1,
                "Vencord est désinstallé",
                mode == UninstallMode.VencordKeepData
                    ? "Les réglages locaux ont été conservés."
                    : "Les réglages et thèmes locaux ont été supprimés."));
            return new InstallResult(
                true,
                "Vencord est désinstallé",
                mode == UninstallMode.VencordKeepData
                    ? "Discord est revenu à sa version d'origine. Tes réglages Vencord restent disponibles pour une future réinstallation."
                    : "Discord est revenu à sa version d'origine et les données locales Vencord ont été supprimées.");
        }
        catch (OperationCanceledException)
        {
            WriteLog("Désinstallation annulée.");
            throw;
        }
        catch (Exception error)
        {
            WriteLog($"Échec de la désinstallation : {error}");
            return new InstallResult(false, "La désinstallation a échoué", error.Message);
        }
        finally
        {
            if (restartDiscord)
            {
                WriteLog("Redémarrage de Discord après l'interruption de la désinstallation.");
                StartDiscord(discord);
            }
        }
    }

    private async Task<BundleManifest> ExtractAndValidateBundleAsync(
        string bundlePath,
        string destination,
        CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(destination);
        var root = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar)
            + Path.DirectorySeparatorChar;

        using var archive = ZipFile.OpenRead(bundlePath);
        if (archive.Entries.Count > MaximumBundleEntries
            || archive.Entries.Sum(entry => entry.Length) > MaximumExtractedBundleBytes)
        {
            throw new InvalidDataException("Le bundle dépasse les limites de sécurité autorisées.");
        }

        foreach (var entry in archive.Entries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var target = Path.GetFullPath(Path.Combine(destination, entry.FullName));
            if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"Entrée ZIP dangereuse refusée : {entry.FullName}");

            if (string.IsNullOrEmpty(entry.Name))
            {
                Directory.CreateDirectory(target);
                continue;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            await using var source = entry.Open();
            await using var output = new FileStream(
                target,
                FileMode.Create,
                FileAccess.Write,
                FileShare.None,
                1024 * 128,
                useAsync: true);
            await source.CopyToAsync(output, cancellationToken);
        }

        var manifestPath = Path.Combine(destination, "manifest.json");
        if (!File.Exists(manifestPath))
            throw new InvalidDataException("Le bundle ne contient pas manifest.json.");
        var manifest = JsonSerializer.Deserialize<BundleManifest>(
            await File.ReadAllTextAsync(manifestPath, cancellationToken),
            JsonOptions)
            ?? throw new InvalidDataException("Le manifeste du bundle est invalide.");
        if (!Regex.IsMatch(manifest.Version, "^v[0-9]+\\.[0-9]+\\.[0-9]+$"))
            throw new InvalidDataException("La version du manifeste est invalide.");
        if (!Regex.IsMatch(manifest.VencordCommit, "^[0-9a-fA-F]{40}$")
            || !Regex.IsMatch(manifest.PluginCommit, "^[0-9a-fA-F]{40}$"))
        {
            throw new InvalidDataException("Les identifiants de source du manifeste sont invalides.");
        }

        foreach (var requiredFile in RequiredBundleFiles
                     .Concat(manifest.RequiredFiles ?? [])
                     .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var resolved = Path.GetFullPath(Path.Combine(destination, requiredFile));
            if (!resolved.StartsWith(root, StringComparison.OrdinalIgnoreCase)
                || !File.Exists(resolved))
            {
                throw new InvalidDataException($"Fichier obligatoire absent du bundle : {requiredFile}");
            }
        }

        return manifest;
    }

    private string ActivateStagedVersion(
        string stagedDirectory,
        BundleManifest manifest,
        InstallState? currentState)
    {
        var safeVersion = string.Concat(
            manifest.Version.Select(character =>
                Path.GetInvalidFileNameChars().Contains(character) ? '-' : character));
        var commitSuffix = manifest.PluginCommit.Length >= 8
            ? manifest.PluginCommit[..8]
            : manifest.PluginCommit;
        var directoryName = string.IsNullOrWhiteSpace(commitSuffix)
            ? safeVersion
            : $"{safeVersion}-{commitSuffix}";
        var finalDirectory = Path.Combine(_layout.Versions, directoryName);

        if (Directory.Exists(finalDirectory))
        {
            if (currentState is not null
                && Path.GetFullPath(currentState.ActiveVersionDirectory)
                    .Equals(Path.GetFullPath(finalDirectory), StringComparison.OrdinalIgnoreCase))
            {
                SafeDeleteDirectory(stagedDirectory, _layout.Versions);
                return finalDirectory;
            }

            SafeDeleteDirectory(finalDirectory, _layout.Versions);
        }

        Directory.Move(stagedDirectory, finalDirectory);
        return finalDirectory;
    }

    private async Task RunVencordCliAsync(
        string executable,
        string operation,
        DiscordInstallation discord,
        string? customDataDirectory,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(executable))
            throw new FileNotFoundException("L'installateur CLI de Vencord est absent.", executable);

        var startInfo = new ProcessStartInfo
        {
            FileName = executable,
            Arguments = $"{operation} --branch {discord.CliBranch}",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Path.GetDirectoryName(executable)!,
        };
        if (customDataDirectory is not null)
        {
            startInfo.Environment["VENCORD_USER_DATA_DIR"] = customDataDirectory;
            startInfo.Environment["VENCORD_DEV_INSTALL"] = "1";
        }

        using var process = new Process { StartInfo = startInfo };
        process.OutputDataReceived += (_, eventArgs) =>
        {
            if (!string.IsNullOrWhiteSpace(eventArgs.Data)) WriteLog(eventArgs.Data);
        };
        process.ErrorDataReceived += (_, eventArgs) =>
        {
            if (!string.IsNullOrWhiteSpace(eventArgs.Data)) WriteLog(eventArgs.Data);
        };

        WriteLog($"VencordInstallerCli {operation} --branch {discord.CliBranch}");
        if (!process.Start())
            throw new InvalidOperationException("Impossible de démarrer l'installateur Vencord.");
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync(cancellationToken);
        if (process.ExitCode != 0)
            throw new InvalidOperationException(
                $"L'installateur Vencord s'est arrêté avec le code {process.ExitCode}.");
    }

    private static async Task StopDiscordAsync(
        DiscordInstallation discord,
        CancellationToken cancellationToken)
    {
        var processes = Process.GetProcessesByName(discord.ProcessName);
        foreach (var process in processes)
        {
            using (process)
            {
                try
                {
                    if (process.CloseMainWindow())
                    {
                        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
                            cancellationToken);
                        timeout.CancelAfter(TimeSpan.FromSeconds(5));
                        try
                        {
                            await process.WaitForExitAsync(timeout.Token);
                            continue;
                        }
                        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                        {
                            // Discord did not close gracefully; force-close only this known process.
                        }
                    }

                    process.Kill(entireProcessTree: true);
                    await process.WaitForExitAsync(cancellationToken);
                }
                catch (InvalidOperationException)
                {
                    // Process exited between discovery and shutdown.
                }
            }
        }
    }

    private static void StartDiscord(DiscordInstallation discord)
    {
        var updateExecutable = Path.Combine(discord.RootPath, "Update.exe");
        if (!File.Exists(updateExecutable)) return;

        Process.Start(new ProcessStartInfo
        {
            FileName = updateExecutable,
            Arguments = $"--processStart {discord.ExecutableName}",
            UseShellExecute = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        });
    }

    private static void ValidateDiscordPatch(
        DiscordInstallation discord,
        string expectedPatcher)
    {
        var appAsar = Directory
            .EnumerateDirectories(discord.RootPath, "app-*")
            .OrderByDescending(Directory.GetLastWriteTimeUtc)
            .Select(directory => Path.Combine(directory, "resources", "app.asar"))
            .FirstOrDefault(File.Exists)
            ?? throw new FileNotFoundException("Le fichier app.asar de Discord est introuvable.");
        var patch = File.ReadAllText(appAsar);
        var escapedPatcher = expectedPatcher.Replace("\\", "\\\\", StringComparison.Ordinal);
        if (!patch.Contains(expectedPatcher, StringComparison.OrdinalIgnoreCase)
            && !patch.Contains(escapedPatcher, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException(
                "Discord n'a pas été relié à la version RandomFavorites attendue.");
        }
    }

    private void WriteState(InstallState state)
    {
        _layout.EnsureDirectories();
        var temporary = _layout.StateFile + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(state, JsonOptions));
        File.Move(temporary, _layout.StateFile, overwrite: true);
    }

    private void RemoveCustomPayload()
    {
        if (Directory.Exists(_layout.Versions))
        {
            _layout.EnsureSafeDeleteTarget(_layout.Versions, _layout.Root);
            Directory.Delete(_layout.Versions, recursive: true);
        }

        if (File.Exists(_layout.StateFile)) File.Delete(_layout.StateFile);
        WriteLog("Fichiers compilés RandomFavorites supprimés.");
    }

    private void PruneInactiveVersions(string activeDirectory)
    {
        if (!Directory.Exists(_layout.Versions)) return;

        var resolvedActive = Path.GetFullPath(activeDirectory);
        foreach (var directory in Directory.EnumerateDirectories(_layout.Versions))
        {
            if (Path.GetFullPath(directory).Equals(
                    resolvedActive,
                    StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            try
            {
                SafeDeleteDirectory(directory, _layout.Versions);
            }
            catch (Exception error)
            {
                WriteLog($"Ancienne version conservée car son nettoyage a échoué : {error.Message}");
            }
        }
    }

    private void SafeDeleteDirectory(string target, string allowedRoot)
    {
        _layout.EnsureSafeDeleteTarget(target, allowedRoot);
        Directory.Delete(target, recursive: true);
    }

    private void WriteLog(string message)
    {
        var line = $"[{DateTime.Now:HH:mm:ss}] {message}";
        LogLine?.Invoke(line);
        try
        {
            File.AppendAllText(_logFile, line + Environment.NewLine);
        }
        catch
        {
            // Logging must never make installation fail.
        }
    }

    public void Dispose() => _releaseClient.Dispose();
}
