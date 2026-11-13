namespace FMMatchLens.Plugin.Memory;

internal static class PlayerOfMatchReader
{
    // Call only after the native 0x4 completion flag has been observed.
    public static uint ReadUid(MemoryReader reader, nint match) =>
        match != default &&
        reader.TryReadPointer(match + Offsets.GameMatch.PlayerOfMatch, out var player) &&
        player != default &&
        reader.TryReadPointer(player + Offsets.MatchPlayer.Person, out var person) &&
        person != default && PlayerUidReader.TryReadPerson(reader, person, out var uid)
            ? uid
            : 0;
}
