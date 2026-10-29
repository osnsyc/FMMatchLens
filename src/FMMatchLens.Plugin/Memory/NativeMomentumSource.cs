using System.Runtime.InteropServices;

namespace FMMatchLens.Plugin.Memory;

/// <summary>One validated event-source snapshot shared by both synchronous consumers.</summary>
internal readonly record struct NativeMomentumSource(
    nint Address, nint Begin, nint End, int Count, int Tick, float HalfWidth, float HalfLength,
    uint FirstEnd, uint FullEnd, uint ExtraFirstEnd, byte ExtraFlag, bool HasCalculationData)
{
    public static bool TryRead(nint match, out NativeMomentumSource value)
    {
        value = default;
        if (match == 0) return false;
        var holder = match + Offsets.GameMatch.MomentumEventSource;
        if (!VirtualMemory.IsReadable(holder, IntPtr.Size)) return false;
        var source = Marshal.ReadIntPtr(holder);
        if (!VirtualMemory.IsReadable(source, Offsets.MomentumEventSource.HalfPitchLength + sizeof(float))) return false;
        var begin = Marshal.ReadIntPtr(source + Offsets.MomentumEventSource.EventsBegin);
        var end = Marshal.ReadIntPtr(source + Offsets.MomentumEventSource.EventsEnd);
        var length = (long)end - (long)begin;
        if (begin == default || length < 0 || length % Offsets.MomentumEvent.Size != 0 ||
            length / Offsets.MomentumEvent.Size > 100_000 || length > int.MaxValue ||
            (length > 0 && !VirtualMemory.IsReadable(begin, (int)length))) return false;
        var halfWidth = ReadFloat(source + Offsets.MomentumEventSource.HalfPitchWidth);
        var halfLength = ReadFloat(source + Offsets.MomentumEventSource.HalfPitchLength);
        if (!float.IsFinite(halfWidth) || !float.IsFinite(halfLength) || halfWidth <= 0 || halfLength <= 0) return false;
        // Event publishing accepts an empty vector and needs only the pitch
        // fields. Optional calculation metadata must not make that path stricter.
        var calculation = VirtualMemory.IsReadable(source, Offsets.MomentumEventSource.ExtraTimeFlag + 1);
        value = new NativeMomentumSource(
            source, begin, end, (int)(length / Offsets.MomentumEvent.Size),
            length > 0 ? unchecked((ushort)Marshal.ReadInt16(end - Offsets.MomentumEvent.Size + Offsets.MomentumEvent.Tick)) : 0,
            halfWidth, halfLength,
            calculation ? unchecked((uint)Marshal.ReadInt32(source + Offsets.MomentumEventSource.FirstHalfEndTick)) : 0,
            calculation ? unchecked((uint)Marshal.ReadInt32(source + Offsets.MomentumEventSource.FullTimeEndTick)) : 0,
            calculation ? unchecked((uint)Marshal.ReadInt32(source + Offsets.MomentumEventSource.ExtraTimeFirstHalfEndTick)) : 0,
            calculation ? Marshal.ReadByte(source + Offsets.MomentumEventSource.ExtraTimeFlag) : (byte)0,
            calculation);
        return true;
    }

    private static float ReadFloat(nint address) => BitConverter.Int32BitsToSingle(Marshal.ReadInt32(address));
}
