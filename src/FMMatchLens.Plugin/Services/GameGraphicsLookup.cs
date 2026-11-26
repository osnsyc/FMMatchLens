using System.Reflection;

namespace FMMatchLens.Plugin.Services;

internal static class GameGraphicsLookup
{
    private static MethodInfo? _getSubsystem;
    private static MethodInfo? _tryLocate;
    private static PropertyInfo? _initialised;

    // Bind generated SI.Core interop at runtime so missing graphics APIs cannot
    // prevent match collection. Called exclusively on the Unity thread.
    internal static string? Resolve(string key)
    {
        if (_getSubsystem is null)
        {
            var assembly = Assembly.Load("SI.Core");
            var resourceType = assembly.GetType("SI.Core.ResourcesSubsystem", true)!;
            var subsystemType = assembly.GetType("SI.Core.GameSubsystems", true)!;
            var get = subsystemType.GetMethods().Single(m => m.Name == "Get" && m.IsGenericMethodDefinition && m.GetParameters().Length == 0);
            _tryLocate = resourceType.GetMethod("TryLocateLocalFiles", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                ?? throw new MissingMethodException(resourceType.FullName, "TryLocateLocalFiles");
            _initialised = resourceType.GetProperty("IsInitialised");
            _getSubsystem = get.MakeGenericMethod(resourceType);
        }
        if (_initialised?.GetValue(null) is false) return null;
        var resources = _getSubsystem.Invoke(null, null);
        if (resources is null) return null;
        // The game owns registration ordering and legacy mapping conversion.
        // Look up one key without enumerating/copying LocalPathIndex.m_filesByKey.
        object?[] arguments = { key, null };
        if (_tryLocate!.Invoke(resources, arguments) is not true || arguments[1] is not { } locations)
            return null;
        var type = locations.GetType();
        var count = (int)type.GetProperty("Count")!.GetValue(locations)!;
        if (count is < 0 or > 1024) return null;
        var item = type.GetProperty("Item")!;
        for (var i = 0; i < count; i++)
        {
            var location = item.GetValue(locations, new object[] { i });
            var candidate = location?.GetType().GetProperty("InternalId")?.GetValue(location) as string;
            if (string.IsNullOrEmpty(candidate) || !Path.IsPathFullyQualified(candidate)) continue;
            var extension = Path.GetExtension(candidate).ToLowerInvariant();
            if (extension is not (".png" or ".jpg" or ".jpeg" or ".webp" or ".bmp" or ".gif")) continue;
            if (File.Exists(candidate)) return Path.GetFullPath(candidate);
        }
        return null;
    }
}
