using System.Windows;
using System.Windows.Input;
using RandomFavorites.Setup.Core.Models;

namespace RandomFavorites.Setup.Dialogs;

public sealed record UninstallSelection(
    UninstallMode Mode,
    bool RemoveRandomFavoritesSettings,
    bool RemoveOpenAsar);

public partial class UninstallDialog : Window
{
    public UninstallDialog(bool openAsarInstalled)
    {
        InitializeComponent();
        RemoveOpenAsarCheck.Visibility = openAsarInstalled
            ? Visibility.Visible
            : Visibility.Collapsed;
        ContentRendered += (_, _) => CancelButton.Focus();
        UpdateSelection();
    }

    public UninstallSelection? Selection { get; private set; }

    private void Selection_OnChanged(object sender, RoutedEventArgs e) => UpdateSelection();

    private void UpdateSelection()
    {
        if (ConfirmButton is null) return;

        var removesAllData = VencordRemoveDataRadio.IsChecked == true;
        DeleteDataAcknowledge.Visibility = removesAllData
            ? Visibility.Visible
            : Visibility.Collapsed;
        RemovePluginSettingsCheck.IsEnabled = PluginOnlyRadio.IsChecked == true;
        ConfirmButton.IsEnabled = !removesAllData || DeleteDataAcknowledge.IsChecked == true;

        var explanation = removesAllData
            ? "Vencord, ses thèmes et ses réglages locaux seront supprimés."
            : VencordKeepDataRadio.IsChecked == true
                ? "Vencord sera retiré. Ses réglages resteront disponibles pour une réinstallation."
                : "RandomFavorites sera retiré. Vencord et ses autres réglages seront conservés.";
        if (RemoveOpenAsarCheck.Visibility == Visibility.Visible)
        {
            explanation += RemoveOpenAsarCheck.IsChecked == true
                ? " OpenAsar sera également retiré."
                : " OpenAsar sera conservé.";
        }

        ExplanationText.Text = explanation;
    }

    private void ConfirmButton_OnClick(object sender, RoutedEventArgs e)
    {
        var mode = VencordRemoveDataRadio.IsChecked == true
            ? UninstallMode.VencordRemoveData
            : VencordKeepDataRadio.IsChecked == true
                ? UninstallMode.VencordKeepData
                : UninstallMode.RandomFavoritesOnly;
        Selection = new UninstallSelection(
            mode,
            PluginOnlyRadio.IsChecked == true && RemovePluginSettingsCheck.IsChecked == true,
            RemoveOpenAsarCheck.Visibility == Visibility.Visible
                && RemoveOpenAsarCheck.IsChecked == true);
        DialogResult = true;
    }

    private void CancelButton_OnClick(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
    }

    private void Dialog_OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape) return;
        e.Handled = true;
        DialogResult = false;
    }
}
