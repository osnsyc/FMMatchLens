#if LENS_UNITY
extern alias UnityInterop;
using FMMatchLens.Plugin.Diagnostics;
using Il2CppInterop.Runtime.Attributes;
using UnityInterop::UnityEngine;

namespace FMMatchLens.Plugin.Sdk;

/// <summary>Only this component may drive third-party delegates.</summary>
public sealed class SdkUpdatePump(IntPtr pointer) : MonoBehaviour(pointer)
{
    private MatchDataHub? _hub;
    private long _nextDiagnostics;

    [HideFromIl2Cpp]
    internal void Attach(MatchDataHub hub) => Volatile.Write(ref _hub, hub);

    [HideFromIl2Cpp]
    internal void Detach() => Volatile.Write(ref _hub, null);

    public void Update()
    {
        var hub = Volatile.Read(ref _hub);
        if (hub is null) { Destroy(this); return; }
        hub.Pump();
        if (PluginLogger.IsDebugEnabled && Environment.TickCount64 >= _nextDiagnostics)
        {
            _nextDiagnostics = Environment.TickCount64 + 5_000;
            PluginLogger.Debug(hub.GetDispatchDiagnostics());
        }
    }
}
#endif
