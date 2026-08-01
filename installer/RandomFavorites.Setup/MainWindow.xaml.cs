using System.Reflection;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using RandomFavorites.Setup.Core.Models;
using RandomFavorites.Setup.Core.Services;

namespace RandomFavorites.Setup;

public partial class MainWindow : Window
{
    private readonly InstallerService _installerService = new();
    private CancellationTokenSource? _operationCancellation;
    private bool _isBusy;
    private bool _closeWhenIdle;

    public MainWindow()
    {
        InitializeComponent();
        VersionText.Text = $"v{GetDisplayVersion()}";
        _installerService.LogLine += AppendLog;
        LoadDiscordInstallations();
        RefreshInstalledState();
        UpdateMaximizeButton();

        StateChanged += (_, _) => UpdateMaximizeButton();
        Closing += (_, eventArgs) =>
        {
            if (!_isBusy) return;

            eventArgs.Cancel = true;
            RequestCloseAfterCancellation();
        };
    }

    private DiscordInstallation? SelectedDiscord =>
        DiscordBranchCombo.SelectedItem as DiscordInstallation;

    private static string GetDisplayVersion()
    {
        var version = Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;
        if (string.IsNullOrWhiteSpace(version)) return "1.0.0";
        var metadataSeparator = version.IndexOf('+');
        return metadataSeparator >= 0 ? version[..metadataSeparator] : version;
    }

    private void LoadDiscordInstallations()
    {
        var installations = _installerService.DiscoverDiscordInstallations();
        DiscordBranchCombo.ItemsSource = installations;

        var state = _installerService.ReadState();
        DiscordBranchCombo.SelectedItem = state is null
            ? installations.FirstOrDefault()
            : installations.FirstOrDefault(item => item.Branch == state.Branch)
                ?? installations.FirstOrDefault();

        if (installations.Count == 0)
        {
            DiscordDetectionText.Text = "Discord introuvable";
            DiscordDetectionText.Visibility = Visibility.Visible;
            DiscordDetectionText.Foreground = (Brush)FindResource("Danger");
            SetActionButtonsEnabled(false);
        }
    }

    private void RefreshInstalledState()
    {
        var state = _installerService.ReadState();
        if (state is null)
        {
            InstalledStatusText.Text = "Non installé";
            InstallButton.Content = "Installer";
            return;
        }

        InstalledStatusText.Text = $"{state.Version} installé";
        InstallButton.Content = "Mettre à jour";
    }

    private void SetActionButtonsEnabled(bool enabled)
    {
        var hasDiscord = DiscordBranchCombo.Items.Count > 0;
        InstallButton.IsEnabled = enabled && hasDiscord;
        RepairButton.IsEnabled = enabled && hasDiscord;
        UninstallButton.IsEnabled = enabled && hasDiscord;
        DiscordBranchCombo.IsEnabled = enabled && hasDiscord;
    }

    private async Task RunOperationAsync(
        Func<DiscordInstallation, IProgress<InstallerProgress>, CancellationToken, Task<InstallResult>> operation)
    {
        if (_isBusy || SelectedDiscord is not { } discord) return;

        _isBusy = true;
        _operationCancellation = new CancellationTokenSource();
        SetActionButtonsEnabled(false);
        CancelOperationButton.IsEnabled = true;
        CancelOperationButton.Visibility = Visibility.Visible;
        ResultPanel.Visibility = Visibility.Collapsed;
        OperationProgress.Value = 0;

        var progress = new Progress<InstallerProgress>(UpdateProgress);
        try
        {
            var result = await operation(discord, progress, _operationCancellation.Token);
            ShowResult(result);
            RefreshInstalledState();
        }
        catch (OperationCanceledException)
        {
            ProgressStageText.Text = "Opération annulée";
            ProgressDetailText.Text = "Aucun autre changement.";
            OperationProgress.IsIndeterminate = false;
            ShowResult(new InstallResult(
                false,
                "Opération annulée",
                "Discord reste fermé s'il avait déjà été arrêté."));
        }
        finally
        {
            _operationCancellation.Dispose();
            _operationCancellation = null;
            _isBusy = false;
            CancelOperationButton.Visibility = Visibility.Collapsed;
            SetActionButtonsEnabled(true);

            if (_closeWhenIdle)
            {
                _closeWhenIdle = false;
                _ = Dispatcher.BeginInvoke(Close);
            }
        }
    }

    private void UpdateProgress(InstallerProgress progress)
    {
        OperationProgress.IsIndeterminate = progress.IsIndeterminate;
        if (!progress.IsIndeterminate)
            OperationProgress.Value = Math.Clamp(progress.Percent * 100, 0, 100);
        ProgressStageText.Text = progress.Stage;
        ProgressDetailText.Text = progress.Detail;
    }

    private void ShowResult(InstallResult result)
    {
        ResultPanel.Visibility = Visibility.Visible;
        ResultPanel.Background = new SolidColorBrush(
            (Color)ColorConverter.ConvertFromString(result.Success ? "#14241F" : "#28181E"));
        ResultPanel.BorderBrush = new SolidColorBrush(
            (Color)ColorConverter.ConvertFromString(result.Success ? "#285E4A" : "#6B2C3C"));
        ResultTitle.Foreground = (Brush)FindResource(result.Success ? "Success" : "Danger");
        ResultTitle.Text = result.Title;
        ResultMessage.Text = result.Message;
    }

    private void AppendLog(string line)
    {
        Dispatcher.Invoke(() =>
        {
            LogText.Text += (LogText.Text.Length == 0 ? "" : Environment.NewLine) + line;
            LogScrollViewer.ScrollToEnd();
        });
    }

    private void InstallButton_OnClick(object sender, RoutedEventArgs e) =>
        _ = RunOperationAsync((discord, progress, token) =>
            _installerService.InstallOrUpdateAsync(discord, progress, token));

    private void RepairButton_OnClick(object sender, RoutedEventArgs e) =>
        _ = RunOperationAsync((discord, progress, token) =>
            _installerService.RepairAsync(discord, progress, token));

    private void UninstallButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (_isBusy) return;
        UninstallOverlay.Visibility = Visibility.Visible;
        UpdateUninstallChoice();
    }

    private void CancelUninstallButton_OnClick(object sender, RoutedEventArgs e) =>
        UninstallOverlay.Visibility = Visibility.Collapsed;

    private void ConfirmUninstallButton_OnClick(object sender, RoutedEventArgs e)
    {
        var mode = RemoveEverythingRadio.IsChecked == true
            ? UninstallMode.VencordRemoveData
            : RemoveVencordKeepDataRadio.IsChecked == true
                ? UninstallMode.VencordKeepData
                : UninstallMode.RandomFavoritesOnly;
        var removePluginSettings = RemovePluginOnlyRadio.IsChecked == true
            && RemovePluginSettingsCheck.IsChecked == true;

        UninstallOverlay.Visibility = Visibility.Collapsed;
        _ = RunOperationAsync((discord, progress, token) =>
            _installerService.UninstallAsync(
                discord,
                mode,
                removePluginSettings,
                progress,
                token));
    }

    private void UninstallChoice_OnChecked(object sender, RoutedEventArgs e) =>
        UpdateUninstallChoice();

    private void DeleteDataAcknowledge_OnChanged(object sender, RoutedEventArgs e) =>
        UpdateUninstallChoice();

    private void UpdateUninstallChoice()
    {
        if (ConfirmUninstallButton is null) return;

        var removeEverything = RemoveEverythingRadio.IsChecked == true;
        DeleteDataAcknowledge.Visibility = removeEverything
            ? Visibility.Visible
            : Visibility.Collapsed;
        RemovePluginSettingsCheck.IsEnabled = RemovePluginOnlyRadio.IsChecked == true;
        ConfirmUninstallButton.IsEnabled = !removeEverything
            || DeleteDataAcknowledge.IsChecked == true;

        UninstallExplanationText.Text = removeEverything
            ? "Supprime Vencord, les thèmes et les réglages locaux."
            : RemoveVencordKeepDataRadio.IsChecked == true
                ? "Retire Vencord. Les données locales sont conservées."
                : "Retire RandomFavorites. Vencord est conservé.";
    }

    private void CancelOperationButton_OnClick(object sender, RoutedEventArgs e)
    {
        CancelOperationButton.IsEnabled = false;
        ProgressDetailText.Text = "Annulation en cours…";
        _operationCancellation?.Cancel();
    }

    private void DiscordBranchCombo_OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (SelectedDiscord is not { } discord) return;
        DiscordDetectionText.Visibility = Visibility.Collapsed;
    }

    private void MinimizeButton_OnClick(object sender, RoutedEventArgs e) =>
        WindowState = WindowState.Minimized;

    private void MaximizeButton_OnClick(object sender, RoutedEventArgs e) =>
        WindowState = WindowState == WindowState.Maximized
            ? WindowState.Normal
            : WindowState.Maximized;

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
        CancelOperationButton.IsEnabled = false;
        ProgressStageText.Text = "Fermeture en cours";
        ProgressDetailText.Text = "L'opération est annulée proprement. Discord ne sera pas relancé.";
        _operationCancellation?.Cancel();
    }

    private void UpdateMaximizeButton()
    {
        if (MaximizeButton is null) return;

        var isMaximized = WindowState == WindowState.Maximized;
        MaximizeButton.Content = isMaximized ? "❐" : "□";
        MaximizeButton.ToolTip = isMaximized ? "Restaurer" : "Agrandir";
        AutomationProperties.SetName(
            MaximizeButton,
            isMaximized ? "Restaurer" : "Agrandir");
    }

    protected override void OnClosed(EventArgs e)
    {
        _installerService.Dispose();
        _operationCancellation?.Dispose();
        base.OnClosed(e);
    }
}
