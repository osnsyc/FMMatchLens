namespace FMMatchLens.Plugin.Memory;

internal static class GameMatchTickSignature
{
    // Ghidra: steam-26340721, image base 0x180000000, entry 0x184520BD0.
    // Covers the prologue and three GAME_MATCH state checks. Wildcard the
    // RIP-relative security-cookie reference, relative CALL and branch targets.
    // Object field offsets stay fixed: changes require a new verified signature.
    internal const string Pattern =
        "41 57 41 56 41 55 41 54 56 57 55 53 48 83 EC 78 " +
        "44 89 C6 89 D3 48 89 CF 48 8B 05 ? ? ? ? " +
        "48 31 E0 48 89 44 24 70 E8 ? ? ? ? " +
        "80 BF 70 55 01 00 01 0F 85 ? ? ? ? " +
        "80 BF 6E 55 01 00 01 0F 85 ? ? ? ? " +
        "80 BF 75 55 01 00 00 0F 84 ? ? ? ?";

    private static readonly byte?[] Bytes = Pattern.Split(' ')
        .Select(token => token == "?" ? (byte?)null : Convert.ToByte(token, 16)).ToArray();

    internal static int Length => Bytes.Length;

    // Return false on ambiguity, even if one of the matches is not an entry.
    // The caller retains the candidate across chunks and executable sections.
    internal static bool Scan(ReadOnlySpan<byte> data, int baseRva, ref int matchRva)
    {
        for (var offset = 0; offset <= data.Length - Bytes.Length; offset++)
        {
            var next = data.Slice(offset, data.Length - Bytes.Length - offset + 1)
                .IndexOf(Bytes[0]!.Value);
            if (next < 0) break;
            offset += next;
            var index = 1;
            for (; index < Bytes.Length; index++)
                if (Bytes[index] is { } expected && data[offset + index] != expected)
                    break;
            if (index != Bytes.Length) continue;
            var rva = checked(baseRva + offset);
            if (matchRva >= 0 && matchRva != rva) return false;
            matchRva = rva;
        }
        return true;
    }
}
