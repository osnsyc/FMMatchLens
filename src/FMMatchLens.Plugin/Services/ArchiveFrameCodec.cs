using FMMatchLens.Plugin.Domain;
using FMMatchLens.Plugin.Memory;
using System.Text;

namespace FMMatchLens.Plugin.Services;

internal static class ArchiveFrameCodec
{
    private const byte RosterResetFlag = 1;
    private const byte PitchChangedFlag = 2;
    private const byte BallXChangedFlag = 4;
    private const byte BallYChangedFlag = 8;
    private const byte BallZChangedFlag = 16;
    private const ulong LegacyTeamFields = (1UL << 23) - 1;
    private const ulong AllTeamFields = (1UL << 25) - 1;
    private const ulong LegacyPlayerFields = (1UL << 39) - 1;
    private const ulong Version27PlayerFields = (1UL << 42) - 1;
    private const ulong AllPlayerFields = (1UL << 43) - 1;
    private const ulong DistanceField = 1UL << 36;
    private const ulong CompactPlayerFields = AllPlayerFields & ~DistanceField;
    private const ulong Version27CompactPlayerFields = Version27PlayerFields & ~DistanceField;
    private const byte StatsChangedFlag = 1;
    private const byte DistanceChangedFlag = 2;
    private const byte SpeedChangedFlag = 4;
    private const byte AngleChangedFlag = 8;
    // All 0..360 degree values and the unknown state remain distinct.
    private const int UnknownAngle = 361;
    private const int AngleStateCount = 362;
    private const int MaxFramesPerChunk = 4_096;
    // Must match GameMatchTickHook.MaxStoredMomentumTrajectoryPoints. Lowering
    // this wire limit later requires a new archive minor version or migration.
    private const int MaxTrajectoryPoints = 4;
    private const int RatingStatsInputSize = 34;
    private const ulong AllRatingPlayerFields = ((1UL << 23) - 1) & ~((1UL << 10) | (1UL << 12) | (1UL << 17));

    public static byte[] Encode(IReadOnlyList<RealtimeTickFrame> frames)
    {
        if (frames.Count is 0 or > MaxFramesPerChunk) throw new ArgumentOutOfRangeException(nameof(frames));
        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream, Encoding.UTF8, leaveOpen: true);
        RealtimeTickFrame? previous = null;
        foreach (var frame in frames)
        {
            var rosterReset = previous is null || !RosterMatches(previous.Players, frame.Players);
            var pitchChanged = previous is null || previous.HalfPitchWidth != frame.HalfPitchWidth || previous.HalfPitchLength != frame.HalfPitchLength;
            var ballXDelta = (long)frame.BallXCentimeters - (previous?.BallXCentimeters ?? 0);
            var ballYDelta = (long)frame.BallYCentimeters - (previous?.BallYCentimeters ?? 0);
            var ballZDelta = (long)frame.BallZCentimeters - (previous?.BallZCentimeters ?? 0);
            writer.Write((byte)((rosterReset ? RosterResetFlag : 0) | (pitchChanged ? PitchChangedFlag : 0) |
                (ballXDelta != 0 ? BallXChangedFlag : 0) | (ballYDelta != 0 ? BallYChangedFlag : 0) |
                (ballZDelta != 0 ? BallZChangedFlag : 0)));
            ArchiveBinary.WriteVarInt64(writer, frame.Sequence - (previous?.Sequence ?? 0));
            ArchiveBinary.WriteVarInt64(writer, frame.Tick - (previous?.Tick ?? 0));
            ArchiveBinary.WriteVarInt64(writer, frame.DisplayTick - (previous?.DisplayTick ?? 0));
            ArchiveBinary.WriteVarInt64(writer, frame.CapturedUnixMilliseconds - (previous?.CapturedUnixMilliseconds ?? 0));
            ArchiveBinary.WriteVarInt64(writer, frame.Period - (previous?.Period ?? 0));
            writer.Write(frame.PossessionTeam switch { TeamSide.Home => (byte)1, TeamSide.Away => (byte)2, _ => (byte)0 });
            var holderSlot = 0;
            if (frame.BallHolderPlayerId.HasValue)
            {
                var found = false;
                foreach (var player in frame.Players)
                {
                    if (!player.IsBallHolder) continue;
                    holderSlot = checked(player.Slot + 1);
                    found = true;
                    break;
                }
                if (!found) throw new ArchiveFormatException("invalid_slot", "Ball holder does not reference a player in the frame roster.");
            }
            ArchiveBinary.WriteVarUInt64(writer, checked((ulong)Math.Max(0, holderSlot)));
            if (ballXDelta != 0) ArchiveBinary.WriteVarInt64(writer, ballXDelta);
            if (ballYDelta != 0) ArchiveBinary.WriteVarInt64(writer, ballYDelta);
            if (ballZDelta != 0) ArchiveBinary.WriteVarInt64(writer, ballZDelta);
            if (pitchChanged)
            {
                ValidatePitch(frame.HalfPitchWidth, frame.HalfPitchLength);
                writer.Write(frame.HalfPitchWidth);
                writer.Write(frame.HalfPitchLength);
            }

            WriteTeamDelta(writer, previous?.Home, frame.Home);
            WriteTeamDelta(writer, previous?.Away, frame.Away);
            if (rosterReset)
            {
                ArchiveBinary.WriteVarUInt64(writer, (ulong)frame.Players.Count);
                foreach (var player in frame.Players) WriteFullPlayer(writer, player);
            }
            else
            {
                for (var index = 0; index < frame.Players.Count; index++)
                {
                    var prior = previous!.Players[index];
                    var current = frame.Players[index];
                    var previousX = ArchiveBinary.QuantizeCentimeters(prior.X);
                    var previousY = ArchiveBinary.QuantizeCentimeters(prior.Y);
                    var currentX = ArchiveBinary.QuantizeCentimeters(current.X);
                    var currentY = ArchiveBinary.QuantizeCentimeters(current.Y);
                    ArchiveBinary.WriteVarInt64(writer, currentX - previousX);
                    ArchiveBinary.WriteVarInt64(writer, currentY - previousY);
                    var speedDelta = current.SpeedCentimetersPerSecond - prior.SpeedCentimetersPerSecond;
                    var angleDelta = AngleDelta(prior.AngleDegrees, current.AngleDegrees);
                    var mask = PlayerMask(prior, current);
                    var distance = ArchiveBinary.QuantizeDistance(current.DistanceM);
                    var priorDistance = ArchiveBinary.QuantizeDistance(prior.DistanceM);
                    var distanceChanged = distance != priorDistance;
                    writer.Write((byte)((mask != 0 ? StatsChangedFlag : 0) | (distanceChanged ? DistanceChangedFlag : 0) |
                        (speedDelta != 0 ? SpeedChangedFlag : 0) | (angleDelta != 0 ? AngleChangedFlag : 0)));
                    if (speedDelta != 0) ArchiveBinary.WriteVarInt64(writer, speedDelta);
                    if (angleDelta != 0) ArchiveBinary.WriteVarInt64(writer, angleDelta);
                    if (mask != 0)
                    {
                        ArchiveBinary.WriteVarUInt64(writer, mask);
                        WritePlayerFields(writer, current, prior, mask);
                    }
                    if (distanceChanged) ArchiveBinary.WriteVarInt64(writer, (long)distance - priorDistance);
                }
            }

            WriteTail(writer, previous?.MomentumEvents, frame.MomentumEvents, WriteEvent, MomentumEventEquals);
            WriteTail(writer, previous?.Momentum, frame.Momentum, WriteMomentum);
            WriteTail(writer, previous?.RollingMomentum, frame.RollingMomentum, WriteMomentum);
            WriteRatingResearch(writer, previous, frame);
            previous = frame;
        }
        return stream.ToArray();
    }

    public static IReadOnlyList<RealtimeTickFrame> Decode(
        ReadOnlyMemory<byte> payload,
        string matchId,
        int expectedFrameCount,
        ushort structureMinor,
        RatingModelMetadata? ratingModelMetadata = null)
    {
        if (expectedFrameCount is < 1 or > MaxFramesPerChunk) throw new ArchiveFormatException("invalid_count", "Chunk frame count is invalid.");
        if (structureMinor < ArchiveWireFormat.FirstSupportedStructureMinor ||
            structureMinor > ArchiveWireFormat.StructureMinor)
            throw new ArchiveFormatException("unsupported_archive_structure", $"Archive structure {ArchiveWireFormat.StructureMajor}.{structureMinor} is not supported.");
        using var stream = new MemoryStream(payload.ToArray(), writable: false);
        using var reader = new BinaryReader(stream, Encoding.UTF8);
        // Structure 2.1 predates header-driven frame decoding and wrote a fixed
        // payload marker. It remains readable, but 2.2+ must not add such a marker.
        if (structureMinor == 1 && reader.ReadByte() != ArchiveWireFormat.Legacy21FramePayloadMarker)
            throw new ArchiveFormatException("unsupported_payload_structure", "The legacy 2.1 frame payload marker is invalid.");
        var frames = new RealtimeTickFrame[expectedFrameCount];
        var supportedPlayerFields = structureMinor >= 8 ? CompactPlayerFields : structureMinor >= 7 ? Version27CompactPlayerFields :
            structureMinor >= 6 ? Version27PlayerFields : LegacyPlayerFields;
        RealtimeTickFrame? previous = null;
        for (var frameIndex = 0; frameIndex < frames.Length; frameIndex++)
        {
            var flags = reader.ReadByte();
            var supportedFlags = structureMinor >= 7 ? 31 : 3;
            if ((flags & ~supportedFlags) != 0)
                throw new ArchiveFormatException("unknown_frame_flag", "Frame contains unknown flags.");
            var rosterReset = (flags & RosterResetFlag) != 0;
            var pitchChanged = (flags & PitchChangedFlag) != 0;
            if (previous is null && (!rosterReset || !pitchChanged)) throw new ArchiveFormatException("missing_keyframe", "Chunk does not start with an independent keyframe.");
            var sequence = checked((previous?.Sequence ?? 0) + ArchiveBinary.ReadVarInt64(reader));
            var tick = checked((previous?.Tick ?? 0) + (int)ArchiveBinary.ReadVarInt64(reader));
            var displayTick = checked((previous?.DisplayTick ?? 0) + (int)ArchiveBinary.ReadVarInt64(reader));
            var captured = checked((previous?.CapturedUnixMilliseconds ?? 0) + ArchiveBinary.ReadVarInt64(reader));
            var period = checked((previous?.Period ?? 0) + (int)ArchiveBinary.ReadVarInt64(reader));
            var possessionValue = reader.ReadByte();
            TeamSide? possession = possessionValue switch { 0 => null, 1 => TeamSide.Home, 2 => TeamSide.Away, _ => throw new ArchiveFormatException("invalid_team", "Frame possession value is invalid.") };
            var holderSlotValue = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
            var ballXCentimeters = previous?.BallXCentimeters ?? 0;
            var ballYCentimeters = previous?.BallYCentimeters ?? 0;
            var ballZCentimeters = previous?.BallZCentimeters ?? 0;
            if (structureMinor >= 7)
            {
                if ((flags & BallXChangedFlag) != 0) ballXCentimeters = ReadBallDelta(reader, ballXCentimeters);
                if ((flags & BallYChangedFlag) != 0) ballYCentimeters = ReadBallDelta(reader, ballYCentimeters);
                if ((flags & BallZChangedFlag) != 0) ballZCentimeters = ReadBallDelta(reader, ballZCentimeters);
            }
            var halfWidth = previous?.HalfPitchWidth ?? 0;
            var halfLength = previous?.HalfPitchLength ?? 0;
            if (pitchChanged)
            {
                halfWidth = reader.ReadSingle();
                halfLength = reader.ReadSingle();
                ValidatePitch(halfWidth, halfLength);
            }
            var supportedTeamFields = structureMinor >= 6 ? AllTeamFields : LegacyTeamFields;
            var home = ReadTeamDelta(reader, previous?.Home, supportedTeamFields);
            var away = ReadTeamDelta(reader, previous?.Away, supportedTeamFields);
            PlayerTickData[] players;
            if (rosterReset)
            {
                var count = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
                if (count > byte.MaxValue) throw new ArchiveFormatException("invalid_count", "Chunk player count is too large.");
                players = new PlayerTickData[count];
                var slots = new HashSet<int>();
                for (var index = 0; index < count; index++)
                {
                    players[index] = ReadFullPlayer(
                        reader,
                        halfWidth,
                        halfLength,
                        supportedPlayerFields,
                        structureMinor >= 7);
                    if (!slots.Add(players[index].Slot)) throw new ArchiveFormatException("duplicate_slot", "Chunk keyframe has duplicate player slots.");
                }
            }
            else
            {
                players = new PlayerTickData[previous!.Players.Count];
                for (var index = 0; index < players.Length; index++)
                {
                    var prior = previous.Players[index];
                    var qx = checked((structureMinor >= 7 ? ArchiveBinary.QuantizeCentimeters(prior.X) : (int)ArchiveBinary.Quantize(prior.X, halfWidth)) + (int)ArchiveBinary.ReadVarInt64(reader));
                    var qy = checked((structureMinor >= 7 ? ArchiveBinary.QuantizeCentimeters(prior.Y) : (int)ArchiveBinary.Quantize(prior.Y, halfLength)) + (int)ArchiveBinary.ReadVarInt64(reader));
                    if (structureMinor >= 7
                        ? qx is < short.MinValue or > short.MaxValue || qy is < short.MinValue or > short.MaxValue
                        : qx is < 0 or > ushort.MaxValue || qy is < 0 or > ushort.MaxValue) throw new ArchiveFormatException("invalid_coordinate", "Position delta exceeds the quantized pitch range.");
                    var speed = prior.SpeedCentimetersPerSecond;
                    var angle = prior.AngleDegrees;
                    var playerFlags = structureMinor >= 7 ? reader.ReadByte() : StatsChangedFlag;
                    if ((playerFlags & ~(StatsChangedFlag | DistanceChangedFlag | SpeedChangedFlag | AngleChangedFlag)) != 0)
                        throw new ArchiveFormatException("unknown_player_flag", "Player delta contains unknown flags.");
                    if (structureMinor >= 7)
                    {
                        var decodedSpeed = (playerFlags & SpeedChangedFlag) != 0
                            ? checked((int)speed + (int)ArchiveBinary.ReadVarInt64(reader)) : speed;
                        if (decodedSpeed is < 0 or > ushort.MaxValue)
                            throw new ArchiveFormatException("invalid_movement", "Player movement delta is outside its quantized range.");
                        speed = (ushort)decodedSpeed;
                        if ((playerFlags & AngleChangedFlag) != 0)
                        {
                            var delta = ArchiveBinary.ReadVarInt64(reader);
                            if (delta is < -181 or > 180)
                                throw new ArchiveFormatException("invalid_movement", "Player angle delta is outside its cyclic range.");
                            angle = DecodeAngle((EncodeAngle(angle) + (int)delta + AngleStateCount) % AngleStateCount);
                        }
                    }
                    var mask = (playerFlags & StatsChangedFlag) != 0 ? ArchiveBinary.ReadVarUInt64(reader) : 0;
                    if ((mask & ~supportedPlayerFields) != 0) throw new ArchiveFormatException("unknown_player_field", "Player delta contains unknown fields.");
                    players[index] = ReadPlayerFields(reader, prior with
                    {
                        X = structureMinor >= 7 ? qx / 100f : ArchiveBinary.Dequantize((ushort)qx, halfWidth),
                        Y = structureMinor >= 7 ? qy / 100f : ArchiveBinary.Dequantize((ushort)qy, halfLength),
                        SpeedCentimetersPerSecond = speed,
                        AngleDegrees = angle
                    }, mask);
                    if (structureMinor >= 7 && (playerFlags & DistanceChangedFlag) != 0)
                        players[index] = players[index] with { DistanceM = ArchiveBinary.ReadDistanceDelta(reader, prior.DistanceM) };
                }
            }
            long? holderPlayerId = null;
            int? holderSlot = null;
            if (holderSlotValue > 0)
            {
                holderSlot = holderSlotValue - 1;
                var holder = players.FirstOrDefault(player => player.Slot == holderSlot.Value);
                if (holder.PlayerId == 0 && !players.Any(player => player.Slot == holderSlot.Value)) throw new ArchiveFormatException("invalid_slot", "Ball holder references an unknown player slot.");
                holderPlayerId = holder.PlayerId;
            }
            for (var index = 0; index < players.Length; index++) players[index] = players[index] with { IsBallHolder = players[index].Slot == holderSlot };
            var events = ReadTail(reader, previous?.MomentumEvents, value => ReadEvent(value, structureMinor));
            var momentum = ReadTail(reader, previous?.Momentum, ReadMomentum);
            var rolling = ReadTail(reader, previous?.RollingMomentum, ReadMomentum);
            RatingResearchMatchData? ratingResearch = null;
            if (structureMinor >= 8)
            {
                ratingResearch = ReadRatingResearch(reader, previous, players, ratingModelMetadata);
            }
            var frame = new RealtimeTickFrame(sequence, matchId, tick, displayTick, period, captured, possession, holderPlayerId,
                ballXCentimeters, ballYCentimeters, ballZCentimeters,
                halfWidth, halfLength, events, momentum, rolling, home, away, players)
            {
                RatingResearch = ratingResearch,
            };
            frames[frameIndex] = frame;
            previous = frame;
        }
        if (stream.Position != stream.Length) throw new ArchiveFormatException("trailing_data", "Chunk payload contains trailing bytes.");
        return frames;
    }

    private static void WriteRatingResearch(BinaryWriter writer, RealtimeTickFrame? previous, RealtimeTickFrame frame)
    {
        var match = frame.RatingResearch;
        writer.Write(match is not null);
        if (match is null) return;
        var priorMatch = previous?.RatingResearch;
        ulong matchMask = 0;
        if (priorMatch is null || priorMatch.RatingBaseCondition != match.RatingBaseCondition) matchMask |= 1UL << 0;
        if (priorMatch is null || priorMatch.MatchPhase != match.MatchPhase) matchMask |= 1UL << 1;
        if (priorMatch is null || priorMatch.EventRewardBranch != match.EventRewardBranch) matchMask |= 1UL << 2;
        ArchiveBinary.WriteVarUInt64(writer, matchMask);
        if ((matchMask & (1UL << 0)) != 0) ArchiveBinary.WriteVarUInt64(writer, match.RatingBaseCondition ^ (priorMatch?.RatingBaseCondition ?? 0));
        if ((matchMask & (1UL << 1)) != 0) writer.Write(match.MatchPhase);
        if ((matchMask & (1UL << 2)) != 0) writer.Write(match.EventRewardBranch);

        for (var index = 0; index < frame.Players.Count; index++)
        {
            var player = frame.Players[index];
            var research = player.RatingResearch;
            var priorResearch = previous is not null && index < previous.Players.Count &&
                                previous.Players[index].Slot == player.Slot
                ? previous.Players[index].RatingResearch
                : null;
            if (research is null) throw new ArchiveFormatException("invalid_rating_research", "A rating-enabled frame contains a player without rating data.");
            ulong mask = 0;
            if (priorResearch is null || !PackRatingStats(research.Stats).AsSpan().SequenceEqual(PackRatingStats(priorResearch.Stats))) mask |= 1UL << 0;
            if (priorResearch is null || priorResearch.InternalW25 != research.InternalW25) mask |= 1UL << 1;
            if (priorResearch is null || priorResearch.InternalW24 != research.InternalW24) mask |= 1UL << 2;
            if (priorResearch is null || priorResearch.SpecialW2C != research.SpecialW2C) mask |= 1UL << 3;
            if (priorResearch is null || priorResearch.SpecialW2D != research.SpecialW2D) mask |= 1UL << 4;
            if (priorResearch is null || priorResearch.SpecialW2E != research.SpecialW2E) mask |= 1UL << 5;
            if (priorResearch is null || priorResearch.SpecialW2F != research.SpecialW2F) mask |= 1UL << 6;
            if (priorResearch is null || priorResearch.SpecialW30 != research.SpecialW30) mask |= 1UL << 7;
            if (priorResearch is null || priorResearch.SpecialW31 != research.SpecialW31) mask |= 1UL << 8;
            if (priorResearch is null || priorResearch.RawInternalRating != research.RawInternalRating) mask |= 1UL << 9;
            if (priorResearch is null || priorResearch.InPossessionRoleDuty != research.InPossessionRoleDuty) mask |= 1UL << 11;
            if (priorResearch is null || priorResearch.OutOfPossessionRoleDuty != research.OutOfPossessionRoleDuty) mask |= 1UL << 13;
            if (priorResearch is null || priorResearch.SpecialConditionA != research.SpecialConditionA) mask |= 1UL << 14;
            if (priorResearch is null || priorResearch.SpecialConditionB != research.SpecialConditionB) mask |= 1UL << 15;
            if (priorResearch is null || priorResearch.TotalEligibleDuration != research.TotalEligibleDuration) mask |= 1UL << 16;
            if (priorResearch is null || !RawRecordsEqual(priorResearch.RatingEventsRaw, research.RatingEventsRaw)) mask |= 1UL << 18;
            if (priorResearch is null || priorResearch.TeamAEventCounterCandidate != research.TeamAEventCounterCandidate) mask |= 1UL << 19;
            if (priorResearch is null || priorResearch.TeamBEventCounterCandidate != research.TeamBEventCounterCandidate) mask |= 1UL << 20;
            if (priorResearch is null || priorResearch.TeamAEventAdjustmentCandidate != research.TeamAEventAdjustmentCandidate) mask |= 1UL << 21;
            if (priorResearch is null || priorResearch.TeamBEventAdjustmentCandidate != research.TeamBEventAdjustmentCandidate) mask |= 1UL << 22;
            ArchiveBinary.WriteVarUInt64(writer, mask);
            if ((mask & (1UL << 0)) != 0) WriteRatingStatsDelta(writer, priorResearch?.Stats, research.Stats);
            WriteInt(1, research.InternalW25, priorResearch?.InternalW25 ?? 0);
            WriteInt(2, research.InternalW24, priorResearch?.InternalW24 ?? 0);
            WriteSByte(3, research.SpecialW2C); WriteSByte(4, research.SpecialW2D); WriteSByte(5, research.SpecialW2E);
            WriteByte(6, research.SpecialW2F); WriteByte(7, research.SpecialW30); WriteByte(8, research.SpecialW31);
            WriteInt(9, research.RawInternalRating, priorResearch?.RawInternalRating ?? 0);
            WriteULong(11, research.InPossessionRoleDuty, priorResearch?.InPossessionRoleDuty ?? 0);
            WriteULong(13, research.OutOfPossessionRoleDuty, priorResearch?.OutOfPossessionRoleDuty ?? 0);
            WriteSByte(14, research.SpecialConditionA); WriteSByte(15, research.SpecialConditionB);
            WriteInt(16, research.TotalEligibleDuration, priorResearch?.TotalEligibleDuration ?? 0);
            if ((mask & (1UL << 18)) != 0) WriteRawRecordTail(writer, priorResearch?.RatingEventsRaw, research.RatingEventsRaw, Offsets.RatingEvent.Size);
            WriteByte(19, research.TeamAEventCounterCandidate);
            WriteByte(20, research.TeamBEventCounterCandidate);
            WriteByte(21, research.TeamAEventAdjustmentCandidate);
            WriteByte(22, research.TeamBEventAdjustmentCandidate);

            void WriteInt(int bit, int value, int oldValue) { if ((mask & (1UL << bit)) != 0) ArchiveBinary.WriteVarInt64(writer, value - oldValue); }
            void WriteULong(int bit, ulong value, ulong oldValue) { if ((mask & (1UL << bit)) != 0) ArchiveBinary.WriteVarUInt64(writer, value ^ oldValue); }
            void WriteSByte(int bit, sbyte value) { if ((mask & (1UL << bit)) != 0) writer.Write(value); }
            void WriteByte(int bit, byte value) { if ((mask & (1UL << bit)) != 0) writer.Write(value); }
        }
    }

    private static RatingResearchMatchData? ReadRatingResearch(
        BinaryReader reader,
        RealtimeTickFrame? previous,
        PlayerTickData[] players,
        RatingModelMetadata? ratingModelMetadata)
    {
        if (!reader.ReadBoolean()) return null;
        if (ratingModelMetadata is null)
            throw new ArchiveFormatException("missing_rating_model", "Rating research data has no archive-level rating model metadata.");
        var priorMatch = previous?.RatingResearch;
        var matchMask = ArchiveBinary.ReadVarUInt64(reader);
        if ((matchMask >> 3) != 0) throw new ArchiveFormatException("invalid_rating_research", "Rating match mask contains unknown fields.");
        if (priorMatch is null && matchMask != 0x7UL)
            throw new ArchiveFormatException("missing_keyframe", "Rating match chunk keyframe is incomplete.");
        uint ReadMatchUInt(int bit, uint oldValue) => (matchMask & (1UL << bit)) == 0 ? oldValue : oldValue ^ checked((uint)ArchiveBinary.ReadVarUInt64(reader, 5));
        byte ReadMatchByte(int bit, byte oldValue) => (matchMask & (1UL << bit)) == 0 ? oldValue : reader.ReadByte();
        var match = new RatingResearchMatchData(
            ReadMatchUInt(0, priorMatch?.RatingBaseCondition ?? 0),
            ReadMatchByte(1, priorMatch?.MatchPhase ?? 0),
            ReadMatchByte(2, priorMatch?.EventRewardBranch ?? 0),
            ratingModelMetadata.ActiveBaseline,
            ratingModelMetadata.HomeBackgroundInput,
            ratingModelMetadata.AwayBackgroundInput);

        for (var index = 0; index < players.Length; index++)
        {
            var priorResearch = previous is not null && index < previous.Players.Count &&
                                previous.Players[index].Slot == players[index].Slot
                ? previous.Players[index].RatingResearch
                : null;
            var mask = ArchiveBinary.ReadVarUInt64(reader);
            if ((mask & ~AllRatingPlayerFields) != 0) throw new ArchiveFormatException("invalid_rating_research", "Rating player mask contains unknown fields.");
            if (priorResearch is null && mask != AllRatingPlayerFields)
                throw new ArchiveFormatException("missing_keyframe", "Rating player chunk keyframe is incomplete.");
            var stats = (mask & 1) != 0 ? ReadRatingStatsDelta(reader, priorResearch?.Stats, players[index]) : priorResearch!.Stats;
            int ReadInt(int bit, int oldValue) => (mask & (1UL << bit)) == 0 ? oldValue : checked(oldValue + (int)ArchiveBinary.ReadVarInt64(reader));
            ulong ReadULong(int bit, ulong oldValue) => (mask & (1UL << bit)) == 0 ? oldValue : oldValue ^ ArchiveBinary.ReadVarUInt64(reader);
            sbyte ReadSByte(int bit, sbyte oldValue) => (mask & (1UL << bit)) == 0 ? oldValue : reader.ReadSByte();
            byte ReadByte(int bit, byte oldValue) => (mask & (1UL << bit)) == 0 ? oldValue : reader.ReadByte();
            var internalW25 = ReadInt(1, priorResearch?.InternalW25 ?? 0);
            var internalW24 = ReadInt(2, priorResearch?.InternalW24 ?? 0);
            var specialW2C = ReadSByte(3, priorResearch?.SpecialW2C ?? 0);
            var specialW2D = ReadSByte(4, priorResearch?.SpecialW2D ?? 0);
            var specialW2E = ReadSByte(5, priorResearch?.SpecialW2E ?? 0);
            var specialW2F = ReadByte(6, priorResearch?.SpecialW2F ?? 0);
            var specialW30 = ReadByte(7, priorResearch?.SpecialW30 ?? 0);
            var specialW31 = ReadByte(8, priorResearch?.SpecialW31 ?? 0);
            var rawInternalRating = ReadInt(9, priorResearch?.RawInternalRating ?? 0);
            var inRole = ReadULong(11, priorResearch?.InPossessionRoleDuty ?? 0);
            var outRole = ReadULong(13, priorResearch?.OutOfPossessionRoleDuty ?? 0);
            var conditionA = ReadSByte(14, priorResearch?.SpecialConditionA ?? 0);
            var conditionB = ReadSByte(15, priorResearch?.SpecialConditionB ?? 0);
            var totalEligibleDuration = ReadInt(16, priorResearch?.TotalEligibleDuration ?? 0);
            var events = (mask & (1UL << 18)) != 0
                ? ReadRawRecordTail(reader, priorResearch?.RatingEventsRaw, Offsets.RatingEvent.Size)
                : priorResearch!.RatingEventsRaw;
            var teamAEventCounter = ReadByte(19, priorResearch?.TeamAEventCounterCandidate ?? 0);
            var teamBEventCounter = ReadByte(20, priorResearch?.TeamBEventCounterCandidate ?? 0);
            var teamAEventAdjustment = ReadByte(21, priorResearch?.TeamAEventAdjustmentCandidate ?? 0);
            var teamBEventAdjustment = ReadByte(22, priorResearch?.TeamBEventAdjustmentCandidate ?? 0);
            var research = new RatingResearchPlayerData(
                stats,
                internalW25, internalW24,
                specialW2C, specialW2D, specialW2E, specialW2F, specialW30, specialW31,
                rawInternalRating,
                inRole, outRole,
                conditionA, conditionB,
                teamAEventCounter, teamBEventCounter,
                teamAEventAdjustment, teamBEventAdjustment,
                totalEligibleDuration,
                events);
            players[index] = players[index] with { RatingResearch = research };
        }
        return match;
    }

    internal static byte[] EncodeRatingModelMetadata(RatingModelMetadata value)
    {
        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream, Encoding.UTF8, leaveOpen: true);
        ArchiveBinary.WriteVarInt64(writer, value.ActiveBaseline);
        writer.Write(value.HomeBackgroundInput);
        writer.Write(value.AwayBackgroundInput);
        return stream.ToArray();
    }

    internal static RatingModelMetadata DecodeRatingModelMetadata(byte[] payload)
    {
        using var stream = new MemoryStream(payload, writable: false);
        using var reader = new BinaryReader(stream, Encoding.UTF8);
        var baseline = checked((int)ArchiveBinary.ReadVarInt64(reader));
        var home = reader.ReadSingle();
        var away = reader.ReadSingle();
        if (stream.Position != stream.Length)
            throw new ArchiveFormatException("trailing_data", "Rating model metadata contains trailing bytes.");
        if (baseline is < 0 or > 10_000 || !float.IsFinite(home) || !float.IsFinite(away))
            throw new ArchiveFormatException("invalid_rating_model", "Rating model metadata is invalid.");
        return new RatingModelMetadata(baseline, home, away);
    }

    private static void WriteRatingStatsDelta(BinaryWriter writer, RatingStatsInputs? previous, RatingStatsInputs current)
    {
        var prior = PackRatingStats(previous ?? default);
        var next = PackRatingStats(current);
        ulong changed = 0;
        for (var index = 0; index < next.Length; index++)
        {
            if (next[index] != prior[index]) changed |= 1UL << index;
        }
        ArchiveBinary.WriteVarUInt64(writer, changed);
        for (var index = 0; index < next.Length; index++)
        {
            if ((changed & (1UL << index)) != 0) writer.Write((byte)(next[index] ^ prior[index]));
        }
    }

    private static RatingStatsInputs ReadRatingStatsDelta(BinaryReader reader, RatingStatsInputs? previous, PlayerTickData player)
    {
        var bytes = PackRatingStats(previous ?? default);
        var changed = ArchiveBinary.ReadVarUInt64(reader);
        if ((changed >> RatingStatsInputSize) != 0)
            throw new ArchiveFormatException("invalid_rating_research", "Rating stats delta contains unknown bits.");
        for (var index = 0; index < bytes.Length; index++)
        {
            if ((changed & (1UL << index)) != 0) bytes[index] ^= reader.ReadByte();
        }
        return UnpackRatingStats(bytes, player);
    }

    private static byte[] PackRatingStats(RatingStatsInputs value)
        => RatingResearchPlayerWireData.PackStats(value);

    private static RatingStatsInputs UnpackRatingStats(byte[] bytes, PlayerTickData player)
    {
        if (bytes.Length != RatingStatsInputSize) throw new ArchiveFormatException("invalid_rating_research", "Rating stats payload has an invalid size.");
        using var stream = new MemoryStream(bytes, writable: false);
        using var reader = new BinaryReader(stream, Encoding.UTF8);
        return new RatingStatsInputs(
            player.Xg, reader.ReadSingle(),
            (byte)player.Goals, reader.ReadByte(), (byte)player.Penalties, (byte)player.OwnGoals, (byte)player.Shots, (byte)player.ShotsOnTarget,
            (byte)player.SavesHeld, (byte)player.SavesParried, (byte)player.SavesTipped,
            reader.ReadByte(), reader.ReadByte(), reader.ReadByte(),
            (byte)player.Assists, reader.ReadByte(), (byte)player.Dribbles, (byte)player.Fouls, (byte)player.Fouled,
            reader.ReadByte(), reader.ReadByte(), reader.ReadByte(),
            (byte)player.TacklesAttempted, (byte)player.TacklesWon, (byte)player.Aerials, (byte)player.AerialsWon, (byte)player.Interceptions,
            reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(),
            (byte)player.Clearances,
            reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(),
            reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(),
            reader.ReadInt16(), reader.ReadInt16(), reader.ReadInt16(), reader.ReadInt16());
    }

    private static bool RawRecordsEqual(IReadOnlyList<byte[]> left, IReadOnlyList<byte[]> right)
    {
        if (left.Count != right.Count) return false;
        for (var index = 0; index < left.Count; index++)
            if (!left[index].AsSpan().SequenceEqual(right[index])) return false;
        return true;
    }

    private static void WriteRawRecordTail(
        BinaryWriter writer,
        IReadOnlyList<byte[]>? previous,
        IReadOnlyList<byte[]> records,
        int recordSize)
    {
        if (records.Count > 4_096)
            throw new ArchiveFormatException("invalid_rating_research", "Rating research record count exceeds the wire limit.");
        var common = 0;
        if (previous is not null)
        {
            var limit = Math.Min(previous.Count, records.Count);
            while (common < limit && previous[common].AsSpan().SequenceEqual(records[common])) common++;
        }
        ArchiveBinary.WriteVarUInt64(writer, checked((ulong)common));
        ArchiveBinary.WriteVarUInt64(writer, checked((ulong)(records.Count - common)));
        for (var index = common; index < records.Count; index++)
        {
            var record = records[index];
            if (record.Length != recordSize)
                throw new ArchiveFormatException("invalid_rating_research", "Rating research record has an invalid size.");
            writer.Write(record);
        }
    }

    private static IReadOnlyList<byte[]> ReadRawRecordTail(
        BinaryReader reader,
        IReadOnlyList<byte[]>? previous,
        int recordSize)
    {
        var prior = previous ?? Array.Empty<byte[]>();
        var common = checked((int)ArchiveBinary.ReadVarUInt64(reader, 2));
        var tail = checked((int)ArchiveBinary.ReadVarUInt64(reader, 2));
        if (common > prior.Count || common + tail > 4_096)
            throw new ArchiveFormatException("invalid_rating_research", "Rating research record count exceeds the wire limit.");
        if (common + tail == 0) return Array.Empty<byte[]>();
        var records = new byte[common + tail][];
        for (var index = 0; index < common; index++) records[index] = prior[index];
        for (var index = common; index < records.Length; index++)
        {
            records[index] = reader.ReadBytes(recordSize);
            if (records[index].Length != recordSize) throw new EndOfStreamException("Rating research record is truncated.");
        }
        return records;
    }

    private static bool RosterMatches(IReadOnlyList<PlayerTickData> left, IReadOnlyList<PlayerTickData> right)
    {
        if (left.Count != right.Count) return false;
        for (var index = 0; index < left.Count; index++)
        {
            if (left[index].Slot != right[index].Slot || left[index].PlayerId != right[index].PlayerId || left[index].Team != right[index].Team) return false;
        }
        return true;
    }

    private static void ValidatePitch(float halfWidth, float halfLength)
    {
        if (!float.IsFinite(halfWidth) || !float.IsFinite(halfLength) || halfWidth <= 0 || halfLength <= 0 || halfWidth > 1_000 || halfLength > 1_000)
            throw new ArchiveFormatException("invalid_pitch", "Pitch dimensions are invalid.");
    }

    private static void WriteTeamDelta(BinaryWriter writer, TeamTickData? previous, TeamTickData current)
    {
        var mask = previous.HasValue ? TeamMask(previous.Value, current) : AllTeamFields;
        ArchiveBinary.WriteVarUInt64(writer, mask);
        var prior = previous.GetValueOrDefault();
        WriteInt(0, current.Goals, prior.Goals); WriteFloat(1, current.Xg); WriteInt(2, current.PossessionTime, prior.PossessionTime);
        WriteInt(3, current.Shots, prior.Shots); WriteInt(4, current.ShotsOnTarget, prior.ShotsOnTarget); WriteInt(5, current.ShotsOffTarget, prior.ShotsOffTarget);
        WriteInt(6, current.BlockedShots, prior.BlockedShots); WriteInt(7, current.ClearCutChances, prior.ClearCutChances); WriteInt(8, current.Passes, prior.Passes);
        WriteInt(9, current.PassesCompleted, prior.PassesCompleted); WriteInt(10, current.Crosses, prior.Crosses); WriteInt(11, current.CrossesCompleted, prior.CrossesCompleted);
        WriteInt(12, current.Aerials, prior.Aerials); WriteInt(13, current.AerialsWon, prior.AerialsWon); WriteInt(14, current.ProgressivePasses, prior.ProgressivePasses);
        WriteInt(15, current.FinalThirdPasses, prior.FinalThirdPasses); WriteInt(16, current.TacklesAttempted, prior.TacklesAttempted); WriteInt(17, current.TacklesWon, prior.TacklesWon);
        WriteInt(18, current.Fouls, prior.Fouls); WriteInt(19, current.Corners, prior.Corners); WriteInt(20, current.Offsides, prior.Offsides);
        WriteInt(21, current.YellowCards, prior.YellowCards); WriteInt(22, current.RedCards, prior.RedCards);
        WriteInt(23, current.FirstHalfShots, prior.FirstHalfShots); WriteInt(24, current.SecondHalfShots, prior.SecondHalfShots);
        void WriteInt(int bit, int value, int oldValue) { if ((mask & (1UL << bit)) != 0) ArchiveBinary.WriteVarInt64(writer, previous.HasValue ? value - oldValue : value); }
        void WriteFloat(int bit, float value) { if ((mask & (1UL << bit)) != 0) WriteFloatXor(writer, value, previous.HasValue ? prior.Xg : 0f); }
    }

    private static TeamTickData ReadTeamDelta(BinaryReader reader, TeamTickData? previous, ulong supportedTeamFields)
    {
        var mask = ArchiveBinary.ReadVarUInt64(reader);
        if ((mask & ~supportedTeamFields) != 0) throw new ArchiveFormatException("unknown_team_field", "Team delta contains unknown fields.");
        var prior = previous.GetValueOrDefault();
        int Int(int bit, int oldValue) => (mask & (1UL << bit)) == 0 ? oldValue : checked((previous.HasValue ? oldValue : 0) + (int)ArchiveBinary.ReadVarInt64(reader));
        float Float(int bit, float oldValue) => (mask & (1UL << bit)) == 0 ? oldValue : ReadFloatXor(reader, oldValue);
        return new TeamTickData(
            Int(0, prior.Goals), Float(1, prior.Xg), Int(2, prior.PossessionTime), Int(3, prior.Shots), Int(4, prior.ShotsOnTarget),
            Int(5, prior.ShotsOffTarget), Int(6, prior.BlockedShots), Int(7, prior.ClearCutChances), Int(8, prior.Passes), Int(9, prior.PassesCompleted),
            Int(10, prior.Crosses), Int(11, prior.CrossesCompleted), Int(12, prior.Aerials), Int(13, prior.AerialsWon), Int(14, prior.ProgressivePasses),
            Int(15, prior.FinalThirdPasses), Int(16, prior.TacklesAttempted), Int(17, prior.TacklesWon), Int(18, prior.Fouls), Int(19, prior.Corners),
            Int(20, prior.Offsides), Int(21, prior.YellowCards), Int(22, prior.RedCards), Int(23, prior.FirstHalfShots), Int(24, prior.SecondHalfShots));
    }

    private static ulong TeamMask(TeamTickData left, TeamTickData right)
    {
        ulong mask = 0;
        Mark(0, left.Goals != right.Goals); Mark(1, left.Xg != right.Xg); Mark(2, left.PossessionTime != right.PossessionTime);
        Mark(3, left.Shots != right.Shots); Mark(4, left.ShotsOnTarget != right.ShotsOnTarget); Mark(5, left.ShotsOffTarget != right.ShotsOffTarget);
        Mark(6, left.BlockedShots != right.BlockedShots); Mark(7, left.ClearCutChances != right.ClearCutChances); Mark(8, left.Passes != right.Passes);
        Mark(9, left.PassesCompleted != right.PassesCompleted); Mark(10, left.Crosses != right.Crosses); Mark(11, left.CrossesCompleted != right.CrossesCompleted);
        Mark(12, left.Aerials != right.Aerials); Mark(13, left.AerialsWon != right.AerialsWon); Mark(14, left.ProgressivePasses != right.ProgressivePasses);
        Mark(15, left.FinalThirdPasses != right.FinalThirdPasses); Mark(16, left.TacklesAttempted != right.TacklesAttempted); Mark(17, left.TacklesWon != right.TacklesWon);
        Mark(18, left.Fouls != right.Fouls); Mark(19, left.Corners != right.Corners); Mark(20, left.Offsides != right.Offsides);
        Mark(21, left.YellowCards != right.YellowCards); Mark(22, left.RedCards != right.RedCards);
        Mark(23, left.FirstHalfShots != right.FirstHalfShots); Mark(24, left.SecondHalfShots != right.SecondHalfShots);
        return mask;
        void Mark(int bit, bool changed) { if (changed) mask |= 1UL << bit; }
    }

    private static void WriteFullPlayer(BinaryWriter writer, PlayerTickData player)
    {
        ArchiveBinary.WriteVarUInt64(writer, checked((ulong)player.Slot));
        ArchiveBinary.WriteVarInt64(writer, player.PlayerId);
        writer.Write((byte)player.Team);
        writer.Write(ArchiveBinary.QuantizeCentimeters(player.X));
        writer.Write(ArchiveBinary.QuantizeCentimeters(player.Y));
        ArchiveBinary.WriteVarUInt64(writer, player.SpeedCentimetersPerSecond);
        ArchiveBinary.WriteVarUInt64(writer, (ulong)EncodeAngle(player.AngleDegrees));
        WritePlayerFields(writer, player, default, CompactPlayerFields);
        ArchiveBinary.WriteVarInt64(writer, ArchiveBinary.QuantizeDistance(player.DistanceM));
    }

    private static PlayerTickData ReadFullPlayer(
        BinaryReader reader,
        float halfWidth,
        float halfLength,
        ulong playerFields,
        bool compactEncoding)
    {
        var slot = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
        var playerId = ArchiveBinary.ReadVarInt64(reader);
        var teamValue = reader.ReadByte();
        if (teamValue > 1) throw new ArchiveFormatException("invalid_team", "Player team value is invalid.");
        var x = compactEncoding ? reader.ReadInt16() / 100f : ArchiveBinary.Dequantize(reader.ReadUInt16(), halfWidth);
        var y = compactEncoding ? reader.ReadInt16() / 100f : ArchiveBinary.Dequantize(reader.ReadUInt16(), halfLength);
        var speedValue = compactEncoding ? ArchiveBinary.ReadVarUInt64(reader) : 0;
        var encodedAngle = compactEncoding ? ArchiveBinary.ReadVarUInt64(reader) : UnknownAngle;
        if (speedValue > ushort.MaxValue || encodedAngle > UnknownAngle)
            throw new ArchiveFormatException("invalid_movement", "Player facing angle is outside its quantized range.");
        var speed = (ushort)speedValue;
        var angle = DecodeAngle((int)encodedAngle);
        var seed = default(PlayerTickData) with
        {
            Slot = slot,
            PlayerId = playerId,
            Team = (TeamSide)teamValue,
            X = x,
            Y = y,
            SpeedCentimetersPerSecond = speed,
            AngleDegrees = angle
        };
        var player = ReadPlayerFields(reader, seed, playerFields);
        return compactEncoding ? player with { DistanceM = ArchiveBinary.ReadDistanceDelta(reader, 0) } : player;
    }

    private static int EncodeAngle(ushort? angle)
    {
        if (angle > 360) throw new ArchiveFormatException("invalid_movement", "Player facing angle exceeds 360 degrees.");
        return angle ?? UnknownAngle;
    }

    private static ushort? DecodeAngle(int angle) => angle == UnknownAngle ? null : (ushort)angle;

    private static int AngleDelta(ushort? prior, ushort? current)
    {
        var delta = EncodeAngle(current) - EncodeAngle(prior);
        return delta > 180 ? delta - AngleStateCount : delta < -181 ? delta + AngleStateCount : delta;
    }

    private static int ReadBallDelta(BinaryReader reader, int prior)
    {
        var value = checked((long)prior + ArchiveBinary.ReadVarInt64(reader));
        if (value is < int.MinValue or > int.MaxValue)
            throw new ArchiveFormatException("invalid_coordinate", "Football coordinate exceeds Int32 centimeters.");
        return (int)value;
    }

    private static ulong PlayerMask(PlayerTickData left, PlayerTickData right)
    {
        ulong mask = 0;
        Mark(0, left.Rating != right.Rating); Mark(1, left.IsSubstitute != right.IsSubstitute); Mark(2, left.IsOnPitch != right.IsOnPitch);
        Mark(3, left.SubbedOnMinute != right.SubbedOnMinute); Mark(4, left.SubbedOffMinute != right.SubbedOffMinute); Mark(5, left.Penalties != right.Penalties);
        Mark(6, left.OwnGoals != right.OwnGoals); Mark(7, left.Goals != right.Goals); Mark(8, left.Assists != right.Assists); Mark(9, left.Xg != right.Xg); Mark(10, left.Xa != right.Xa);
        Mark(11, left.Shots != right.Shots); Mark(12, left.ShotsOnTarget != right.ShotsOnTarget); Mark(13, left.BlockedShots != right.BlockedShots);
        Mark(14, left.ClearCutChances != right.ClearCutChances); Mark(15, left.HitWoodwork != right.HitWoodwork); Mark(16, left.Dribbles != right.Dribbles);
        Mark(17, left.Fouls != right.Fouls); Mark(18, left.Fouled != right.Fouled); Mark(19, left.Crosses != right.Crosses); Mark(20, left.CrossesCompleted != right.CrossesCompleted);
        Mark(21, left.Passes != right.Passes); Mark(22, left.PassesCompleted != right.PassesCompleted); Mark(23, left.KeyPasses != right.KeyPasses);
        Mark(24, left.TacklesAttempted != right.TacklesAttempted); Mark(25, left.TacklesWon != right.TacklesWon); Mark(26, left.KeyTackles != right.KeyTackles);
        Mark(27, left.Aerials != right.Aerials); Mark(28, left.AerialsWon != right.AerialsWon); Mark(29, left.Interceptions != right.Interceptions);
        Mark(30, left.ThrowIns != right.ThrowIns); Mark(31, left.Corners != right.Corners); Mark(32, left.DefensiveFreeKicks != right.DefensiveFreeKicks);
        Mark(33, left.AttackingFreeKicks != right.AttackingFreeKicks); Mark(34, left.Clearances != right.Clearances); Mark(35, left.ShotsFaced != right.ShotsFaced);
        Mark(37, left.OverallPhysicalCondition != right.OverallPhysicalCondition); Mark(38, left.MatchSharpness != right.MatchSharpness);
        Mark(39, left.SavesHeld != right.SavesHeld); Mark(40, left.SavesParried != right.SavesParried); Mark(41, left.SavesTipped != right.SavesTipped);
        Mark(42, left.ProgressivePasses != right.ProgressivePasses);
        return mask;
        void Mark(int bit, bool changed) { if (changed) mask |= 1UL << bit; }
    }

    private static void WritePlayerFields(BinaryWriter writer, PlayerTickData value, PlayerTickData prior, ulong mask)
    {
        Float(0, value.Rating); Bool(1, value.IsSubstitute); Bool(2, value.IsOnPitch); Int(3, value.SubbedOnMinute); Int(4, value.SubbedOffMinute);
        Int(5, value.Penalties); Int(6, value.OwnGoals); Int(7, value.Goals); Int(8, value.Assists); Float(9, value.Xg); Float(10, value.Xa);
        Int(11, value.Shots); Int(12, value.ShotsOnTarget); Int(13, value.BlockedShots); Int(14, value.ClearCutChances); Int(15, value.HitWoodwork);
        Int(16, value.Dribbles); Int(17, value.Fouls); Int(18, value.Fouled); Int(19, value.Crosses); Int(20, value.CrossesCompleted);
        Int(21, value.Passes); Int(22, value.PassesCompleted); Int(23, value.KeyPasses); Int(24, value.TacklesAttempted); Int(25, value.TacklesWon);
        Int(26, value.KeyTackles); Int(27, value.Aerials); Int(28, value.AerialsWon); Int(29, value.Interceptions); Int(30, value.ThrowIns);
        Int(31, value.Corners); Int(32, value.DefensiveFreeKicks); Int(33, value.AttackingFreeKicks); Int(34, value.Clearances); Int(35, value.ShotsFaced);
        Float(36, value.DistanceM);
        Int(37, value.OverallPhysicalCondition); Int(38, value.MatchSharpness);
        Int(39, value.SavesHeld); Int(40, value.SavesParried); Int(41, value.SavesTipped);
        Int(42, value.ProgressivePasses);
        void Int(int bit, int item) { if ((mask & (1UL << bit)) != 0) ArchiveBinary.WriteVarInt64(writer, item); }
        void Float(int bit, float item)
        {
            if ((mask & (1UL << bit)) == 0) return;
            var oldValue = bit switch { 0 => prior.Rating, 9 => prior.Xg, 10 => prior.Xa, 36 => prior.DistanceM, _ => 0f };
            WriteFloatXor(writer, item, oldValue);
        }
        void Bool(int bit, bool item) { if ((mask & (1UL << bit)) != 0) writer.Write(item); }
    }

    private static PlayerTickData ReadPlayerFields(BinaryReader reader, PlayerTickData prior, ulong mask)
    {
        int Int(int bit, int oldValue) => (mask & (1UL << bit)) == 0 ? oldValue : checked((int)ArchiveBinary.ReadVarInt64(reader));
        float Float(int bit, float oldValue) => (mask & (1UL << bit)) == 0 ? oldValue : ReadFloatXor(reader, oldValue);
        bool Bool(int bit, bool oldValue) => (mask & (1UL << bit)) == 0 ? oldValue : reader.ReadBoolean();
        return prior with
        {
            Rating = Float(0, prior.Rating), IsSubstitute = Bool(1, prior.IsSubstitute), IsOnPitch = Bool(2, prior.IsOnPitch),
            SubbedOnMinute = Int(3, prior.SubbedOnMinute), SubbedOffMinute = Int(4, prior.SubbedOffMinute), Penalties = Int(5, prior.Penalties),
            OwnGoals = Int(6, prior.OwnGoals), Goals = Int(7, prior.Goals), Assists = Int(8, prior.Assists), Xg = Float(9, prior.Xg), Xa = Float(10, prior.Xa),
            Shots = Int(11, prior.Shots), ShotsOnTarget = Int(12, prior.ShotsOnTarget), BlockedShots = Int(13, prior.BlockedShots),
            ClearCutChances = Int(14, prior.ClearCutChances), HitWoodwork = Int(15, prior.HitWoodwork), Dribbles = Int(16, prior.Dribbles),
            Fouls = Int(17, prior.Fouls), Fouled = Int(18, prior.Fouled), Crosses = Int(19, prior.Crosses), CrossesCompleted = Int(20, prior.CrossesCompleted),
            Passes = Int(21, prior.Passes), PassesCompleted = Int(22, prior.PassesCompleted), KeyPasses = Int(23, prior.KeyPasses),
            TacklesAttempted = Int(24, prior.TacklesAttempted), TacklesWon = Int(25, prior.TacklesWon), KeyTackles = Int(26, prior.KeyTackles),
            Aerials = Int(27, prior.Aerials), AerialsWon = Int(28, prior.AerialsWon), Interceptions = Int(29, prior.Interceptions),
            ThrowIns = Int(30, prior.ThrowIns), Corners = Int(31, prior.Corners), DefensiveFreeKicks = Int(32, prior.DefensiveFreeKicks),
            AttackingFreeKicks = Int(33, prior.AttackingFreeKicks), Clearances = Int(34, prior.Clearances), ShotsFaced = Int(35, prior.ShotsFaced),
            DistanceM = Float(36, prior.DistanceM), OverallPhysicalCondition = Int(37, prior.OverallPhysicalCondition),
            MatchSharpness = Int(38, prior.MatchSharpness), SavesHeld = Int(39, prior.SavesHeld),
            SavesParried = Int(40, prior.SavesParried), SavesTipped = Int(41, prior.SavesTipped),
            ProgressivePasses = Int(42, prior.ProgressivePasses)
        };
    }

    private static void WriteTail<T>(BinaryWriter writer, IReadOnlyList<T>? previous, IReadOnlyList<T> current,
        Action<BinaryWriter, T> write, Func<T, T, bool>? equals = null)
    {
        previous ??= Array.Empty<T>();
        equals ??= EqualityComparer<T>.Default.Equals;
        var common = 0;
        while (common < previous.Count && common < current.Count && equals(previous[common], current[common])) common++;
        ArchiveBinary.WriteVarUInt64(writer, (ulong)common);
        ArchiveBinary.WriteVarUInt64(writer, (ulong)(current.Count - common));
        for (var index = common; index < current.Count; index++) write(writer, current[index]);
    }

    private static IReadOnlyList<T> ReadTail<T>(BinaryReader reader, IReadOnlyList<T>? previous, Func<BinaryReader, T> read)
    {
        previous ??= Array.Empty<T>();
        var common = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
        var tail = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
        if (common > previous.Count || common + tail > 65_536) throw new ArchiveFormatException("invalid_count", "Incremental stream count is invalid.");
        var result = new T[common + tail];
        for (var index = 0; index < common; index++) result[index] = previous[index];
        for (var index = common; index < result.Length; index++) result[index] = read(reader);
        return result;
    }

    private static void WriteEvent(BinaryWriter writer, NativeMomentumEventData value)
    {
        ArchiveBinary.WriteVarInt64(writer, value.EventIndex); ArchiveBinary.WriteVarInt64(writer, value.Tick);
        writer.Write(value.LateralPosition); writer.Write(value.LongitudinalPosition); writer.Write((byte)value.Team);
        ArchiveBinary.WriteVarInt64(writer, value.PlayerSlot); ArchiveBinary.WriteVarInt64(writer, value.PlayerId);
        ArchiveBinary.WriteVarInt64(writer, value.ReceiverPlayerSlot); ArchiveBinary.WriteVarInt64(writer, value.ReceiverPlayerId);
        ArchiveBinary.WriteVarInt64(writer, value.EventType); ArchiveBinary.WriteVarInt64(writer, value.Flags);
        ArchiveBinary.WriteVarInt64(writer, value.SequenceIndex); ArchiveBinary.WriteVarInt64(writer, value.CompletionTick);
        var trajectoryPoints = value.TrajectoryPoints ?? Array.Empty<NativeMomentumTrajectoryPoint>();
        if (trajectoryPoints.Count > MaxTrajectoryPoints)
            throw new ArchiveFormatException("invalid_count", "Event trajectory point count is invalid.");
        ArchiveBinary.WriteVarUInt64(writer, (ulong)trajectoryPoints.Count);
        foreach (var point in trajectoryPoints)
        {
            if (!float.IsFinite(point.LateralPosition) || !float.IsFinite(point.LongitudinalPosition))
                throw new ArchiveFormatException("invalid_coordinate", "Event trajectory contains an invalid coordinate.");
            writer.Write(point.LateralPosition);
            writer.Write(point.LongitudinalPosition);
        }
    }

    private static NativeMomentumEventData ReadEvent(BinaryReader reader, ushort structureMinor)
    {
        var eventIndex = checked((int)ArchiveBinary.ReadVarInt64(reader));
        var tick = checked((int)ArchiveBinary.ReadVarInt64(reader));
        var lateral = reader.ReadSingle(); var longitudinal = reader.ReadSingle();
        var team = reader.ReadByte();
        if (team > 1) throw new ArchiveFormatException("invalid_team", "Event team value is invalid.");
        var playerSlot = checked((int)ArchiveBinary.ReadVarInt64(reader));
        var playerId = ArchiveBinary.ReadVarInt64(reader);
        var receiverPlayerSlot = checked((int)ArchiveBinary.ReadVarInt64(reader));
        var receiverPlayerId = ArchiveBinary.ReadVarInt64(reader);
        var eventType = checked((int)ArchiveBinary.ReadVarInt64(reader));
        var flags = checked((int)ArchiveBinary.ReadVarInt64(reader));
        var sequenceIndex = 0;
        var completionTick = 0;
        NativeMomentumTrajectoryPoint[] trajectoryPoints = [];
        if (structureMinor >= 2)
        {
            sequenceIndex = checked((int)ArchiveBinary.ReadVarInt64(reader));
            completionTick = checked((int)ArchiveBinary.ReadVarInt64(reader));
            var pointCount = checked((int)ArchiveBinary.ReadVarUInt64(reader, 2));
            if (pointCount > MaxTrajectoryPoints)
                throw new ArchiveFormatException("invalid_count", "Event trajectory point count is invalid.");
            trajectoryPoints = new NativeMomentumTrajectoryPoint[pointCount];
            for (var index = 0; index < pointCount; index++)
            {
                var pointLateral = reader.ReadSingle();
                var pointLongitudinal = reader.ReadSingle();
                if (!float.IsFinite(pointLateral) || !float.IsFinite(pointLongitudinal))
                    throw new ArchiveFormatException("invalid_coordinate", "Event trajectory contains an invalid coordinate.");
                trajectoryPoints[index] = new(pointLateral, pointLongitudinal);
            }
        }
        return new NativeMomentumEventData(eventIndex, tick, lateral, longitudinal,
            trajectoryPoints,
            (TeamSide)team, playerSlot, playerId, receiverPlayerSlot, receiverPlayerId, eventType, flags,
            sequenceIndex, completionTick);
    }

    private static bool MomentumEventEquals(NativeMomentumEventData left, NativeMomentumEventData right)
    {
        if (left.EventIndex != right.EventIndex || left.Tick != right.Tick ||
            left.LateralPosition != right.LateralPosition || left.LongitudinalPosition != right.LongitudinalPosition ||
            left.Team != right.Team || left.PlayerSlot != right.PlayerSlot || left.PlayerId != right.PlayerId ||
            left.ReceiverPlayerSlot != right.ReceiverPlayerSlot || left.ReceiverPlayerId != right.ReceiverPlayerId ||
            left.EventType != right.EventType || left.Flags != right.Flags ||
            left.SequenceIndex != right.SequenceIndex || left.CompletionTick != right.CompletionTick)
            return false;

        var leftPoints = left.TrajectoryPoints ?? Array.Empty<NativeMomentumTrajectoryPoint>();
        var rightPoints = right.TrajectoryPoints ?? Array.Empty<NativeMomentumTrajectoryPoint>();
        return leftPoints.SequenceEqual(rightPoints);
    }

    private static void WriteMomentum(BinaryWriter writer, MomentumTickData value)
    {
        writer.Write(value.Value); ArchiveBinary.WriteVarInt64(writer, value.TimeTicks);
        ArchiveBinary.WriteVarInt64(writer, value.HomeWeight); ArchiveBinary.WriteVarInt64(writer, value.AwayWeight);
    }

    private static MomentumTickData ReadMomentum(BinaryReader reader) => new(
        reader.ReadSingle(), checked((int)ArchiveBinary.ReadVarInt64(reader)),
        checked((int)ArchiveBinary.ReadVarInt64(reader)), checked((int)ArchiveBinary.ReadVarInt64(reader)));

    private static void WriteFloatXor(BinaryWriter writer, float value, float previous)
    {
        var bits = unchecked((uint)BitConverter.SingleToInt32Bits(value));
        var previousBits = unchecked((uint)BitConverter.SingleToInt32Bits(previous));
        ArchiveBinary.WriteVarUInt64(writer, bits ^ previousBits);
    }

    private static float ReadFloatXor(BinaryReader reader, float previous)
    {
        var delta = checked((uint)ArchiveBinary.ReadVarUInt64(reader, 5));
        var previousBits = unchecked((uint)BitConverter.SingleToInt32Bits(previous));
        return BitConverter.Int32BitsToSingle(unchecked((int)(previousBits ^ delta)));
    }
}
