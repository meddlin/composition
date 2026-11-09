using System.Diagnostics;
using Microsoft.UI.Xaml;

namespace Composition.Shell.Spike;

public partial class App : Application
{
    /// <summary>Process start to the first moment our code runs: the part of cold start that is the runtime's, not ours.</summary>
    public static readonly DateTime ProcessStart = Process.GetCurrentProcess().StartTime;

    public App() => InitializeComponent();

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var window = new MainWindow();
        window.Activate();
    }
}
