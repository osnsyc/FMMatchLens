using FMMatchLens.Plugin.Domain;
using System.Text;

namespace FMMatchLens.Plugin.Services;

internal static class ArchiveFrameCodec
{
    private const byte PayloadStructure = 1;
    private const byte RosterResetFlag = 1;
    private const byte PitchChangedFlag = 2;
    private const ulong AllTeamFields = (1UL << 23) - 1;
    private const ulong AllPlayerFields = (1UL << 37) - 1;
    private const int MaxFramesPerChunk = 4_096;

    public static byte[] Encode(IReadOnlyList<RealtimeTickFrame> frames)
    {
        if (frames.Count is 0 or > MaxFramesPerChunk) throw new ArgumentOutOfRangeException(nameof(frames));
        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream, Encoding.UTF8, leaveOpen: true);
        writer.Write(PayloadStructure);
        RealtimeTickFrame? previous = null;
        foreach (var frame in frames)
        {
            var rosterReset = previous is null || !RosterMatches(previous.Players, frame.Players);
            var pitchChanged = previous is null || previous.HalfPitchWidth != frame.HalfPitchWidth || previous.HalfPitchLength != frame.HalfPitchLength;
            writer.Write((byte)((rosterReset ? RosterResetFlag : 0) | (pitchChanged ? PitchChangedFlag : 0)));
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
                    if (player.PlayerId != frame.BallHolderPlayerId.Value) continue;
                    holderSlot = checked(player.Slot + 1);
                    found = true;
                    break;
                }
                if (!found) throw new ArchiveFormatException("invalid_slot", "Ball holder does not reference a player in the frame roster.");
            }
            ArchiveBinary.WriteVarUInt64(writer, checked((ulong)Math.Max(0, holderSlot)));
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
                foreach (var player in frame.Players) WriteFullPlayer(writer, player, frame.HalfPitchWidth, frame.HalfPitchLength);
            }
            else
            {
                for (var index = 0; index < frame.Players.Count; index++)
                {
                    var prior = previous!.Players[index];
                    var current = frame.Players[index];
                    var previousX = ArchiveBinary.Quantize(prior.X, frame.HalfPitchWidth);
                    var previousY = ArchiveBinary.Quantize(prior.Y, frame.HalfPitchLength);
                    var currentX = ArchiveBinary.Quantize(current.X, frame.HalfPitchWidth);
                    var currentY = ArchiveBinary.Quantize(current.Y, frame.HalfPitchLength);
                    ArchiveBinary.WriteVarInt64(writer, currentX - previousX);
                    ArchiveBinary.WriteVarInt64(writer, currentY - previousY);
                    var mask = PlayerMask(prior, current);
                    ArchiveBinary.WriteVarUInt64(writer, mask);
                    WritePlayerFields(writer, current, prior, mask);
                }
            }

            WriteTail(writer, previous?.MomentumEvents, frame.MomentumEvents, WriteEvent);
            WriteTail(writer, previous?.Momentum, frame.Momentum, WriteMomentum);
            WriteTail(writer, previous?.RollingMomentum, frame.RollingMomentum, WriteMomentum);
            previous = frame;
        }
        return stream.ToArray();
    }

    public static IReadOnlyList<RealtimeTickFrame> Decode(
        ReadOnlyMemory<byte> payload,
        string matchId,
        int expectedFrameCount)
    {
        if (expectedFrameCount is < 1 or > MaxFramesPerChunk) throw new ArchiveFormatException("invalid_count", "Chunk frame count is invalid.");
        using var stream = new MemoryStream(payload.ToArray(), writable: false);
        using var reader = new BinaryReader(stream, Encoding.UTF8);
        if (reader.ReadByte() != PayloadStructure) throw new ArchiveFormatException("unsupported_payload_structure", "The chunk payload structure is not supported.");
        var frames = new RealtimeTickFrame[expectedFrameCount];
        RealtimeTickFrame? previous = null;
        for (var frameIndex = 0; frameIndex < frames.Length; frameIndex++)
        {
            var flags = reader.ReadByte();
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
            var halfWidth = previous?.HalfPitchWidth ?? 0;
            var halfLength = previous?.HalfPitchLength ?? 0;
            if (pitchChanged)
            {
                halfWidth = reader.ReadSingle();
                halfLength = reader.ReadSingle();
                ValidatePitch(halfWidth, halfLength);
            }
            var home = ReadTeamDelta(reader, previous?.Home);
            var away = ReadTeamDelta(reader, previous?.Away);
            PlayerTickData[] players;
            if (rosterReset)
            {
                var count = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
                if (count > byte.MaxValue) throw new ArchiveFormatException("invalid_count", "Chunk player count is too large.");
                players = new PlayerTickData[count];
                var slots = new HashSet<int>();
                for (var index = 0; index < count; index++)
                {
                    players[index] = ReadFullPlayer(reader, halfWidth, halfLength);
                    if (!slots.Add(players[index].Slot)) throw new ArchiveFormatException("duplicate_slot", "Chunk keyframe has duplicate player slots.");
                }
            }
            else
            {
                players = new PlayerTickData[previous!.Players.Count];
                for (var index = 0; index < players.Length; index++)
                {
                    var prior = previous.Players[index];
                    var qx = checked((int)ArchiveBinary.Quantize(prior.X, halfWidth) + (int)ArchiveBinary.ReadVarInt64(reader));
                    var qy = checked((int)ArchiveBinary.Quantize(prior.Y, halfLength) + (int)ArchiveBinary.ReadVarInt64(reader));
                    if (qx is < 0 or > ushort.MaxValue || qy is < 0 or > ushort.MaxValue) throw new ArchiveFormatException("invalid_coordinate", "Position delta exceeds the quantized pitch range.");
                    var mask = ArchiveBinary.ReadVarUInt64(reader);
                    if ((mask & ~AllPlayerFields) != 0) throw new ArchiveFormatException("unknown_player_field", "Player delta contains unknown fields.");
                    players[index] = ReadPlayerFields(reader, prior with
                    {
                        X = ArchiveBinary.Dequantize((ushort)qx, halfWidth),
                        Y = ArchiveBinary.Dequantize((ushort)qy, halfLength)
                    }, mask);
                }
            }
            int? holderPlayerId = null;
            if (holderSlotValue > 0)
            {
                var holderSlot = holderSlotValue - 1;
                var holder = players.FirstOrDefault(player => player.Slot == holderSlot);
                if (holder.PlayerId == 0 && !players.Any(player => player.Slot == holderSlot)) throw new ArchiveFormatException("invalid_slot", "Ball holder references an unknown player slot.");
                holderPlayerId = holder.PlayerId;
            }
            for (var index = 0; index < players.Length; index++) players[index] = players[index] with { IsBallHolder = players[index].PlayerId == holderPlayerId };
            var events = ReadTail(reader, previous?.MomentumEvents, ReadEvent);
            var momentum = ReadTail(reader, previous?.Momentum, ReadMomentum);
            var rolling = ReadTail(reader, previous?.RollingMomentum, ReadMomentum);
            var frame = new RealtimeTickFrame(sequence, matchId, tick, displayTick, period, captured, possession, holderPlayerId,
                halfWidth, halfLength, events, momentum, rolling, home, away, players);
            frames[frameIndex] = frame;
            previous = frame;
        }
        if (stream.Position != stream.Length) throw new ArchiveFormatException("trailing_data", "Chunk payload contains trailing bytes.");
        return frames;
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
        void WriteInt(int bit, int value, int oldValue) { if ((mask & (1UL << bit)) != 0) ArchiveBinary.WriteVarInt64(writer, previous.HasValue ? value - oldValue : value); }
        void WriteFloat(int bit, float value) { if ((mask & (1UL << bit)) != 0) WriteFloatXor(writer, value, previous.HasValue ? prior.Xg : 0f); }
    }

    private static TeamTickData ReadTeamDelta(BinaryReader reader, TeamTickData? previous)
    {
        var mask = ArchiveBinary.ReadVarUInt64(reader);
        if ((mask & ~AllTeamFields) != 0) throw new ArchiveFormatException("unknown_team_field", "Team delta contains unknown fields.");
        var prior = previous.GetValueOrDefault();
        int Int(int bit, int oldValue) => (mask & (1UL << bit)) == 0 ? oldValue : checked((previous.HasValue ? oldValue : 0) + (int)ArchiveBinary.ReadVarInt64(reader));
        float Float(int bit, float oldValue) => (mask & (1UL << bit)) == 0 ? oldValue : ReadFloatXor(reader, oldValue);
        return new TeamTickData(
            Int(0, prior.Goals), Float(1, prior.Xg), Int(2, prior.PossessionTime), Int(3, prior.Shots), Int(4, prior.ShotsOnTarget),
            Int(5, prior.ShotsOffTarget), Int(6, prior.BlockedShots), Int(7, prior.ClearCutChances), Int(8, prior.Passes), Int(9, prior.PassesCompleted),
            Int(10, prior.Crosses), Int(11, prior.CrossesCompleted), Int(12, prior.Aerials), Int(13, prior.AerialsWon), Int(14, prior.ProgressivePasses),
            Int(15, prior.FinalThirdPasses), Int(16, prior.TacklesAttempted), Int(17, prior.TacklesWon), Int(18, prior.Fouls), Int(19, prior.Corners),
            Int(20, prior.Offsides), Int(21, prior.YellowCards), Int(22, prior.RedCards));
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
        return mask;
        void Mark(int bit, bool changed) { if (changed) mask |= 1UL << bit; }
    }

    private static void WriteFullPlayer(BinaryWriter writer, PlayerTickData player, float halfWidth, float halfLength)
    {
        ArchiveBinary.WriteVarUInt64(writer, checked((ulong)player.Slot));
        ArchiveBinary.WriteVarInt64(writer, player.PlayerId);
        writer.Write((byte)player.Team);
        writer.Write(ArchiveBinary.Quantize(player.X, halfWidth));
        writer.Write(ArchiveBinary.Quantize(player.Y, halfLength));
        WritePlayerFields(writer, player, default, AllPlayerFields);
    }

    private static PlayerTickData ReadFullPlayer(BinaryReader reader, float halfWidth, float halfLength)
    {
        var slot = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
        var playerId = checked((int)ArchiveBinary.ReadVarInt64(reader));
        var teamValue = reader.ReadByte();
        if (teamValue > 1) throw new ArchiveFormatException("invalid_team", "Player team value is invalid.");
        var seed = default(PlayerTickData) with
        {
            Slot = slot,
            PlayerId = playerId,
            Team = (TeamSide)teamValue,
            X = ArchiveBinary.Dequantize(reader.ReadUInt16(), halfWidth),
            Y = ArchiveBinary.Dequantize(reader.ReadUInt16(), halfLength)
        };
        return ReadPlayerFields(reader, seed, AllPlayerFields);
    }

    private static ulong PlayerMask(PlayerTickData left, PlayerTickData right)
    {
        ulong mask = 0;
        Mark(0, left.Rating != right.Rating); Mark(1, left.IsSubstitute != right.IsSubstitute); Mark(2, left.IsOnPitch != right.IsOnPitch);
        Mark(3, left.SubbedOnMinute != right.SubbedOnMinute); Mark(4, left.SubbedOffMinute != right.SubbedOffMinute); Mark(5, left.YellowCards != right.YellowCards);
        Mark(6, left.RedCards != right.RedCards); Mark(7, left.Goals != right.Goals); Mark(8, left.Assists != right.Assists); Mark(9, left.Xg != right.Xg); Mark(10, left.Xa != right.Xa);
        Mark(11, left.Shots != right.Shots); Mark(12, left.ShotsOnTarget != right.ShotsOnTarget); Mark(13, left.BlockedShots != right.BlockedShots);
        Mark(14, left.ClearCutChances != right.ClearCutChances); Mark(15, left.HitWoodwork != right.HitWoodwork); Mark(16, left.Dribbles != right.Dribbles);
        Mark(17, left.Fouls != right.Fouls); Mark(18, left.Fouled != right.Fouled); Mark(19, left.Crosses != right.Crosses); Mark(20, left.CrossesCompleted != right.CrossesCompleted);
        Mark(21, left.Passes != right.Passes); Mark(22, left.PassesCompleted != right.PassesCompleted); Mark(23, left.KeyPasses != right.KeyPasses);
        Mark(24, left.TacklesAttempted != right.TacklesAttempted); Mark(25, left.TacklesWon != right.TacklesWon); Mark(26, left.KeyTackles != right.KeyTackles);
        Mark(27, left.Aerials != right.Aerials); Mark(28, left.AerialsWon != right.AerialsWon); Mark(29, left.Interceptions != right.Interceptions);
        Mark(30, left.ThrowIns != right.ThrowIns); Mark(31, left.Corners != right.Corners); Mark(32, left.DefensiveFreeKicks != right.DefensiveFreeKicks);
        Mark(33, left.AttackingFreeKicks != right.AttackingFreeKicks); Mark(34, left.Clearances != right.Clearances); Mark(35, left.ShotsFaced != right.ShotsFaced);
        Mark(36, left.DistanceM != right.DistanceM);
        return mask;
        void Mark(int bit, bool changed) { if (changed) mask |= 1UL << bit; }
    }

    private static void WritePlayerFields(BinaryWriter writer, PlayerTickData value, PlayerTickData prior, ulong mask)
    {
        Float(0, value.Rating); Bool(1, value.IsSubstitute); Bool(2, value.IsOnPitch); Int(3, value.SubbedOnMinute); Int(4, value.SubbedOffMinute);
        Int(5, value.YellowCards); Int(6, value.RedCards); Int(7, value.Goals); Int(8, value.Assists); Float(9, value.Xg); Float(10, value.Xa);
        Int(11, value.Shots); Int(12, value.ShotsOnTarget); Int(13, value.BlockedShots); Int(14, value.ClearCutChances); Int(15, value.HitWoodwork);
        Int(16, value.Dribbles); Int(17, value.Fouls); Int(18, value.Fouled); Int(19, value.Crosses); Int(20, value.CrossesCompleted);
        Int(21, value.Passes); Int(22, value.PassesCompleted); Int(23, value.KeyPasses); Int(24, value.TacklesAttempted); Int(25, value.TacklesWon);
        Int(26, value.KeyTackles); Int(27, value.Aerials); Int(28, value.AerialsWon); Int(29, value.Interceptions); Int(30, value.ThrowIns);
        Int(31, value.Corners); Int(32, value.DefensiveFreeKicks); Int(33, value.AttackingFreeKicks); Int(34, value.Clearances); Int(35, value.ShotsFaced);
        Float(36, value.DistanceM);
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
            SubbedOnMinute = Int(3, prior.SubbedOnMinute), SubbedOffMinute = Int(4, prior.SubbedOffMinute), YellowCards = Int(5, prior.YellowCards),
            RedCards = Int(6, prior.RedCards), Goals = Int(7, prior.Goals), Assists = Int(8, prior.Assists), Xg = Float(9, prior.Xg), Xa = Float(10, prior.Xa),
            Shots = Int(11, prior.Shots), ShotsOnTarget = Int(12, prior.ShotsOnTarget), BlockedShots = Int(13, prior.BlockedShots),
            ClearCutChances = Int(14, prior.ClearCutChances), HitWoodwork = Int(15, prior.HitWoodwork), Dribbles = Int(16, prior.Dribbles),
            Fouls = Int(17, prior.Fouls), Fouled = Int(18, prior.Fouled), Crosses = Int(19, prior.Crosses), CrossesCompleted = Int(20, prior.CrossesCompleted),
            Passes = Int(21, prior.Passes), PassesCompleted = Int(22, prior.PassesCompleted), KeyPasses = Int(23, prior.KeyPasses),
            TacklesAttempted = Int(24, prior.TacklesAttempted), TacklesWon = Int(25, prior.TacklesWon), KeyTackles = Int(26, prior.KeyTackles),
            Aerials = Int(27, prior.Aerials), AerialsWon = Int(28, prior.AerialsWon), Interceptions = Int(29, prior.Interceptions),
            ThrowIns = Int(30, prior.ThrowIns), Corners = Int(31, prior.Corners), DefensiveFreeKicks = Int(32, prior.DefensiveFreeKicks),
            AttackingFreeKicks = Int(33, prior.AttackingFreeKicks), Clearances = Int(34, prior.Clearances), ShotsFaced = Int(35, prior.ShotsFaced),
            DistanceM = Float(36, prior.DistanceM)
        };
    }

    private static void WriteTail<T>(BinaryWriter writer, IReadOnlyList<T>? previous, IReadOnlyList<T> current, Action<BinaryWriter, T> write)
    {
        previous ??= Array.Empty<T>();
        var common = 0;
        while (common < previous.Count && common < current.Count && EqualityComparer<T>.Default.Equals(previous[common], current[common])) common++;
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
    }

    private static NativeMomentumEventData ReadEvent(BinaryReader reader)
    {
        var eventIndex = checked((int)ArchiveBinary.ReadVarInt64(reader));
        var tick = checked((int)ArchiveBinary.ReadVarInt64(reader));
        var lateral = reader.ReadSingle(); var longitudinal = reader.ReadSingle();
        var team = reader.ReadByte();
        if (team > 1) throw new ArchiveFormatException("invalid_team", "Event team value is invalid.");
        return new NativeMomentumEventData(eventIndex, tick, lateral, longitudinal, (TeamSide)team,
            checked((int)ArchiveBinary.ReadVarInt64(reader)), checked((int)ArchiveBinary.ReadVarInt64(reader)),
            checked((int)ArchiveBinary.ReadVarInt64(reader)), checked((int)ArchiveBinary.ReadVarInt64(reader)),
            checked((int)ArchiveBinary.ReadVarInt64(reader)), checked((int)ArchiveBinary.ReadVarInt64(reader)));
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
