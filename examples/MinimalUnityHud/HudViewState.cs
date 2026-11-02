using FMMatchLens.Contracts;

namespace FMMatchLens.Examples.MinimalUnityHud;

/// <summary>Managed display state shared by polling and callbacks, scoped to the current SDK session.</summary>
internal sealed class HudViewState
{
    private readonly Queue<string> _recentEvents = new();
    private string? _sessionId;
    public MatchSnapshot? Snapshot { get; private set; }
    public MotionSnapshot? Motion { get; private set; }
    public SummarySnapshot? Summary { get; private set; }
    public IEnumerable<string> RecentEvents => _recentEvents;

    public bool SynchronizeSession(LensStatus? status)
    {
        var sessionId = status is { State: LensState.Active } ? status.SessionId : null;
        if (_sessionId == sessionId) return false;
        Clear();
        _sessionId = sessionId;
        return true;
    }

    public void SetSnapshot(MatchSnapshot? value, LensStatus? status)
    {
        SynchronizeSession(status);
        if (value is null || MatchesSession(value.SessionId)) Snapshot = value;
    }

    public void AcceptEvent(MatchEventNotification notification, LensStatus? status)
    {
        SynchronizeSession(status);
        if (!MatchesSession(notification.SessionId)) return;
        var e = notification.Event;
        _recentEvents.Enqueue(e is null
            ? $"{notification.Kind} #{notification.SequenceIndex} r{notification.Revision}"
            : $"{e.Operation} #{e.SequenceIndex} r{e.Revision}, type={e.EventType}, tick={e.Tick}");
        while (_recentEvents.Count > 5) _recentEvents.Dequeue();
    }

    public void AcceptMotion(MotionSnapshot value, LensStatus? status)
    {
        SynchronizeSession(status);
        if (MatchesSession(value.Source.SessionId)) Motion = value;
    }

    public void AcceptSummary(SummarySnapshot value, LensStatus? status)
    {
        SynchronizeSession(status);
        if (MatchesSession(value.Source.SessionId)) Summary = value;
    }

    private bool MatchesSession(string sessionId) => _sessionId is not null && _sessionId == sessionId;

    public void Clear()
    {
        _sessionId = null;
        Snapshot = null; Motion = null; Summary = null;
        _recentEvents.Clear();
    }
}
