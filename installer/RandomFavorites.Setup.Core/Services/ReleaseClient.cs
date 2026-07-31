using System.Diagnostics;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using RandomFavorites.Setup.Core.Models;

namespace RandomFavorites.Setup.Core.Services;

public sealed class ReleaseClient : IDisposable
{
    public const string BundleUrl =
        "https://github.com/Yuzuctus/RandomFavorites/releases/latest/download/RandomFavoritesBundle.zip";
    public const string ChecksumUrl =
        "https://github.com/Yuzuctus/RandomFavorites/releases/latest/download/RandomFavoritesBundle.zip.sha256";
    public const string OfficialInstallerUrl =
        "https://github.com/Vencord/Installer/releases/latest/download/VencordInstallerCli.exe";
    public const string OfficialInstallerChecksumUrl =
        "https://github.com/Vencord/Installer/releases/latest/download/checksums.sha256";

    private readonly HttpClient _httpClient;

    public ReleaseClient(HttpMessageHandler? handler = null)
    {
        _httpClient = handler is null ? new HttpClient() : new HttpClient(handler);
        _httpClient.DefaultRequestHeaders.UserAgent.Add(
            new ProductInfoHeaderValue("RandomFavoritesSetup", "1.0"));
        _httpClient.Timeout = TimeSpan.FromMinutes(15);
    }

    public async Task<string> DownloadVerifiedBundleAsync(
        InstallerLayout layout,
        IProgress<InstallerProgress>? progress,
        CancellationToken cancellationToken)
    {
        layout.EnsureDirectories();
        var bundlePath = Path.Combine(layout.Downloads, "RandomFavoritesBundle.zip");
        var checksum = ParseSha256(await _httpClient.GetStringAsync(ChecksumUrl, cancellationToken));

        await DownloadFileWithRetriesAsync(
            BundleUrl,
            bundlePath,
            "Téléchargement des fichiers prêts à l'emploi",
            progress,
            cancellationToken);

        progress?.Report(new InstallerProgress(
            0.48,
            "Vérification du téléchargement",
            "Contrôle de l'intégrité SHA-256…",
            true));
        var actualChecksum = await ComputeSha256Async(bundlePath, cancellationToken);
        if (!actualChecksum.Equals(checksum, StringComparison.OrdinalIgnoreCase))
        {
            File.Delete(bundlePath);
            throw new InvalidDataException(
                $"Le fichier téléchargé est invalide. SHA-256 attendu {checksum}, obtenu {actualChecksum}.");
        }

        return bundlePath;
    }

    public async Task<string> DownloadOfficialInstallerAsync(
        InstallerLayout layout,
        IProgress<InstallerProgress>? progress,
        CancellationToken cancellationToken)
    {
        layout.EnsureDirectories();
        var installerPath = Path.Combine(layout.Downloads, "VencordInstallerCli.exe");
        var checksumFile = await _httpClient.GetStringAsync(
            OfficialInstallerChecksumUrl,
            cancellationToken);
        var expectedChecksum = ParseSha256ForFile(
            checksumFile,
            "VencordInstallerCli.exe");
        await DownloadFileWithRetriesAsync(
            OfficialInstallerUrl,
            installerPath,
            "Préparation de Vencord officiel",
            progress,
            cancellationToken);

        progress?.Report(new InstallerProgress(
            0.46,
            "Vérification de Vencord officiel",
            "Contrôle de l'intégrité SHA-256…",
            true));
        var actualChecksum = await ComputeSha256Async(installerPath, cancellationToken);
        if (!actualChecksum.Equals(expectedChecksum, StringComparison.OrdinalIgnoreCase))
        {
            File.Delete(installerPath);
            throw new InvalidDataException(
                "L'installateur officiel de Vencord ne correspond pas à son empreinte SHA-256 publiée.");
        }

        return installerPath;
    }

    public static string ParseSha256(string checksumFile)
    {
        var candidate = checksumFile
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault();
        if (candidate is null
            || candidate.Length != 64
            || candidate.Any(character => !Uri.IsHexDigit(character)))
        {
            throw new InvalidDataException("Le fichier de contrôle SHA-256 est invalide.");
        }

        return candidate.ToLowerInvariant();
    }

    public static string ParseSha256ForFile(string checksumFile, string fileName)
    {
        foreach (var line in checksumFile.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2) continue;

            var listedFile = parts[^1].TrimStart('*');
            if (listedFile.Equals(fileName, StringComparison.OrdinalIgnoreCase))
                return ParseSha256(parts[0]);
        }

        throw new InvalidDataException(
            $"Le fichier de contrôle ne contient pas d'empreinte pour {fileName}.");
    }

    private async Task DownloadFileWithRetriesAsync(
        string url,
        string destination,
        string stage,
        IProgress<InstallerProgress>? progress,
        CancellationToken cancellationToken)
    {
        Exception? lastError = null;
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                await DownloadFileAsync(url, destination, stage, progress, cancellationToken);
                return;
            }
            catch (Exception error) when (error is not OperationCanceledException && attempt < 3)
            {
                lastError = error;
                progress?.Report(new InstallerProgress(
                    0.08,
                    stage,
                    $"Nouvelle tentative {attempt + 1}/3 après une interruption…",
                    true));
                await Task.Delay(TimeSpan.FromSeconds(attempt * 2), cancellationToken);
            }
        }

        throw new HttpRequestException("Le téléchargement a échoué après trois tentatives.", lastError);
    }

    private async Task DownloadFileAsync(
        string url,
        string destination,
        string stage,
        IProgress<InstallerProgress>? progress,
        CancellationToken cancellationToken)
    {
        var partPath = destination + ".part";
        if (File.Exists(partPath)) File.Delete(partPath);

        using var response = await _httpClient.GetAsync(
            url,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        response.EnsureSuccessStatusCode();

        var totalBytes = response.Content.Headers.ContentLength;
        await using (var source = await response.Content.ReadAsStreamAsync(cancellationToken))
        await using (var destinationStream = new FileStream(
                         partPath,
                         FileMode.Create,
                         FileAccess.Write,
                         FileShare.None,
                         bufferSize: 1024 * 128,
                         useAsync: true))
        {
            var buffer = new byte[1024 * 128];
            long downloaded = 0;
            var stopwatch = Stopwatch.StartNew();
            while (true)
            {
                var count = await source.ReadAsync(buffer, cancellationToken);
                if (count == 0) break;

                await destinationStream.WriteAsync(buffer.AsMemory(0, count), cancellationToken);
                downloaded += count;

                var ratio = totalBytes is > 0 ? (double)downloaded / totalBytes.Value : 0;
                var megabytes = downloaded / 1024d / 1024d;
                var speed = megabytes / Math.Max(stopwatch.Elapsed.TotalSeconds, 0.1);
                var totalLabel = totalBytes is > 0
                    ? $" / {totalBytes.Value / 1024d / 1024d:0.0} Mo"
                    : "";
                progress?.Report(new InstallerProgress(
                    0.08 + ratio * 0.36,
                    stage,
                    $"{megabytes:0.0}{totalLabel} · {speed:0.0} Mo/s",
                    totalBytes is null));
            }

            await destinationStream.FlushAsync(cancellationToken);
        }

        File.Move(partPath, destination, overwrite: true);
    }

    private static async Task<string> ComputeSha256Async(
        string path,
        CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    public void Dispose() => _httpClient.Dispose();
}
