using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Peers;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using RandomFavorites.Setup.Core.Models;
using RandomFavorites.Setup.Core.Services;
using RandomFavorites.Setup.Dialogs;
using RandomFavorites.Setup.Presentation;

namespace RandomFavorites.Setup;

public partial class MainWindow : Window
{
    private readonly InstallerService _installerService = new();
    private readonly CancellationTokenSource _lifetimeCancellation = new();
    private readonly List<string> _logLines = [];
    private CancellationTokenSource? _operationCancellation;
    private InstallState? _installedState;
    private BundleManifest? _installedManifest;
    private BundleManifest? _availableManifest;
    private InstallerProgress? _progress;
    private InstallResult? _result;
    private LogWindow? _logWindow;
    private InstallerPrimaryAction _primaryAction = InstallerPrimaryAction.None;
    private bool _installationHealthy;
    private bool _openAsarInstalled;
    private string? _installedOpenAsarDigest;
    private bool _desiredOpenAsar;
    private bool _isInitializing = true;
    private bool _isDetecting;
    private bool _isBusy;
    private bool _canOpenDiscord;
    private bool _suppressSelectionChanged;
    private bool _suppressOpenAsarChanged;
    private bool _closeWhenIdle;
    private string? _inspectionWarning;
    private string? _lastAnnouncedTitle;

    public MainWindow()
    {
        InitializeComponent();
        _installerService.LogLine += AppendLog;
        ApplyViewState();

        Closing += (_, eventArgs) =>
        {
            if (!_isBusy) return;

            eventArgs.Cancel = true;
            RequestCloseAfterCancellation();
        };
    }

    private DiscordInstallation? SelectedDiscord =>
        DiscordBranchCombo.SelectedItem as DiscordInstallation;

    private async void MainWindow_OnLoaded(object sender, RoutedEventArgs e)
    {
        ClampToWorkArea();
        try
        {
            await DetectDiscordAsync();
        }
        catch (OperationCanceledException) when (_lifetimeCancellation.IsCancellationRequested)
        {
            // The window is closing.
        }
    }

    private void ClampToWorkArea()
    {
        const double margin = 24;
        var workArea = SystemParameters.WorkArea;
        MaxWidth = Math.Max(320, workArea.Width - margin);
        MaxHeight = Math.Max(420, workArea.Height - margin);
        MinWidth = Math.Min(MinWidth, MaxWidth);
        MinHeight = Math.Min(MinHeight, MaxHeight);
        Width = Math.Min(Width, MaxWidth);
        Height = Math.Min(Height, MaxHeight);
    }

    private async Task DetectDiscordAsync()
    {
        if (_isBusy) return;

        _isInitializing = false;
        _isDetecting = true;
        _result = null;
        _canOpenDiscord = false;
        ApplyViewState();
        await Task.Yield();

        var previousBranch = SelectedDiscord?.Branch;
        var installations = _installerService.DiscoverDiscordInstallations();
        var savedState = _installerService.ReadState();
        var selected = installations.FirstOrDefault(item => item.Branch == previousBranch)
            ?? installations.FirstOrDefault(item => item.Branch == savedState?.Branch)
            ?? installations.FirstOrDefault();

        _suppressSelectionChanged = true;
        DiscordBranchCombo.ItemsSource = installations;
        DiscordBranchCombo.SelectedItem = selected;
        _suppressSelectionChanged = false;

        RefreshSelectedLocalState(resetOpenAsarPreference: true);
        _isDetecting = false;
        ApplyViewState();

        if (selected is not null)
            await RefreshAvailableManifestAsync(_lifetimeCancellation.Token);
    }

    private async Task RefreshAvailableManifestAsync(CancellationToken cancellationToken)
    {
        try
        {
            _availableManifest = await _installerService.GetAvailableManifestAsync(cancellationToken);
            _inspectionWarning = null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception error)
        {
            _availableManifest = null;
            _inspectionWarning = "La vérification en ligne est momentanément indisponible.";
            AppendUiLog($"Vérification de la version disponible impossible : {error.Message}");
        }

        ApplyViewState();
    }

    private void RefreshSelectedLocalState(bool resetOpenAsarPreference)
    {
        if (SelectedDiscord is not { } discord)
        {
            _installedState = null;
            _installedManifest = null;
            _installationHealthy = false;
            _openAsarInstalled = false;
            _installedOpenAsarDigest = null;
            if (resetOpenAsarPreference) SetOpenAsarToggle(false);
            return;
        }

        var state = _installerService.ReadState();
        _installedState = state?.Branch == discord.Branch ? state : null;
        _installedManifest = _installerService.ReadInstalledManifest(_installedState);
        _installationHealthy = _installerService.IsInstallationHealthy(
            discord,
            _installedState,
            _installedManifest);
        _openAsarInstalled = _installerService.IsOpenAsarInstalled(discord);
        _installedOpenAsarDigest = _installerService.GetOpenAsarDigest(discord);
        if (resetOpenAsarPreference) SetOpenAsarToggle(_openAsarInstalled);
    }

    private void SetOpenAsarToggle(bool enabled)
    {
        _desiredOpenAsar = enabled;
        _suppressOpenAsarChanged = true;
        OpenAsarToggle.IsChecked = enabled;
        _suppressOpenAsarChanged = false;
    }

    private InstallerStateInput CreateStateInput() => new()
    {
        IsInitializing = _isInitializing,
        IsDetecting = _isDetecting,
        HasDiscord = SelectedDiscord is not null,
        InstalledState = _installedState,
        InstalledManifest = _installedManifest,
        AvailableManifest = _availableManifest,
        InstallationHealthy = _installationHealthy,
        OpenAsarInstalled = _openAsarInstalled,
        InstalledOpenAsarDigest = _installedOpenAsarDigest,
        DesiredOpenAsar = _desiredOpenAsar,
        IsBusy = _isBusy,
        Progress = _progress,
        Result = _result,
        CanOpenDiscord = _canOpenDiscord,
        InspectionWarning = _inspectionWarning,
    };

    private void ApplyViewState()
    {
        if (StatusPanel is null) return;

        var state = InstallerStateResolver.Resolve(CreateStateInput());
        _primaryAction = state.PrimaryAction;
        StatusTitleText.Text = state.Title;
        StatusDetailText.Text = state.Detail;
        PrimaryActionText.Text = state.PrimaryActionText;
        PrimaryActionButton.IsEnabled = state.PrimaryActionEnabled && !_isBusy;
        AutomationProperties.SetName(PrimaryActionButton, state.PrimaryActionText);
        ContextText.Text = state.ContextText;

        ApplyStatusTone(state.Tone);
        ApplyStatusIcon(state.Icon);
        ApplyPrimaryActionIcon(state.PrimaryAction);

        OperationProgress.Visibility = state.ShowProgress
            ? Visibility.Visible
            : Visibility.Collapsed;
        OperationProgress.IsIndeterminate = state.IsProgressIndeterminate
            && SystemParameters.ClientAreaAnimation;
        if (!OperationProgress.IsIndeterminate)
        {
            OperationProgress.Value = state.IsProgressIndeterminate
                ? 50
                : state.ProgressPercent;
        }

        CancelOperationButton.Visibility = _isBusy
            ? Visibility.Visible
            : Visibility.Collapsed;
        CancelOperationButton.IsEnabled = _operationCancellation is not null
            && !_operationCancellation.IsCancellationRequested;

        var hasDiscord = SelectedDiscord is not null;
        DiscordBranchCombo.IsEnabled = !_isBusy && DiscordBranchCombo.Items.Count > 0;
        DetectDiscordButton.Visibility = !hasDiscord && !_isDetecting
            ? Visibility.Visible
            : Visibility.Collapsed;
        DetectDiscordButton.IsEnabled = !_isBusy && !_isDetecting;
        OpenAsarToggle.IsEnabled = !_isBusy && hasDiscord;
        RestartDiscordCheck.IsEnabled = !_isBusy;
        var canRepair = !_isBusy && hasDiscord && _installedState is not null;
        RepairButton.IsEnabled = canRepair;
        RepairMenuItem.IsEnabled = canRepair;
        UninstallMenuItem.IsEnabled = !_isBusy && hasDiscord && _installedState is not null;

        OpenAsarDetailText.Text = GetOpenAsarDetail();
        UpdateAdvancedInformation();
        AnnounceStatusIfChanged(state.Title);
    }

    private void ApplyStatusTone(InstallerStatusTone tone)
    {
        var background = tone switch
        {
            InstallerStatusTone.Success => "SuccessSurface",
            InstallerStatusTone.Accent => "AccentSurface",
            InstallerStatusTone.Warning => "WarningSurface",
            InstallerStatusTone.Error => "ErrorSurface",
            _ => "Surface",
        };
        var accent = tone switch
        {
            InstallerStatusTone.Warning => "Warning",
            InstallerStatusTone.Error => "Error",
            InstallerStatusTone.Neutral => "TextSecondary",
            _ => "Accent",
        };

        StatusPanel.Background = (Brush)FindResource(background);
        StatusPanel.BorderBrush = (Brush)FindResource(
            tone == InstallerStatusTone.Neutral ? "BorderSubtle" : accent);
        StatusIconSurface.Background = (Brush)FindResource(background);
        StatusIcon.Stroke = (Brush)FindResource(accent);
        StatusIcon.Fill = Brushes.Transparent;
    }

    private void ApplyStatusIcon(InstallerStatusIcon icon)
    {
        var resource = icon switch
        {
            InstallerStatusIcon.Check => "CheckGeometry",
            InstallerStatusIcon.Download => "DownloadGeometry",
            InstallerStatusIcon.Warning => "WarningGeometry",
            InstallerStatusIcon.Progress => "DownloadGeometry",
            _ => "StarGeometry",
        };
        StatusIcon.Data = (Geometry)FindResource(resource);
        if (icon == InstallerStatusIcon.Star)
        {
            StatusIcon.Fill = StatusIcon.Stroke;
            StatusIcon.StrokeThickness = 0;
        }
        else
        {
            StatusIcon.Fill = Brushes.Transparent;
            StatusIcon.StrokeThickness = 2;
        }
    }

    private void ApplyPrimaryActionIcon(InstallerPrimaryAction action)
    {
        PrimaryActionIcon.Visibility = action == InstallerPrimaryAction.None && !_isBusy
            ? Visibility.Collapsed
            : Visibility.Visible;
        PrimaryActionIcon.Data = (Geometry)FindResource(action switch
        {
            InstallerPrimaryAction.ApplyChanges => "StarGeometry",
            InstallerPrimaryAction.OpenDiscord => "StarGeometry",
            _ => "DownloadGeometry",
        });
        PrimaryActionIcon.Fill = action is InstallerPrimaryAction.ApplyChanges
            or InstallerPrimaryAction.OpenDiscord
            ? (Brush)FindResource("AccentInk")
            : Brushes.Transparent;
    }

    private string GetOpenAsarDetail()
    {
        if (_openAsarInstalled && !_desiredOpenAsar)
            return "Sera supprimé lors de l'application des changements";
        if (!_openAsarInstalled && _desiredOpenAsar)
            return "Sera installé avec RandomFavorites";
        if (_openAsarInstalled)
            return "Installé · démarrage de Discord plus rapide";
        return "Optionnel · démarrage de Discord plus rapide";
    }

    private void UpdateAdvancedInformation()
    {
        InstalledVencordText.Text = FormatBuild(_installedManifest?.VencordCommit);
        AvailableVencordText.Text = _availableManifest is null
            ? _inspectionWarning is null ? "Vérification…" : "Indisponible"
            : FormatBuild(_availableManifest.VencordCommit);
        PluginVersionText.Text = _installedManifest?.Version ?? "Non installé";
        AdvancedOpenAsarText.Text = _openAsarInstalled ? "Installé" : "Non installé";
        DiscordPathText.Text = SelectedDiscord?.RootPath ?? "Aucune installation sélectionnée";
    }

    private static string FormatBuild(string? commit) =>
        string.IsNullOrWhiteSpace(commit)
            ? "—"
            : $"Build {commit[..Math.Min(8, commit.Length)]}";

    private void AnnounceStatusIfChanged(string title)
    {
        if (title == _lastAnnouncedTitle) return;
        _lastAnnouncedTitle = title;
        AutomationProperties.SetName(StatusPanel, $"{title}. {StatusDetailText.Text}");
        var peer = UIElementAutomationPeer.FromElement(StatusPanel)
            ?? new FrameworkElementAutomationPeer(StatusPanel);
        peer.RaiseAutomationEvent(AutomationEvents.LiveRegionChanged);
    }

    private async Task RunOperationAsync(
        string successTitle,
        Func<DiscordInstallation, IProgress<InstallerProgress>, CancellationToken, Task<InstallResult>> operation)
    {
        if (_isBusy || SelectedDiscord is not { } discord) return;

        _isBusy = true;
        _result = null;
        _canOpenDiscord = false;
        _progress = new InstallerProgress(0, "Préparation", "Initialisation de l'opération…", true);
        _operationCancellation = new CancellationTokenSource();
        ApplyViewState();

        var progress = new Progress<InstallerProgress>(value =>
        {
            _progress = value;
            ApplyViewState();
        });

        try
        {
            var result = await operation(discord, progress, _operationCancellation.Token);
            RefreshSelectedLocalState(resetOpenAsarPreference: true);
            if (result.Success)
            {
                result = result with { Title = successTitle };
                if (RestartDiscordCheck.IsChecked == true)
                {
                    result = TryStartDiscord(discord, result);
                }
                else
                {
                    _canOpenDiscord = true;
                }
            }

            _result = result;
        }
        catch (OperationCanceledException)
        {
            _result = new InstallResult(
                false,
                "Opération annulée",
                "L'opération a été interrompue proprement. Consultez le journal avant de réessayer.");
            RefreshSelectedLocalState(resetOpenAsarPreference: true);
        }
        finally
        {
            _operationCancellation.Dispose();
            _operationCancellation = null;
            _isBusy = false;
            _progress = null;
            ApplyViewState();

            if (_closeWhenIdle)
            {
                _closeWhenIdle = false;
                _ = Dispatcher.BeginInvoke(Close);
            }
        }
    }

    private InstallResult TryStartDiscord(DiscordInstallation discord, InstallResult result)
    {
        try
        {
            _installerService.StartDiscord(discord);
            _canOpenDiscord = false;
            return result with { Message = result.Message + " Discord a été relancé." };
        }
        catch (Exception error)
        {
            _canOpenDiscord = true;
            AppendUiLog($"Discord n'a pas pu être relancé : {error.Message}");
            return result with
            {
                Message = result.Message
                    + " Discord n'a pas pu démarrer automatiquement ; vous pouvez réessayer ci-dessous.",
            };
        }
    }

    private void PrimaryActionButton_OnClick(object sender, RoutedEventArgs e)
    {
        switch (_primaryAction)
        {
            case InstallerPrimaryAction.Install:
            case InstallerPrimaryAction.Update:
            case InstallerPrimaryAction.ApplyChanges:
            case InstallerPrimaryAction.Reinstall:
                var desiredOpenAsar = _desiredOpenAsar;
                _ = RunOperationAsync(
                    "Installation terminée",
                    (discord, progress, token) => _installerService.InstallOrUpdateAsync(
                        discord,
                        desiredOpenAsar,
                        progress,
                        token));
                break;
            case InstallerPrimaryAction.OpenDiscord:
                if (SelectedDiscord is { } discord)
                {
                    var current = _result ?? new InstallResult(
                        true,
                        "Installation terminée",
                        "RandomFavorites est prêt.");
                    _result = TryStartDiscord(discord, current);
                    ApplyViewState();
                }
                break;
            case InstallerPrimaryAction.None:
            default:
                break;
        }
    }

    private async void DetectDiscordButton_OnClick(object sender, RoutedEventArgs e)
    {
        await DetectDiscordAsync();
    }

    private async void DiscordBranchCombo_OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressSelectionChanged || _isBusy) return;

        _result = null;
        _canOpenDiscord = false;
        RefreshSelectedLocalState(resetOpenAsarPreference: true);
        ApplyViewState();
        if (SelectedDiscord is not null && _availableManifest is null)
        {
            try
            {
                await RefreshAvailableManifestAsync(_lifetimeCancellation.Token);
            }
            catch (OperationCanceledException) when (_lifetimeCancellation.IsCancellationRequested)
            {
                // The window is closing.
            }
        }
    }

    private void OpenAsarToggle_OnChanged(object sender, RoutedEventArgs e)
    {
        if (_suppressOpenAsarChanged) return;
        _desiredOpenAsar = OpenAsarToggle.IsChecked == true;
        _result = null;
        _canOpenDiscord = false;
        ApplyViewState();
    }

    private void RepairButton_OnClick(object sender, RoutedEventArgs e) => ShowRepairConfirmation();

    private void RepairMenuItem_OnClick(object sender, RoutedEventArgs e) => ShowRepairConfirmation();

    private void ShowRepairConfirmation()
    {
        if (_isBusy || SelectedDiscord is null) return;
        var dialog = new ConfirmationDialog(
            "Réparer l'installation",
            "La build Vencord et RandomFavorites sera téléchargée, vérifiée puis réappliquée. Vos réglages seront conservés. Discord sera fermé pendant l'opération.",
            "Réparer")
        {
            Owner = this,
        };
        if (dialog.ShowDialog() != true) return;

        var desiredOpenAsar = _desiredOpenAsar;
        _ = RunOperationAsync(
            "Réparation terminée",
            (discord, progress, token) => _installerService.RepairAsync(
                discord,
                desiredOpenAsar,
                progress,
                token));
    }

    private void UninstallMenuItem_OnClick(object sender, RoutedEventArgs e)
    {
        if (_isBusy || SelectedDiscord is null || _installedState is null) return;
        var dialog = new UninstallDialog(_openAsarInstalled) { Owner = this };
        if (dialog.ShowDialog() != true || dialog.Selection is not { } selection) return;

        _ = RunOperationAsync(
            "Désinstallation terminée",
            (discord, progress, token) => _installerService.UninstallAsync(
                discord,
                selection.Mode,
                selection.RemoveRandomFavoritesSettings,
                selection.RemoveOpenAsar,
                progress,
                token));
    }

    private void AdvancedToggle_OnChanged(object sender, RoutedEventArgs e)
    {
        if (AdvancedPanel is null) return;
        var expanded = AdvancedToggle.IsChecked == true;
        AdvancedPanel.Visibility = expanded ? Visibility.Visible : Visibility.Collapsed;
        AdvancedChevron.RenderTransform = new RotateTransform(expanded ? 180 : 0);
        AutomationProperties.SetName(
            AdvancedToggle,
            expanded ? "Masquer les options avancées" : "Afficher les options avancées");
        if (expanded) _ = Dispatcher.BeginInvoke(() => AdvancedPanel.BringIntoView());
    }

    private void MoreButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (MoreButton.ContextMenu is not { } menu) return;
        menu.PlacementTarget = MoreButton;
        menu.IsOpen = true;
    }

    private void ShowLogButton_OnClick(object sender, RoutedEventArgs e) => ShowLogWindow();

    private void ShowLogMenuItem_OnClick(object sender, RoutedEventArgs e) => ShowLogWindow();

    private void ShowLogWindow()
    {
        if (_logWindow is not null)
        {
            _logWindow.Activate();
            return;
        }

        _logWindow = new LogWindow(
            _installerService.CurrentLogFile,
            string.Join(Environment.NewLine, _logLines))
        {
            Owner = this,
        };
        _logWindow.Closed += (_, _) => _logWindow = null;
        _logWindow.Show();
    }

    private void OpenLogsFolderMenuItem_OnClick(object sender, RoutedEventArgs e)
    {
        Directory.CreateDirectory(_installerService.Layout.Logs);
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = _installerService.Layout.Logs,
            UseShellExecute = true,
        });
    }

    private void AboutMenuItem_OnClick(object sender, RoutedEventArgs e)
    {
        var dialog = new AboutDialog(GetDisplayVersion()) { Owner = this };
        _ = dialog.ShowDialog();
    }

    private static string GetDisplayVersion()
    {
        var version = Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;
        if (string.IsNullOrWhiteSpace(version)) return "1.0.0";
        var metadataSeparator = version.IndexOf('+');
        return metadataSeparator >= 0 ? version[..metadataSeparator] : version;
    }

    private void CancelOperationButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (_operationCancellation is null) return;
        CancelOperationButton.IsEnabled = false;
        ContextText.Text = "Annulation en cours…";
        _operationCancellation.Cancel();
    }

    private void AppendUiLog(string message) =>
        _installerService.WriteDiagnostic(message);

    private void AppendLog(string line)
    {
        if (!Dispatcher.CheckAccess())
        {
            _ = Dispatcher.BeginInvoke(() => AppendLog(line));
            return;
        }

        _logLines.Add(line);
        _logWindow?.AppendLine(line);
    }

    private void MinimizeButton_OnClick(object sender, RoutedEventArgs e) =>
        WindowState = WindowState.Minimized;

    private void CloseButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (_isBusy)
        {
            RequestCloseAfterCancellation();
            return;
        }

        Close();
    }

    private void RequestCloseAfterCancellation()
    {
        if (_closeWhenIdle) return;
        _closeWhenIdle = true;
        ContextText.Text = "Annulation propre avant la fermeture…";
        CancelOperationButton.IsEnabled = false;
        _operationCancellation?.Cancel();
    }

    private void MainWindow_OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape && AdvancedToggle.IsChecked == true && !_isBusy)
        {
            AdvancedToggle.IsChecked = false;
            e.Handled = true;
        }
    }

    protected override void OnClosed(EventArgs e)
    {
        _lifetimeCancellation.Cancel();
        _installerService.LogLine -= AppendLog;
        _installerService.Dispose();
        _operationCancellation?.Dispose();
        _lifetimeCancellation.Dispose();
        base.OnClosed(e);
    }
}
