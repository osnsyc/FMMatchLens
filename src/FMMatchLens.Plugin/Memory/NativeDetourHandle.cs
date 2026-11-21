using System.Runtime.CompilerServices;

namespace FMMatchLens.Plugin.Memory;

/// <summary>
/// A native detour with a permanent trampoline, in the same steps as BepInEx's <c>INativeDetour</c>:
/// create, generate the trampoline, apply. On Windows it is BepInEx's <c>INativeDetour</c> itself
/// (<see cref="WindowsNativeDetour"/>). The macOS BepInEx IL2CPP package has no <c>INativeDetour</c>,
/// so there it is a MonoMod.Core detour (<see cref="MacNativeDetour"/>).
/// </summary>
internal abstract class NativeDetourHandle : IDisposable
{
    public abstract nint OriginalMethodPtr { get; }
    public abstract nint DetourMethodPtr { get; }
    public abstract nint TrampolinePtr { get; }
    public abstract T GenerateTrampoline<T>() where T : Delegate;
    public abstract void Apply();
    public abstract void Dispose();

    public static NativeDetourHandle Create<T>(nint original, T target) where T : Delegate =>
        MacNative.IsMacOS ? CreateMac(original, target) : CreateWindows(original, target);

    // Separate methods, so INativeDetour is only loaded where it is used: a type that
    // references it cannot load on macOS, where it does not exist.
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static NativeDetourHandle CreateWindows<T>(nint original, T target) where T : Delegate =>
        WindowsNativeDetour.Create(original, target);

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static NativeDetourHandle CreateMac<T>(nint original, T target) where T : Delegate =>
        MacNativeDetour.Create(original, target);
}
