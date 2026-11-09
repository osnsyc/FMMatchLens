namespace FMMatchLens.Plugin.Domain;

// Managed, pointer-free raw inputs. Interpretation belongs to the frontend.
// Arrays are owned by the snapshot and must never be mutated after publication.
internal sealed record TacticalSnapshot(int ObservedTick, long CapturedUnixMilliseconds,
    TacticalTeamData Home, TacticalTeamData Away)
{
    public long Revision { get; init; }
}

internal sealed record TacticalTeamData(string Status, TacticalConfiguration? Processing,
    TacticalConfiguration? Command, byte[]? PersonalOpposition, TacticalOppositionPosition[]? PositionOpposition,
    TacticalPlayerSlot[] Players);

internal sealed record TacticalConfiguration(byte[] TeamInstructions, uint StyleKey, byte[]? NameUtf8, byte AdditionalState,
    byte Mentality, byte[] PhaseSlotMapping, TacticalPosition[] InPossession, TacticalPosition[] OutOfPossession,
    TacticalPersonalOverride[]? InPossessionOverrides, TacticalPersonalOverride[]? OutOfPossessionOverrides);

internal sealed record TacticalPosition(uint PositionMask, byte Auxiliary, byte Flags, string RoleDuty,
    TacticalRoleInstructions[]? Instructions, TacticalApplicability[]? Applicability);
internal sealed record TacticalRoleInstructions(string RoleKey, string Bits, uint MarkPosition, int MarkPlayer);
internal sealed record TacticalApplicability(int InstructionId, string RoleMask);
internal sealed record TacticalPersonalOverride(uint PersonKey, TacticalPosition[] Positions);
internal sealed record TacticalOppositionPosition(uint PositionKey, uint PackedInstructions);
internal sealed record TacticalPlayerSlot(int Slot, long PlayerId, int? RosterSlot, int? TacticSlot, uint? OppositionPositionKey);

internal static class TacticalSnapshotEquality
{
    public static bool Same(TacticalSnapshot? a, TacticalSnapshot b) => a is not null && Team(a.Home, b.Home) && Team(a.Away, b.Away);
    private static bool Team(TacticalTeamData a, TacticalTeamData b) => a.Status == b.Status &&
        Config(a.Processing, b.Processing) && Config(a.Command, b.Command) &&
        Items(a.PersonalOpposition, b.PersonalOpposition) && Items(a.PositionOpposition, b.PositionOpposition) && Items(a.Players, b.Players);
    internal static bool Config(TacticalConfiguration? a, TacticalConfiguration? b) => ReferenceEquals(a, b) ||
        a is not null && b is not null && a.StyleKey == b.StyleKey && a.AdditionalState == b.AdditionalState &&
        a.Mentality == b.Mentality && Items(a.NameUtf8, b.NameUtf8) && Items(a.TeamInstructions, b.TeamInstructions) && Items(a.PhaseSlotMapping, b.PhaseSlotMapping) &&
        Positions(a.InPossession, b.InPossession) && Positions(a.OutOfPossession, b.OutOfPossession) &&
        Overrides(a.InPossessionOverrides, b.InPossessionOverrides) && Overrides(a.OutOfPossessionOverrides, b.OutOfPossessionOverrides);
    private static bool Positions(TacticalPosition[] a, TacticalPosition[] b) => a.Length == b.Length &&
        a.Zip(b, (x, y) => x.PositionMask == y.PositionMask && x.Auxiliary == y.Auxiliary && x.Flags == y.Flags &&
            x.RoleDuty == y.RoleDuty && Items(x.Instructions, y.Instructions) && Items(x.Applicability, y.Applicability)).All(value => value);
    private static bool Overrides(TacticalPersonalOverride[]? a, TacticalPersonalOverride[]? b) => ReferenceEquals(a, b) ||
        a is not null && b is not null && a.Length == b.Length &&
        a.Zip(b, (x, y) => x.PersonKey == y.PersonKey && Positions(x.Positions, y.Positions)).All(value => value);
    private static bool Items<T>(T[]? a, T[]? b) => ReferenceEquals(a, b) || a is not null && b is not null && a.SequenceEqual(b);
}
