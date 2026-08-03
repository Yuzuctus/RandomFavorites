using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using RandomFavorites.Setup.Core;
using RandomFavorites.Setup.Core.Models;
using RandomFavorites.Setup.Core.Services;
using RandomFavorites.Setup.Presentation;

var tests = new (string Name, Action Run)[]
{
    ("checksum parser accepts GitHub checksum files", TestChecksumParser),
    ("checksum parser selects the requested release asset", TestNamedChecksumParser),
    ("downloaded bundle is moved only after its stream is released", TestDownloadReleasesFile),
    ("latest release metadata is read without downloading the bundle", TestLatestManifest),
    ("safe deletion guard rejects broad and sibling paths", TestSafeDeleteGuard),
    ("installer state rejects payload paths outside its version directory", TestStatePathGuard),
    ("payload identity changes when the Vencord build changes", TestPayloadIdentity),
    ("settings cleanup removes only RandomFavorites and creates a backup", TestSettingsCleanup),
    ("OpenAsar download is accepted only after SHA-256 verification", TestOpenAsarDownload),
    ("OpenAsar download is deleted when SHA-256 verification fails", TestOpenAsarDigestMismatch),
    ("OpenAsar install and uninstall restore the original Discord asar", TestOpenAsarInstallAndRestore),
    ("OpenAsar update preserves the original Discord backup", TestOpenAsarUpdate),
    ("OpenAsar preserves Vencord's outer patch", TestOpenAsarPreservesVencordPatch),
    ("OpenAsar refuses to overwrite an existing backup", TestOpenAsarBackupCollision),
    ("OpenAsar preference removes an installed copy safely", TestOpenAsarPreferenceRemoval),
    ("installer UI resolves the main installation states", TestInstallerUiStates),
    ("installer UI exposes real operation progress and success actions", TestInstallerUiProgress),
    ("Discord launch uses the selected branch updater", TestDiscordLaunchInfo),
};

var failures = 0;
foreach (var test in tests)
{
    try
    {
        test.Run();
        Console.WriteLine($"PASS {test.Name}");
    }
    catch (Exception error)
    {
        failures++;
        Console.Error.WriteLine($"FAIL {test.Name}: {error}");
    }
}

Console.WriteLine($"{tests.Length - failures}/{tests.Length} smoke tests passed.");
return failures == 0 ? 0 : 1;

static void TestChecksumParser()
{
    const string hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    Assert(ReleaseClient.ParseSha256($"{hash}  RandomFavoritesBundle.zip\n") == hash);
    AssertThrows<InvalidDataException>(() => ReleaseClient.ParseSha256("not-a-checksum"));
}

static void TestNamedChecksumParser()
{
    const string first = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const string expected = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    var checksums = $"{first}  VencordInstaller.exe\n{expected}  VencordInstallerCli.exe\n";

    Assert(ReleaseClient.ParseSha256ForFile(checksums, "VencordInstallerCli.exe") == expected);
    AssertThrows<InvalidDataException>(() =>
        ReleaseClient.ParseSha256ForFile(checksums, "missing.exe"));
}

static void TestDownloadReleasesFile()
{
    var temporary = Path.Combine(Path.GetTempPath(), $"randomfavorites-download-{Guid.NewGuid():N}");
    var layout = new InstallerLayout(
        Path.Combine(temporary, "local"),
        Path.Combine(temporary, "roaming"));
    var payload = "release bundle bytes"u8.ToArray();
    var hash = Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant();

    try
    {
        using var client = new ReleaseClient(new StaticReleaseHandler(payload, hash));
        var bundle = client.DownloadVerifiedBundleAsync(
                layout,
                progress: null,
                CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        Assert(File.ReadAllBytes(bundle).SequenceEqual(payload));
        using var exclusiveHandle = new FileStream(
            bundle,
            FileMode.Open,
            FileAccess.ReadWrite,
            FileShare.None);
        Assert(exclusiveHandle.Length == payload.Length);
    }
    finally
    {
        if (Directory.Exists(temporary))
            Directory.Delete(temporary, recursive: true);
    }
}

static void TestLatestManifest()
{
    var expected = CreateManifest("v3.2.1", 'c', 'd');
    using var client = new ReleaseClient(new ManifestReleaseHandler(expected));
    var manifest = client.GetLatestManifestAsync(CancellationToken.None)
        .GetAwaiter()
        .GetResult();

    Assert(manifest.Version == expected.Version);
    Assert(manifest.PluginCommit == expected.PluginCommit);
    Assert(manifest.VencordCommit == expected.VencordCommit);
}

static void TestSafeDeleteGuard()
{
    var temporary = Path.Combine(Path.GetTempPath(), $"randomfavorites-layout-{Guid.NewGuid():N}");
    var layout = new InstallerLayout(
        Path.Combine(temporary, "local"),
        Path.Combine(temporary, "roaming"));
    var version = Path.Combine(layout.Versions, "v1");

    layout.EnsureSafeDeleteTarget(version, layout.Versions);
    AssertThrows<InvalidOperationException>(() =>
        layout.EnsureSafeDeleteTarget(layout.Versions, layout.Versions));
    AssertThrows<InvalidOperationException>(() =>
        layout.EnsureSafeDeleteTarget(Path.Combine(layout.Root, "sibling"), layout.Versions));
}

static void TestStatePathGuard()
{
    var temporary = Path.Combine(Path.GetTempPath(), $"randomfavorites-state-{Guid.NewGuid():N}");
    var layout = new InstallerLayout(
        Path.Combine(temporary, "local"),
        Path.Combine(temporary, "roaming"));
    layout.EnsureDirectories();

    try
    {
        var unsafeState = new
        {
            version = "v1.0.0",
            branch = "Stable",
            activeVersionDirectory = Path.Combine(layout.Root, "outside-versions"),
            installedAtUtc = DateTimeOffset.UtcNow,
        };
        File.WriteAllText(layout.StateFile, JsonSerializer.Serialize(unsafeState));

        using var service = new InstallerService(layout);
        Assert(service.ReadState() is null);
    }
    finally
    {
        Directory.Delete(temporary, recursive: true);
    }
}

static void TestPayloadIdentity()
{
    var first = new BundleManifest
    {
        Version = "v1.2.3",
        PluginCommit = new string('a', 40),
        VencordCommit = new string('b', 40),
    };
    var refreshed = new BundleManifest
    {
        Version = first.Version,
        PluginCommit = first.PluginCommit,
        VencordCommit = new string('c', 40),
    };

    Assert(InstallerService.GetVersionDirectoryName(first) == "v1.2.3-aaaaaaaa-bbbbbbbb");
    Assert(InstallerService.GetVersionDirectoryName(first)
        != InstallerService.GetVersionDirectoryName(refreshed));
}

static void TestSettingsCleanup()
{
    var temporary = Path.Combine(Path.GetTempPath(), $"randomfavorites-settings-{Guid.NewGuid():N}");
    Directory.CreateDirectory(temporary);
    try
    {
        var settingsFile = Path.Combine(temporary, "settings.json");
        File.WriteAllText(settingsFile, """
            {
              "plugins": {
                "RandomFavorites": { "enabled": true, "maskGifs": true },
                "KeepMe": { "enabled": true }
              },
              "useQuickCss": true
            }
            """);

        var backup = VencordSettingsEditor.RemoveRandomFavoritesSettings(settingsFile);
        Assert(backup is not null && File.Exists(backup));

        var result = JsonNode.Parse(File.ReadAllText(settingsFile))!.AsObject();
        var plugins = result["plugins"]!.AsObject();
        Assert(!plugins.ContainsKey("RandomFavorites"));
        Assert(plugins.ContainsKey("KeepMe"));
        Assert(result["useQuickCss"]!.GetValue<bool>());
    }
    finally
    {
        Directory.Delete(temporary, recursive: true);
    }
}

static void TestOpenAsarDownload()
{
    var temporary = Path.Combine(Path.GetTempPath(), $"randomfavorites-openasar-download-{Guid.NewGuid():N}");
    var layout = new InstallerLayout(
        Path.Combine(temporary, "local"),
        Path.Combine(temporary, "roaming"));
    var payload = "OpenAsar verified payload"u8.ToArray();

    try
    {
        using var client = new ReleaseClient(new OpenAsarReleaseHandler(payload));
        var downloaded = client.DownloadVerifiedOpenAsarAsync(
                layout,
                progress: null,
                CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        Assert(File.ReadAllBytes(downloaded).SequenceEqual(payload));
    }
    finally
    {
        if (Directory.Exists(temporary))
            Directory.Delete(temporary, recursive: true);
    }
}

static void TestOpenAsarDigestMismatch()
{
    var temporary = Path.Combine(Path.GetTempPath(), $"randomfavorites-openasar-invalid-{Guid.NewGuid():N}");
    var layout = new InstallerLayout(
        Path.Combine(temporary, "local"),
        Path.Combine(temporary, "roaming"));

    try
    {
        using var client = new ReleaseClient(new OpenAsarReleaseHandler(
            "untrusted payload"u8.ToArray(),
            corruptDigest: true));
        AssertThrows<InvalidDataException>(() => client.DownloadVerifiedOpenAsarAsync(
                layout,
                progress: null,
                CancellationToken.None)
            .GetAwaiter()
            .GetResult());
        Assert(!File.Exists(Path.Combine(layout.Downloads, "OpenAsar.app.asar")));
    }
    finally
    {
        if (Directory.Exists(temporary))
            Directory.Delete(temporary, recursive: true);
    }
}

static void TestOpenAsarInstallAndRestore()
{
    var temporary = CreateDiscordFixture(withVencordPatch: false);
    var discord = CreateDiscordInstallation(temporary);
    var resources = GetFixtureResources(temporary);
    var openAsar = Path.Combine(temporary, "verified-openasar.asar");
    File.WriteAllText(openAsar, "OpenAsar replacement");

    try
    {
        Assert(OpenAsarManager.InstallOrUpdate(discord, openAsar) == OpenAsarChange.Installed);
        Assert(OpenAsarManager.IsInstalled(discord));
        Assert(File.ReadAllText(Path.Combine(resources, "app.asar")) == "OpenAsar replacement");
        Assert(File.ReadAllText(Path.Combine(resources, "app.asar.backup")) == "Discord original");

        OpenAsarManager.Uninstall(discord);
        Assert(!OpenAsarManager.IsInstalled(discord));
        Assert(File.ReadAllText(Path.Combine(resources, "app.asar")) == "Discord original");
        Assert(!File.Exists(Path.Combine(resources, "app.asar.backup")));
    }
    finally
    {
        Directory.Delete(temporary, recursive: true);
    }
}

static void TestOpenAsarUpdate()
{
    var temporary = CreateDiscordFixture(withVencordPatch: false);
    var discord = CreateDiscordInstallation(temporary);
    var resources = GetFixtureResources(temporary);
    var firstOpenAsar = Path.Combine(temporary, "openasar-old.asar");
    var currentOpenAsar = Path.Combine(temporary, "openasar-current.asar");
    File.WriteAllText(firstOpenAsar, "OpenAsar old release");
    File.WriteAllText(currentOpenAsar, "OpenAsar current release");

    try
    {
        Assert(OpenAsarManager.InstallOrUpdate(discord, firstOpenAsar) == OpenAsarChange.Installed);
        Assert(OpenAsarManager.InstallOrUpdate(discord, currentOpenAsar) == OpenAsarChange.Updated);
        Assert(File.ReadAllText(Path.Combine(resources, "app.asar")) == "OpenAsar current release");
        Assert(File.ReadAllText(Path.Combine(resources, "app.asar.backup")) == "Discord original");

        Assert(OpenAsarManager.InstallOrUpdate(discord, currentOpenAsar) == OpenAsarChange.None);
        Assert(File.ReadAllText(Path.Combine(resources, "app.asar.backup")) == "Discord original");
    }
    finally
    {
        Directory.Delete(temporary, recursive: true);
    }
}

static void TestOpenAsarPreservesVencordPatch()
{
    var temporary = CreateDiscordFixture(withVencordPatch: true);
    var discord = CreateDiscordInstallation(temporary);
    var resources = GetFixtureResources(temporary);
    var openAsar = Path.Combine(temporary, "verified-openasar.asar");
    var updatedOpenAsar = Path.Combine(temporary, "updated-openasar.asar");
    File.WriteAllText(openAsar, "OpenAsar replacement");
    File.WriteAllText(updatedOpenAsar, "OpenAsar updated replacement");

    try
    {
        Assert(OpenAsarManager.InstallOrUpdate(discord, openAsar) == OpenAsarChange.Installed);
        Assert(File.ReadAllText(Path.Combine(resources, "app.asar")) == "Vencord patcher");
        Assert(File.ReadAllText(Path.Combine(resources, "_app.asar")) == "OpenAsar replacement");

        Assert(OpenAsarManager.InstallOrUpdate(discord, updatedOpenAsar) == OpenAsarChange.Updated);
        Assert(File.ReadAllText(Path.Combine(resources, "app.asar")) == "Vencord patcher");
        Assert(File.ReadAllText(Path.Combine(resources, "_app.asar")) == "OpenAsar updated replacement");
        Assert(File.ReadAllText(Path.Combine(resources, "app.asar.backup")) == "Discord original");

        OpenAsarManager.Uninstall(discord);
        Assert(File.ReadAllText(Path.Combine(resources, "app.asar")) == "Vencord patcher");
        Assert(File.ReadAllText(Path.Combine(resources, "_app.asar")) == "Discord original");
    }
    finally
    {
        Directory.Delete(temporary, recursive: true);
    }
}

static void TestOpenAsarBackupCollision()
{
    var temporary = CreateDiscordFixture(withVencordPatch: false);
    var discord = CreateDiscordInstallation(temporary);
    var resources = GetFixtureResources(temporary);
    var openAsar = Path.Combine(temporary, "verified-openasar.asar");
    File.WriteAllText(openAsar, "OpenAsar replacement");
    File.WriteAllText(Path.Combine(resources, "app.asar.backup"), "user backup");

    try
    {
        AssertThrows<InvalidOperationException>(() => OpenAsarManager.InstallOrUpdate(discord, openAsar));
        Assert(File.ReadAllText(Path.Combine(resources, "app.asar")) == "Discord original");
        Assert(File.ReadAllText(Path.Combine(resources, "app.asar.backup")) == "user backup");
    }
    finally
    {
        Directory.Delete(temporary, recursive: true);
    }
}

static void TestOpenAsarPreferenceRemoval()
{
    var temporary = CreateDiscordFixture(withVencordPatch: false);
    var discord = CreateDiscordInstallation(temporary);
    var resources = GetFixtureResources(temporary);
    var openAsar = Path.Combine(temporary, "verified-openasar.asar");
    File.WriteAllText(openAsar, "OpenAsar preferred payload");

    try
    {
        Assert(OpenAsarManager.ApplyPreference(
                discord,
                enabled: true,
                verifiedOpenAsar: openAsar)
            == OpenAsarChange.Installed);
        Assert(OpenAsarManager.GetInstalledDigest(discord)
            == "sha256:" + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(openAsar)))
                .ToLowerInvariant());

        Assert(OpenAsarManager.ApplyPreference(discord, enabled: false)
            == OpenAsarChange.Removed);
        Assert(!OpenAsarManager.IsInstalled(discord));
        Assert(File.ReadAllText(Path.Combine(resources, "app.asar")) == "Discord original");
    }
    finally
    {
        Directory.Delete(temporary, recursive: true);
    }
}

static void TestInstallerUiStates()
{
    var available = CreateManifest("v2.0.0", 'b', 'c');
    var notInstalled = InstallerStateResolver.Resolve(new InstallerStateInput
    {
        HasDiscord = true,
        AvailableManifest = available,
        DesiredOpenAsar = false,
    });
    Assert(notInstalled.Status == InstallerScreenStatus.NotInstalled);
    Assert(notInstalled.PrimaryAction == InstallerPrimaryAction.Install);
    Assert(notInstalled.PrimaryActionText == "Installer");

    var current = CreateInstalledUiInput(available);
    var upToDate = InstallerStateResolver.Resolve(current);
    Assert(upToDate.Status == InstallerScreenStatus.UpToDate);
    Assert(upToDate.PrimaryAction == InstallerPrimaryAction.None);
    Assert(upToDate.PrimaryActionText == "Tout est à jour");

    var updateAvailable = InstallerStateResolver.Resolve(current with
    {
        AvailableManifest = CreateManifest("v2.1.0", 'd', 'e'),
    });
    Assert(updateAvailable.Status == InstallerScreenStatus.UpdateAvailable);
    Assert(updateAvailable.PrimaryAction == InstallerPrimaryAction.Update);
    Assert(updateAvailable.PrimaryActionText == "Mettre à jour");

    var refreshedBuild = InstallerStateResolver.Resolve(current with
    {
        AvailableManifest = CreateManifest(available.Version, 'f', '0'),
    });
    Assert(refreshedBuild.Status == InstallerScreenStatus.UpdateAvailable);
    Assert(refreshedBuild.Detail == "Une nouvelle build vérifiée est disponible");

    var openAsarChange = InstallerStateResolver.Resolve(current with
    {
        DesiredOpenAsar = true,
    });
    Assert(openAsarChange.PrimaryAction == InstallerPrimaryAction.ApplyChanges);
    Assert(openAsarChange.PrimaryActionText == "Appliquer les changements");

    var openAsarUpdate = InstallerStateResolver.Resolve(current with
    {
        OpenAsarInstalled = true,
        DesiredOpenAsar = true,
        InstalledOpenAsarDigest = "sha256:" + new string('0', 64),
    });
    Assert(openAsarUpdate.Status == InstallerScreenStatus.UpdateAvailable);
    Assert(openAsarUpdate.PrimaryAction == InstallerPrimaryAction.Update);

    var damaged = InstallerStateResolver.Resolve(current with
    {
        InstallationHealthy = false,
    });
    Assert(damaged.Status == InstallerScreenStatus.RepairRequired);
    Assert(damaged.PrimaryAction == InstallerPrimaryAction.Reinstall);
    Assert(damaged.PrimaryActionText == "Réinstaller");

    var missingManifest = InstallerStateResolver.Resolve(current with
    {
        InstalledManifest = null,
        InstallationHealthy = false,
    });
    Assert(missingManifest.Status == InstallerScreenStatus.RepairRequired);

    var offline = InstallerStateResolver.Resolve(current with
    {
        AvailableManifest = null,
        InspectionWarning = "La vérification en ligne est momentanément indisponible.",
    });
    Assert(offline.Status == InstallerScreenStatus.Warning);
    Assert(offline.Detail == "La vérification en ligne est momentanément indisponible.");
}

static void TestInstallerUiProgress()
{
    var busy = InstallerStateResolver.Resolve(new InstallerStateInput
    {
        HasDiscord = true,
        IsBusy = true,
        Progress = new InstallerProgress(
            0.42,
            "Téléchargement de Vencord",
            "18,4 Mo sur 42,0 Mo",
            IsIndeterminate: false),
    });
    Assert(busy.Status == InstallerScreenStatus.Busy);
    Assert(busy.PrimaryActionText == "Installation en cours…");
    Assert(busy.ShowProgress && !busy.IsProgressIndeterminate);
    Assert(Math.Abs(busy.ProgressPercent - 42) < 0.001);
    Assert(busy.ContextText == "Téléchargement de Vencord");

    var success = InstallerStateResolver.Resolve(new InstallerStateInput
    {
        HasDiscord = true,
        Result = new InstallResult(true, "Installation terminée", "Tout est prêt."),
        CanOpenDiscord = true,
    });
    Assert(success.Status == InstallerScreenStatus.Success);
    Assert(success.PrimaryAction == InstallerPrimaryAction.OpenDiscord);
    Assert(success.PrimaryActionText == "Ouvrir Discord");
    Assert(success.PrimaryActionEnabled);

    var uninstalled = InstallerStateResolver.Resolve(new InstallerStateInput
    {
        HasDiscord = true,
        Result = new InstallResult(true, "Désinstallation terminée", "RandomFavorites a été retiré."),
    });
    Assert(uninstalled.Status == InstallerScreenStatus.Success);
    Assert(uninstalled.PrimaryAction == InstallerPrimaryAction.Install);
    Assert(uninstalled.PrimaryActionText == "Installer");
}

static void TestDiscordLaunchInfo()
{
    var temporary = Path.Combine(Path.GetTempPath(), $"randomfavorites-launch-{Guid.NewGuid():N}");
    Directory.CreateDirectory(temporary);
    try
    {
        var updater = Path.Combine(temporary, "Update.exe");
        File.WriteAllText(updater, "fixture");
        var discord = CreateDiscordInstallation(temporary);
        var startInfo = DiscordLauncher.CreateStartInfo(discord);

        Assert(startInfo.FileName == updater);
        Assert(startInfo.UseShellExecute);
        Assert(startInfo.ArgumentList.SequenceEqual(["--processStart", "Discord.exe"]));
    }
    finally
    {
        Directory.Delete(temporary, recursive: true);
    }
}

static InstallerStateInput CreateInstalledUiInput(BundleManifest manifest) => new()
{
    HasDiscord = true,
    InstalledState = new InstallState
    {
        Version = manifest.Version,
        Branch = DiscordBranch.Stable,
        ActiveVersionDirectory = Path.Combine(Path.GetTempPath(), "randomfavorites-ui-state"),
        InstalledAtUtc = DateTimeOffset.UtcNow,
    },
    InstalledManifest = manifest,
    AvailableManifest = manifest,
    InstallationHealthy = true,
    OpenAsarInstalled = false,
    DesiredOpenAsar = false,
};

static BundleManifest CreateManifest(string version, char pluginCommit, char vencordCommit) => new()
{
    Version = version,
    PluginCommit = new string(pluginCommit, 40),
    VencordCommit = new string(vencordCommit, 40),
    OpenAsarDigest = "sha256:" + new string('a', 64),
    OpenAsarPublishedAtUtc = DateTimeOffset.UtcNow,
    BuiltAtUtc = DateTimeOffset.UtcNow,
};

static string CreateDiscordFixture(bool withVencordPatch)
{
    var temporary = Path.Combine(Path.GetTempPath(), $"randomfavorites-openasar-{Guid.NewGuid():N}");
    var resources = GetFixtureResources(temporary);
    Directory.CreateDirectory(resources);
    File.WriteAllText(Path.Combine(resources, "app.asar"), withVencordPatch
        ? "Vencord patcher"
        : "Discord original");
    if (withVencordPatch)
        File.WriteAllText(Path.Combine(resources, "_app.asar"), "Discord original");
    return temporary;
}

static string GetFixtureResources(string root) =>
    Path.Combine(root, "app-1.0.0", "resources");

static DiscordInstallation CreateDiscordInstallation(string root) => new(
    DiscordBranch.Stable,
    "Discord Stable",
    root,
    "Discord",
    "Discord.exe");

static void Assert(bool condition)
{
    if (!condition) throw new InvalidOperationException("Assertion failed.");
}

static void AssertThrows<TException>(Action action)
    where TException : Exception
{
    try
    {
        action();
    }
    catch (TException)
    {
        return;
    }

    throw new InvalidOperationException($"Expected {typeof(TException).Name}.");
}

sealed class StaticReleaseHandler(byte[] payload, string hash) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        HttpContent content = request.RequestUri?.AbsolutePath.EndsWith(
            ".sha256",
            StringComparison.OrdinalIgnoreCase) == true
            ? new StringContent($"{hash}  RandomFavoritesBundle.zip\n")
            : new ByteArrayContent(payload);

        return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK)
        {
            Content = content,
        });
    }
}

sealed class OpenAsarReleaseHandler(byte[] payload, bool corruptDigest = false) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var hash = corruptDigest
            ? new string('0', 64)
            : Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant();
        HttpContent content = request.RequestUri?.AbsolutePath.EndsWith(
            "/releases/tags/nightly",
            StringComparison.OrdinalIgnoreCase) == true
            ? new StringContent($$"""
                {
                  "tag_name": "nightly",
                  "assets": [
                    {
                      "name": "app.asar",
                      "browser_download_url": "https://github.com/GooseMod/OpenAsar/releases/download/nightly/app.asar",
                      "digest": "sha256:{{hash}}"
                    }
                  ]
                }
                """)
            : new ByteArrayContent(payload);

        return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK)
        {
            Content = content,
        });
    }
}

sealed class ManifestReleaseHandler(BundleManifest manifest) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken) => Task.FromResult(new HttpResponseMessage(
        System.Net.HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(manifest)),
        });
}
