extern alias UnityInterop;
using BepInEx;
using BepInEx.Unity.IL2CPP;
using FMMatchLens.Contracts;
using Il2CppInterop.Runtime.Attributes;
using UnityInterop::UnityEngine;

namespace FMMatchLens.Examples.MinimalUnityHud;

[BepInPlugin("com.fmmatchlens.examples.minimalhud", "FMMatchLens Minimal HUD", HudMetadata.Version)]
[BepInDependency(LensApi.PluginId, BepInDependency.DependencyFlags.HardDependency)]
public sealed class Plugin : BasePlugin
{
    private HudBehaviour? _hud;
    public override void Load() => _hud = AddComponent<HudBehaviour>();
    public override bool Unload() { _hud?.Detach(); _hud = null; return true; }
}

public sealed class HudBehaviour(IntPtr pointer) : MonoBehaviour(pointer)
{
    private ILensMatchDataProvider? _provider;
    private ILensSubscription? _events, _lifecycle, _motionToken, _summaryToken;
    private readonly HudViewState _view = new();
    private bool _moduleMode;
    private long _nextRefresh;
    private bool _visible = true, _stopped;

    public void Update()
    {
        if (_stopped) { Destroy(this); return; }
        var provider = LensApi.TryGetProvider();
        if (!ReferenceEquals(provider, _provider))
        {
            Release();
            _provider = provider is { ApiMajorVersion: 1 } ? provider : null;
            if (_provider is not null)
            {
                try
                {
                    _events = _provider.SubscribeEvents(OnEvent);
                    _lifecycle = _provider.SubscribeLifecycle(OnLifecycle);
                    if (_moduleMode)
                    {
                        _motionToken = _provider.SubscribeMotion(OnMotion);
                        _summaryToken = _provider.SubscribeSummary(OnSummary);
                    }
                }
                catch (ObjectDisposedException) { Release(); }
            }
        }
        if (_view.SynchronizeSession(_provider?.Status)) _nextRefresh = 0;
        if (_moduleMode) return;
        if (Environment.TickCount64 < _nextRefresh) return;
        _nextRefresh = Environment.TickCount64 + 100;
        var snapshot = _provider is not null && _provider.TryGetLatestSnapshot(out var current) ? current : null;
        _view.SetSnapshot(snapshot, _provider?.Status);
    }

    [HideFromIl2Cpp]
    private void OnEvent(MatchEventNotification notification) => _view.AcceptEvent(notification, _provider?.Status);

    [HideFromIl2Cpp]
    private void OnLifecycle(MatchLifecycleEvent e) => _view.SynchronizeSession(_provider?.Status);

    [HideFromIl2Cpp]
    private void OnMotion(MotionSnapshot value)
    {
        if (_moduleMode) _view.AcceptMotion(value, _provider?.Status);
    }

    [HideFromIl2Cpp]
    private void OnSummary(SummarySnapshot value)
    {
        if (_moduleMode) _view.AcceptSummary(value, _provider?.Status);
    }

    public void OnGUI()
    {
        if (_stopped) return;
        // Legacy Input can throw when the game disables the old input backend.
        // Handle key releases once, including while hidden so F8 can restore the HUD.
        var input = Event.current;
        if (input is not null && input.type == EventType.KeyUp)
        {
            if (input.keyCode == KeyCode.F8)
            {
                _visible = !_visible;
                input.Use();
            }
            else if (input.keyCode == KeyCode.F9)
            {
                _moduleMode = !_moduleMode;
                Release();
                _nextRefresh = 0;
                input.Use();
            }
        }
        if (!_visible) return;
        GUI.Box(new Rect(16, 16, 510, 240), $"SDK 1.0 — F8 visibility / F9 {(_moduleMode ? "modules" : "full snapshot")}");
        var text = _provider is null ? "Data SDK unavailable" : $"State: {_provider.Status.State}\n{_provider.Status.Reason}";
        if (!_moduleMode && _view.Snapshot is { } s)
        {
            var holder = s.Players.FirstOrDefault(p => p.IsBallHolder);
            text = $"Session: {s.SessionId}\nTick: {s.Tick} (display {s.DisplayTick})\n" +
                $"Score: {s.Home.Goals} – {s.Away.Goals}, players: {s.Players.Count}\n" +
                $"Ball holder: {holder?.PlayerId}, position: {holder?.Position}\n" + string.Join("\n", _view.RecentEvents);
        }
        if (_moduleMode)
        {
            var m = _view.Motion; var summary = _view.Summary;
            if (m is not null || summary is not null)
            {
                var source = summary?.Source ?? m!.Source;
                var holder = m?.Players.FirstOrDefault(p => p.IsBallHolder);
                text = $"Session: {source.SessionId}\nTick: {source.Tick} (display {source.DisplayTick})\n" +
                    $"Score: {summary?.HomeGoals} – {summary?.AwayGoals}, players: {m?.Players.Count}\n" +
                    $"Ball holder: {holder?.PlayerId}, position: {holder?.Position}\n" + string.Join("\n", _view.RecentEvents);
            }
        }
        GUI.Label(new Rect(28, 44, 486, 205), text);
    }

    [HideFromIl2Cpp]
    internal void Detach() { _stopped = true; Release(); }

    [HideFromIl2Cpp]
    private void Release()
    {
        _events?.Dispose(); _lifecycle?.Dispose(); _events = _lifecycle = null;
        _motionToken?.Dispose(); _summaryToken?.Dispose(); _motionToken = _summaryToken = null;
        _provider = null; _view.Clear();
    }

    public void OnDestroy() => Release();
}
