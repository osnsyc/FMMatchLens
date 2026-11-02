using System.Runtime.InteropServices;

namespace FMMatchLens.Plugin.Memory;

internal readonly record struct TeamTickSnapshot(nint TeamBase, byte Goals, float Xg, byte Shots)
{
    public static TeamTickSnapshot Read(MemoryReader reader, nint team)
    {
        if (!reader.TryReadPointer(team + Offsets.Team.TeamBase, out var teamBase) || teamBase == default)
            return default;
        reader.TryReadByte(teamBase + Offsets.TeamBase.Goals, out var goals);
        reader.TryReadFloat(teamBase + Offsets.TeamBase.Xg, out var rawXg);
        reader.TryReadByte(teamBase + Offsets.TeamBase.Shots, out var shots);
        return new TeamTickSnapshot(teamBase, goals, float.IsFinite(rawXg) ? rawXg : 0, shots);
    }
}

internal readonly record struct BallPositionSnapshot(int X, int Y, int Z)
{
    public bool IsValid { get; init; }

    public static BallPositionSnapshot Read(MemoryReader reader, nint match)
    {
        var start = match + Offsets.GameMatch.BallPosition + Offsets.BallPosition.X;
        var valid = true;
        if (VirtualMemory.IsReadable(start, 3 * sizeof(float)))
            return Finish(ReadDirect(start), ReadDirect(start + sizeof(float)), ReadDirect(start + 2 * sizeof(float)));
        // A combined range can straddle an unreadable region even though one or
        // two components remain readable. Keep the original per-axis defaults.
        return Finish(ReadChecked(start), ReadChecked(start + sizeof(float)), ReadChecked(start + 2 * sizeof(float)));

        BallPositionSnapshot Finish(int x, int y, int z) => new(x, y, z) { IsValid = valid };
        int Convert(float meters)
        {
            valid &= float.IsFinite(meters) && meters >= int.MinValue / 100f && meters <= int.MaxValue / 100f;
            return ToCentimeters(meters);
        }
        int ReadChecked(nint address)
        {
            if (reader.TryReadFloat(address, out var meters)) return Convert(meters);
            valid = false;
            return 0;
        }
        int ReadDirect(nint address) => Convert(BitConverter.Int32BitsToSingle(Marshal.ReadInt32(address)));
    }

    private static int ToCentimeters(float meters)
    {
        if (!float.IsFinite(meters) || meters is < int.MinValue / 100f or > int.MaxValue / 100f) return 0;
        return checked((int)Math.Round(meters * 100f, MidpointRounding.AwayFromZero));
    }
}
