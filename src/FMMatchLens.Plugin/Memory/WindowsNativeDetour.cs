using BepInEx.Unity.IL2CPP.Hook;

namespace FMMatchLens.Plugin.Memory;

/// <summary>BepInEx's <c>INativeDetour</c>, unchanged; only wrapped so macOS can use another provider.</summary>
internal sealed class WindowsNativeDetour : NativeDetourHandle
{
    private readonly INativeDetour _detour;

    private WindowsNativeDetour(INativeDetour detour) => _detour = detour;

    public static NativeDetourHandle Create<T>(nint original, T target) where T : Delegate =>
        new WindowsNativeDetour(INativeDetour.Create(original, target));

    public override nint OriginalMethodPtr => _detour.OriginalMethodPtr;
    public override nint DetourMethodPtr => _detour.DetourMethodPtr;
    public override nint TrampolinePtr => _detour.TrampolinePtr;
    public override T GenerateTrampoline<T>() => _detour.GenerateTrampoline<T>();
    public override void Apply() => _detour.Apply();
    public override void Dispose() => _detour.Dispose();
}
