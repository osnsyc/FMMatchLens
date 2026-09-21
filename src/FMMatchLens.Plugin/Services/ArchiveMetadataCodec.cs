using FMMatchLens.Plugin.Domain;
using System.Globalization;
using System.Text;

namespace FMMatchLens.Plugin.Services;

internal sealed record ArchiveMetadataDeltaEncoding(
    byte[] Payload,
    RealtimeMatchMetadata Metadata,
    int ChangedPlayerCount,
    int NewPlayerCount);

internal static class ArchiveMetadataCodec
{
    private const byte FullPlayerFlag = 1 << 0;
    private const byte InPossessionFlag = 1 << 1;
    private const byte OutOfPossessionFlag = 1 << 2;
    private const byte AllPlayerDeltaFlags = FullPlayerFlag | InPossessionFlag | OutOfPossessionFlag;
    private const byte HomeTeamFlag = 1 << 0;
    private const byte AwayTeamFlag = 1 << 1;
    private const byte AllTeamDeltaFlags = HomeTeamFlag | AwayTeamFlag;
    private const byte MatchDateExtensionFlag = 1 << 0;
    private const byte TeamManagersExtensionFlag = 1 << 1;
    private const byte PitchDimensionsExtensionFlag = 1 << 2;
    private const byte CompetitionExtensionFlag = 1 << 3;
    private const byte AllMetadataExtensionFlags = MatchDateExtensionFlag | TeamManagersExtensionFlag | PitchDimensionsExtensionFlag | CompetitionExtensionFlag;
    private const byte PitchDimensionsDeltaFlag = 1 << 0;
    private const byte CompetitionDeltaFlag = 1 << 1;
    private const byte AllMetadataDeltaExtensionFlags = PitchDimensionsDeltaFlag | CompetitionDeltaFlag;

    private readonly record struct PlayerDelta(
        RealtimePlayerMetadata Player,
        bool IsFull,
        bool InPossessionChanged,
        bool OutOfPossessionChanged);

    public static bool HasCompleteStaticPlayerSnapshot(RealtimeMatchMetadata metadata) =>
        metadata.Players.Count > 0 && metadata.Players.All(player =>
            player.Uid.HasValue &&
            player.ShirtNumber.HasValue &&
            player.Profile is
            {
                DateOfBirth: not null,
                NationUid: not null,
                BodyType: not null,
                GuideValueGbp: not null,
                InternationalApps: not null,
                InternationalGoals: not null,
                YouthApps: not null,
                YouthGoals: not null
            } &&
            player.Attributes is not null &&
            !string.Equals(player.DisplayName, $"Player {player.PlayerId}", StringComparison.Ordinal));

    public static byte[] Encode(
        RealtimeMatchMetadata metadata,
        uint revision,
        ushort structureMinor = ArchiveWireFormat.StructureMinor)
    {
        var strings = BuildStringTable(metadata);
        var ids = strings.Select((value, index) => (value, id: index + 1))
            .ToDictionary(item => item.value, item => item.id, StringComparer.Ordinal);
        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream, Encoding.UTF8, leaveOpen: true);
        ArchiveBinary.WriteVarUInt64(writer, revision);
        ArchiveBinary.WriteVarInt64(writer, metadata.CapturedTick);
        ArchiveBinary.WriteVarUInt64(writer, (ulong)strings.Count);
        foreach (var value in strings) ArchiveBinary.WriteString(writer, value);
        WriteTeam(writer, metadata.Home, ids);
        WriteTeam(writer, metadata.Away, ids);
        ArchiveBinary.WriteVarUInt64(writer, (ulong)metadata.Players.Count);
        foreach (var player in metadata.Players.OrderBy(item => item.Slot)) WritePlayer(writer, player, ids, structureMinor);
        var extensionFlags = (byte)(
            (!string.IsNullOrWhiteSpace(metadata.MatchDate) ? MatchDateExtensionFlag : 0) |
            (metadata.Home.Manager.HasValue || metadata.Away.Manager.HasValue ? TeamManagersExtensionFlag : 0) |
            (structureMinor >= 5 && HasPitchDimensions(metadata) ? PitchDimensionsExtensionFlag : 0) |
            (structureMinor >= 6 && metadata.Competition.HasValue ? CompetitionExtensionFlag : 0));
        if (extensionFlags != 0)
        {
            writer.Write(extensionFlags);
            if ((extensionFlags & MatchDateExtensionFlag) != 0) ArchiveBinary.WriteString(writer, metadata.MatchDate!);
            if ((extensionFlags & TeamManagersExtensionFlag) != 0)
            {
                WriteManager(writer, metadata.Home.Manager, ids);
                WriteManager(writer, metadata.Away.Manager, ids);
            }
            if ((extensionFlags & PitchDimensionsExtensionFlag) != 0)
            {
                writer.Write(metadata.HalfPitchWidth!.Value);
                writer.Write(metadata.HalfPitchLength!.Value);
            }
            if ((extensionFlags & CompetitionExtensionFlag) != 0)
                WriteCompetition(writer, metadata.Competition!.Value, ids);
        }
        return stream.ToArray();
    }

    public static (uint Revision, RealtimeMatchMetadata Metadata) Decode(
        ReadOnlyMemory<byte> payload,
        string matchId,
        long startedUnixMilliseconds,
        ushort structureMinor = ArchiveWireFormat.StructureMinor)
    {
        using var stream = new MemoryStream(payload.ToArray(), writable: false);
        using var reader = new BinaryReader(stream, Encoding.UTF8);
        var (revision, capturedTick, strings) = ReadPreamble(reader);
        var home = ReadTeam(reader, strings);
        var away = ReadTeam(reader, strings);
        var playerCount = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
        if (playerCount > byte.MaxValue) throw new ArchiveFormatException("invalid_count", "Metadata has too many players.");
        var players = new RealtimePlayerMetadata[playerCount];
        var slots = new HashSet<int>();
        var playerUids = new HashSet<uint>();
        for (var index = 0; index < playerCount; index++)
        {
            players[index] = ReadPlayer(reader, strings, structureMinor);
            if (!slots.Add(players[index].Slot)) throw new ArchiveFormatException("duplicate_slot", "Metadata contains a duplicate player slot.");
            if (players[index].Uid is { } uid && !playerUids.Add(uid))
                throw new ArchiveFormatException("duplicate_player_uid", "Metadata contains a duplicate player UID.");
        }
        string? matchDate = null;
        float? halfPitchWidth = null;
        float? halfPitchLength = null;
        RealtimeCompetitionMetadata? competition = null;
        if (stream.Position < stream.Length)
        {
            var extensionFlags = reader.ReadByte();
            var allowedExtensionFlags = structureMinor >= 6
                ? AllMetadataExtensionFlags
                : structureMinor >= 5
                    ? MatchDateExtensionFlag | TeamManagersExtensionFlag | PitchDimensionsExtensionFlag
                : MatchDateExtensionFlag | TeamManagersExtensionFlag;
            if (extensionFlags == 0 || (extensionFlags & ~allowedExtensionFlags) != 0)
                throw new ArchiveFormatException("unknown_metadata_extension", "Metadata contains unknown extension fields.");
            if ((extensionFlags & MatchDateExtensionFlag) != 0)
                matchDate = ArchiveBinary.ReadString(reader);
            if ((extensionFlags & TeamManagersExtensionFlag) != 0)
            {
                home = home with { Manager = ReadManager(reader, strings) };
                away = away with { Manager = ReadManager(reader, strings) };
            }
            if ((extensionFlags & PitchDimensionsExtensionFlag) != 0)
            {
                halfPitchWidth = ReadPitchHalf(reader);
                halfPitchLength = ReadPitchHalf(reader);
            }
            if ((extensionFlags & CompetitionExtensionFlag) != 0)
                competition = ReadCompetition(reader, strings);
        }
        if (stream.Position != stream.Length) throw new ArchiveFormatException("trailing_data", "Metadata record contains trailing bytes.");
        return (revision, new RealtimeMatchMetadata(
            matchId, startedUnixMilliseconds, capturedTick, home, away, players,
            matchDate, halfPitchWidth, halfPitchLength, competition));
    }

    public static bool TryEncodeDelta(
        RealtimeMatchMetadata previous,
        RealtimeMatchMetadata incoming,
        uint revision,
        out ArchiveMetadataDeltaEncoding encoding)
    {
        var effectivePlayers = previous.Players.ToDictionary(player => player.Slot);
        var deltas = new List<PlayerDelta>();
        var newPlayerCount = 0;
        foreach (var player in incoming.Players.OrderBy(player => player.Slot))
        {
            if (!effectivePlayers.TryGetValue(player.Slot, out var existing))
            {
                effectivePlayers[player.Slot] = player;
                deltas.Add(new PlayerDelta(player, IsFull: true, InPossessionChanged: false, OutOfPossessionChanged: false));
                newPlayerCount++;
                continue;
            }

            var inPossessionChanged = existing.InPossession != player.InPossession;
            var outOfPossessionChanged = existing.OutOfPossession != player.OutOfPossession;
            if (inPossessionChanged || outOfPossessionChanged)
            {
                var tacticalPlayer = existing with
                {
                    InPossession = player.InPossession,
                    OutOfPossession = player.OutOfPossession
                };
                effectivePlayers[player.Slot] = tacticalPlayer;
                deltas.Add(new PlayerDelta(tacticalPlayer, IsFull: false, inPossessionChanged, outOfPossessionChanged));
            }
        }

        // Managers are a static, one-time archive snapshot. Do not turn later
        // memory refreshes into repeated metadata deltas.
        var homeChanged = (previous.Home with { Manager = null }) != (incoming.Home with { Manager = null });
        var awayChanged = (previous.Away with { Manager = null }) != (incoming.Away with { Manager = null });
        var effectiveHalfPitchWidth = incoming.HalfPitchWidth ?? previous.HalfPitchWidth;
        var effectiveHalfPitchLength = incoming.HalfPitchLength ?? previous.HalfPitchLength;
        var pitchDimensionsChanged =
            previous.HalfPitchWidth != effectiveHalfPitchWidth ||
            previous.HalfPitchLength != effectiveHalfPitchLength;
        var effectiveCompetition = incoming.Competition ?? previous.Competition;
        var competitionChanged = previous.Competition != effectiveCompetition;
        if (!homeChanged && !awayChanged && deltas.Count == 0 && !pitchDimensionsChanged && !competitionChanged)
        {
            encoding = default!;
            return false;
        }

        var players = effectivePlayers.Values.OrderBy(player => player.Slot).ToArray();
        if (players.Length > byte.MaxValue || players.Select(player => player.Slot).Distinct().Count() != players.Length)
            throw new InvalidDataException("Metadata delta produces an invalid player roster.");

        var effective = new RealtimeMatchMetadata(
            incoming.MatchId,
            incoming.StartedUnixMilliseconds,
            incoming.CapturedTick,
            homeChanged ? incoming.Home with { Manager = previous.Home.Manager } : previous.Home,
            awayChanged ? incoming.Away with { Manager = previous.Away.Manager } : previous.Away,
            players,
            incoming.MatchDate ?? previous.MatchDate,
            effectiveHalfPitchWidth,
            effectiveHalfPitchLength,
            effectiveCompetition);
        var strings = BuildDeltaStringTable(effective, deltas, homeChanged, awayChanged, competitionChanged);
        var ids = BuildStringIds(strings);
        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream, Encoding.UTF8, leaveOpen: true);
        WritePreamble(writer, revision, incoming.CapturedTick, strings);
        var teamFlags = (byte)((homeChanged ? HomeTeamFlag : 0) | (awayChanged ? AwayTeamFlag : 0));
        writer.Write(teamFlags);
        if (homeChanged) WriteTeam(writer, effective.Home, ids);
        if (awayChanged) WriteTeam(writer, effective.Away, ids);
        ArchiveBinary.WriteVarUInt64(writer, (ulong)deltas.Count);
        foreach (var delta in deltas)
        {
            if (delta.IsFull)
            {
                writer.Write(FullPlayerFlag);
                WritePlayer(writer, delta.Player, ids, ArchiveWireFormat.StructureMinor);
                continue;
            }

            var flags = (byte)((delta.InPossessionChanged ? InPossessionFlag : 0) |
                               (delta.OutOfPossessionChanged ? OutOfPossessionFlag : 0));
            writer.Write(flags);
            ArchiveBinary.WriteVarInt64(writer, delta.Player.PlayerId);
            if (delta.InPossessionChanged) WriteAssignment(writer, delta.Player.InPossession, ids);
            if (delta.OutOfPossessionChanged) WriteAssignment(writer, delta.Player.OutOfPossession, ids);
        }
        var deltaExtensionFlags = (byte)(
            (pitchDimensionsChanged && HasPitchDimensions(effective) ? PitchDimensionsDeltaFlag : 0) |
            (competitionChanged && effective.Competition.HasValue ? CompetitionDeltaFlag : 0));
        writer.Write(deltaExtensionFlags);
        if ((deltaExtensionFlags & PitchDimensionsDeltaFlag) != 0)
        {
            writer.Write(effective.HalfPitchWidth!.Value);
            writer.Write(effective.HalfPitchLength!.Value);
        }
        if ((deltaExtensionFlags & CompetitionDeltaFlag) != 0)
            WriteCompetition(writer, effective.Competition!.Value, ids);

        encoding = new ArchiveMetadataDeltaEncoding(stream.ToArray(), effective, deltas.Count, newPlayerCount);
        return true;
    }

    public static (uint Revision, RealtimeMatchMetadata Metadata) DecodeDelta(
        ReadOnlyMemory<byte> payload,
        RealtimeMatchMetadata previous,
        string matchId,
        long startedUnixMilliseconds,
        ushort structureMinor = ArchiveWireFormat.StructureMinor)
    {
        using var stream = new MemoryStream(payload.ToArray(), writable: false);
        using var reader = new BinaryReader(stream, Encoding.UTF8);
        var (revision, capturedTick, strings) = ReadPreamble(reader);
        var teamFlags = reader.ReadByte();
        if ((teamFlags & ~AllTeamDeltaFlags) != 0)
            throw new ArchiveFormatException("unknown_metadata_delta_field", "Metadata delta contains unknown team fields.");
        var home = (teamFlags & HomeTeamFlag) != 0
            ? ReadTeam(reader, strings) with { Manager = previous.Home.Manager }
            : previous.Home;
        var away = (teamFlags & AwayTeamFlag) != 0
            ? ReadTeam(reader, strings) with { Manager = previous.Away.Manager }
            : previous.Away;
        var players = previous.Players.ToDictionary(player => player.Slot);
        var deltaCount = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
        if (deltaCount > byte.MaxValue) throw new ArchiveFormatException("invalid_count", "Metadata delta has too many players.");
        for (var index = 0; index < deltaCount; index++)
        {
            var flags = reader.ReadByte();
            if (flags == 0 || (flags & ~AllPlayerDeltaFlags) != 0 ||
                ((flags & FullPlayerFlag) != 0 && flags != FullPlayerFlag))
                throw new ArchiveFormatException("unknown_metadata_delta_field", "Metadata delta contains invalid player fields.");
            if ((flags & FullPlayerFlag) != 0)
            {
                var player = ReadPlayer(reader, strings, structureMinor);
                if (!players.TryAdd(player.Slot, player))
                    throw new ArchiveFormatException("duplicate_slot", "Metadata delta adds an existing player slot.");
                continue;
            }

            var playerId = ArchiveBinary.ReadVarInt64(reader);
            var matches = players.Where(entry => entry.Value.PlayerId == playerId).Take(2).ToArray();
            if (matches.Length == 0)
                throw new ArchiveFormatException("unknown_player", "Metadata delta references an unknown player id.");
            if (matches.Length > 1)
                throw new ArchiveFormatException("ambiguous_player", "Metadata delta references a non-unique legacy player id.");
            var (slot, existing) = matches[0];
            players[slot] = existing with
            {
                InPossession = (flags & InPossessionFlag) != 0 ? ReadAssignment(reader, strings) : existing.InPossession,
                OutOfPossession = (flags & OutOfPossessionFlag) != 0 ? ReadAssignment(reader, strings) : existing.OutOfPossession
            };
        }

        var orderedPlayers = players.Values.OrderBy(player => player.Slot).ToArray();
        if (orderedPlayers.Length > byte.MaxValue || orderedPlayers.Select(player => player.Slot).Distinct().Count() != orderedPlayers.Length)
            throw new ArchiveFormatException("duplicate_slot", "Metadata delta produces a duplicate player slot.");
        var halfPitchWidth = previous.HalfPitchWidth;
        var halfPitchLength = previous.HalfPitchLength;
        var competition = previous.Competition;
        if (structureMinor >= 5)
        {
            var extensionFlags = reader.ReadByte();
            var allowedExtensionFlags = structureMinor >= 6
                ? AllMetadataDeltaExtensionFlags
                : PitchDimensionsDeltaFlag;
            if ((extensionFlags & ~allowedExtensionFlags) != 0)
                throw new ArchiveFormatException("unknown_metadata_delta_field", "Metadata delta contains unknown extension fields.");
            if ((extensionFlags & PitchDimensionsDeltaFlag) != 0)
            {
                halfPitchWidth = ReadPitchHalf(reader);
                halfPitchLength = ReadPitchHalf(reader);
            }
            if ((extensionFlags & CompetitionDeltaFlag) != 0)
                competition = ReadCompetition(reader, strings);
        }
        if (stream.Position != stream.Length) throw new ArchiveFormatException("trailing_data", "Metadata delta contains trailing bytes.");
        return (revision, new RealtimeMatchMetadata(
            matchId,
            startedUnixMilliseconds,
            capturedTick,
            home,
            away,
            orderedPlayers,
            previous.MatchDate,
            halfPitchWidth,
            halfPitchLength,
            competition));
    }

    private static List<string> BuildStringTable(RealtimeMatchMetadata metadata)
    {
        var values = new SortedSet<string>(StringComparer.Ordinal);
        AddTeam(metadata.Home, values);
        AddTeam(metadata.Away, values);
        if (metadata.Competition is { } competition) Add(values, competition.Name, competition.LogoPath);
        foreach (var player in metadata.Players)
        {
            AddPlayer(player, values);
        }
        return values.ToList();
    }

    private static List<string> BuildDeltaStringTable(
        RealtimeMatchMetadata metadata,
        IReadOnlyList<PlayerDelta> deltas,
        bool homeChanged,
        bool awayChanged,
        bool competitionChanged)
    {
        var values = new SortedSet<string>(StringComparer.Ordinal);
        // Delta team records intentionally exclude the one-time manager snapshot,
        // including its names in the delta string table.
        if (homeChanged) Add(values, metadata.Home.Name, metadata.Home.LogoPath);
        if (awayChanged) Add(values, metadata.Away.Name, metadata.Away.LogoPath);
        if (competitionChanged && metadata.Competition is { } competition) Add(values, competition.Name, competition.LogoPath);
        foreach (var delta in deltas)
        {
            if (delta.IsFull)
            {
                AddPlayer(delta.Player, values);
            }
            else
            {
                if (delta.InPossessionChanged) AddAssignment(delta.Player.InPossession, values);
                if (delta.OutOfPossessionChanged) AddAssignment(delta.Player.OutOfPossession, values);
            }
        }
        return values.ToList();
    }

    private static void AddPlayer(RealtimePlayerMetadata player, ISet<string> values)
    {
        Add(values, player.Position, player.FirstName, player.SecondName, player.CommonName, player.DisplayName, player.PortraitPath);
        AddAssignment(player.InPossession, values);
        AddAssignment(player.OutOfPossession, values);
        AddAttributes(player.Attributes?.Technical, values);
        AddAttributes(player.Attributes?.Mental, values);
        AddAttributes(player.Attributes?.Physical, values);
        AddAttributes(player.Attributes?.Goalkeeping, values);
    }

    private static Dictionary<string, int> BuildStringIds(IReadOnlyList<string> strings) =>
        strings.Select((value, index) => (value, id: index + 1))
            .ToDictionary(item => item.value, item => item.id, StringComparer.Ordinal);

    private static void WritePreamble(BinaryWriter writer, uint revision, int capturedTick, IReadOnlyList<string> strings)
    {
        ArchiveBinary.WriteVarUInt64(writer, revision);
        ArchiveBinary.WriteVarInt64(writer, capturedTick);
        ArchiveBinary.WriteVarUInt64(writer, (ulong)strings.Count);
        foreach (var value in strings) ArchiveBinary.WriteString(writer, value);
    }

    private static (uint Revision, int CapturedTick, string[] Strings) ReadPreamble(BinaryReader reader)
    {
        var revision = checked((uint)ArchiveBinary.ReadVarUInt64(reader, 5));
        var capturedTick = checked((int)ArchiveBinary.ReadVarInt64(reader));
        var stringCount = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
        if (stringCount > 16_384) throw new ArchiveFormatException("invalid_count", "Metadata string table is too large.");
        var strings = new string[stringCount + 1];
        for (var index = 1; index < strings.Length; index++) strings[index] = ArchiveBinary.ReadString(reader);
        return (revision, capturedTick, strings);
    }

    private static void AddTeam(RealtimeTeamMetadata team, ISet<string> values)
    {
        Add(values, team.Name, team.LogoPath);
        if (team.Manager is { } manager) Add(values, manager.FirstName, manager.SecondName);
    }

    private static void AddAssignment(PlayerTacticalAssignment? assignment, ISet<string> values)
    {
        if (!assignment.HasValue) return;
        Add(values, assignment.Value.Position, assignment.Value.Role, assignment.Value.RoleAbbreviation, assignment.Value.Duty);
    }

    private static void AddAttributes(IReadOnlyDictionary<string, int>? attributes, ISet<string> values)
    {
        if (attributes is null) return;
        foreach (var name in attributes.Keys) Add(values, name);
    }

    private static void Add(ISet<string> values, params string?[] candidates)
    {
        foreach (var value in candidates)
        {
            if (!string.IsNullOrEmpty(value)) values.Add(value);
        }
    }

    private static void WriteTeam(BinaryWriter writer, RealtimeTeamMetadata team, IReadOnlyDictionary<string, int> ids)
    {
        WriteNullableUInt(writer, team.Uid);
        WriteNullableUInt(writer, team.ClubUid);
        WriteStringId(writer, team.Name, ids);
        WriteNullableUInt(writer, team.BackgroundColour);
        WriteNullableUInt(writer, team.ForegroundColour);
        WriteNullableUInt(writer, team.OutlineColour);
        WriteStringId(writer, team.LogoPath, ids);
    }

    private static RealtimeTeamMetadata ReadTeam(BinaryReader reader, IReadOnlyList<string> strings) => new(
        ReadNullableUInt(reader),
        ReadNullableUInt(reader),
        ReadStringId(reader, strings) ?? string.Empty,
        ReadNullableUInt(reader),
        ReadNullableUInt(reader),
        ReadNullableUInt(reader),
        ReadStringId(reader, strings));

    private static void WriteCompetition(
        BinaryWriter writer,
        RealtimeCompetitionMetadata competition,
        IReadOnlyDictionary<string, int> ids)
    {
        WriteNullableUInt(writer, competition.Uid);
        WriteStringId(writer, competition.Name, ids);
        WriteStringId(writer, competition.LogoPath, ids);
        WriteNullableUInt(writer, competition.PrimaryColour);
        WriteNullableUInt(writer, competition.SecondaryColour);
        WriteNullableUInt(writer, competition.TertiaryColour);
    }

    private static RealtimeCompetitionMetadata ReadCompetition(
        BinaryReader reader,
        IReadOnlyList<string> strings) => new(
        ReadNullableUInt(reader),
        ReadStringId(reader, strings),
        ReadStringId(reader, strings),
        ReadNullableUInt(reader),
        ReadNullableUInt(reader),
        ReadNullableUInt(reader));

    private static void WriteManager(
        BinaryWriter writer,
        RealtimeManagerMetadata? manager,
        IReadOnlyDictionary<string, int> ids)
    {
        writer.Write(manager.HasValue);
        if (!manager.HasValue) return;
        WriteNullableUInt(writer, manager.Value.Uid);
        WriteStringId(writer, manager.Value.FirstName, ids);
        WriteStringId(writer, manager.Value.SecondName, ids);
        writer.Write(manager.Value.IsHumanControlled);
    }

    private static RealtimeManagerMetadata? ReadManager(BinaryReader reader, IReadOnlyList<string> strings)
    {
        if (!reader.ReadBoolean()) return null;
        return new RealtimeManagerMetadata(
            ReadNullableUInt(reader),
            ReadStringId(reader, strings),
            ReadStringId(reader, strings),
            reader.ReadBoolean());
    }

    private static void WritePlayer(
        BinaryWriter writer,
        RealtimePlayerMetadata player,
        IReadOnlyDictionary<string, int> ids,
        ushort structureMinor)
    {
        ArchiveBinary.WriteVarUInt64(writer, checked((ulong)player.Slot));
        ArchiveBinary.WriteVarInt64(writer, player.PlayerId);
        WriteNullableUInt(writer, player.Uid);
        writer.Write((byte)player.Team);
        WriteNullableInt(writer, player.ShirtNumber);
        WriteStringId(writer, player.Position, ids);
        WritePositionFamiliarities(writer, player.PositionFamiliarities);
        WriteAssignment(writer, player.InPossession, ids);
        WriteAssignment(writer, player.OutOfPossession, ids);
        WriteStringId(writer, player.FirstName, ids);
        WriteStringId(writer, player.SecondName, ids);
        WriteStringId(writer, player.CommonName, ids);
        WriteStringId(writer, player.DisplayName, ids);
        WriteStringId(writer, player.PortraitPath, ids);
        WriteProfile(writer, player.Profile, structureMinor);
        WriteAttributes(writer, player.Attributes, ids, structureMinor);
    }

    private static RealtimePlayerMetadata ReadPlayer(
        BinaryReader reader,
        IReadOnlyList<string> strings,
        ushort structureMinor)
    {
        var slot = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
        var playerId = ArchiveBinary.ReadVarInt64(reader);
        var uid = ReadNullableUInt(reader);
        var team = ReadTeamSide(reader);
        var shirt = ReadNullableInt(reader);
        var position = ReadStringId(reader, strings);
        var positionFamiliarities = ReadPositionFamiliarities(reader);
        var inPossession = ReadAssignment(reader, strings);
        var outOfPossession = ReadAssignment(reader, strings);
        var first = ReadStringId(reader, strings);
        var second = ReadStringId(reader, strings);
        var common = ReadStringId(reader, strings);
        var display = ReadStringId(reader, strings) ?? $"Player {playerId}";
        var portrait = ReadStringId(reader, strings);
        var profile = ReadProfile(reader, structureMinor);
        var attributes = ReadAttributes(reader, strings, structureMinor);
        return new RealtimePlayerMetadata(slot, playerId, uid, team, shirt, position, first, second, common, display, portrait, profile, attributes, inPossession, outOfPossession, positionFamiliarities);
    }

    private static void WritePositionFamiliarities(
        BinaryWriter writer,
        IReadOnlyDictionary<string, int>? familiarities)
    {
        writer.Write(familiarities is not null);
        if (familiarities is null) return;
        foreach (var label in PlayerPositionFamiliarity.Labels)
        {
            writer.Write(checked((byte)familiarities.GetValueOrDefault(label)));
        }
    }

    private static IReadOnlyDictionary<string, int>? ReadPositionFamiliarities(BinaryReader reader)
    {
        if (!reader.ReadBoolean()) return null;
        var familiarities = new Dictionary<string, int>(PlayerPositionFamiliarity.Labels.Length, StringComparer.Ordinal);
        foreach (var label in PlayerPositionFamiliarity.Labels)
        {
            familiarities[label] = reader.ReadByte();
        }
        return familiarities;
    }

    private static void WriteAssignment(BinaryWriter writer, PlayerTacticalAssignment? assignment, IReadOnlyDictionary<string, int> ids)
    {
        writer.Write(assignment.HasValue);
        if (!assignment.HasValue) return;
        var value = assignment.Value;
        ArchiveBinary.WriteVarUInt64(writer, value.PositionMask);
        WriteStringId(writer, value.Position, ids);
        ArchiveBinary.WriteVarUInt64(writer, value.RoleDuty);
        WriteStringId(writer, value.Role, ids);
        WriteStringId(writer, value.RoleAbbreviation, ids);
        WriteStringId(writer, value.Duty, ids);
    }

    private static PlayerTacticalAssignment? ReadAssignment(BinaryReader reader, IReadOnlyList<string> strings)
    {
        if (!reader.ReadBoolean()) return null;
        return new PlayerTacticalAssignment(
            checked((uint)ArchiveBinary.ReadVarUInt64(reader, 5)),
            ReadStringId(reader, strings) ?? string.Empty,
            ArchiveBinary.ReadVarUInt64(reader),
            ReadStringId(reader, strings) ?? string.Empty,
            ReadStringId(reader, strings) ?? string.Empty,
            ReadStringId(reader, strings));
    }

    private static void WriteProfile(BinaryWriter writer, PlayerProfile? profile, ushort structureMinor)
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
        if (structureMinor >= 4)
        {
            ArchiveBinary.WriteString(writer, profile.DateOfBirth);
            WriteNullableUInt(writer, profile.NationUid);
            WriteNullableInt(writer, profile.BodyType);
            WriteNullableUInt(writer, profile.GuideValueGbp);
            WriteNullableInt(writer, profile.InternationalApps);
            WriteNullableInt(writer, profile.InternationalGoals);
            WriteNullableInt(writer, profile.YouthApps);
            WriteNullableInt(writer, profile.YouthGoals);
        }
    }

    private static PlayerProfile? ReadProfile(BinaryReader reader, ushort structureMinor)
    {
        if (!reader.ReadBoolean()) return null;
        var profile = new PlayerProfile(
            ReadNullableInt(reader), ReadNullableInt(reader), ReadNullableInt(reader), ReadNullableInt(reader),
            ReadNullableInt(reader), ReadNullableInt(reader), ReadNullableInt(reader));
        return structureMinor >= 4
            ? profile with
            {
                DateOfBirth = NullIfEmpty(ArchiveBinary.ReadString(reader)),
                NationUid = ReadNullableUInt(reader),
                BodyType = ReadNullableInt(reader),
                GuideValueGbp = ReadNullableUInt(reader),
                InternationalApps = ReadNullableInt(reader),
                InternationalGoals = ReadNullableInt(reader),
                YouthApps = ReadNullableInt(reader),
                YouthGoals = ReadNullableInt(reader)
            }
            : profile;
    }

    private static string? NullIfEmpty(string value) => string.IsNullOrEmpty(value) ? null : value;

    private static void WriteAttributes(
        BinaryWriter writer,
        PlayerAttributes? attributes,
        IReadOnlyDictionary<string, int> ids,
        ushort structureMinor)
    {
        writer.Write(attributes is not null);
        if (attributes is null) return;
        WriteAttributeGroup(writer, attributes.Technical, ids);
        WriteAttributeGroup(writer, attributes.Mental, ids);
        WriteAttributeGroup(writer, attributes.Physical, ids);
        WriteAttributeGroup(writer, attributes.Goalkeeping, ids);
        if (structureMinor >= 6) writer.Write(ParseTraits(attributes.Traits));
    }

    private static PlayerAttributes? ReadAttributes(
        BinaryReader reader,
        IReadOnlyList<string> strings,
        ushort structureMinor)
    {
        if (!reader.ReadBoolean()) return null;
        var technical = ReadAttributeGroup(reader, strings);
        var mental = ReadAttributeGroup(reader, strings);
        var physical = ReadAttributeGroup(reader, strings);
        var goalkeeping = ReadAttributeGroup(reader, strings);
        var traits = structureMinor >= 6
            ? reader.ReadUInt64().ToString("X16", CultureInfo.InvariantCulture)
            : null;
        return new PlayerAttributes(
            technical,
            mental,
            physical,
            goalkeeping,
            traits);
    }

    private static ulong ParseTraits(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return 0;
        if (value.Length != 16 || !ulong.TryParse(value, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var traits))
            throw new InvalidDataException("Player traits must be a 16-digit hexadecimal UInt64 value.");
        return traits;
    }

    private static void WriteAttributeGroup(BinaryWriter writer, IReadOnlyDictionary<string, int> attributes, IReadOnlyDictionary<string, int> ids)
    {
        ArchiveBinary.WriteVarUInt64(writer, (ulong)attributes.Count);
        foreach (var item in attributes.OrderBy(item => item.Key, StringComparer.Ordinal))
        {
            WriteStringId(writer, item.Key, ids);
            ArchiveBinary.WriteVarInt64(writer, item.Value);
        }
    }

    private static IReadOnlyDictionary<string, int> ReadAttributeGroup(BinaryReader reader, IReadOnlyList<string> strings)
    {
        var count = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
        if (count > 1_024) throw new ArchiveFormatException("invalid_count", "Attribute group is too large.");
        var result = new Dictionary<string, int>(count, StringComparer.Ordinal);
        for (var index = 0; index < count; index++)
        {
            var name = ReadStringId(reader, strings) ?? throw new ArchiveFormatException("invalid_string_id", "Attribute name is missing.");
            result[name] = checked((int)ArchiveBinary.ReadVarInt64(reader));
        }
        return result;
    }

    private static void WriteStringId(BinaryWriter writer, string? value, IReadOnlyDictionary<string, int> ids) =>
        ArchiveBinary.WriteVarUInt64(writer, string.IsNullOrEmpty(value) ? 0UL : checked((ulong)ids[value]));

    private static string? ReadStringId(BinaryReader reader, IReadOnlyList<string> strings)
    {
        var id = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
        if (id == 0) return null;
        if (id >= strings.Count) throw new ArchiveFormatException("invalid_string_id", "Metadata references an unknown string.");
        return strings[id];
    }

    private static void WriteNullableUInt(BinaryWriter writer, uint? value)
    {
        writer.Write(value.HasValue);
        if (value.HasValue) ArchiveBinary.WriteVarUInt64(writer, value.Value);
    }

    private static uint? ReadNullableUInt(BinaryReader reader) => reader.ReadBoolean()
        ? checked((uint)ArchiveBinary.ReadVarUInt64(reader, 5))
        : null;

    private static void WriteNullableInt(BinaryWriter writer, int? value)
    {
        writer.Write(value.HasValue);
        if (value.HasValue) ArchiveBinary.WriteVarInt64(writer, value.Value);
    }

    private static int? ReadNullableInt(BinaryReader reader) => reader.ReadBoolean()
        ? checked((int)ArchiveBinary.ReadVarInt64(reader))
        : null;

    private static bool HasPitchDimensions(RealtimeMatchMetadata metadata) =>
        metadata.HalfPitchWidth is > 0 &&
        metadata.HalfPitchLength is > 0 &&
        float.IsFinite(metadata.HalfPitchWidth.Value) &&
        float.IsFinite(metadata.HalfPitchLength.Value);

    private static float ReadPitchHalf(BinaryReader reader)
    {
        var value = reader.ReadSingle();
        return value > 0 && float.IsFinite(value)
            ? value
            : throw new ArchiveFormatException("invalid_pitch", "Metadata contains invalid pitch dimensions.");
    }

    private static TeamSide ReadTeamSide(BinaryReader reader)
    {
        var value = reader.ReadByte();
        return value <= 1 ? (TeamSide)value : throw new ArchiveFormatException("invalid_team", "Metadata contains an invalid team value.");
    }
}
