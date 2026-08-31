namespace FMMatchLens.Plugin.Services;

internal static class ArchiveDiagnostics
{
    private static Action<string>? _debug;
    private static Action<string>? _warning;
    private static Action<string>? _info;

    public static void Configure(Action<string> debug, Action<string> warning, Action<string> info)
    {
        _debug = debug;
        _warning = warning;
        _info = info;
    }

    public static void Debug(string message) => _debug?.Invoke(message);

    public static void Warning(string message) => _warning?.Invoke(message);

    public static void Info(string message) => _info?.Invoke(message);
}
