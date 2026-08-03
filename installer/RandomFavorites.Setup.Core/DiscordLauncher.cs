using System.Diagnostics;
using RandomFavorites.Setup.Core.Models;

namespace RandomFavorites.Setup.Core;

public static class DiscordLauncher
{
    public static ProcessStartInfo CreateStartInfo(DiscordInstallation discord)
    {
        ArgumentNullException.ThrowIfNull(discord);
        if (!Directory.Exists(discord.RootPath))
        {
            throw new DirectoryNotFoundException(
                $"Discord est introuvable dans {discord.RootPath}.");
        }

        var updater = Path.Combine(discord.RootPath, "Update.exe");
        if (File.Exists(updater))
        {
            var updaterInfo = new ProcessStartInfo
            {
                FileName = updater,
                WorkingDirectory = discord.RootPath,
                UseShellExecute = true,
            };
            updaterInfo.ArgumentList.Add("--processStart");
            updaterInfo.ArgumentList.Add(discord.ExecutableName);
            return updaterInfo;
        }

        var executable = Directory
            .EnumerateDirectories(discord.RootPath, "app-*")
            .OrderByDescending(Directory.GetLastWriteTimeUtc)
            .Select(directory => Path.Combine(directory, discord.ExecutableName))
            .FirstOrDefault(File.Exists)
            ?? throw new FileNotFoundException(
                "L'exécutable Discord sélectionné est introuvable.");
        return new ProcessStartInfo
        {
            FileName = executable,
            WorkingDirectory = Path.GetDirectoryName(executable)!,
            UseShellExecute = true,
        };
    }

    public static void Start(DiscordInstallation discord)
    {
        var process = Process.Start(CreateStartInfo(discord));
        if (process is null)
            throw new InvalidOperationException("Windows n'a pas pu démarrer Discord.");
        process.Dispose();
    }
}
