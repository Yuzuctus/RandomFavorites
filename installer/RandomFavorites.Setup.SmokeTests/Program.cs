using System.Text.Json.Nodes;
using System.Text.Json;
using RandomFavorites.Setup.Core;
using RandomFavorites.Setup.Core.Services;

var tests = new (string Name, Action Run)[]
{
    ("checksum parser accepts GitHub checksum files", TestChecksumParser),
    ("checksum parser selects the requested release asset", TestNamedChecksumParser),
    ("safe deletion guard rejects broad and sibling paths", TestSafeDeleteGuard),
    ("installer state rejects payload paths outside its version directory", TestStatePathGuard),
    ("settings cleanup removes only RandomFavorites and creates a backup", TestSettingsCleanup),
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
