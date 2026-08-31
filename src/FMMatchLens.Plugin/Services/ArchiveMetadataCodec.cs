using FMMatchLens.Plugin.Domain;
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

    private readonly record struct PlayerDelta(
        RealtimePlayerMetadata Player,
        bool IsFull,
        bool InPossessionChanged,
        bool OutOfPossessionChanged);

    public static bool HasCompleteStaticPlayerSnapshot(RealtimeMatchMetadata metadata) =>
        metadata.Players.Count > 0 && metadata.Players.All(player =>
            player.Uid.HasValue &&
            player.ShirtNumber.HasValue &&
            player.Profile is not null &&
            player.Attributes is not null &&
            !string.Equals(player.DisplayName, $"Player {player.PlayerId}", StringComparison.Ordinal));

    public static byte[] Encode(RealtimeMatchMetadata metadata, uint revision)
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
        foreach (var player in metadata.Players.OrderBy(item => item.Slot)) WritePlayer(writer, player, ids);
        return stream.ToArray();
    }

    public static (uint Revision, RealtimeMatchMetadata Metadata) Decode(
        ReadOnlyMemory<byte> payload,
        string matchId,
        long startedUnixMilliseconds)
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
        var playerIds = new HashSet<int>();
        for (var index = 0; index < playerCount; index++)
        {
            players[index] = ReadPlayer(reader, strings);
            if (!slots.Add(players[index].Slot)) throw new ArchiveFormatException("duplicate_slot", "Metadata contains a duplicate player slot.");
            if (!playerIds.Add(players[index].PlayerId)) throw new ArchiveFormatException("duplicate_player", "Metadata contains a duplicate player id.");
        }
        if (stream.Position != stream.Length) throw new ArchiveFormatException("trailing_data", "Metadata record contains trailing bytes.");
        return (revision, new RealtimeMatchMetadata(matchId, startedUnixMilliseconds, capturedTick, home, away, players));
    }

    public static bool TryEncodeDelta(
        RealtimeMatchMetadata previous,
        RealtimeMatchMetadata incoming,
        uint revision,
        out ArchiveMetadataDeltaEncoding encoding)
    {
        var effectivePlayers = previous.Players.ToDictionary(player => player.PlayerId);
        var deltas = new List<PlayerDelta>();
        var newPlayerCount = 0;
        foreach (var player in incoming.Players.OrderBy(player => player.Slot))
        {
            if (!effectivePlayers.TryGetValue(player.PlayerId, out var existing))
            {
                effectivePlayers[player.PlayerId] = player;
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
                effectivePlayers[player.PlayerId] = tacticalPlayer;
                deltas.Add(new PlayerDelta(tacticalPlayer, IsFull: false, inPossessionChanged, outOfPossessionChanged));
            }
        }

        var homeChanged = previous.Home != incoming.Home;
        var awayChanged = previous.Away != incoming.Away;
        if (!homeChanged && !awayChanged && deltas.Count == 0)
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
            homeChanged ? incoming.Home : previous.Home,
            awayChanged ? incoming.Away : previous.Away,
            players);
        var strings = BuildDeltaStringTable(effective, deltas, homeChanged, awayChanged);
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
                WritePlayer(writer, delta.Player, ids);
                continue;
            }

            var flags = (byte)((delta.InPossessionChanged ? InPossessionFlag : 0) |
                               (delta.OutOfPossessionChanged ? OutOfPossessionFlag : 0));
            writer.Write(flags);
            ArchiveBinary.WriteVarInt64(writer, delta.Player.PlayerId);
            if (delta.InPossessionChanged) WriteAssignment(writer, delta.Player.InPossession, ids);
            if (delta.OutOfPossessionChanged) WriteAssignment(writer, delta.Player.OutOfPossession, ids);
        }

        encoding = new ArchiveMetadataDeltaEncoding(stream.ToArray(), effective, deltas.Count, newPlayerCount);
        return true;
    }

    public static (uint Revision, RealtimeMatchMetadata Metadata) DecodeDelta(
        ReadOnlyMemory<byte> payload,
        RealtimeMatchMetadata previous,
        string matchId,
        long startedUnixMilliseconds)
    {
        using var stream = new MemoryStream(payload.ToArray(), writable: false);
        using var reader = new BinaryReader(stream, Encoding.UTF8);
        var (revision, capturedTick, strings) = ReadPreamble(reader);
        var teamFlags = reader.ReadByte();
        if ((teamFlags & ~AllTeamDeltaFlags) != 0)
            throw new ArchiveFormatException("unknown_metadata_delta_field", "Metadata delta contains unknown team fields.");
        var home = (teamFlags & HomeTeamFlag) != 0 ? ReadTeam(reader, strings) : previous.Home;
        var away = (teamFlags & AwayTeamFlag) != 0 ? ReadTeam(reader, strings) : previous.Away;
        var players = previous.Players.ToDictionary(player => player.PlayerId);
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
                var player = ReadPlayer(reader, strings);
                if (!players.TryAdd(player.PlayerId, player))
                    throw new ArchiveFormatException("duplicate_player", "Metadata delta adds an existing player id.");
                continue;
            }

            var playerId = checked((int)ArchiveBinary.ReadVarInt64(reader));
            if (!players.TryGetValue(playerId, out var existing))
                throw new ArchiveFormatException("unknown_player", "Metadata delta references an unknown player id.");
            players[playerId] = existing with
            {
                InPossession = (flags & InPossessionFlag) != 0 ? ReadAssignment(reader, strings) : existing.InPossession,
                OutOfPossession = (flags & OutOfPossessionFlag) != 0 ? ReadAssignment(reader, strings) : existing.OutOfPossession
            };
        }

        var orderedPlayers = players.Values.OrderBy(player => player.Slot).ToArray();
        if (orderedPlayers.Length > byte.MaxValue || orderedPlayers.Select(player => player.Slot).Distinct().Count() != orderedPlayers.Length)
            throw new ArchiveFormatException("duplicate_slot", "Metadata delta produces a duplicate player slot.");
        if (stream.Position != stream.Length) throw new ArchiveFormatException("trailing_data", "Metadata delta contains trailing bytes.");
        return (revision, new RealtimeMatchMetadata(matchId, startedUnixMilliseconds, capturedTick, home, away, orderedPlayers));
    }

    private static List<string> BuildStringTable(RealtimeMatchMetadata metadata)
    {
        var values = new SortedSet<string>(StringComparer.Ordinal);
        AddTeam(metadata.Home, values);
        AddTeam(metadata.Away, values);
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
        bool awayChanged)
    {
        var values = new SortedSet<string>(StringComparer.Ordinal);
        if (homeChanged) AddTeam(metadata.Home, values);
        if (awayChanged) AddTeam(metadata.Away, values);
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

    private static void AddTeam(RealtimeTeamMetadata team, ISet<string> values) => Add(values, team.Name, team.LogoPath);

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

    private static void WritePlayer(BinaryWriter writer, RealtimePlayerMetadata player, IReadOnlyDictionary<string, int> ids)
    {
        ArchiveBinary.WriteVarUInt64(writer, checked((ulong)player.Slot));
        ArchiveBinary.WriteVarInt64(writer, player.PlayerId);
        WriteNullableUInt(writer, player.Uid);
        writer.Write((byte)player.Team);
        WriteNullableInt(writer, player.ShirtNumber);
        WriteStringId(writer, player.Position, ids);
        WriteAssignment(writer, player.InPossession, ids);
        WriteAssignment(writer, player.OutOfPossession, ids);
        WriteStringId(writer, player.FirstName, ids);
        WriteStringId(writer, player.SecondName, ids);
        WriteStringId(writer, player.CommonName, ids);
        WriteStringId(writer, player.DisplayName, ids);
        WriteStringId(writer, player.PortraitPath, ids);
        WriteProfile(writer, player.Profile);
        WriteAttributes(writer, player.Attributes, ids);
    }

    private static RealtimePlayerMetadata ReadPlayer(BinaryReader reader, IReadOnlyList<string> strings)
    {
        var slot = checked((int)ArchiveBinary.ReadVarUInt64(reader, 5));
        var playerId = checked((int)ArchiveBinary.ReadVarInt64(reader));
        var uid = ReadNullableUInt(reader);
        var team = ReadTeamSide(reader);
        var shirt = ReadNullableInt(reader);
        var position = ReadStringId(reader, strings);
        var inPossession = ReadAssignment(reader, strings);
        var outOfPossession = ReadAssignment(reader, strings);
        var first = ReadStringId(reader, strings);
        var second = ReadStringId(reader, strings);
        var common = ReadStringId(reader, strings);
        var display = ReadStringId(reader, strings) ?? $"Player {playerId}";
        var portrait = ReadStringId(reader, strings);
        var profile = ReadProfile(reader);
        var attributes = ReadAttributes(reader, strings);
        return new RealtimePlayerMetadata(slot, playerId, uid, team, shirt, position, first, second, common, display, portrait, profile, attributes, inPossession, outOfPossession);
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

    private static void WriteProfile(BinaryWriter writer, PlayerProfile? profile)
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

    private static PlayerProfile? ReadProfile(BinaryReader reader) => !reader.ReadBoolean() ? null : new PlayerProfile(
        ReadNullableInt(reader), ReadNullableInt(reader), ReadNullableInt(reader), ReadNullableInt(reader),
        ReadNullableInt(reader), ReadNullableInt(reader), ReadNullableInt(reader));

    private static void WriteAttributes(BinaryWriter writer, PlayerAttributes? attributes, IReadOnlyDictionary<string, int> ids)
    {
        writer.Write(attributes is not null);
        if (attributes is null) return;
        WriteAttributeGroup(writer, attributes.Technical, ids);
        WriteAttributeGroup(writer, attributes.Mental, ids);
        WriteAttributeGroup(writer, attributes.Physical, ids);
        WriteAttributeGroup(writer, attributes.Goalkeeping, ids);
    }

    private static PlayerAttributes? ReadAttributes(BinaryReader reader, IReadOnlyList<string> strings) => !reader.ReadBoolean()
        ? null
        : new PlayerAttributes(
            ReadAttributeGroup(reader, strings), ReadAttributeGroup(reader, strings),
            ReadAttributeGroup(reader, strings), ReadAttributeGroup(reader, strings));

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

    private static TeamSide ReadTeamSide(BinaryReader reader)
    {
        var value = reader.ReadByte();
        return value <= 1 ? (TeamSide)value : throw new ArchiveFormatException("invalid_team", "Metadata contains an invalid team value.");
    }
}
