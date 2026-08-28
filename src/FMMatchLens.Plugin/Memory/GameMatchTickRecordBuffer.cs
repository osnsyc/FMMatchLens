namespace FMMatchLens.Plugin.Memory;

internal readonly record struct GameMatchTickRecord(
    long Sequence,
    long CapturedTimestamp,
    nint MatchAddress,
    uint Param2,
    bool IsTerminal,
    int Tick,
    int DisplayTick,
    byte Period,
    byte State142F8,
    byte State142F9,
    byte State142FA,
    byte State142FB,
    byte PlayerCount,
    nint HomeTeam,
    nint AwayTeam,
    nint PossessionTeam,
    nint CurrentBallHolder,
    byte HomeGoals,
    byte AwayGoals,
    float HomeXg,
    float AwayXg,
    byte HomeShots,
    byte AwayShots);

/// <summary>
/// A fixed-size, allocation-free buffer on the hook producer path. MatchUpdate
/// can run on more than one simulation thread, so writes are serialized briefly.
/// The consumer copies records out under the same lock and performs logging later.
/// </summary>
internal sealed class GameMatchTickRecordBuffer
{
    private readonly object _sync = new();
    private readonly GameMatchTickRecord[] _records;
    private int _head;
    private int _tail;
    private int _count;
    private long _dropped;

    public GameMatchTickRecordBuffer(int capacity)
    {
        if (capacity <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(capacity));
        }

        _records = new GameMatchTickRecord[capacity];
    }

    public long Dropped
    {
        get
        {
            lock (_sync)
            {
                return _dropped;
            }
        }
    }

    public bool TryWrite(in GameMatchTickRecord record)
    {
        lock (_sync)
        {
            if (_count == _records.Length)
            {
                _dropped++;
                return false;
            }

            _records[_tail] = record;
            _tail = (_tail + 1) % _records.Length;
            _count++;
            return true;
        }
    }

    public int Drain(GameMatchTickRecord[] destination)
    {
        lock (_sync)
        {
            var drainCount = Math.Min(_count, destination.Length);
            for (var i = 0; i < drainCount; i++)
            {
                destination[i] = _records[_head];
                _head = (_head + 1) % _records.Length;
            }

            _count -= drainCount;
            return drainCount;
        }
    }
}
