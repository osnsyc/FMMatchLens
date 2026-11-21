namespace FMMatchLens.Plugin.Memory;

internal sealed class GameMatchTickSignature
{
    // steam-26385295 and steam-26577676: image base 0x180000000, entry 0x184764AC0.
    // Rechecked against steam-26577676: one executable-section match, also an unwind entry.
    // Covers inlined floating-point initialization and three GAME_MATCH state checks.
    // Wildcard the RIP-relative security-cookie reference and branch targets.
    private const string SteamPattern =
        "41 57 41 56 41 55 41 54 56 57 55 53 48 83 EC 58 " +
        "48 8B 05 ? ? ? ? 48 31 E0 48 89 44 24 50 " +
        "0F AE 5C 24 4C B8 FF 9F FF FF 23 44 24 4C " +
        "89 44 24 48 0F AE 54 24 48 0F AE 5C 24 44 " +
        "B8 00 80 00 00 0B 44 24 44 89 44 24 40 0F AE 54 24 40 " +
        "80 B9 70 55 01 00 01 0F 85 ? ? ? ? 48 89 CF " +
        "80 B9 6E 55 01 00 01 0F 85 ? ? ? ? " +
        "80 BF 75 55 01 00 00 0F 84 ? ? ? ?";

    // XGP 27.1.0-1117: entry RVA 0x043831C0, unique executable-section match.
    // Includes the R8D spill and zero/nonzero state checks used by this build.
    private const string XgpPattern =
        "41 57 41 56 41 55 41 54 56 57 55 53 48 83 EC 58 " +
        "44 89 44 24 3C 48 8B 05 ? ? ? ? 48 31 E0 48 89 44 24 50 " +
        "0F AE 5C 24 4C B8 FF 9F FF FF 23 44 24 4C " +
        "89 44 24 48 0F AE 54 24 48 0F AE 5C 24 44 " +
        "B8 00 80 00 00 0B 44 24 44 89 44 24 40 0F AE 54 24 40 " +
        "80 B9 70 55 01 00 00 0F 84 ? ? ? ? 48 89 CF " +
        "80 B9 6E 55 01 00 00 0F 84 ? ? ? ? " +
        "80 BF 75 55 01 00 00 0F 84 ? ? ? ?";

    // Priority order: stop after the first signature with a match. Each signature
    // must still be unique across all executable sections before it is accepted.
    internal static IReadOnlyList<GameMatchTickSignature> All { get; } =
        Array.AsReadOnly(new[]
        {
            new GameMatchTickSignature("Steam", SteamPattern),
            new GameMatchTickSignature("XGP", XgpPattern),
        });

    // macOS on Apple Silicon (arm64 game_plugin); scanned instead of the list above
    // there, by MacHookResolver. See MacHookResolver for the instructions it matches.
    internal static GameMatchTickSignature MacArm64 { get; } =
        new("macOS arm64", MacHookResolver.MatchTickPatternArm64);

    private readonly byte?[] Bytes;

    private GameMatchTickSignature(string name, string pattern)
    {
        Name = name;
        Bytes = pattern.Split(' ')
            .Select(token => token == "?" ? (byte?)null : Convert.ToByte(token, 16)).ToArray();
    }

    internal string Name { get; }
    internal int Length => Bytes.Length;

    // Return false on ambiguity, even if one of the matches is not an entry.
    // The caller retains the candidate across chunks and executable sections.
    internal bool Scan(ReadOnlySpan<byte> data, int baseRva, ref int matchRva)
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
