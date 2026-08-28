using FMMatchLens.Plugin.Diagnostics;
using FMMatchLens.Plugin.Domain;
using System.Text;

namespace FMMatchLens.Plugin.Services;

/// <summary>
/// Append-only binary archive. A truncated final record is ignored by the reader,
/// so all completely written frames remain usable after an abnormal shutdown.
/// </summary>
internal sealed class MatchArchiveStore : IDisposable
{
    private const string Magic = "FMLENS";
    private const byte FrameRecord = 1;
    private const byte EndRecord = 2;
    private const byte MetadataRecord = 3;
    private readonly object _gate = new();
    private readonly string _directory;
    private FileStream? _stream;
    private BinaryWriter? _writer;
    private string? _currentMatchId;
    private string? _currentHomeName;
    private string? _currentAwayName;
    private int _framesSinceFlush;
    private long _lastFlushTimestamp;

    public MatchArchiveStore(string directory)
    {
        _directory = directory;
        Directory.CreateDirectory(_directory);
        PluginLogger.Debug($"Match archives will be stored in {_directory}.");
    }

    public string DirectoryPath => _directory;

    public void Begin(string matchId, long startedUnixMilliseconds)
    {
        lock (_gate)
        {
            CloseWriterLocked();
            try
            {
                var path = GetPath(matchId);
                _stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read, 64 * 1024, FileOptions.SequentialScan);
                _writer = new BinaryWriter(_stream, Encoding.UTF8, leaveOpen: true);
                _writer.Write(Encoding.ASCII.GetBytes(Magic));
                _writer.Write(ProjectMetadata.Version);
                _writer.Write(matchId);
                _writer.Write(startedUnixMilliseconds);
                _writer.Flush();
                _stream.Flush(flushToDisk: true);
                _currentMatchId = matchId;
                _currentHomeName = null;
                _currentAwayName = null;
                _framesSinceFlush = 0;
                _lastFlushTimestamp = Environment.TickCount64;
                PluginLogger.Debug($"GAME_MATCH archive opened: {path}.");
            }
            catch (Exception ex)
            {
                CloseWriterLocked();
                PluginLogger.Warning($"Unable to open GAME_MATCH archive: {ex.Message}");
            }
        }
    }

    public void Append(RealtimeTickFrame frame)
    {
        lock (_gate)
        {
            if (_writer is null || frame.MatchId != _currentMatchId)
            {
                return;
            }

            try
            {
                _writer.Write(FrameRecord);
                WriteFrame(_writer, frame);
                _framesSinceFlush++;

                var now = Environment.TickCount64;
                if (_framesSinceFlush >= 16 || now - _lastFlushTimestamp >= 1_000)
                {
                    _writer.Flush();
                    _framesSinceFlush = 0;
                    _lastFlushTimestamp = now;
                }
            }
            catch (Exception ex)
            {
                CloseWriterLocked();
                PluginLogger.Warning($"GAME_MATCH archive write stopped after an I/O error: {ex.Message}");
            }
        }
    }

    public void WriteMetadata(RealtimeMatchMetadata metadata)
    {
        lock (_gate)
        {
            if (_writer is null || metadata.MatchId != _currentMatchId)
            {
                return;
            }

            try
            {
                if (!string.IsNullOrWhiteSpace(metadata.Home.Name) && metadata.Home.Name != "Home")
                {
                    _currentHomeName = metadata.Home.Name;
                }
                if (!string.IsNullOrWhiteSpace(metadata.Away.Name) && metadata.Away.Name != "Away")
                {
                    _currentAwayName = metadata.Away.Name;
                }
                _writer.Write(MetadataRecord);
                _writer.Write(metadata.CapturedTick);
                WriteTeamMetadata(_writer, metadata.Home);
                WriteTeamMetadata(_writer, metadata.Away);
                _writer.Write((byte)metadata.Players.Count);
                foreach (var player in metadata.Players)
                {
                    _writer.Write(ToByte(player.Slot));
                    _writer.Write(player.PlayerId);
                    _writer.Write(player.Uid ?? 0);
                    _writer.Write((byte)player.Team);
                    _writer.Write((byte)(player.ShirtNumber ?? 0));
                    _writer.Write(player.Position ?? string.Empty);
                    WriteTacticalAssignment(_writer, player.InPossession);
                    WriteTacticalAssignment(_writer, player.OutOfPossession);
                    _writer.Write(player.FirstName ?? string.Empty);
                    _writer.Write(player.SecondName ?? string.Empty);
                    _writer.Write(player.CommonName ?? string.Empty);
                    _writer.Write(player.DisplayName);
                    _writer.Write(player.PortraitPath ?? string.Empty);
                    WritePlayerProfile(_writer, player.Profile);
                    WritePlayerAttributes(_writer, player.Attributes);
                }

                _writer.Flush();
            }
            catch (Exception ex)
            {
                CloseWriterLocked();
                PluginLogger.Warning($"GAME_MATCH archive metadata write failed: {ex.Message}");
            }
        }
    }

    public void Complete(string matchId)
    {
        lock (_gate)
        {
            if (_writer is null || matchId != _currentMatchId)
            {
                return;
            }

            var path = _stream!.Name;
            var homeName = _currentHomeName;
            var awayName = _currentAwayName;
            var finalized = false;
            try
            {
                _writer.Write(EndRecord);
                _writer.Write(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                _writer.Flush();
                _stream.Flush(flushToDisk: true);
                finalized = true;
            }
            catch (Exception ex)
            {
                PluginLogger.Warning($"Unable to finalize GAME_MATCH archive {path}: {ex.Message}");
            }
            finally
            {
                CloseWriterLocked();
            }

            if (finalized)
            {
                path = TryAppendTeamNames(path, matchId, homeName, awayName);
                PluginLogger.Info($"GAME_MATCH archive finalized and closed: {path}.");
            }
        }
    }

    public IReadOnlyList<MatchArchiveSummary> List()
    {
        lock (_gate)
        {
            _writer?.Flush();
            var result = new List<MatchArchiveSummary>();
            foreach (var path in Directory.EnumerateFiles(_directory, "*.fmlens", SearchOption.TopDirectoryOnly))
            {
                if (TryScan(path, 0, null, 1, 0, materialize: false, out var scan))
                {
                    result.Add(scan.Summary);
                }
            }

            return result.OrderByDescending(item => item.StartedUnixMilliseconds).ToArray();
        }
    }

    public bool TryReadFrames(string matchId, int fromTick, int? toTick, int stride, int limit, out ArchivedFrameSlice slice)
    {
        slice = default!;
        if (!IsSafeMatchId(matchId))
        {
            return false;
        }

        lock (_gate)
        {
            _writer?.Flush();
            stride = Math.Clamp(stride, 1, 1_000);
            limit = Math.Clamp(limit, 1, 10_000);
            if (!TryScan(FindPath(matchId), fromTick, toTick, stride, limit, materialize: true, out var scan))
            {
                return false;
            }

            slice = new ArchivedFrameSlice(scan.Summary, scan.Metadata, scan.Frames);
            return true;
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            CloseWriterLocked();
        }
    }

    private bool TryScan(
        string path,
        int fromTick,
        int? toTick,
        int stride,
        int limit,
        bool materialize,
        out ArchiveScanResult result)
    {
        result = default!;
        if (!File.Exists(path))
        {
            return false;
        }

        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var reader = new BinaryReader(stream, Encoding.UTF8);
            var magic = Encoding.ASCII.GetString(reader.ReadBytes(Magic.Length));
            if (magic != Magic)
            {
                return false;
            }
            // The producer version is informational; parse archives optimistically.
            _ = reader.ReadString();

            var matchId = reader.ReadString();
            var started = reader.ReadInt64();
            var frames = materialize ? new List<RealtimeTickFrame>(Math.Min(limit, 2_400)) : new List<RealtimeTickFrame>(0);
            var frameCount = 0;
            var firstTick = -1;
            var lastTick = -1;
            var finalHomeGoals = 0;
            var finalAwayGoals = 0;
            var ended = false;
            long? endedAt = null;
            RealtimeMatchMetadata? metadata = null;
            var accepted = 0;

            while (stream.Position < stream.Length)
            {
                var recordType = reader.ReadByte();
                if (recordType == EndRecord)
                {
                    endedAt = reader.ReadInt64();
                    ended = true;
                    break;
                }

                if (recordType == MetadataRecord)
                {
                    metadata = ReadMetadata(reader, matchId, started);
                    continue;
                }

                if (recordType != FrameRecord)
                {
                    break;
                }

                var frame = ReadFrame(reader, matchId, materialize);
                frameCount++;
                firstTick = firstTick < 0 ? frame.Tick : firstTick;
                lastTick = frame.Tick;
                finalHomeGoals = frame.Home.Goals;
                finalAwayGoals = frame.Away.Goals;

                if (materialize &&
                    frame.Tick >= fromTick &&
                    (!toTick.HasValue || frame.Tick <= toTick.Value) &&
                    accepted++ % stride == 0 &&
                    frames.Count < limit)
                {
                    frames.Add(frame);
                }
            }

            var info = new FileInfo(path);
            var (homeName, awayName) = ResolveArchiveTeamNames(matchId, info.Name, metadata);
            var summary = new MatchArchiveSummary(
                matchId,
                info.Name,
                started,
                endedAt,
                ended,
                frameCount,
                firstTick,
                lastTick,
                homeName,
                awayName,
                finalHomeGoals,
                finalAwayGoals,
                info.Length);
            result = new ArchiveScanResult(summary, metadata, frames);
            return true;
        }
        catch (EndOfStreamException)
        {
            // A crash can leave one incomplete record. Rescan the valid prefix by
            // treating it as an unfinished archive instead of exposing corruption.
            return TryScanValidPrefix(path, fromTick, toTick, stride, limit, materialize, out result);
        }
        catch (Exception ex)
        {
            PluginLogger.Warning($"Unable to read match archive {Path.GetFileName(path)}: {ex.Message}");
            return false;
        }
    }

    private bool TryScanValidPrefix(
        string path,
        int fromTick,
        int? toTick,
        int stride,
        int limit,
        bool materialize,
        out ArchiveScanResult result)
    {
        // The normal scanner already retained no externally visible partial state.
        // A second tolerant pass stops at the first incomplete frame.
        result = default!;
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var reader = new BinaryReader(stream, Encoding.UTF8);
            var magic = Encoding.ASCII.GetString(reader.ReadBytes(Magic.Length));
            if (magic != Magic)
            {
                return false;
            }
            // The producer version is informational; parse archives optimistically.
            _ = reader.ReadString();

            var matchId = reader.ReadString();
            var started = reader.ReadInt64();
            var frames = materialize ? new List<RealtimeTickFrame>() : new List<RealtimeTickFrame>(0);
            var count = 0;
            var firstTick = -1;
            var lastTick = -1;
            var homeGoals = 0;
            var awayGoals = 0;
            var accepted = 0;
            var ended = false;
            long? endedAt = null;
            RealtimeMatchMetadata? metadata = null;

            while (stream.Position < stream.Length)
            {
                try
                {
                    var type = reader.ReadByte();
                    if (type == EndRecord)
                    {
                        endedAt = reader.ReadInt64();
                        ended = true;
                        break;
                    }

                    if (type == MetadataRecord)
                    {
                        metadata = ReadMetadata(reader, matchId, started);
                        continue;
                    }

                    if (type != FrameRecord) break;
                    var frame = ReadFrame(reader, matchId, materialize);
                    count++;
                    firstTick = firstTick < 0 ? frame.Tick : firstTick;
                    lastTick = frame.Tick;
                    homeGoals = frame.Home.Goals;
                    awayGoals = frame.Away.Goals;
                    if (materialize && frame.Tick >= fromTick && (!toTick.HasValue || frame.Tick <= toTick.Value) && accepted++ % stride == 0 && frames.Count < limit)
                    {
                        frames.Add(frame);
                    }
                }
                catch (EndOfStreamException)
                {
                    break;
                }
            }

            var info = new FileInfo(path);
            var (homeName, awayName) = ResolveArchiveTeamNames(matchId, info.Name, metadata);
            result = new ArchiveScanResult(
                new MatchArchiveSummary(
                    matchId,
                    info.Name,
                    started,
                    endedAt,
                    ended,
                    count,
                    firstTick,
                    lastTick,
                    homeName,
                    awayName,
                    homeGoals,
                    awayGoals,
                    info.Length),
                metadata,
                frames);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static void WriteFrame(BinaryWriter writer, RealtimeTickFrame frame)
    {
        writer.Write(frame.Sequence);
        writer.Write(frame.Tick);
        writer.Write(frame.DisplayTick);
        writer.Write(frame.Period);
        writer.Write(frame.CapturedUnixMilliseconds);
        writer.Write(frame.PossessionTeam is null ? (sbyte)-1 : (sbyte)frame.PossessionTeam.Value);
        writer.Write(frame.BallHolderPlayerId ?? 0);
        writer.Write(frame.HalfPitchWidth);
        writer.Write(frame.HalfPitchLength);
        writer.Write((byte)frame.MomentumEvents.Count);
        foreach (var item in frame.MomentumEvents)
        {
            writer.Write(item.EventIndex);
            writer.Write(item.Tick);
            writer.Write(item.LateralPosition);
            writer.Write(item.LongitudinalPosition);
            writer.Write((byte)item.Team);
            writer.Write(ToByte(item.PlayerSlot));
            writer.Write(item.PlayerId);
            writer.Write(ToByte(item.ReceiverPlayerSlot));
            writer.Write(item.ReceiverPlayerId);
            writer.Write(ToByte(item.EventType));
            writer.Write(unchecked((ushort)item.Flags));
        }
        WriteTeam(writer, frame.Home);
        WriteTeam(writer, frame.Away);
        writer.Write((byte)frame.Players.Count);
        foreach (var player in frame.Players)
        {
            WritePlayer(writer, player);
        }
        writer.Write((byte)frame.Momentum.Count);
        foreach (var point in frame.Momentum)
        {
            writer.Write(point.Value);
            writer.Write(point.TimeTicks);
            writer.Write(point.HomeWeight);
            writer.Write(point.AwayWeight);
        }
        writer.Write((byte)frame.RollingMomentum.Count);
        foreach (var point in frame.RollingMomentum)
        {
            writer.Write(point.Value);
            writer.Write(point.TimeTicks);
            writer.Write(point.HomeWeight);
            writer.Write(point.AwayWeight);
        }
    }

    private static RealtimeTickFrame ReadFrame(BinaryReader reader, string matchId, bool materialize)
    {
        var sequence = reader.ReadInt64();
        var tick = reader.ReadInt32();
        var displayTick = reader.ReadInt32();
        var period = reader.ReadInt32();
        var captured = reader.ReadInt64();
        var possessionRaw = reader.ReadSByte();
        var ballHolder = reader.ReadInt32();
        var halfPitchWidth = reader.ReadSingle();
        var halfPitchLength = reader.ReadSingle();
        var momentumEventCount = reader.ReadByte();
        var momentumEvents = materialize
            ? new NativeMomentumEventData[momentumEventCount]
            : Array.Empty<NativeMomentumEventData>();
        for (var i = 0; i < momentumEventCount; i++)
        {
            var item = new NativeMomentumEventData(
                reader.ReadInt32(),
                reader.ReadInt32(),
                reader.ReadSingle(),
                reader.ReadSingle(),
                (TeamSide)reader.ReadByte(),
                reader.ReadByte(),
                reader.ReadInt32(),
                reader.ReadByte(),
                reader.ReadInt32(),
                reader.ReadByte(),
                reader.ReadUInt16());
            if (materialize) momentumEvents[i] = item;
        }
        var home = ReadTeam(reader);
        var away = ReadTeam(reader);
        var playerCount = reader.ReadByte();
        var players = materialize ? new PlayerTickData[playerCount] : Array.Empty<PlayerTickData>();
        for (var i = 0; i < playerCount; i++)
        {
            var player = ReadPlayer(reader);
            if (materialize) players[i] = player;
        }

        var momentumCount = reader.ReadByte();
        var momentum = materialize ? new MomentumTickData[momentumCount] : Array.Empty<MomentumTickData>();
        for (var i = 0; i < momentumCount; i++)
        {
            var point = new MomentumTickData(
                reader.ReadSingle(),
                reader.ReadInt32(),
                reader.ReadInt32(),
                reader.ReadInt32());
            if (materialize) momentum[i] = point;
        }

        var rollingMomentumCount = reader.ReadByte();
        var rollingMomentum = materialize
            ? new MomentumTickData[rollingMomentumCount]
            : Array.Empty<MomentumTickData>();
        for (var i = 0; i < rollingMomentumCount; i++)
        {
            var point = new MomentumTickData(
                reader.ReadSingle(),
                reader.ReadInt32(),
                reader.ReadInt32(),
                reader.ReadInt32());
            if (materialize) rollingMomentum[i] = point;
        }

        return new RealtimeTickFrame(
            sequence,
            matchId,
            tick,
            displayTick,
            period,
            captured,
            possessionRaw is 0 or 1 ? (TeamSide)possessionRaw : null,
            ballHolder == 0 ? null : ballHolder,
            halfPitchWidth,
            halfPitchLength,
            momentumEvents,
            momentum,
            rollingMomentum,
            home,
            away,
            players);
    }

    private static RealtimeMatchMetadata ReadMetadata(BinaryReader reader, string matchId, long started)
    {
        var capturedTick = reader.ReadInt32();
        var home = ReadTeamMetadata(reader);
        var away = ReadTeamMetadata(reader);
        var count = reader.ReadByte();
        var players = new RealtimePlayerMetadata[count];
        for (var i = 0; i < count; i++)
        {
            var slot = reader.ReadByte();
            var playerId = reader.ReadInt32();
            var uid = NullIfZero(reader.ReadUInt32());
            var team = (TeamSide)reader.ReadByte();
            var shirtNumber = NullIfZero(reader.ReadByte());
            var position = NullIfEmpty(reader.ReadString());
            var inPossession = ReadTacticalAssignment(reader);
            var outOfPossession = ReadTacticalAssignment(reader);
            var firstName = NullIfEmpty(reader.ReadString());
            var secondName = NullIfEmpty(reader.ReadString());
            var commonName = NullIfEmpty(reader.ReadString());
            var displayName = reader.ReadString();
            var portraitPath = NullIfEmpty(reader.ReadString());
            var profile = ReadPlayerProfile(reader);
            var attributes = ReadPlayerAttributes(reader);
            players[i] = new RealtimePlayerMetadata(
                slot,
                playerId,
                uid,
                team,
                shirtNumber,
                position,
                firstName,
                secondName,
                commonName,
                displayName,
                portraitPath,
                profile,
                attributes,
                inPossession,
                outOfPossession);
        }

        return new RealtimeMatchMetadata(matchId, started, capturedTick, home, away, players);
    }

    private static void WriteTacticalAssignment(BinaryWriter writer, PlayerTacticalAssignment? assignment)
    {
        writer.Write(assignment.HasValue);
        if (!assignment.HasValue) return;

        var value = assignment.Value;
        writer.Write(value.PositionMask);
        writer.Write(value.Position);
        writer.Write(value.RoleDuty);
        writer.Write(value.Role);
        writer.Write(value.RoleAbbreviation);
        writer.Write(value.Duty ?? string.Empty);
    }

    private static PlayerTacticalAssignment? ReadTacticalAssignment(BinaryReader reader)
    {
        if (!reader.ReadBoolean()) return null;
        return new PlayerTacticalAssignment(
            reader.ReadUInt32(),
            reader.ReadString(),
            reader.ReadUInt64(),
            reader.ReadString(),
            reader.ReadString(),
            NullIfEmpty(reader.ReadString()));
    }

    private static void WriteTeamMetadata(BinaryWriter writer, RealtimeTeamMetadata team)
    {
        writer.Write(team.Uid ?? 0);
        writer.Write(team.ClubUid ?? 0);
        writer.Write(team.Name);
        writer.Write(team.BackgroundColour ?? 0);
        writer.Write(team.ForegroundColour ?? 0);
        writer.Write(team.OutlineColour ?? 0);
        writer.Write(team.LogoPath ?? string.Empty);
    }

    private static RealtimeTeamMetadata ReadTeamMetadata(BinaryReader reader)
    {
        var uid = NullIfZero(reader.ReadUInt32());
        var clubUid = NullIfZero(reader.ReadUInt32());
        var name = reader.ReadString();
        return new RealtimeTeamMetadata(
            uid,
            clubUid,
            name,
            NullIfZero(reader.ReadUInt32()),
            NullIfZero(reader.ReadUInt32()),
            NullIfZero(reader.ReadUInt32()),
            NullIfEmpty(reader.ReadString()));
    }

    private static void WritePlayerProfile(BinaryWriter writer, PlayerProfile? profile)
    {
        writer.Write(profile is not null);
        if (profile is null) return;
        WriteNullableInt(writer, profile.WeeklyWage);
        WriteNullableInt(writer, profile.HeightCm);
        WriteNullableInt(writer, profile.Condition);
        WriteNullableInt(writer, profile.Morale);
        WriteNullableInt(writer, profile.CurrentAbility);
        WriteNullableInt(writer, profile.PotentialAbility);
        WriteNullableInt(writer, profile.CurrentReputation);
    }

    private static PlayerProfile? ReadPlayerProfile(BinaryReader reader)
    {
        return !reader.ReadBoolean()
            ? null
            : new PlayerProfile(
                ReadNullableInt(reader),
                ReadNullableInt(reader),
                ReadNullableInt(reader),
                ReadNullableInt(reader),
                ReadNullableInt(reader),
                ReadNullableInt(reader),
                ReadNullableInt(reader));
    }

    private static void WritePlayerAttributes(BinaryWriter writer, PlayerAttributes? attributes)
    {
        writer.Write(attributes is not null);
        if (attributes is null) return;
        WriteAttributeGroup(writer, attributes.Technical);
        WriteAttributeGroup(writer, attributes.Mental);
        WriteAttributeGroup(writer, attributes.Physical);
        WriteAttributeGroup(writer, attributes.Goalkeeping);
    }

    private static PlayerAttributes? ReadPlayerAttributes(BinaryReader reader)
    {
        return !reader.ReadBoolean()
            ? null
            : new PlayerAttributes(
                ReadAttributeGroup(reader),
                ReadAttributeGroup(reader),
                ReadAttributeGroup(reader),
                ReadAttributeGroup(reader));
    }

    private static void WriteAttributeGroup(BinaryWriter writer, IReadOnlyDictionary<string, int> attributes)
    {
        writer.Write((byte)Math.Min(byte.MaxValue, attributes.Count));
        foreach (var attribute in attributes.Take(byte.MaxValue))
        {
            writer.Write(attribute.Key);
            writer.Write((byte)Math.Clamp(attribute.Value, byte.MinValue, byte.MaxValue));
        }
    }

    private static IReadOnlyDictionary<string, int> ReadAttributeGroup(BinaryReader reader)
    {
        var count = reader.ReadByte();
        var attributes = new Dictionary<string, int>(count);
        for (var index = 0; index < count; index++)
        {
            attributes[reader.ReadString()] = reader.ReadByte();
        }
        return attributes;
    }

    private static void WriteNullableInt(BinaryWriter writer, int? value) => writer.Write(value ?? 0);

    private static int? ReadNullableInt(BinaryReader reader)
    {
        var value = reader.ReadInt32();
        return value > 0 ? value : null;
    }

    private static uint? NullIfZero(uint value) => value == 0 ? null : value;

    private static int? NullIfZero(byte value) => value == 0 ? null : value;

    private static string? NullIfEmpty(string value) => string.IsNullOrWhiteSpace(value) ? null : value;

    private static void WriteTeam(BinaryWriter writer, TeamTickData team)
    {
        writer.Write(ToByte(team.Goals)); writer.Write(team.Xg); writer.Write(team.PossessionTime);
        writer.Write(ToByte(team.Shots)); writer.Write(ToByte(team.ShotsOnTarget)); writer.Write(ToByte(team.ShotsOffTarget));
        writer.Write(ToByte(team.BlockedShots)); writer.Write(ToByte(team.ClearCutChances)); writer.Write(team.Passes); writer.Write(team.PassesCompleted);
        writer.Write(ToInt16(team.Crosses)); writer.Write(ToInt16(team.CrossesCompleted)); writer.Write(ToInt16(team.Aerials));
        writer.Write(ToInt16(team.AerialsWon)); writer.Write(ToInt16(team.ProgressivePasses)); writer.Write(ToInt16(team.FinalThirdPasses));
        writer.Write(ToByte(team.TacklesAttempted)); writer.Write(ToByte(team.TacklesWon)); writer.Write(ToByte(team.Fouls));
        writer.Write(ToByte(team.Corners)); writer.Write(ToByte(team.Offsides)); writer.Write(ToByte(team.YellowCards)); writer.Write(ToByte(team.RedCards));
    }

    private static TeamTickData ReadTeam(BinaryReader reader) => new(
        reader.ReadByte(), reader.ReadSingle(), reader.ReadInt32(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(),
        reader.ReadByte(), reader.ReadByte(), reader.ReadInt32(), reader.ReadInt32(), reader.ReadInt16(), reader.ReadInt16(), reader.ReadInt16(),
        reader.ReadInt16(), reader.ReadInt16(), reader.ReadInt16(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(),
        reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte());

    private static void WritePlayer(BinaryWriter writer, PlayerTickData player)
    {
        writer.Write(ToByte(player.Slot)); writer.Write(player.PlayerId); writer.Write((byte)player.Team);
        writer.Write(player.IsBallHolder); writer.Write(player.X); writer.Write(player.Y); writer.Write(player.Rating);
        writer.Write(player.IsSubstitute); writer.Write(player.IsOnPitch); writer.Write(ToByte(player.SubbedOnMinute)); writer.Write(ToByte(player.SubbedOffMinute));
        writer.Write(ToByte(player.YellowCards)); writer.Write(ToByte(player.RedCards));
        writer.Write(ToByte(player.Goals)); writer.Write(ToByte(player.Assists)); writer.Write(player.Xg); writer.Write(player.Xa);
        writer.Write(ToByte(player.Shots)); writer.Write(ToByte(player.ShotsOnTarget)); writer.Write(ToByte(player.BlockedShots)); writer.Write(ToByte(player.ClearCutChances));
        writer.Write(ToByte(player.HitWoodwork)); writer.Write(ToByte(player.Dribbles)); writer.Write(ToByte(player.Fouls)); writer.Write(ToByte(player.Fouled));
        writer.Write(ToByte(player.Crosses)); writer.Write(ToByte(player.CrossesCompleted)); writer.Write(ToByte(player.Passes)); writer.Write(ToByte(player.PassesCompleted));
        writer.Write(ToByte(player.KeyPasses)); writer.Write(ToByte(player.TacklesAttempted)); writer.Write(ToByte(player.TacklesWon)); writer.Write(ToByte(player.KeyTackles));
        writer.Write(ToByte(player.Aerials)); writer.Write(ToByte(player.AerialsWon)); writer.Write(ToByte(player.Interceptions)); writer.Write(ToByte(player.ThrowIns));
        writer.Write(ToByte(player.Corners)); writer.Write(ToByte(player.DefensiveFreeKicks)); writer.Write(ToByte(player.AttackingFreeKicks));
        writer.Write(ToByte(player.Clearances)); writer.Write(ToByte(player.ShotsFaced)); writer.Write(player.DistanceM);
    }

    private static PlayerTickData ReadPlayer(BinaryReader reader) => new(
        reader.ReadByte(), reader.ReadInt32(), (TeamSide)reader.ReadByte(), reader.ReadBoolean(),
        reader.ReadSingle(), reader.ReadSingle(), reader.ReadSingle(), reader.ReadBoolean(), reader.ReadBoolean(),
        reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadSingle(), reader.ReadSingle(),
        reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(),
        reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(),
        reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(),
        reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(), reader.ReadByte(),
        reader.ReadByte(), reader.ReadSingle());

    private static byte ToByte(int value) => (byte)Math.Clamp(value, byte.MinValue, byte.MaxValue);

    private static short ToInt16(int value) => (short)Math.Clamp(value, short.MinValue, short.MaxValue);

    private string GetPath(string matchId) => Path.Combine(_directory, $"{matchId}.fmlens");

    private string FindPath(string matchId)
    {
        var original = GetPath(matchId);
        if (File.Exists(original)) return original;
        return Directory.EnumerateFiles(_directory, $"{matchId}-*.fmlens", SearchOption.TopDirectoryOnly)
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault() ?? original;
    }

    private string TryAppendTeamNames(string path, string matchId, string? homeName, string? awayName)
    {
        if (string.IsNullOrWhiteSpace(homeName) || string.IsNullOrWhiteSpace(awayName)) return path;

        try
        {
            var fileName = $"{matchId}-{SafeFileNamePart(homeName)}-vs-{SafeFileNamePart(awayName)}.fmlens";
            var renamedPath = Path.Combine(_directory, fileName);
            if (string.Equals(path, renamedPath, StringComparison.OrdinalIgnoreCase)) return path;
            File.Move(path, renamedPath);
            return renamedPath;
        }
        catch (Exception ex)
        {
            PluginLogger.Warning($"Unable to append team names to archive {Path.GetFileName(path)}: {ex.Message}");
            return path;
        }
    }

    private static string SafeFileNamePart(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var sanitized = new string(value.Trim().Select(character =>
            invalid.Contains(character) || char.IsControl(character) ? '_' : character).ToArray());
        sanitized = string.Join(' ', sanitized.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).Trim('.', ' ');
        if (sanitized.Length > 48) sanitized = sanitized[..48].TrimEnd('.', ' ');
        return string.IsNullOrWhiteSpace(sanitized) ? "Unknown" : sanitized;
    }

    private static (string? Home, string? Away) ResolveArchiveTeamNames(
        string matchId,
        string fileName,
        RealtimeMatchMetadata? metadata)
    {
        if (!string.IsNullOrWhiteSpace(metadata?.Home.Name) &&
            !string.IsNullOrWhiteSpace(metadata.Away.Name))
        {
            return (metadata.Home.Name, metadata.Away.Name);
        }

        var prefix = $"{matchId}-";
        const string suffix = ".fmlens";
        if (!fileName.StartsWith(prefix, StringComparison.Ordinal) ||
            !fileName.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
        {
            return (null, null);
        }

        var matchup = fileName[prefix.Length..^suffix.Length];
        var separator = matchup.IndexOf("-vs-", StringComparison.Ordinal);
        return separator <= 0 || separator >= matchup.Length - 4
            ? (null, null)
            : (matchup[..separator], matchup[(separator + 4)..]);
    }

    private static bool IsSafeMatchId(string matchId) =>
        matchId.Length is > 0 and <= 80 && matchId.All(character => char.IsLetterOrDigit(character) || character is '-' or '_');

    private void CloseWriterLocked()
    {
        _writer?.Dispose();
        _stream?.Dispose();
        _writer = null;
        _stream = null;
        _currentMatchId = null;
        _currentHomeName = null;
        _currentAwayName = null;
    }

    private sealed record ArchiveScanResult(
        MatchArchiveSummary Summary,
        RealtimeMatchMetadata? Metadata,
        IReadOnlyList<RealtimeTickFrame> Frames);
}

internal sealed record MatchArchiveSummary(
    string MatchId,
    string FileName,
    long StartedUnixMilliseconds,
    long? EndedUnixMilliseconds,
    bool Ended,
    int FrameCount,
    int FirstTick,
    int LastTick,
    string? HomeName,
    string? AwayName,
    int HomeGoals,
    int AwayGoals,
    long FileSizeBytes);

internal sealed record ArchivedFrameSlice(
    MatchArchiveSummary Archive,
    RealtimeMatchMetadata? Metadata,
    IReadOnlyList<RealtimeTickFrame> Frames);
