using FMMatchLens.Plugin.Domain;
using FMMatchLens.Plugin.Memory;

namespace FMMatchLens.Sdk.Tests;

internal static class Fixtures
{
    public static RawRealtimeTickFrame Raw(int tick, nint address = 1)
    {
        var result = new RawRealtimeTickFrame(0)
        {
            MatchAddress = address, Tick = tick, DisplayTick = tick, Sequence = 1000 + tick,
            BallXCentimeters = 125, BallYCentimeters = -250, BallZCentimeters = 175,
            BallPositionValid = true, HalfPitchWidth = 34, HalfPitchLength = 52.5f,
            PlayerCount = 1, MomentumCount = 1,
        };
        result.Players[0] = default(PlayerTickData) with
        {
            Slot = 0, PlayerId = 42, Team = TeamSide.Home, IsOnPitch = true,
            X = 2, Y = 3, PositionValid = true, Rating = 7.2f, IsBallHolder = true,
        };
        result.Momentum[0] = new MomentumTickData(1, tick, 2, 3);
        return result;
    }

    public static RealtimeTickFrame Frame(int tick = 1, string matchId = "source", bool events = false)
    {
        var raw = Raw(tick);
        return new RealtimeTickFrame(raw.Sequence, matchId, tick, tick, 1, 1000 + tick,
            TeamSide.Home, 42, raw.BallXCentimeters, raw.BallYCentimeters, raw.BallZCentimeters,
            raw.HalfPitchWidth, raw.HalfPitchLength, Array.Empty<NativeMomentumEventData>(),
            new[] { raw.Momentum[0] }, Array.Empty<MomentumTickData>(), default, default,
            new[] { raw.Players[0] }, events ? new[] { Update(tick) } : null)
        { BallPositionValid = true };
    }

    public static NativeMomentumEventData Event(int index = 1) => new(index, 1, 2, 3,
        Array.Empty<NativeMomentumTrajectoryPoint>(), TeamSide.Home, 0, 42, 1, 43, 999, 7, 100, 2);
    public static MomentumEventUpdate Update(int sequence = 1) => new(sequence,
        MomentumEventUpdateKind.Add, 100, 0, Event());
}
