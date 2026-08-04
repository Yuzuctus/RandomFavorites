using System.Text.RegularExpressions;
using RandomFavorites.Setup.Core.Models;

namespace RandomFavorites.Setup.Core;

public static class BundleManifestValidator
{
    public static void Validate(BundleManifest manifest)
    {
        ArgumentNullException.ThrowIfNull(manifest);

        if (!Regex.IsMatch(manifest.Version, "^v[0-9]+\\.[0-9]+\\.[0-9]+(?:-beta\\.[0-9]+)?$"))
            throw new InvalidDataException("La version du manifeste est invalide.");
        if (!Regex.IsMatch(manifest.VencordCommit, "^[0-9a-fA-F]{40}$")
            || !Regex.IsMatch(manifest.PluginCommit, "^[0-9a-fA-F]{40}$"))
        {
            throw new InvalidDataException("Les identifiants de source du manifeste sont invalides.");
        }

        if (!Regex.IsMatch(manifest.OpenAsarDigest, "^sha256:[0-9a-fA-F]{64}$")
            || manifest.OpenAsarPublishedAtUtc == default)
        {
            throw new InvalidDataException("La release OpenAsar du manifeste est invalide.");
        }
    }
}
