using FMMatchLens.Plugin.Domain;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;

namespace FMMatchLens.Plugin.Memory;

/// <summary>
/// Read-only managed port of game_plugin.dll+0x2303250. The native hook only
/// copies event deltas; a background worker owns history and full scans.
/// </summary>
internal sealed class MomentumCalculator : IDisposable
{
    private const int FirstHalfEnd = 0x2A30;
    private const int FullTimeEnd = 0x5460;
    private const int ExtraHalf = 0x0E11;
    private const int ExtraTimeEnd = 0x7081;
    private const int NoStartExpansionMask = 0x240201;
    private const int NoEndExpansionMask = 0x120100;
    private const int MaxEvents = 100_000;
    private const int MaxWeights = 4_096;
    private const int RollingStep = 120;
    private const int RollingWindow = 1_200;
    private const int MaxOutput = 512;

    private readonly ConcurrentQueue<Work> _jobs = new();
    private readonly AutoResetEvent _jobReady = new(false);
    private readonly object _outputGate = new();
    private readonly Queue<MomentumTickData> _nativeOutput = new();
    private readonly Queue<MomentumTickData> _rollingOutput = new();
    private readonly Window[] _captureWindows = new Window[RawRealtimeTickFrame.MaxMomentumPoints];
    private readonly Thread _worker;
    private Weight[]? _weights;
    private nint _moduleBase;
    private nint _match;
    private nint _source;
    private nint _begin;
    private int _eventCount;
    private ulong _stableSignature;
    private ulong _windowSignature;
    private int _lastRollingTick = -1;
    private volatile bool _disposed;

    public MomentumCalculator()
    {
        _worker = new Thread(WorkerLoop) { IsBackground = true, Name = "FMMatchLens Momentum" };
        _worker.Start();
    }

    public void SetModuleBase(nint moduleBase)
    {
        if (_moduleBase == moduleBase) return;
        _moduleBase = moduleBase;
        _weights = null;
        ResetCapture();
        Queue(new Work(true, 0, Array.Empty<Event>(), default, Array.Empty<Window>(), 0, false, -1, -1));
    }

    /// <remarks>Runs on the native callback and never waits for calculation.</remarks>
    public void Capture(
        nint match,
        MomentumTickData[] nativeDestination,
        out byte nativeCount,
        MomentumTickData[] rollingDestination,
        out byte rollingCount)
    {
        nativeCount = 0;
        rollingCount = 0;
        if (_disposed || _moduleBase == default || match == default ||
            !TryReadSource(match, out var source) || !EnsureWeights()) return;

        var reset = match != _match || source.Address != _source ||
            source.Begin != _begin || source.Count < _eventCount;
        var pointCount = BuildWindows(source, _captureWindows, out var windowSignature);
        var stableSignature = StableLastSignature(source);
        var countChanged = reset || source.Count != _eventCount;
        var stableChanged = !reset && source.Count == _eventCount && stableSignature != _stableSignature;
        var officialDue = countChanged || stableChanged || reset || windowSignature != _windowSignature;
        var latestRolling = source.Tick / RollingStep * RollingStep;
        var rollingDue = latestRolling >= RollingStep && latestRolling > _lastRollingTick;

        var start = source.Count;
        var count = 0;
        if (reset)
        {
            start = 0;
            count = source.Count;
        }
        else if (source.Count > _eventCount)
        {
            // The former last record is mutable. Refresh it before adding records.
            start = Math.Max(0, _eventCount - 1);
            count = source.Count - start;
        }
        else if (stableChanged || rollingDue)
        {
            // Tick/coordinates can change every tick. Sample that mutable record
            // only for a key change or the strict 30-second rolling interval.
            start = Math.Max(0, source.Count - 1);
            count = Math.Min(1, source.Count);
        }

        if (officialDue || rollingDue || count > 0)
        {
            var firstRolling = rollingDue
                ? (_lastRollingTick < 0 ? RollingStep : _lastRollingTick + RollingStep)
                : -1;
            Queue(new Work(
                reset,
                start,
                ReadEvents(source, start, count),
                new Source(source.HalfWidth, source.HalfLength),
                officialDue ? _captureWindows.ToArray() : Array.Empty<Window>(),
                pointCount,
                officialDue,
                firstRolling,
                rollingDue ? latestRolling : -1));
            if (rollingDue) _lastRollingTick = latestRolling;
        }

        _match = match;
        _source = source.Address;
        _begin = source.Begin;
        _eventCount = source.Count;
        _stableSignature = stableSignature;
        _windowSignature = windowSignature;

        lock (_outputGate)
        {
            nativeCount = (byte)Drain(_nativeOutput, nativeDestination);
            rollingCount = (byte)Drain(_rollingOutput, rollingDestination);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _jobReady.Set();
        _worker.Join(TimeSpan.FromSeconds(1));
        _jobReady.Dispose();
    }

    private void WorkerLoop()
    {
        var events = new List<Event>(2_048);
        var previous = new MomentumTickData[RawRealtimeTickFrame.MaxMomentumPoints];
        var values = new MomentumTickData[RawRealtimeTickFrame.MaxMomentumPoints];
        var previousCount = 0;
        while (!_disposed)
        {
            if (!_jobs.TryDequeue(out var job))
            {
                _jobReady.WaitOne(250);
                continue;
            }
            if (job.Reset)
            {
                events.Clear();
                previousCount = 0;
                Array.Clear(previous);
                lock (_outputGate) { _nativeOutput.Clear(); _rollingOutput.Clear(); }
            }
            Apply(events, job.Start, job.Events);
            if (job.Official && job.PointCount > 0)
            {
                Calculate(events, job.Source, job.Windows, job.PointCount, values);
                lock (_outputGate)
                {
                    for (var i = 0; i < job.PointCount; i++)
                    {
                        if (job.Reset || i >= previousCount || values[i] != previous[i])
                            AddOutput(_nativeOutput, values[i]);
                        previous[i] = values[i];
                    }
                }
                previousCount = job.PointCount;
            }
            if (job.FirstRolling >= 0)
            {
                lock (_outputGate)
                {
                    for (var tick = job.FirstRolling; tick <= job.LastRolling; tick += RollingStep)
                        AddOutput(_rollingOutput, CalculateWindow(events, job.Source,
                            Math.Max(0, tick - RollingWindow + 1), tick));
                }
            }
        }
    }

    private static void Apply(List<Event> target, int start, Event[] values)
    {
        if (start < target.Count && start + values.Length < target.Count)
            target.RemoveRange(start + values.Length, target.Count - start - values.Length);
        for (var i = 0; i < values.Length; i++)
        {
            var index = start + i;
            if (index < target.Count) target[index] = values[i]; else target.Add(values[i]);
        }
    }

    private static int Drain(Queue<MomentumTickData> source, MomentumTickData[] destination)
    {
        var count = Math.Min(source.Count, destination.Length);
        for (var i = 0; i < count; i++) destination[i] = source.Dequeue();
        return count;
    }

    private static void AddOutput(Queue<MomentumTickData> output, MomentumTickData value)
    {
        while (output.Count >= MaxOutput) output.Dequeue();
        output.Enqueue(value);
    }

    private void Queue(Work job)
    {
        _jobs.Enqueue(job);
        _jobReady.Set();
    }

    private static Event[] ReadEvents(in NativeSource source, int start, int count)
    {
        if (count <= 0) return Array.Empty<Event>();
        var values = new Event[count];
        for (var i = 0; i < count; i++)
        {
            var address = source.Begin + (start + i) * Offsets.MomentumEvent.Size;
            values[i] = new Event(
                unchecked((ushort)Marshal.ReadInt16(address + Offsets.MomentumEvent.Tick)),
                Marshal.ReadByte(address + Offsets.MomentumEvent.EventType),
                Marshal.ReadByte(address + Offsets.MomentumEvent.Team),
                unchecked((ushort)Marshal.ReadInt16(address + Offsets.MomentumEvent.Flags)),
                ReadFloat(address + Offsets.MomentumEvent.LateralPosition),
                ReadFloat(address + Offsets.MomentumEvent.LongitudinalPosition));
        }
        return values;
    }

    private static bool TryReadSource(nint match, out NativeSource value)
    {
        value = default;
        var holder = match + Offsets.GameMatch.MomentumEventSource;
        if (!VirtualMemory.IsReadable(holder, IntPtr.Size)) return false;
        var source = Marshal.ReadIntPtr(holder);
        if (!VirtualMemory.IsReadable(source, Offsets.MomentumEventSource.ExtraTimeFlag + 1)) return false;
        var begin = Marshal.ReadIntPtr(source + Offsets.MomentumEventSource.EventsBegin);
        var end = Marshal.ReadIntPtr(source + Offsets.MomentumEventSource.EventsEnd);
        var length = (long)end - (long)begin;
        if (begin == default || length <= 0 || length % Offsets.MomentumEvent.Size != 0 ||
            length / Offsets.MomentumEvent.Size > MaxEvents || length > int.MaxValue ||
            !VirtualMemory.IsReadable(begin, (int)length)) return false;
        var halfWidth = ReadFloat(source + Offsets.MomentumEventSource.HalfPitchWidth);
        var halfLength = ReadFloat(source + Offsets.MomentumEventSource.HalfPitchLength);
        if (!float.IsFinite(halfWidth) || !float.IsFinite(halfLength) || halfWidth <= 0 || halfLength <= 0) return false;
        value = new NativeSource(
            source, begin, end, (int)(length / Offsets.MomentumEvent.Size),
            unchecked((ushort)Marshal.ReadInt16(end - 0x16)), halfWidth, halfLength,
            unchecked((uint)Marshal.ReadInt32(source + Offsets.MomentumEventSource.FirstHalfEndTick)),
            unchecked((uint)Marshal.ReadInt32(source + Offsets.MomentumEventSource.FullTimeEndTick)),
            unchecked((uint)Marshal.ReadInt32(source + Offsets.MomentumEventSource.ExtraTimeFirstHalfEndTick)),
            Marshal.ReadByte(source + Offsets.MomentumEventSource.ExtraTimeFlag));
        return true;
    }

    private bool EnsureWeights()
    {
        if (_weights is not null) return true;
        var global = _moduleBase + Offsets.MomentumWeightingTable.GlobalRva;
        if (!VirtualMemory.IsReadable(global, IntPtr.Size)) return false;
        var table = Marshal.ReadIntPtr(global);
        if (!VirtualMemory.IsReadable(table, Offsets.MomentumWeightingTable.EntriesEnd + IntPtr.Size)) return false;
        var begin = Marshal.ReadIntPtr(table + Offsets.MomentumWeightingTable.EntriesBegin);
        var end = Marshal.ReadIntPtr(table + Offsets.MomentumWeightingTable.EntriesEnd);
        var length = (long)end - (long)begin;
        if (begin == default || length <= 0 || length % Offsets.MomentumWeightingTable.EntrySize != 0 ||
            length / Offsets.MomentumWeightingTable.EntrySize > MaxWeights || length > int.MaxValue ||
            !VirtualMemory.IsReadable(begin, (int)length)) return false;
        var weights = new Weight[(int)(length / Offsets.MomentumWeightingTable.EntrySize)];
        for (var i = 0; i < weights.Length; i++)
        {
            var address = begin + i * Offsets.MomentumWeightingTable.EntrySize;
            weights[i] = new Weight(
                Marshal.ReadByte(address + Offsets.MomentumWeightingTable.EventType),
                Marshal.ReadByte(address + Offsets.MomentumWeightingTable.VerticalSixth),
                Marshal.ReadByte(address + Offsets.MomentumWeightingTable.HorizontalThird),
                unchecked((uint)Marshal.ReadInt32(address + Offsets.MomentumWeightingTable.Weight)));
        }
        _weights = weights;
        return true;
    }

    private static int BuildWindows(in NativeSource source, Window[] windows, out ulong signature)
    {
        var firstEnd = Math.Max(FirstHalfEnd, unchecked((int)source.FirstEnd));
        var fullEnd = Math.Max(FullTimeEnd, unchecked((int)source.FullEnd));
        var extraFirstEnd = Math.Max(fullEnd + ExtraHalf, unchecked((int)source.ExtraFirstEnd));
        var extraFullEnd = source.ExtraFirstEnd == uint.MaxValue ? ExtraTimeEnd : unchecked((int)source.ExtraFirstEnd) + ExtraHalf;
        var count = 9;
        if (source.FirstEnd != uint.MaxValue && firstEnd <= source.Tick)
            count = source.ExtraFlag == 0 ? 18 : extraFirstEnd <= source.Tick ? 24 : 21;
        var firstSpan = firstEnd - 1;
        var secondSpan = fullEnd - firstEnd;
        var extraFirstSpan = extraFirstEnd - fullEnd - 1;
        var extraSecondSpan = extraFullEnd - extraFirstEnd;
        var rawStart = 0;
        signature = 1469598103934665603UL;
        for (var bucket = 0; bucket < count; bucket++)
        {
            var phaseSpan = bucket < 9 ? firstSpan : secondSpan;
            var span = bucket < 21 ? extraFirstSpan : extraSecondSpan;
            if (bucket < 19) span = phaseSpan;
            var step = span / (bucket > 18 ? 3 : 9);
            var rawEnd = rawStart + step;
            if (bucket == 8) rawEnd = firstEnd - 1;
            if (bucket == 17) rawEnd = fullEnd;
            if (bucket == 20) rawEnd = extraFirstEnd;
            if (bucket == 23) rawEnd = extraFullEnd;
            var sampleStart = rawStart;
            var sampleEnd = rawEnd;
            var quarter = step >= 0 ? step / 4 : (step + 3) / 4;
            if (rawEnd <= source.Tick && (bucket > 21 || !BitSet(NoStartExpansionMask, bucket))) sampleStart -= quarter;
            if (bucket > 20 || !BitSet(NoEndExpansionMask, bucket)) sampleEnd += quarter;
            windows[bucket] = new Window(rawEnd, sampleStart, sampleEnd);
            signature = Mix(Mix(Mix(signature, unchecked((uint)rawEnd)), unchecked((uint)sampleStart)), unchecked((uint)sampleEnd));
            rawStart = rawEnd + 1;
        }
        return count;
    }

    private void Calculate(List<Event> events, Source source, Window[] windows, int count, MomentumTickData[] output)
    {
        Span<int> home = stackalloc int[RawRealtimeTickFrame.MaxMomentumPoints];
        Span<int> away = stackalloc int[RawRealtimeTickFrame.MaxMomentumPoints];
        foreach (var item in events)
        {
            var weight = EventWeight(item, source);
            if (weight == 0) continue;
            for (var bucket = 0; bucket < count; bucket++)
            {
                if (item.Tick < windows[bucket].Start || item.Tick > windows[bucket].End) continue;
                if (item.Team == 0) home[bucket] += weight; else away[bucket] += weight;
            }
        }
        for (var i = 0; i < count; i++) output[i] = Point(windows[i].Time, home[i], away[i]);
    }

    private MomentumTickData CalculateWindow(List<Event> events, Source source, int start, int end)
    {
        var home = 0;
        var away = 0;
        foreach (var item in events)
        {
            if (item.Tick < start) continue;
            if (item.Tick > end) break;
            var weight = EventWeight(item, source);
            if (item.Team == 0) home += weight; else away += weight;
        }
        return Point(end, home, away);
    }

    private int EventWeight(Event item, Source source)
    {
        if (!float.IsFinite(item.X) || !float.IsFinite(item.Y)) return 0;
        var reverse = (item.Flags & Offsets.MomentumEvent.ReverseDirectionMask) != 0;
        var vertical = Vertical(item.Y, source.HalfLength, reverse);
        var horizontal = Horizontal(item.X, source.HalfWidth, reverse);
        foreach (var weight in _weights!)
            if (weight.EventType == item.EventType && weight.Vertical == vertical && weight.Horizontal == horizontal)
                return unchecked((int)weight.Value);
        return 0;
    }

    private static MomentumTickData Point(int tick, int home, int away)
    {
        var total = home + away;
        return new MomentumTickData(total == 0 ? 0f : (home + home) / (float)total - 1f, tick, home, away);
    }

    private static ulong StableLastSignature(in NativeSource source)
    {
        var address = source.End - Offsets.MomentumEvent.Size;
        var hash = 1469598103934665603UL;
        hash = Mix(hash, Marshal.ReadByte(address + Offsets.MomentumEvent.EventType));
        hash = Mix(hash, Marshal.ReadByte(address + Offsets.MomentumEvent.Team));
        return Mix(hash, unchecked((ushort)Marshal.ReadInt16(address + Offsets.MomentumEvent.Flags)));
    }

    private void ResetCapture()
    {
        _match = _source = _begin = default;
        _eventCount = 0;
        _stableSignature = _windowSignature = 0;
        _lastRollingTick = -1;
        while (_jobs.TryDequeue(out _)) { }
        lock (_outputGate) { _nativeOutput.Clear(); _rollingOutput.Clear(); }
    }

    private static byte Horizontal(float value, float half, bool reverse)
    {
        var threshold = half / 3f;
        if (!reverse) return value > threshold ? (byte)0 : value > -threshold ? (byte)1 : (byte)2;
        return value > threshold ? (byte)2 : value > -threshold ? (byte)1 : (byte)0;
    }

    private static byte Vertical(float value, float half, bool reverse)
    {
        var one = half / 3f;
        var two = one + one;
        if (reverse) value = -value;
        if (value >= two) return 0;
        if (value >= one) return 1;
        if (value >= 0) return 2;
        if (value >= -one) return 3;
        if (value >= -two) return 4;
        return 5;
    }

    private static bool BitSet(int value, int bit) => ((value >> bit) & 1) != 0;
    private static ulong Mix(ulong hash, uint value) => (hash ^ value) * 1099511628211UL;
    private static float ReadFloat(nint address) => BitConverter.Int32BitsToSingle(Marshal.ReadInt32(address));

    private readonly record struct NativeSource(
        nint Address, nint Begin, nint End, int Count, int Tick, float HalfWidth, float HalfLength,
        uint FirstEnd, uint FullEnd, uint ExtraFirstEnd, byte ExtraFlag);
    private readonly record struct Source(float HalfWidth, float HalfLength);
    private readonly record struct Event(ushort Tick, byte EventType, byte Team, ushort Flags, float X, float Y);
    private readonly record struct Window(int Time, int Start, int End);
    private readonly record struct Weight(byte EventType, byte Vertical, byte Horizontal, uint Value);
    private readonly record struct Work(
        bool Reset, int Start, Event[] Events, Source Source, Window[] Windows, int PointCount,
        bool Official, int FirstRolling, int LastRolling);
}
