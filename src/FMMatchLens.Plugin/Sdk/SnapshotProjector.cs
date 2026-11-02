using FMMatchLens.Contracts;
using FMMatchLens.Plugin.Domain;
using System.Globalization;
using Side = FMMatchLens.Contracts.TeamSide;

namespace FMMatchLens.Plugin.Sdk;

internal static partial class SnapshotProjector
{
    internal sealed record PlayerMetadataEntry(long PlayerId, string? DisplayName, int? ShirtNumber,
        PlayerMetadataSnapshot Details);
    internal sealed record MetadataProjection(MatchMetadataSnapshot Match, TeamMetadataSnapshot Home,
        TeamMetadataSnapshot Away, IReadOnlyDictionary<int, PlayerMetadataEntry> Players);

    public static MatchSnapshot Project(string sessionId, long sequence, RealtimeTickFrame frame,
        RealtimeMatchMetadata? metadata, MetadataProjection? projection)
    {
        var projected = frame.Players.Select(p =>
        {
            PlayerMetadataEntry? info = null;
            projection?.Players.TryGetValue(p.Slot, out info);
            // A substitution/late UID resolution can precede the next metadata refresh.
            if (info?.PlayerId != p.PlayerId) info = null;
            return new PlayerSnapshot(p.Slot, p.PlayerId,
                p.PlayerId is > 0 and <= uint.MaxValue ? (uint)p.PlayerId : null, (Side)p.Team,
                info?.DisplayName, info?.ShirtNumber, p.IsOnPitch, p.IsBallHolder,
                p.PositionValid ? Position(p.X, p.Y, 0, frame.HalfPitchWidth, frame.HalfPitchLength) : null,
                p.Rating, p.Goals, p.Assists, p.Passes, p.PassesCompleted)
            {
                Statistics = ProjectPlayerMatchStatistics(p),
                Movement = p.MovementValid && p.AngleDegrees is <= 360
                    ? new(p.SpeedCentimetersPerSecond / 100f, p.AngleDegrees.Value) : null,
                Metadata = info?.Details,
            };
        });
        return new(sessionId, frame.MatchId, sequence, frame.Tick, frame.DisplayTick, frame.Period,
            DateTimeOffset.FromUnixTimeMilliseconds(frame.CapturedUnixMilliseconds),
            Team(Side.Home, frame.Home, metadata?.Home, projection?.Home),
            Team(Side.Away, frame.Away, metadata?.Away, projection?.Away),
            frame.PossessionTeam is { } side ? (Side)side : null, frame.BallHolderPlayerId,
            frame.BallPositionValid
                ? Position(frame.BallXCentimeters / 100f, frame.BallYCentimeters / 100f,
                    frame.BallZCentimeters / 100f, frame.HalfPitchWidth, frame.HalfPitchLength)
                : null,
            ValidHalf(frame.HalfPitchWidth), ValidHalf(frame.HalfPitchLength), projected,
            frame.Momentum.Select(Momentum), frame.RollingMomentum.Select(Momentum)) { Metadata = projection?.Match };
    }

    public static MetadataProjection ProjectMetadata(RealtimeMatchMetadata metadata)
    {
        var players = new Dictionary<int, PlayerMetadataEntry>();
        foreach (var p in metadata.Players)
        {
            var hasName = !string.IsNullOrWhiteSpace(p.FirstName) || !string.IsNullOrWhiteSpace(p.SecondName) ||
                !string.IsNullOrWhiteSpace(p.CommonName);
            var attributes = p.Attributes is { } a ? new PlayerAttributesSnapshot(
                KnownAttributes(a.Technical), KnownAttributes(a.Mental), KnownAttributes(a.Physical),
                KnownAttributes(a.Goalkeeping), ulong.TryParse(a.Traits, NumberStyles.AllowHexSpecifier,
                    CultureInfo.InvariantCulture, out var traits) ? traits : null) : null;
            var details = new PlayerMetadataSnapshot(p.FirstName, p.SecondName, p.CommonName,
                !hasName && p.ShirtName == p.DisplayName ? null : p.ShirtName,
                p.SquadNumber, p.Position, p.PortraitPath,
                p.Profile is { } profile ? ProjectPlayerProfileSnapshot(profile) : null, attributes,
                Tactical(p.InPossession), Tactical(p.OutOfPossession), p.PositionFamiliarities);
            players[p.Slot] = new(p.PlayerId, hasName ? p.DisplayName : null, p.ShirtNumber, details);
        }
        var competition = metadata.Competition is { } c
            ? new CompetitionSnapshot(c.Uid, c.Name, c.LogoPath, c.PrimaryColour, c.SecondaryColour, c.TertiaryColour) : null;
        return new(new(metadata.MatchDate, competition), TeamMetadata(metadata.Home), TeamMetadata(metadata.Away), players);
    }

    private static IReadOnlyDictionary<string, int> KnownAttributes(IReadOnlyDictionary<string, int> values) =>
        values.Where(p => p.Value is > 0 and <= 100).ToDictionary(p => p.Key, p => p.Value, StringComparer.Ordinal);

    private static TacticalAssignmentSnapshot? Tactical(PlayerTacticalAssignment? value) => value is { } v
        ? new(v.PositionMask, v.Position, v.RoleDuty, v.Role, v.RoleAbbreviation, v.Duty) : null;

    private static TeamMetadataSnapshot TeamMetadata(RealtimeTeamMetadata v) => new(v.ClubUid,
        v.BackgroundColour, v.ForegroundColour, v.OutlineColour, v.LogoPath,
        v.Manager is { } m ? new(m.Uid, m.FirstName, m.SecondName, m.IsHumanControlled) : null,
        v.ShirtNumberColor, v.ShirtBackgroundColor, v.ShirtBackgroundColorGK);

    public static EventTrajectorySnapshot? Trajectory(NativeMomentumEventData value, float halfWidth, float halfLength)
    {
        if (value.TrajectoryPoints.Count == 0) return null;
        var points = new Position3[value.TrajectoryPoints.Count];
        for (var i = 0; i < points.Length; i++)
        {
            var p = value.TrajectoryPoints[i];
            if (Position(p.LateralPosition, p.LongitudinalPosition, 0, halfWidth, halfLength) is not { } point) return null;
            points[i] = point;
        }
        return new(points);
    }

    public static Position3? Position(float x, float y, float z, float halfWidth, float halfLength) =>
        float.IsFinite(x) && float.IsFinite(y) && float.IsFinite(z) &&
        (ValidHalf(halfWidth) is not { } w || Math.Abs(x) <= w + 20) &&
        (ValidHalf(halfLength) is not { } l || Math.Abs(y) <= l + 20)
            ? new Position3(x, y, z) : null;

    private static float? ValidHalf(float value) => float.IsFinite(value) && value > 0 ? value : null;
    private static MomentumPoint Momentum(MomentumTickData p) => new(p.Value, p.TimeTicks, p.HomeWeight, p.AwayWeight);
    private static TeamSnapshot Team(Side side, TeamTickData value, RealtimeTeamMetadata? info, TeamMetadataSnapshot? details) =>
        new(side, info?.Uid, info?.Uid is not null || info?.ClubUid is not null ? info?.Name : null,
            value.Goals, value.Xg, value.Shots, value.ShotsOnTarget, value.Passes, value.PassesCompleted)
        { Statistics = ProjectTeamMatchStatistics(value), Metadata = details };
}
