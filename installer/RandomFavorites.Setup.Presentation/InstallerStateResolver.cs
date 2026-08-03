using RandomFavorites.Setup.Core.Models;

namespace RandomFavorites.Setup.Presentation;

public enum InstallerScreenStatus
{
    Initializing,
    Detecting,
    NotInstalled,
    UpToDate,
    UpdateAvailable,
    RepairRequired,
    Busy,
    Success,
    Warning,
    Error,
}

public enum InstallerPrimaryAction
{
    None,
    Install,
    Update,
    ApplyChanges,
    Reinstall,
    OpenDiscord,
}

public enum InstallerStatusTone
{
    Neutral,
    Success,
    Accent,
    Warning,
    Error,
}

public enum InstallerStatusIcon
{
    Star,
    Check,
    Download,
    Warning,
    Progress,
}

public sealed record InstallerStateInput
{
    public bool IsInitializing { get; init; }

    public bool IsDetecting { get; init; }

    public bool HasDiscord { get; init; }

    public InstallState? InstalledState { get; init; }

    public BundleManifest? InstalledManifest { get; init; }

    public BundleManifest? AvailableManifest { get; init; }

    public bool InstallationHealthy { get; init; }

    public bool OpenAsarInstalled { get; init; }

    public string? InstalledOpenAsarDigest { get; init; }

    public bool DesiredOpenAsar { get; init; }

    public bool IsBusy { get; init; }

    public InstallerProgress? Progress { get; init; }

    public InstallResult? Result { get; init; }

    public bool CanOpenDiscord { get; init; }

    public string? InspectionWarning { get; init; }
}

public sealed record InstallerViewState(
    InstallerScreenStatus Status,
    InstallerStatusTone Tone,
    InstallerStatusIcon Icon,
    string Title,
    string Detail,
    InstallerPrimaryAction PrimaryAction,
    string PrimaryActionText,
    bool PrimaryActionEnabled,
    string ContextText,
    bool ShowProgress = false,
    bool IsProgressIndeterminate = false,
    double ProgressPercent = 0);

public static class InstallerStateResolver
{
    public static InstallerViewState Resolve(InstallerStateInput input)
    {
        ArgumentNullException.ThrowIfNull(input);

        if (input.IsInitializing)
        {
            return State(
                InstallerScreenStatus.Initializing,
                InstallerStatusTone.Neutral,
                InstallerStatusIcon.Progress,
                "Préparation de l'installeur",
                "Lecture de la configuration locale…",
                context: "Initialisation…");
        }

        if (input.IsDetecting)
        {
            return State(
                InstallerScreenStatus.Detecting,
                InstallerStatusTone.Neutral,
                InstallerStatusIcon.Progress,
                "Recherche de Discord",
                "Détection des installations présentes sur ce PC…",
                context: "Détection en cours…");
        }

        if (input.IsBusy)
        {
            var progress = input.Progress;
            return new InstallerViewState(
                InstallerScreenStatus.Busy,
                InstallerStatusTone.Accent,
                InstallerStatusIcon.Progress,
                progress?.Stage ?? "Installation en cours",
                progress?.Detail ?? "Préparation de l'opération…",
                InstallerPrimaryAction.None,
                "Installation en cours…",
                PrimaryActionEnabled: false,
                progress?.Stage ?? "Installation en cours…",
                ShowProgress: true,
                IsProgressIndeterminate: progress?.IsIndeterminate ?? true,
                ProgressPercent: Math.Clamp((progress?.Percent ?? 0) * 100, 0, 100));
        }

        if (input.Result is { } result)
        {
            if (result.Success)
            {
                var canInstall = input.HasDiscord && input.InstalledState is null;
                return State(
                    InstallerScreenStatus.Success,
                    InstallerStatusTone.Success,
                    InstallerStatusIcon.Check,
                    result.Title,
                    result.Message,
                    input.CanOpenDiscord
                        ? InstallerPrimaryAction.OpenDiscord
                        : canInstall
                            ? InstallerPrimaryAction.Install
                            : InstallerPrimaryAction.None,
                    input.CanOpenDiscord
                        ? "Ouvrir Discord"
                        : canInstall
                            ? "Installer"
                            : "Tout est à jour",
                    input.CanOpenDiscord || canInstall,
                    result.Title);
            }

            return State(
                InstallerScreenStatus.Error,
                InstallerStatusTone.Error,
                InstallerStatusIcon.Warning,
                result.Title,
                ToFriendlyError(result.Message),
                input.HasDiscord
                    ? InstallerPrimaryAction.Reinstall
                    : InstallerPrimaryAction.None,
                input.HasDiscord ? "Réessayer" : "Indisponible",
                input.HasDiscord,
                "Consultez le journal si le problème persiste.");
        }

        if (!input.HasDiscord)
        {
            return State(
                InstallerScreenStatus.Warning,
                InstallerStatusTone.Warning,
                InstallerStatusIcon.Warning,
                "Aucune installation Discord détectée",
                "Installez Discord ou relancez la détection.",
                context: "Discord est nécessaire pour continuer.");
        }

        if (input.InstalledState is null)
        {
            return State(
                InstallerScreenStatus.NotInstalled,
                InstallerStatusTone.Neutral,
                InstallerStatusIcon.Star,
                "RandomFavorites n'est pas installé",
                "Prêt pour l'installation",
                InstallerPrimaryAction.Install,
                "Installer",
                context: "Discord sera fermé pendant l'installation.");
        }

        if (input.InstalledManifest is null || !input.InstallationHealthy)
        {
            return State(
                InstallerScreenStatus.RepairRequired,
                InstallerStatusTone.Warning,
                InstallerStatusIcon.Warning,
                "Installation endommagée",
                "Une réparation est recommandée",
                InstallerPrimaryAction.Reinstall,
                "Réinstaller",
                context: "Discord sera fermé pendant la réparation.");
        }

        if (input.AvailableManifest is null)
        {
            var openAsarPreferenceChanged = input.OpenAsarInstalled != input.DesiredOpenAsar;
            return State(
                InstallerScreenStatus.Warning,
                InstallerStatusTone.Warning,
                InstallerStatusIcon.Warning,
                "RandomFavorites est installé",
                input.InspectionWarning ?? "La version disponible n'a pas pu être vérifiée.",
                openAsarPreferenceChanged
                    ? InstallerPrimaryAction.ApplyChanges
                    : InstallerPrimaryAction.Reinstall,
                openAsarPreferenceChanged ? "Appliquer les changements" : "Réinstaller",
                context: "Vérifiez votre connexion avant de continuer.");
        }

        if (!BuildsMatch(input.InstalledManifest, input.AvailableManifest)
            || IsOpenAsarOutdated(input))
        {
            return State(
                InstallerScreenStatus.UpdateAvailable,
                InstallerStatusTone.Accent,
                InstallerStatusIcon.Download,
                "Mise à jour disponible",
                string.Equals(
                    input.InstalledManifest.Version,
                    input.AvailableManifest.Version,
                    StringComparison.OrdinalIgnoreCase)
                    ? "Une nouvelle build vérifiée est disponible"
                    : $"{input.InstalledManifest.Version} → {input.AvailableManifest.Version}",
                InstallerPrimaryAction.Update,
                "Mettre à jour",
                context: "Discord sera fermé pendant la mise à jour.");
        }

        if (input.OpenAsarInstalled != input.DesiredOpenAsar)
        {
            return State(
                InstallerScreenStatus.UpToDate,
                InstallerStatusTone.Success,
                InstallerStatusIcon.Check,
                "RandomFavorites est à jour",
                $"Version {input.InstalledManifest.Version}",
                InstallerPrimaryAction.ApplyChanges,
                "Appliquer les changements",
                context: "Discord sera fermé pour appliquer ce changement.");
        }

        return State(
            InstallerScreenStatus.UpToDate,
            InstallerStatusTone.Success,
            InstallerStatusIcon.Check,
            "RandomFavorites est à jour",
            $"Version {input.InstalledManifest.Version}",
            context: "Aucune action nécessaire.",
            primaryActionText: "Tout est à jour");
    }

    private static bool BuildsMatch(BundleManifest installed, BundleManifest available) =>
        string.Equals(installed.Version, available.Version, StringComparison.OrdinalIgnoreCase)
        && string.Equals(
            installed.PluginCommit,
            available.PluginCommit,
            StringComparison.OrdinalIgnoreCase)
        && string.Equals(
            installed.VencordCommit,
            available.VencordCommit,
            StringComparison.OrdinalIgnoreCase);

    private static bool IsOpenAsarOutdated(InstallerStateInput input) =>
        input.DesiredOpenAsar
        && input.OpenAsarInstalled
        && !string.Equals(
            input.InstalledOpenAsarDigest,
            input.AvailableManifest?.OpenAsarDigest,
            StringComparison.OrdinalIgnoreCase);

    private static string ToFriendlyError(string message)
    {
        if (message.Contains("télécharg", StringComparison.OrdinalIgnoreCase)
            || message.Contains("HTTP", StringComparison.OrdinalIgnoreCase)
            || message.Contains("connexion", StringComparison.OrdinalIgnoreCase))
        {
            return "Le téléchargement a échoué. Vérifiez votre connexion puis relancez l'opération.";
        }

        if (message.Contains("Discord est introuvable", StringComparison.OrdinalIgnoreCase)
            || message.Contains("dossier resources", StringComparison.OrdinalIgnoreCase))
        {
            return "L'installation Discord sélectionnée n'existe plus. Relancez la détection.";
        }

        return "L'opération n'a pas abouti. Consultez le journal pour afficher les détails techniques.";
    }

    private static InstallerViewState State(
        InstallerScreenStatus status,
        InstallerStatusTone tone,
        InstallerStatusIcon icon,
        string title,
        string detail,
        InstallerPrimaryAction primaryAction = InstallerPrimaryAction.None,
        string primaryActionText = "Tout est à jour",
        bool primaryActionEnabled = false,
        string context = "") => new(
            status,
            tone,
            icon,
            title,
            detail,
            primaryAction,
            primaryActionText,
            primaryActionEnabled || primaryAction != InstallerPrimaryAction.None,
            context);
}
