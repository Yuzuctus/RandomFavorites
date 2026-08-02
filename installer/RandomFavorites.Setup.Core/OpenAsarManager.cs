using System.Security.Cryptography;
using System.Text;
using RandomFavorites.Setup.Core.Models;

namespace RandomFavorites.Setup.Core;

public enum OpenAsarChange
{
    None,
    Installed,
    Updated,
}

public static class OpenAsarManager
{
    private const int ScanBufferSize = 64 * 1024;
    private static readonly byte[] Signature = Encoding.ASCII.GetBytes("OpenAsar");

    public static bool IsInstalled(DiscordInstallation discord)
    {
        try
        {
            return ContainsSignature(FindActiveAsar(discord));
        }
        catch (FileNotFoundException)
        {
            return false;
        }
        catch (DirectoryNotFoundException)
        {
            return false;
        }
    }

    public static OpenAsarChange InstallOrUpdate(
        DiscordInstallation discord,
        string verifiedOpenAsar)
    {
        if (!File.Exists(verifiedOpenAsar))
            throw new FileNotFoundException("Le fichier OpenAsar vérifié est introuvable.", verifiedOpenAsar);
        if (!ContainsSignature(verifiedOpenAsar))
            throw new InvalidDataException("Le fichier téléchargé ne contient pas une archive OpenAsar reconnaissable.");

        var activeAsar = FindActiveAsar(discord);
        if (ContainsSignature(activeAsar))
        {
            if (FilesHaveSameSha256(activeAsar, verifiedOpenAsar))
                return OpenAsarChange.None;

            Update(activeAsar, verifiedOpenAsar);
            return OpenAsarChange.Updated;
        }

        Install(activeAsar, verifiedOpenAsar);
        return OpenAsarChange.Installed;
    }

    private static void Install(string activeAsar, string verifiedOpenAsar)
    {
        var resources = Path.GetDirectoryName(activeAsar)!;
        var backup = Path.Combine(resources, "app.asar.backup");
        if (File.Exists(backup))
        {
            throw new InvalidOperationException(
                "Une sauvegarde app.asar.backup existe déjà. Elle est conservée pour éviter toute perte ; retire-la manuellement seulement si tu sais d'où elle vient.");
        }

        var staged = Path.Combine(resources, $".randomfavorites-openasar-{Guid.NewGuid():N}.tmp");
        File.Copy(verifiedOpenAsar, staged, overwrite: false);
        var originalMoved = false;
        try
        {
            File.Move(activeAsar, backup);
            originalMoved = true;
            File.Move(staged, activeAsar);
        }
        catch
        {
            if (originalMoved && File.Exists(backup))
                File.Move(backup, activeAsar, overwrite: true);
            throw;
        }
        finally
        {
            if (File.Exists(staged)) File.Delete(staged);
        }
    }

    private static void Update(string activeAsar, string verifiedOpenAsar)
    {
        var resources = Path.GetDirectoryName(activeAsar)!;
        if (!File.Exists(Path.Combine(resources, "app.asar.backup"))
            && !File.Exists(Path.Combine(resources, "app.asar.original")))
        {
            throw new InvalidOperationException(
                "La sauvegarde Discord d'origine est absente. OpenAsar ne sera pas mis à jour tant qu'une réinstallation de Discord ne l'aura pas restaurée.");
        }

        var staged = Path.Combine(resources, $".randomfavorites-openasar-update-{Guid.NewGuid():N}.tmp");
        var previous = Path.Combine(resources, $".randomfavorites-openasar-previous-{Guid.NewGuid():N}.tmp");
        File.Copy(verifiedOpenAsar, staged, overwrite: false);

        try
        {
            File.Move(activeAsar, previous);
            try
            {
                File.Move(staged, activeAsar);
            }
            catch
            {
                File.Move(previous, activeAsar, overwrite: true);
                throw;
            }
        }
        finally
        {
            if (File.Exists(staged)) File.Delete(staged);
        }

        try
        {
            File.Delete(previous);
        }
        catch (IOException)
        {
            // The verified update is active and the Discord backup is intact.
        }
        catch (UnauthorizedAccessException)
        {
            // The verified update is active and the Discord backup is intact.
        }
    }

    public static void Uninstall(DiscordInstallation discord)
    {
        var activeAsar = FindActiveAsar(discord);
        if (!ContainsSignature(activeAsar)) return;

        var resources = Path.GetDirectoryName(activeAsar)!;
        var backup = new[]
        {
            Path.Combine(resources, "app.asar.backup"),
            Path.Combine(resources, "app.asar.original"),
        }.FirstOrDefault(File.Exists)
            ?? throw new InvalidOperationException(
                "La sauvegarde Discord d'origine est absente. Réinstalle Discord pour restaurer son app.asar officiel.");
        var replaced = Path.Combine(resources, $".randomfavorites-openasar-remove-{Guid.NewGuid():N}.tmp");

        try
        {
            File.Move(activeAsar, replaced);
            File.Move(backup, activeAsar);
        }
        catch
        {
            if (File.Exists(replaced) && !File.Exists(activeAsar))
                File.Move(replaced, activeAsar);
            throw;
        }

        try
        {
            File.Delete(replaced);
        }
        catch (IOException)
        {
            // Discord's original archive is already restored. A locked temporary
            // OpenAsar copy is harmless and can be cleaned by a later repair.
        }
    }

    private static string FindActiveAsar(DiscordInstallation discord)
    {
        if (!Directory.Exists(discord.RootPath))
            throw new DirectoryNotFoundException($"Discord est introuvable dans {discord.RootPath}.");

        var resources = Directory
            .EnumerateDirectories(discord.RootPath, "app-*")
            .OrderByDescending(Directory.GetLastWriteTimeUtc)
            .Select(directory => Path.Combine(directory, "resources"))
            .FirstOrDefault(Directory.Exists)
            ?? throw new DirectoryNotFoundException("Le dossier resources de Discord est introuvable.");

        foreach (var fileName in new[] { "_app.asar", "app.asar" })
        {
            var candidate = Path.Combine(resources, fileName);
            if (File.Exists(candidate)) return candidate;
        }

        throw new FileNotFoundException("Le fichier app.asar de Discord est introuvable.");
    }

    private static bool ContainsSignature(string path)
    {
        using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            ScanBufferSize,
            FileOptions.SequentialScan);
        var buffer = new byte[ScanBufferSize + Signature.Length - 1];
        var retained = 0;

        while (true)
        {
            var read = stream.Read(buffer, retained, ScanBufferSize);
            if (read == 0) return false;

            var available = retained + read;
            if (buffer.AsSpan(0, available).IndexOf(Signature) >= 0) return true;

            retained = Math.Min(Signature.Length - 1, available);
            buffer.AsSpan(available - retained, retained).CopyTo(buffer);
        }
    }

    private static bool FilesHaveSameSha256(string first, string second)
    {
        using var firstStream = File.OpenRead(first);
        using var secondStream = File.OpenRead(second);
        var firstHash = SHA256.HashData(firstStream);
        var secondHash = SHA256.HashData(secondStream);
        return CryptographicOperations.FixedTimeEquals(firstHash, secondHash);
    }
}
