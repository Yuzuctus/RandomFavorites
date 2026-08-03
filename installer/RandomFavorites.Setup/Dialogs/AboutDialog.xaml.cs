using System.Diagnostics;
using System.Windows;
using System.Windows.Input;

namespace RandomFavorites.Setup.Dialogs;

public partial class AboutDialog : Window
{
    public AboutDialog(string version)
    {
        InitializeComponent();
        VersionText.Text = $"Version {version}";
        ContentRendered += (_, _) => CloseButton.Focus();
    }

    private void GitHubButton_OnClick(object sender, RoutedEventArgs e)
    {
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = "https://github.com/Yuzuctus/RandomFavorites",
            UseShellExecute = true,
        });
    }

    private void CloseButton_OnClick(object sender, RoutedEventArgs e) => Close();

    private void Dialog_OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape) return;
        e.Handled = true;
        Close();
    }
}
