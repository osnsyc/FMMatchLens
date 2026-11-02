using System.Collections.ObjectModel;

namespace FMMatchLens.Contracts;

/// <summary>Speed in metres/second; native facing angle clockwise from +Y, 0..360 degrees.</summary>
public sealed record PlayerMovementSnapshot(float SpeedMetersPerSecond, ushort AngleDegrees);

public sealed record MatchMetadataSnapshot(string? MatchDate, CompetitionSnapshot? Competition);

public sealed record CompetitionSnapshot(uint? Uid, string? Name, string? LogoPath,
    uint? PrimaryColour, uint? SecondaryColour, uint? TertiaryColour);

public sealed record ManagerSnapshot(uint? Uid, string? FirstName, string? SecondName, bool IsHumanControlled);

/// <summary>Colours are packed uint32 ARGB. Asset paths are existing local-API relative references.</summary>
public sealed record TeamMetadataSnapshot(uint? ClubUid, uint? BackgroundColour, uint? ForegroundColour,
    uint? OutlineColour, string? LogoPath, ManagerSnapshot? Manager,
    uint? ShirtNumberColor, uint? ShirtBackgroundColor, uint? ShirtBackgroundColorGK);

public sealed record TacticalAssignmentSnapshot(uint PositionMask, string Position, ulong RoleDuty,
    string Role, string RoleAbbreviation, string? Duty);

/// <summary>Session metadata, cached separately from per-tick statistics. Unavailable entries stay null.</summary>
public sealed class PlayerMetadataSnapshot
{
    public string? FirstName { get; }
    public string? SecondName { get; }
    public string? CommonName { get; }
    public string? ShirtName { get; }
    public int? SquadNumber { get; }
    public string? Position { get; }
    public string? PortraitPath { get; }
    public PlayerProfileSnapshot? Profile { get; }
    public PlayerAttributesSnapshot? Attributes { get; }
    public TacticalAssignmentSnapshot? InPossession { get; }
    public TacticalAssignmentSnapshot? OutOfPossession { get; }
    public IReadOnlyDictionary<string, int>? PositionFamiliarities { get; }

    public PlayerMetadataSnapshot(string? firstName, string? secondName, string? commonName,
        string? shirtName, int? squadNumber, string? position, string? portraitPath,
        PlayerProfileSnapshot? profile, PlayerAttributesSnapshot? attributes,
        TacticalAssignmentSnapshot? inPossession, TacticalAssignmentSnapshot? outOfPossession,
        IReadOnlyDictionary<string, int>? positionFamiliarities)
    {
        FirstName = firstName; SecondName = secondName; CommonName = commonName;
        ShirtName = shirtName; SquadNumber = squadNumber; Position = position; PortraitPath = portraitPath;
        Profile = profile; Attributes = attributes; InPossession = inPossession; OutOfPossession = outOfPossession;
        PositionFamiliarities = positionFamiliarities is null ? null : Freeze(positionFamiliarities);
    }

    internal static IReadOnlyDictionary<string, int> Freeze(IReadOnlyDictionary<string, int> source) =>
        new ReadOnlyDictionary<string, int>(source.ToDictionary(p => p.Key, p => p.Value, StringComparer.Ordinal));
}

/// <summary>Values retain captured 0..100 attribute units; absent/zero entries are omitted by the provider.</summary>
public sealed class PlayerAttributesSnapshot
{
    public IReadOnlyDictionary<string, int> Technical { get; }
    public IReadOnlyDictionary<string, int> Mental { get; }
    public IReadOnlyDictionary<string, int> Physical { get; }
    public IReadOnlyDictionary<string, int> Goalkeeping { get; }
    public ulong? Traits { get; }

    public PlayerAttributesSnapshot(IReadOnlyDictionary<string, int> technical,
        IReadOnlyDictionary<string, int> mental, IReadOnlyDictionary<string, int> physical,
        IReadOnlyDictionary<string, int> goalkeeping, ulong? traits)
    {
        Technical = PlayerMetadataSnapshot.Freeze(technical); Mental = PlayerMetadataSnapshot.Freeze(mental);
        Physical = PlayerMetadataSnapshot.Freeze(physical); Goalkeeping = PlayerMetadataSnapshot.Freeze(goalkeeping);
        Traits = traits;
    }
}

public sealed class EventTrajectorySnapshot
{
    public IReadOnlyList<Position3> Points { get; }
    public EventTrajectorySnapshot(IEnumerable<Position3> points) => Points = Array.AsReadOnly(points.ToArray());
}
