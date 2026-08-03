using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Input;

namespace RandomFavorites.Setup.Dialogs;

public partial class LogWindow : Window
{
    private readonly string _logFile;

    public LogWindow(string logFile, string currentLog)
    {
        InitializeComponent();
        _logFile = logFile;
        LogTextBox.Text = currentLog;
        OpenFileButton.IsEnabled = File.Exists(_logFile);
        ContentRendered += (_, _) =>
        {
            LogTextBox.ScrollToEnd();
            LogTextBox.Focus();
        };
    }

    public void AppendLine(string line)
    {
        if (!Dispatcher.CheckAccess())
        {
            _ = Dispatcher.BeginInvoke(() => AppendLine(line));
            return;
        }

        LogTextBox.AppendText((LogTextBox.Text.Length == 0 ? "" : Environment.NewLine) + line);
        LogTextBox.ScrollToEnd();
        OpenFileButton.IsEnabled = File.Exists(_logFile);
    }

    private void CopyButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrEmpty(LogTextBox.Text)) Clipboard.SetText(LogTextBox.Text);
    }

    private void OpenFileButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (!File.Exists(_logFile)) return;
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = _logFile,
            UseShellExecute = true,
        });
    }

    private void ClearButton_OnClick(object sender, RoutedEventArgs e) => LogTextBox.Clear();

    private void CloseButton_OnClick(object sender, RoutedEventArgs e) => Close();

    private void Window_OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape) return;
        e.Handled = true;
        Close();
    }
}
