using System.Text.Json;
using System.Text.Json.Nodes;

namespace RandomFavorites.Setup.Core;

public static class VencordSettingsEditor
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
    };

    public static string? RemoveRandomFavoritesSettings(string settingsFile)
    {
        if (!File.Exists(settingsFile)) return null;

        var document = JsonNode.Parse(File.ReadAllText(settingsFile)) as JsonObject
            ?? throw new InvalidDataException("Vencord settings are not a JSON object.");
        if (document["plugins"] is not JsonObject plugins
            || !plugins.Remove("RandomFavorites"))
        {
            return null;
        }

        var directory = Path.GetDirectoryName(settingsFile)
            ?? throw new InvalidOperationException("The Vencord settings path has no parent directory.");
        var backupPath = Path.Combine(
            directory,
            $"settings.before-randomfavorites-uninstall-{DateTime.UtcNow:yyyyMMdd-HHmmss}.json");
        File.Copy(settingsFile, backupPath, overwrite: false);

        var temporaryPath = settingsFile + ".tmp";
        File.WriteAllText(temporaryPath, document.ToJsonString(JsonOptions));
        File.Move(temporaryPath, settingsFile, overwrite: true);
        return backupPath;
    }
}
