using System.Reflection;
using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using System.Threading;
using FMMatchLens.Plugin.Diagnostics;

namespace FMMatchLens.Plugin.Memory;

/// <summary>
/// macOS native detour. The macOS BepInEx IL2CPP package dropped <c>INativeDetour</c>, so this goes through
/// MonoMod.Core's <c>IDetourFactory</c>, preferring BepInEx's own <c>Il2CppDetourFactory</c> (Dobby), whose
/// original entry point is a permanent trampoline rather than MonoMod's undo-call-redo one. MonoMod.Core is
/// resolved by reflection, so this file compiles against the Windows BepInEx DLLs.
/// </summary>
internal sealed class MacNativeDetour : NativeDetourHandle
{
    private const string BepInExFactoryType = "BepInEx.Unity.IL2CPP.Hook.Il2CppDetourFactory";

    private readonly object _detour;
    private readonly IDisposable _disposable;
    private readonly Type _detourInterface;
    private readonly Delegate _target;
    private readonly string _provider;
    private nint _trampoline;
    private int _disposed;

    private MacNativeDetour(object detour, Type detourInterface, nint original, Delegate target, nint targetPtr, string provider)
    {
        _detour = detour;
        _disposable = detour as IDisposable
            ?? throw new InvalidOperationException($"{detour.GetType().FullName} is not IDisposable.");
        _detourInterface = detourInterface;
        _target = target;
        _provider = provider;
        OriginalMethodPtr = original;
        DetourMethodPtr = targetPtr;
    }

    public override nint OriginalMethodPtr { get; }
    public override nint DetourMethodPtr { get; }
    public override nint TrampolinePtr => _trampoline;

    public static NativeDetourHandle CreateDetour<T>(nint original, T target) where T : Delegate
    {
        if (original == 0) throw new ArgumentException("Target address is zero.", nameof(original));
        if (target is null) throw new ArgumentNullException(nameof(target));

        var factory = SelectFactory(out var factoryApi, out var provider)
            ?? throw new InvalidOperationException("No native detour API found: this BepInEx build has no MonoMod.Core.");
        var factoryInterface = FindType("MonoMod.Core", "MonoMod.Core.IDetourFactory")!;
        var detourInterface = FindType("MonoMod.Core", "MonoMod.Core.ICoreNativeDetour")
            ?? throw new InvalidOperationException("MonoMod.Core.ICoreNativeDetour not found.");
        if (factoryInterface.GetProperty("SupportsNativeDetourOrigEntrypoint")?.GetValue(factory) is not true)
            throw new NotSupportedException($"{provider} cannot call the original function of a native detour.");

        var create = factoryApi!.GetMethod(
                "CreateNativeDetour",
                BindingFlags.Public | BindingFlags.Static,
                null,
                new[] { factoryInterface, typeof(nint), typeof(nint), typeof(bool) },
                null)
            ?? throw new MissingMethodException("MonoMod.Core.DetourFactory", "CreateNativeDetour");

        var targetPtr = Marshal.GetFunctionPointerForDelegate(target);
        var detour = Invoke(create, null, new object?[] { factory, original, targetPtr, false })
            ?? throw new InvalidOperationException("CreateNativeDetour returned null.");
        PluginLogger.Info($"[macOS] Native detour provider: {provider}.");
        return new MacNativeDetour(detour, detourInterface, original, target, targetPtr, provider);
    }

    public override T GenerateTrampoline<T>()
    {
        var original = ReadOrigEntrypoint();
        if (original == 0)
        {
            // Some providers only build the trampoline when the detour is applied.
            Apply();
            original = ReadOrigEntrypoint();
        }

        if (original == 0)
            throw new InvalidOperationException($"{_provider} returned no original entry point.");
        _trampoline = original;
        return Marshal.GetDelegateForFunctionPointer<T>(original);
    }

    public override void Apply()
    {
        var detourBase = FindType("MonoMod.Core", "MonoMod.Core.ICoreDetourBase");
        if (detourBase?.GetProperty("IsApplied")?.GetValue(_detour) is true) return;
        var apply = detourBase?.GetMethod("Apply", Type.EmptyTypes)
                    ?? _detour.GetType().GetMethod("Apply", BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null)
                    ?? throw new MissingMethodException(_detour.GetType().FullName, "Apply");
        Invoke(apply, _detour, Array.Empty<object?>());
    }

    public override void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        _disposable.Dispose();
        GC.KeepAlive(_target);
    }

    private nint ReadOrigEntrypoint()
    {
        if (_detourInterface.GetProperty("HasOrigEntrypoint")?.GetValue(_detour) is not true) return 0;
        return _detourInterface.GetProperty("OrigEntrypoint")?.GetValue(_detour) is nint pointer ? pointer : 0;
    }

    private static object? SelectFactory(out Type? factoryApi, out string provider)
    {
        provider = "none";
        factoryApi = FindType("MonoMod.Core", "MonoMod.Core.DetourFactory");
        if (factoryApi is null) return null;

        var current = factoryApi.GetProperty("Current", BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
        if (current?.GetType().FullName == BepInExFactoryType)
        {
            provider = $"MonoMod.Core via {BepInExFactoryType} (current)";
            return current;
        }

        // MonoMod's built-in factory has no Apple Silicon support, so use BepInEx's provider when it is not current.
        var bepInExFactory = FindType("BepInEx.Unity.IL2CPP", BepInExFactoryType);
        if (bepInExFactory is not null && Activator.CreateInstance(bepInExFactory, nonPublic: true) is { } created)
        {
            provider = $"MonoMod.Core via {BepInExFactoryType} (created; current is {current?.GetType().FullName ?? "null"})";
            return created;
        }

        if (current is null) return null;
        provider = $"MonoMod.Core via {current.GetType().FullName}";
        return current;
    }

    private static object? Invoke(MethodInfo method, object? instance, object?[] args)
    {
        try
        {
            return method.Invoke(instance, args);
        }
        catch (TargetInvocationException ex) when (ex.InnerException is not null)
        {
            ExceptionDispatchInfo.Capture(ex.InnerException).Throw();
            throw;
        }
    }

    private static Type? FindType(string assemblyName, string fullName)
    {
        foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
        {
            if (!string.Equals(assembly.GetName().Name, assemblyName, StringComparison.Ordinal)) continue;
            var type = assembly.GetType(fullName, throwOnError: false);
            if (type is not null) return type;
        }

        try
        {
            return Assembly.Load(new AssemblyName(assemblyName)).GetType(fullName, throwOnError: false);
        }
        catch
        {
            return null;
        }
    }
}
