namespace RandomFavorites.Setup.Core;

public sealed class InstallerLayout
{
    public InstallerLayout(string localAppData, string roamingAppData)
    {
        if (string.IsNullOrWhiteSpace(localAppData))
            throw new ArgumentException("Local application data path is required.", nameof(localAppData));
        if (string.IsNullOrWhiteSpace(roamingAppData))
            throw new ArgumentException("Roaming application data path is required.", nameof(roamingAppData));

        LocalAppData = Path.GetFullPath(localAppData);
        RoamingAppData = Path.GetFullPath(roamingAppData);
        Root = Path.Combine(LocalAppData, "RandomFavorites");
        Versions = Path.Combine(Root, "versions");
        Downloads = Path.Combine(Root, "downloads");
        Logs = Path.Combine(Root, "logs");
        StateFile = Path.Combine(Root, "state.json");
        VencordData = Path.Combine(RoamingAppData, "Vencord");
        VencordSettingsFile = Path.Combine(VencordData, "settings", "settings.json");
    }

    public static InstallerLayout ForCurrentUser() => new(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData));

    public string LocalAppData { get; }

    public string RoamingAppData { get; }

    public string Root { get; }

    public string Versions { get; }

    public string Downloads { get; }

    public string Logs { get; }

    public string StateFile { get; }

    public string VencordData { get; }

    public string VencordSettingsFile { get; }

    public void EnsureDirectories()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(Versions);
        Directory.CreateDirectory(Downloads);
        Directory.CreateDirectory(Logs);
    }

    public void EnsureSafeDeleteTarget(string target, string allowedRoot)
    {
        var resolvedTarget = Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar);
        var resolvedRoot = Path.GetFullPath(allowedRoot).TrimEnd(Path.DirectorySeparatorChar);
        var requiredPrefix = resolvedRoot + Path.DirectorySeparatorChar;

        if (resolvedTarget.Equals(resolvedRoot, StringComparison.OrdinalIgnoreCase)
            || !resolvedTarget.StartsWith(requiredPrefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Refusing to delete '{resolvedTarget}' because it is not a child of '{resolvedRoot}'.");
        }
    }
}
