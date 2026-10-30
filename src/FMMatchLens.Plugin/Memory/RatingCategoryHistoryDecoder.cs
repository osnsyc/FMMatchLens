namespace FMMatchLens.Plugin.Memory;

internal static class RatingCategoryHistoryDecoder
{
    // FM27 RVA 0x457FC30 selects duration with this mask. Its category lookup
    // table is reproduced by the index-to-bit mapping below; it is deliberately
    // independent of any version-specific pointer into game_plugin.dll.
    private const ulong EligibleMask = 0x03FB7B49A90FDEFFUL;

    public static bool IsEligible(ushort encoded)
    {
        if ((encoded & Offsets.RatingCategoryHistory.ExcludedMask) != 0) return false;

        // Match the native 16-bit truncation/sign extension before shifting.
        var index = (unchecked((short)(encoded << 3)) >> 9) + 31;
        var bit = index switch
        {
            >= 0 and <= 7 => index,
            >= 8 and <= 11 => index + 1,
            >= 13 and <= 19 => index + 1,
            20 => 24,
            >= 21 and <= 27 => index + 6,
            >= 28 and <= 40 => index + 7,
            41 => 49,
            42 => 48,
            >= 43 and <= 50 => index + 7,
            _ => -1,
        };
        return bit >= 0 && (EligibleMask & (1UL << bit)) != 0;
    }
}
