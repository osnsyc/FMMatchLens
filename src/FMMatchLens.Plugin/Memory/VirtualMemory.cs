using System.Runtime.InteropServices;

namespace FMMatchLens.Plugin.Memory;

internal static class VirtualMemory
{
    private const uint MemCommit = 0x1000;
    private const uint PageNoAccess = 0x01;
    private const uint PageGuard = 0x100;
    private const int CachedRegionCapacity = 8;
    [ThreadStatic] private static ReadScopeState? _activeReadScope;
    [ThreadStatic] private static ReadScopeState? _rootReadScope;

    /// <summary>
    /// Reuses VirtualQuery results only during one synchronous capture. Every
    /// read still checks its address, length and protection against the queried
    /// region. No memory-map information survives into the next capture.
    /// </summary>
    public static ReadScope BeginReadScope()
    {
        var previous = _activeReadScope;
        var state = previous is null
            ? (_rootReadScope ??= new ReadScopeState())
            : (previous.Nested ??= new ReadScopeState());
        state.Reset();
        state.Parent = previous;
        _activeReadScope = state;
        return new ReadScope(previous);
    }

    public static void InvalidateActiveReadScopes()
    {
        // A native update can reenter the hook on this thread. Any enclosing
        // capture must requery its regions after that update as well.
        for (var state = _activeReadScope; state is not null; state = state.Parent)
            state.Reset();
    }

    [DllImport("kernel32.dll")]
    private static extern nuint VirtualQuery(nint lpAddress, out MemoryBasicInformation lpBuffer, nuint dwLength);

    public static bool IsReadable(nint address, int size)
    {
        if (address == default || size <= 0)
        {
            return false;
        }

        var start = (ulong)address;
        var end = start + (uint)size;
        if (end < start) return false;
        var scope = _activeReadScope;
        if (scope is not null && scope.TryFind(start, out var cached))
            return cached.Readable && end <= cached.End;

        var queryResult = VirtualQuery(address, out var info, (nuint)Marshal.SizeOf<MemoryBasicInformation>());
        if (queryResult == 0)
        {
            return false;
        }

        var regionStart = (ulong)info.BaseAddress;
        var regionEnd = regionStart + (ulong)info.RegionSize;
        var readable = info.State == MemCommit &&
                       (info.Protect & (PageNoAccess | PageGuard)) == 0;
        if (regionEnd < regionStart || start < regionStart || start >= regionEnd)
            return false;
        scope?.Remember(new QueriedRegion(regionStart, regionEnd, readable));
        return readable && end <= regionEnd;
    }

    internal readonly record struct QueriedRegion(ulong Start, ulong End, bool Readable);

    internal sealed class ReadScopeState
    {
        private readonly QueriedRegion[] _regions = new QueriedRegion[CachedRegionCapacity];
        private int _count;
        private int _next;
        private int _recent;
        public ReadScopeState? Nested;
        public ReadScopeState? Parent;

        public void Reset() { _count = 0; _next = 0; _recent = 0; }

        private bool Contains(int index, ulong address) =>
            address >= _regions[index].Start && address < _regions[index].End;

        public bool TryFind(ulong address, out QueriedRegion region)
        {
            if (_count > 0 && Contains(_recent, address))
            {
                region = _regions[_recent];
                return true;
            }
            for (var i = 0; i < _count; i++)
            {
                if (!Contains(i, address)) continue;
                _recent = i;
                region = _regions[i];
                return true;
            }
            region = default;
            return false;
        }

        public void Remember(QueriedRegion region)
        {
            _regions[_next] = region;
            _recent = _next;
            _next = (_next + 1) % CachedRegionCapacity;
            _count = Math.Min(_count + 1, CachedRegionCapacity);
        }
    }

    internal readonly struct ReadScope : IDisposable
    {
        private readonly ReadScopeState? _previous;
        internal ReadScope(ReadScopeState? previous) => _previous = previous;
        public void Dispose() => _activeReadScope = _previous;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryBasicInformation
    {
        public nint BaseAddress;
        public nint AllocationBase;
        public uint AllocationProtect;
        public ushort PartitionId;
        public nuint RegionSize;
        public uint State;
        public uint Protect;
        public uint Type;
    }
}

