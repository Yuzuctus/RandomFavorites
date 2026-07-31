using System.Text.Json.Serialization;

namespace RandomFavorites.Setup.Core.Models;

public enum DiscordBranch
{
    Stable,
    Ptb,
    Canary,
}

public enum UninstallMode
{
    RandomFavoritesOnly,
    VencordKeepData,
    VencordRemoveData,
}

public sealed record DiscordInstallation(
    DiscordBranch Branch,
    string DisplayName,
    string RootPath,
    string ProcessName,
    string ExecutableName)
{
    public string CliBranch => Branch switch
    {
        DiscordBranch.Stable => "stable",
        DiscordBranch.Ptb => "ptb",
        DiscordBranch.Canary => "canary",
        _ => throw new ArgumentOutOfRangeException(nameof(Branch)),
    };
}

public sealed record InstallerProgress(
    double Percent,
    string Stage,
    string Detail,
    bool IsIndeterminate = false);

public sealed class BundleManifest
{
    public string Version { get; init; } = "";

    public string VencordCommit { get; init; } = "";

    public string PluginCommit { get; init; } = "";

    public DateTimeOffset BuiltAtUtc { get; init; }

    public string[] RequiredFiles { get; init; } = [];
}

public sealed class InstallState
{
    public string Version { get; init; } = "";

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public DiscordBranch Branch { get; init; }

    public string ActiveVersionDirectory { get; init; } = "";

    public DateTimeOffset InstalledAtUtc { get; init; }
}

public sealed record InstallResult(
    bool Success,
    string Title,
    string Message,
    string? Version = null);
