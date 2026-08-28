using FMMatchLens.Plugin.Domain;

namespace FMMatchLens.Plugin.Memory;

internal static class TacticalFormationDecoder
{
    private const uint BasePositionMask = 0x0001FFFF;
    private const uint LeftSided = 0x00100000;
    private const uint RightSided = 0x00200000;
    private const ulong DutyMask = 0x200000 | 0x400000 | 0x800000 | 0x2000000 | 0x4000000 | 0x400000000;

    private static readonly IReadOnlyDictionary<ulong, (string Name, string Abbreviation)> InPossessionRoles =
        new Dictionary<ulong, (string, string)>
        {
            [0x1] = ("Goalkeeper", "GK"),
            [0x1000] = ("Ball-Playing Goalkeeper", "BPGK"),
            [0x20000000000000] = ("No-Nonsense Goalkeeper", "NNGK"),
            [0x4] = ("Full-Back", "FB"),
            [0x8] = ("Wing-Back", "WB"),
            [0x1000000000] = ("No-Nonsense Full-Back", "NNFB"),
            [0x4000000000] = ("Advanced Wing-Back", "AWB"),
            [0x100000000000] = ("Inverted Wing-Back", "IWB"),
            [0x10000000000000] = ("Inverted Full-Back", "IFB"),
            [0x80000000000000] = ("Playmaking Wing-Back", "PWB"),
            [0x2] = ("Central Defender", "CD"),
            [0x4000] = ("Libero", "L"),
            [0x1000000] = ("Ball-Playing Defender", "BPD"),
            [0x20000000] = ("No-Nonsense Centre-Back", "NCB"),
            [0x8000000000000] = ("Wide Centre-Back", "WCB"),
            [0x40000000000000] = ("Overlapping Centre-Back", "OCB"),
            [0x200000000000000] = ("Midfield Playmaker", "MP"),
            [0x10] = ("Defensive Midfielder", "DM"),
            [0x20] = ("Central Midfielder", "CM"),
            [0x8000] = ("Deep-Lying Playmaker", "DLP"),
            [0x10000] = ("Box-to-Box Midfielder", "BBM"),
            [0x10000000] = ("Ball-Winning Midfielder", "BWM"),
            [0x200000000] = ("Anchor", "A"),
            [0x800000000] = ("Half-Back", "HB"),
            [0x2000000000] = ("Enganche", "EG"),
            [0x8000000000] = ("Regista", "RGA"),
            [0x400000000000] = ("Box-to-Box Playmaker", "BBP"),
            [0x800000000000] = ("Mezzala", "MEZ"),
            [0x4000000000000] = ("Segundo Volante", "SV"),
            [0x40] = ("Wide Midfielder", "WM"),
            [0x80] = ("Winger", "W"),
            [0x200] = ("Attacking Midfielder", "AM"),
            [0x100000000000000] = ("Channel Midfielder", "CHM"),
            [0x20000] = ("Advanced Playmaker", "AP"),
            [0x8000000] = ("Inside Forward", "IF"),
            [0x2000000000000] = ("Inverted Winger", "IW"),
            [0x40000000] = ("Defensive Winger", "DW"),
            [0x100000000] = ("Trequartista", "T"),
            [0x40000000000] = ("Wide Target Forward", "WTF"),
            [0x80000000000] = ("Wide Playmaker", "WP"),
            [0x200000000000] = ("Wide Forward", "WF"),
            [0x1000000000000] = ("Wide Central Midfielder", "WCM"),
            [0x400] = ("Deep-Lying Forward", "DLF"),
            [0x800] = ("Centre-Forward", "CF"),
            [0x40000] = ("Target Man", "TM"),
            [0x80000] = ("Poacher", "P"),
            [0x100000] = ("Complete Forward", "CFW"),
            [0x80000000] = ("Channel Forward", "CHF"),
            [0x10000000000] = ("False Nine", "F9"),
            [0x20000000000] = ("Shadow Striker", "SS")
        };

    private static readonly IReadOnlyDictionary<ulong, (string Name, string Abbreviation)> OutOfPossessionRoles =
        new Dictionary<ulong, (string, string)>
        {
            [0x1] = ("Goalkeeper", "GK"), [0x2] = ("Sweeper Keeper", "SK"), [0x4] = ("Line Keeper", "LK"),
            [0x8] = ("Centre-Back", "CB"), [0x10] = ("Stopping Centre-Back", "SCB"), [0x20] = ("Covering Centre-Back", "CCB"),
            [0x40] = ("Wide Centre-Back", "WCB"), [0x80] = ("Stopping Wide Centre-Back", "SWCB"), [0x100] = ("Covering Wide Centre-Back", "CWCB"),
            [0x200] = ("Full-Back", "FB"), [0x400] = ("Pressing Full-Back", "PFB"), [0x800] = ("Holding Full-Back", "HFB"),
            [0x1000] = ("Wing-Back", "WB"), [0x2000] = ("Pressing Wing-Back", "PWB"), [0x4000] = ("Holding Wing-Back", "HWB"),
            [0x8000] = ("Defensive Midfielder", "DM"), [0x10000] = ("Dropping Defensive Midfielder", "DDM"),
            [0x20000] = ("Pressing Defensive Midfielder", "PDM"), [0x40000] = ("Screening Defensive Midfielder", "SDM"),
            [0x80000] = ("Wide-Cover Defensive Midfielder", "WCDM"), [0x100000] = ("Central Midfielder", "CM"),
            [0x8000000] = ("Pressing Central Midfielder", "PCM"), [0x10000000] = ("Screening Central Midfielder", "SCM"),
            [0x20000000] = ("Wide-Cover Central Midfielder", "WCCM"), [0x40000000] = ("Attacking Midfielder", "AM"),
            [0x80000000] = ("Tracking Attacking Midfielder", "TAM"), [0x100000000] = ("Central-Outlet Attacking Midfielder", "COAM"),
            [0x200000000] = ("Splitting-Outlet Attacking Midfielder", "SOAM"), [0x800000000] = ("Wide Midfielder", "WM"),
            [0x1000000000] = ("Tracking Wide Midfielder", "TWM"), [0x2000000000] = ("Wide-Outlet Wide Midfielder", "WOWM"),
            [0x4000000000] = ("Winger", "W"), [0x8000000000] = ("Tracking Winger", "TW"),
            [0x10000000000] = ("Inverting-Outlet Winger", "IOW"), [0x20000000000] = ("Wide-Outlet Winger", "WOW"),
            [0x40000000000] = ("Centre-Forward", "CF"), [0x80000000000] = ("Tracking Centre-Forward", "TCF"),
            [0x100000000000] = ("Central-Outlet Centre-Forward", "COCF"), [0x200000000000] = ("Splitting-Outlet Centre-Forward", "SOCF")
        };

    public static PlayerTacticalAssignment? Decode(uint positionMask, ulong roleDuty, bool inPossession)
    {
        var position = DecodePosition(positionMask);
        if (position is null) return null;

        var roleValue = roleDuty & ~DutyMask;
        var roles = inPossession ? InPossessionRoles : OutOfPossessionRoles;
        var role = roles.TryGetValue(roleValue, out var decoded)
            ? decoded
            : (Name: $"Unknown (0x{roleValue:X})", Abbreviation: "?");

        return new PlayerTacticalAssignment(
            positionMask,
            position,
            roleDuty,
            role.Name,
            role.Abbreviation,
            DecodeDuty(roleDuty));
    }

    private static string? DecodePosition(uint mask)
    {
        var basePosition = mask & BasePositionMask;
        if (basePosition == 0) return null;
        if (basePosition == 0x1) return "GK";
        if (basePosition == 0x4) return "DR";
        if (basePosition == 0x8) return "DL";
        if (basePosition == 0x20) return "WBR";
        if (basePosition == 0x40) return "WBL";
        if (basePosition == 0x100) return "MR";
        if (basePosition == 0x200) return "ML";
        if (basePosition == 0x800) return "AMR";
        if (basePosition == 0x1000) return "AML";
        if (basePosition == 0x8000) return "STR";
        if (basePosition == 0x10000) return "STL";

        var centre = basePosition switch
        {
            0x10 => "DC",
            0x80 => "DMC",
            0x400 => "MC",
            0x2000 => "AMC",
            0x4000 => "ST",
            _ => null
        };
        if (centre is null) return null;
        if ((mask & LeftSided) != 0) return centre == "DMC" ? "DML" : centre + "L";
        if ((mask & RightSided) != 0) return centre == "DMC" ? "DMR" : centre + "R";
        return centre;
    }

    private static string? DecodeDuty(ulong value)
    {
        if ((value & 0x2000000) != 0) return "Stopper";
        if ((value & 0x4000000) != 0) return "Cover";
        if ((value & 0x200000) != 0) return "Defend";
        if ((value & 0x400000) != 0) return "Support";
        if ((value & 0x800000) != 0) return "Attack";
        if ((value & 0x400000000) != 0) return "Float";
        return null;
    }
}
