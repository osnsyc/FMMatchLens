using System.Runtime.InteropServices;

namespace FMMatchLens.Plugin.Memory;

internal static class PlayerUidReader
{
    /// <remarks>The caller must have validated MatchPlayer through +Stats, including +Person.</remarks>
    public static bool TryReadValidatedPlayer(
        MemoryReader reader, in PlayerUidCache.Capture capture, int slot, nint player, out uint uid)
    {
        var person = Marshal.ReadIntPtr(player + Offsets.MatchPlayer.Person);
        if (capture.TryGet(slot, player, person, out uid)) return true;
        if (person != default && TryReadPerson(reader, person, out uid))
        {
            capture.Store(slot, player, person, uid);
            return true;
        }
        capture.Forget(slot);
        uid = 0;
        return false;
    }

    public static bool TryReadPerson(MemoryReader reader, nint person, out uint uid)
    {
        if (reader.TryReadUInt32(person + Offsets.Person.Uid, out uid) && uid != 0) return true;
        uid = 0;
        return false;
    }
}
