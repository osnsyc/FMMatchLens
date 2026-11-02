using System.Collections;
using System.Text.Json;
using FMMatchLens.Contracts;
using FMMatchLens.Plugin.Domain;
using FMMatchLens.Plugin.Sdk;
using Xunit;
using Side = FMMatchLens.Plugin.Domain.TeamSide;

namespace FMMatchLens.Sdk.Tests;

public sealed class ExtendedSnapshotTests
{
    private static MatchDataHub Ready()
    {
        var hub = new MatchDataHub(clock: () => 0);
        hub.SetSourceAvailability(true, "verified"); hub.Begin("source");
        return hub;
    }

    internal static RealtimeMatchMetadata Metadata()
    {
        var details = JsonSerializer.Deserialize<PlayerSeasonDetailedStats>(
            """{"DistanceKmTimes10":123,"ExpectedGoalsTimes100":275,"ExpectedAssistsTimes100":125,"NonPenaltyExpectedGoalsTimes100":225,"GoalsPreventedTimes100":-25,"Sprints":19,"OpenPlayCrossesCompleted":99}""")!;
        var category = JsonSerializer.Deserialize<PlayerSeasonStatsSlot>("""{"Minutes":250,"Appearances":3,"Goals":2}""")!;
        var season = new PlayerSeasonStats(null, category with { Detailed = details }, null, null, null, null, null, null);
        var profile = new PlayerProfile(12000, 185, 7800, 15, 150, 170, 7000,
            DateOfBirth: "2000-02-03", NationUid: 100, BodyType: 3, GuideValueGbp: 123456,
            InternationalApps: 12, InternationalGoals: 3, YouthApps: 4, YouthGoals: 1,
            MatchSharpness: 9000, SeasonStats: season);
        var attributes = new PlayerAttributes(new Dictionary<string, int> { ["Passing"] = 87, ["Unknown"] = 0 },
            new Dictionary<string, int> { ["Vision"] = 81 }, new Dictionary<string, int> { ["Pace"] = 91 },
            new Dictionary<string, int>(), "8000000000000001");
        var player = new RealtimePlayerMetadata(0, 42, 42, Side.Home, 9, "ST", "Alex", "Smith", null,
            "Alex Smith", "portrait-key", profile, attributes,
            new PlayerTacticalAssignment(4, "ST", ulong.MaxValue, "Forward", "F", "Attack"), null,
            new Dictionary<string, int> { ["ST"] = 20 }, "SMITH", 19);
        return new("source", 1000, 1,
            new RealtimeTeamMetadata(10, 20, "Home Club", 0xff123456, 0xffabcdef, 0xff010203, "logo-key",
                new RealtimeManagerMetadata(55, "Manager", "One", true), 0xff112233, 0xff334455, 0xff556677),
            new RealtimeTeamMetadata(11, 21, "Away Club", null, null, null, null), new[] { player },
            "2026-10-31", Competition: new RealtimeCompetitionMetadata(30, "League", "competition-key",
                0xffaabbcc, 0xff001122, 0xff445566));
    }

    private static RatingResearchPlayerData Research() => new(
        Stats: default(RatingStatsInputs) with { OpenPlayXa = .75f, Sprints = 8, PressesAttempted = 12,
            PressesWon = 4, YellowCards = 1, PenaltyAttempts = 2, GoalsConceded = 3 },
        InternalW25: 0, InternalW24: 0, SpecialW2C: 0, SpecialW2D: 0, SpecialW2E: 0,
        SpecialW2F: 0, SpecialW30: 0, SpecialW31: 0, RawInternalRating: 0,
        InPossessionRoleDuty: 0, OutOfPossessionRoleDuty: 0, SpecialConditionA: 0, SpecialConditionB: 0,
        TeamAEventCounterCandidate: 0, TeamBEventCounterCandidate: 0,
        TeamAEventAdjustmentCandidate: 0, TeamBEventAdjustmentCandidate: 0, TotalEligibleDuration: 0,
        RatingEventsRaw: Array.Empty<byte[]>());

    [Fact]
    public void DetailedCountersAndMovementUseExistingValuesAndExplicitUnits()
    {
        using var hub = Ready();
        var frame = Fixtures.Frame();
        frame = frame with
        {
            Home = default(TeamTickData) with { PossessionTime = 1234, ShotsOffTarget = 9, ProgressivePasses = 11,
                CrossesCompleted = 7, FirstHalfShots = 5, SecondHalfShots = 6 },
            Players = new[] { frame.Players[0] with { DistanceM = 1234.5f, Xg = 1.2f, Xa = .8f, BlockedShots = 2,
                OverallPhysicalCondition = 85, MatchSharpness = 76, SubbedOnMinute = 60,
                SpeedCentimetersPerSecond = 321, AngleDegrees = 360, MovementValid = true, RatingResearch = Research() } },
        };
        hub.Publish(frame, Metadata());
        Assert.True(hub.TryGetLatestSnapshot(out var s));
        Assert.Equal(1, hub.ApiMajorVersion); Assert.Equal(0, hub.ApiMinorVersion);
        Assert.Equal(1234, s.Home.Statistics!.PossessionTime);
        Assert.Equal(9, s.Home.Statistics.DerivedShotsOffTarget);
        Assert.Equal(11, s.Home.Statistics.ProgressivePasses);
        Assert.Equal(6, s.Home.Statistics.SecondHalfShots);
        var p = s.Players[0];
        Assert.Equal(3.21f, p.Movement!.SpeedMetersPerSecond);
        Assert.Equal((ushort)360, p.Movement.AngleDegrees);
        Assert.Equal(1234.5f, p.Statistics!.DistanceMeters);
        Assert.Equal(2, p.Statistics.BlockedShotsCandidate);
        Assert.Equal(.75f, p.Statistics.OpenPlayXa);
        Assert.Equal(8, p.Statistics.Sprints);
        Assert.Equal(4, p.Statistics.PressesWon);
        Assert.Equal(85, p.Statistics.OverallPhysicalCondition);
        Assert.Equal(7800, p.Metadata!.Profile!.Condition);
        Assert.True(hub.Capabilities.HasFlag(LensCapabilities.DetailedMatchStatistics | LensCapabilities.PlayerMovement));
    }

    [Fact]
    public void ProfileTacticsColoursCompetitionAndSeasonDataAreAvailable()
    {
        using var hub = Ready();
        hub.Publish(Fixtures.Frame(), Metadata()); hub.TryGetLatestSnapshot(out var s);
        Assert.Equal("2026-10-31", s!.Metadata!.MatchDate);
        Assert.Equal(30u, s.Metadata.Competition!.Uid);
        Assert.Equal(0xffaabbccu, s.Metadata.Competition.PrimaryColour);
        Assert.True(s.Home.Metadata!.Manager!.IsHumanControlled);
        Assert.Equal(20u, s.Home.Metadata.ClubUid);
        Assert.Equal(0xff556677u, s.Home.Metadata.ShirtBackgroundColorGK);
        var p = s.Players[0].Metadata!;
        Assert.Equal("SMITH", p.ShirtName); Assert.Equal(19, p.SquadNumber);
        Assert.Equal("portrait-key", p.PortraitPath);
        Assert.Equal(87, p.Attributes!.Technical["Passing"]);
        Assert.False(p.Attributes.Technical.ContainsKey("Unknown"));
        Assert.Equal(0x8000000000000001UL, p.Attributes.Traits);
        Assert.Equal(ulong.MaxValue, p.InPossession!.RoleDuty);
        Assert.Null(p.OutOfPossession);
        Assert.Equal(20, p.PositionFamiliarities!["ST"]);
        var profile = p.Profile!;
        Assert.Equal(170, profile.PotentialAbility); Assert.Equal("2000-02-03", profile.DateOfBirth);
        Assert.Equal(123456u, profile.GuideValueGbp);
        var season = profile.SeasonStats!;
        Assert.True(season.RequiresGameUiValidation);
        Assert.Null(season.Cup);
        Assert.Equal(250, season.League!.Minutes);
        Assert.Equal(12.3f, season.League.Detailed!.DistanceKilometers);
        Assert.Equal(2.75f, season.League.Detailed.ExpectedGoals);
        Assert.Equal(-.25f, season.League.Detailed.GoalsPrevented);
        Assert.Null(typeof(SeasonStatisticsDetails).GetProperty("OpenPlayCrossesCompleted"));
        Assert.True(hub.Capabilities.HasFlag(LensCapabilities.MatchMetadata | LensCapabilities.PlayerProfiles |
            LensCapabilities.PlayerAttributes | LensCapabilities.TacticalAssignments | LensCapabilities.SeasonStatistics));
    }

    [Fact]
    public void NestedMetadataIsDefensivelyCopiedAndReusedUntilMetadataChanges()
    {
        using var hub = Ready();
        var metadata = Metadata();
        hub.Publish(Fixtures.Frame(), metadata); hub.TryGetLatestSnapshot(out var first);
        var info = first!.Players[0].Metadata!;
        ((Dictionary<string, int>)metadata.Players[0].Attributes!.Technical)["Passing"] = 1;
        ((Dictionary<string, int>)metadata.Players[0].PositionFamiliarities!)["ST"] = 1;
        Assert.Equal(87, info.Attributes!.Technical["Passing"]);
        Assert.Equal(20, info.PositionFamiliarities!["ST"]);
        Assert.Throws<NotSupportedException>(() => ((IDictionary<string, int>)info.Attributes.Technical)["Passing"] = 1);
        hub.Publish(Fixtures.Frame(2), metadata); hub.TryGetLatestSnapshot(out var next);
        Assert.Same(info, next!.Players[0].Metadata);
        Assert.Same(first.Metadata, next.Metadata);
        hub.UpdateMetadata(metadata with { CapturedTick = 2 });
        hub.TryGetLatestSnapshot(out var refreshed);
        Assert.NotSame(info, refreshed!.Players[0].Metadata);
        Assert.Equal(1, refreshed.Players[0].Metadata!.Attributes!.Technical["Passing"]);
        Assert.Equal(87, info.Attributes.Technical["Passing"]);
    }

    [Fact]
    public void MissingMovementResearchMetadataAndReusedSlotRemainUnavailable()
    {
        using var hub = Ready();
        var frame = Fixtures.Frame();
        frame = frame with { Players = new[] { frame.Players[0] with { PlayerId = 99, AngleDegrees = 90,
            SpeedCentimetersPerSecond = 321, MovementValid = false } } };
        hub.Publish(frame, Metadata()); hub.TryGetLatestSnapshot(out var s);
        Assert.Null(s!.Players[0].Metadata);
        Assert.Null(s.Players[0].Movement);
        Assert.Null(s.Players[0].Statistics!.Sprints);
        Assert.Null(s.Players[0].Statistics!.OpenPlayXa);
        Assert.False(hub.Capabilities.HasFlag(LensCapabilities.PlayerProfiles));
        Assert.False(hub.Capabilities.HasFlag(LensCapabilities.PlayerMovement));
        hub.Publish(Fixtures.Frame(2), null); hub.TryGetLatestSnapshot(out var none);
        Assert.Null(none!.Metadata); Assert.Null(none.Home.Metadata);
    }

    [Fact]
    public void EventTrajectoryIsImmutableAndRejectedAsAWholeIfAnyPointIsInvalid()
    {
        using var hub = Ready();
        var received = new List<MatchEvent>();
        using var sub = hub.SubscribeEvents(n => received.Add(n.Event!));
        var points = new[] { new NativeMomentumTrajectoryPoint(1, 2), new NativeMomentumTrajectoryPoint(3, 4) };
        var update = Fixtures.Update() with { Event = Fixtures.Event() with { TrajectoryPoints = points } };
        hub.Publish(Fixtures.Frame() with { MomentumEventUpdates = new[] { update } }, null);
        points[0] = new(20, 20);
        hub.Pump();
        var trajectory = Assert.Single(received).Trajectory!;
        Assert.Equal(new Position3(1, 2), trajectory.Points[0]);
        Assert.Throws<NotSupportedException>(() => ((IList)trajectory.Points)[0] = new Position3());
        update = update with { Event = update.Event with { TrajectoryPoints = new[] { points[0], new NativeMomentumTrajectoryPoint(float.NaN, 0) } } };
        hub.Publish(Fixtures.Frame(2) with { MomentumEventUpdates = new[] { update } }, null); hub.Pump();
        Assert.Null(received[1].Trajectory);
        Assert.False(hub.Capabilities.HasFlag(LensCapabilities.RawMomentumEvents | LensCapabilities.RawTickStream));
    }
}
