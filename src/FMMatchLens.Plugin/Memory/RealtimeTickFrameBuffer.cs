using FMMatchLens.Plugin.Domain;

namespace FMMatchLens.Plugin.Memory;

/// <summary>
/// A fixed object pool between native hook producers and the managed consumer.
/// No arrays or frame objects are allocated on the native callback path.
/// </summary>
internal sealed class RealtimeTickFrameBuffer
{
    private readonly object _gate = new();
    private readonly RawRealtimeTickFrame[] _frames;
    private readonly Stack<int> _free;
    private readonly Queue<int> _ready;
    private long _dropped;

    public RealtimeTickFrameBuffer(int capacity)
    {
        _frames = new RawRealtimeTickFrame[capacity];
        _free = new Stack<int>(capacity);
        _ready = new Queue<int>(capacity);

        for (var i = 0; i < capacity; i++)
        {
            _frames[i] = new RawRealtimeTickFrame(i);
            _free.Push(i);
        }
    }

    public long Dropped
    {
        get
        {
            lock (_gate)
            {
                return _dropped;
            }
        }
    }

    public bool TryRent(out RawRealtimeTickFrame frame)
    {
        lock (_gate)
        {
            if (_free.Count == 0)
            {
                _dropped++;
                frame = null!;
                return false;
            }

            frame = _frames[_free.Pop()];
            return true;
        }
    }

    public void Publish(RawRealtimeTickFrame frame)
    {
        lock (_gate)
        {
            _ready.Enqueue(frame.PoolIndex);
        }
    }

    public void ReleaseUnpublished(RawRealtimeTickFrame frame)
    {
        lock (_gate)
        {
            _free.Push(frame.PoolIndex);
        }
    }

    public int Drain(RawRealtimeTickFrame[] destination)
    {
        lock (_gate)
        {
            var count = Math.Min(destination.Length, _ready.Count);
            for (var i = 0; i < count; i++)
            {
                destination[i] = _frames[_ready.Dequeue()];
            }

            return count;
        }
    }

    public void Release(RawRealtimeTickFrame[] frames, int count)
    {
        lock (_gate)
        {
            for (var i = 0; i < count; i++)
            {
                _free.Push(frames[i].PoolIndex);
                frames[i] = null!;
            }
        }
    }
}

internal sealed class RawRealtimeTickFrame
{
    public const int MaxPlayers = 64;
    public const int MaxMomentumPoints = 24;
    public const int MaxRollingMomentumPoints = 16;
    public const int MaxMomentumEvents = 64;

    public RawRealtimeTickFrame(int poolIndex)
    {
        PoolIndex = poolIndex;
        Players = new PlayerTickData[MaxPlayers];
        Momentum = new MomentumTickData[MaxMomentumPoints];
        RollingMomentum = new MomentumTickData[MaxRollingMomentumPoints];
        MomentumEvents = new NativeMomentumEventData[MaxMomentumEvents];
    }

    public int PoolIndex { get; }
    public long Sequence;
    public long CapturedTimestamp;
    public nint MatchAddress;
    public int Tick;
    public int DisplayTick;
    public byte Period;
    public byte PlayerCount;
    public TeamSide? PossessionTeam;
    public int BallHolderPlayerId;
    public float HalfPitchWidth;
    public float HalfPitchLength;
    public byte MomentumEventCount;
    public byte MomentumCount;
    public byte RollingMomentumCount;
    public TeamTickData Home;
    public TeamTickData Away;
    public PlayerTickData[] Players { get; }
    public MomentumTickData[] Momentum { get; }
    public MomentumTickData[] RollingMomentum { get; }
    public NativeMomentumEventData[] MomentumEvents { get; }
}
