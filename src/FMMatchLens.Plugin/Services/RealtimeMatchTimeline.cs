using FMMatchLens.Plugin.Domain;
using FMMatchLens.Plugin.Memory;

namespace FMMatchLens.Plugin.Services;

/// <summary>
/// Chunked, append-only storage for the current animated match. The final active
/// frame remains available after the terminal native state has been observed.
/// </summary>
internal sealed class RealtimeMatchTimeline
{
    private const int ChunkSize = 512;
    private const int DefaultQueryLimit = 2_400;
    private const long MetadataRefreshIntervalMilliseconds = 1_000;
    private readonly object _gate = new();
    private readonly MatchArchiveStore _archives;
    private readonly GraphicsAssetIndex _graphicsAssets;
    private readonly List<RealtimeTickFrame[]> _chunks = new();
    private int _lastChunkCount;
    private int _frameCount;
    private int _lastTick = -1;
    private long _missingTickCount;
    private long _duplicateTickCount;
    private long _outOfOrderTickCount;
    private nint _sourceMatchAddress;
    private string _status = "waiting";
    private string? _matchId;
    private long _startedUnixMilliseconds;
    private RealtimeTickFrame? _current;
    private RealtimeMatchMetadata? _metadata;
    private bool _hasCompleteMetadata;
    private long _lastMetadataRefreshTimestamp;

    public RealtimeMatchTimeline(MatchArchiveStore archives, GraphicsAssetIndex graphicsAssets)
    {
        _archives = archives;
        _graphicsAssets = graphicsAssets;
    }

    public bool NeedsPlayerMetadata
    {
        get
        {
            lock (_gate)
            {
                return !_hasCompleteMetadata ||
                       Environment.TickCount64 - _lastMetadataRefreshTimestamp >= MetadataRefreshIntervalMilliseconds;
            }
        }
    }

    public void Begin(nint sourceMatchAddress)
    {
        if (sourceMatchAddress == default)
        {
            return;
        }

        lock (_gate)
        {
            // Native GAME_MATCH storage is commonly reused. The same address is
            // a new match once the previous timeline has reached full time.
            if (_sourceMatchAddress == sourceMatchAddress && _status != "ended")
            {
                return;
            }

            ResetLocked();
            _sourceMatchAddress = sourceMatchAddress;
            _startedUnixMilliseconds = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            _matchId = $"match-{_startedUnixMilliseconds}";
            _status = "live";
            _archives.Begin(_matchId, _startedUnixMilliseconds);
        }
    }

    public bool Append(RawRealtimeTickFrame raw)
    {
        lock (_gate)
        {
            if (raw.MatchAddress != _sourceMatchAddress || _matchId is null)
            {
                return false;
            }

            if (raw.Tick == _lastTick)
            {
                _duplicateTickCount++;
                return false;
            }

            if (raw.Tick < _lastTick)
            {
                _outOfOrderTickCount++;
                return false;
            }

            if (_lastTick < 0 && raw.Tick > 1)
            {
                _missingTickCount += raw.Tick - 1;
            }
            else if (_lastTick >= 0 && raw.Tick > _lastTick + 1)
            {
                _missingTickCount += raw.Tick - _lastTick - 1;
            }

            var players = new PlayerTickData[raw.PlayerCount];
            Array.Copy(raw.Players, players, players.Length);
            var momentum = new MomentumTickData[raw.MomentumCount];
            Array.Copy(raw.Momentum, momentum, momentum.Length);
            var rollingMomentum = new MomentumTickData[raw.RollingMomentumCount];
            Array.Copy(raw.RollingMomentum, rollingMomentum, rollingMomentum.Length);
            var momentumEvents = new NativeMomentumEventData[raw.MomentumEventCount];
            Array.Copy(raw.MomentumEvents, momentumEvents, momentumEvents.Length);

            var frame = new RealtimeTickFrame(
                Sequence: raw.Sequence,
                MatchId: _matchId,
                Tick: raw.Tick,
                DisplayTick: raw.DisplayTick,
                Period: raw.Period,
                CapturedUnixMilliseconds: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                PossessionTeam: raw.PossessionTeam,
                BallHolderPlayerId: raw.BallHolderPlayerId == 0 ? null : raw.BallHolderPlayerId,
                HalfPitchWidth: raw.HalfPitchWidth,
                HalfPitchLength: raw.HalfPitchLength,
                MomentumEvents: momentumEvents,
                Momentum: momentum,
                RollingMomentum: rollingMomentum,
                Home: raw.Home,
                Away: raw.Away,
                Players: players);

            if (_chunks.Count == 0 || _lastChunkCount == ChunkSize)
            {
                _chunks.Add(new RealtimeTickFrame[ChunkSize]);
                _lastChunkCount = 0;
            }

            _chunks[^1][_lastChunkCount++] = frame;
            _frameCount++;
            _lastTick = frame.Tick;
            _current = frame;
            _status = "live";
            _archives.Append(frame);

            if (_metadata is null)
            {
                _metadata = new RealtimeMatchMetadata(
                    _matchId,
                    _startedUnixMilliseconds,
                    frame.Tick,
                    new RealtimeTeamMetadata(null, null, "Home", null, null, null, null),
                    new RealtimeTeamMetadata(null, null, "Away", null, null, null, null),
                    players.Select(player => new RealtimePlayerMetadata(
                        player.Slot,
                        player.PlayerId,
                        null,
                        player.Team,
                        null,
                        null,
                        null,
                        null,
                        null,
                        $"Player {player.PlayerId}",
                        null,
                        null,
                        null,
                        null,
                        null)).ToArray());
            }

            return true;
        }
    }

    public void SetMetadata(
        RealtimeTeamMetadata home,
        RealtimeTeamMetadata away,
        IReadOnlyList<RealtimePlayerMetadata> players)
    {
        lock (_gate)
        {
            if (_matchId is null)
            {
                return;
            }

            _lastMetadataRefreshTimestamp = Environment.TickCount64;
            var incoming = AddAssetPaths(new RealtimeMatchMetadata(
                _matchId,
                _startedUnixMilliseconds,
                _lastTick,
                home,
                away,
                players.ToArray()));
            var candidate = _metadata is null ? incoming : MergeMetadata(_metadata, incoming);
            if (_metadata is not null && MetadataContentEquals(_metadata, candidate))
            {
                return;
            }

            _metadata = candidate;
            _hasCompleteMetadata = IsMetadataComplete(candidate);
            _archives.WriteMetadata(_metadata);
        }
    }

    public void MarkEnded(nint sourceMatchAddress)
    {
        lock (_gate)
        {
            if (sourceMatchAddress == _sourceMatchAddress)
            {
                _status = "ended";
                if (_matchId is not null)
                {
                    _archives.Complete(_matchId);
                }
            }
        }
    }

    public RealtimeTimelineStatus GetStatus()
    {
        lock (_gate)
        {
            return new RealtimeTimelineStatus(
                _status,
                _matchId,
                _sourceMatchAddress == default ? null : $"0x{unchecked((ulong)(long)_sourceMatchAddress):X}",
                _frameCount,
                _lastTick,
                _current?.Period,
                _missingTickCount,
                _duplicateTickCount,
                _outOfOrderTickCount);
        }
    }

    public RealtimeTickFrame? GetCurrent()
    {
        lock (_gate)
        {
            return _current;
        }
    }

    public RealtimeMatchMetadata? GetMetadata()
    {
        lock (_gate)
        {
            return _metadata;
        }
    }

    public RealtimeFrameSlice GetFrames(int fromTick, int? toTick, int stride, int limit = DefaultQueryLimit)
    {
        stride = Math.Clamp(stride, 1, 1_000);
        limit = Math.Clamp(limit, 1, 10_000);

        lock (_gate)
        {
            var result = new List<RealtimeTickFrame>(Math.Min(limit, _frameCount));
            var accepted = 0;
            for (var frameIndex = 0; frameIndex < _frameCount && result.Count < limit; frameIndex++)
            {
                var frame = GetFrameLocked(frameIndex);
                if (frame.Tick < fromTick || (toTick.HasValue && frame.Tick > toTick.Value))
                {
                    continue;
                }

                if (accepted++ % stride == 0)
                {
                    result.Add(frame);
                }
            }

            return new RealtimeFrameSlice(_matchId, _status, _frameCount, result);
        }
    }

    private RealtimeTickFrame GetFrameLocked(int frameIndex)
    {
        return _chunks[frameIndex / ChunkSize][frameIndex % ChunkSize];
    }

    private void ResetLocked()
    {
        _chunks.Clear();
        _lastChunkCount = 0;
        _frameCount = 0;
        _lastTick = -1;
        _missingTickCount = 0;
        _duplicateTickCount = 0;
        _outOfOrderTickCount = 0;
        _sourceMatchAddress = default;
        _matchId = null;
        _current = null;
        _metadata = null;
        _hasCompleteMetadata = false;
        _lastMetadataRefreshTimestamp = 0;
    }

    private static RealtimeMatchMetadata MergeMetadata(
        RealtimeMatchMetadata current,
        RealtimeMatchMetadata incoming)
    {
        var players = current.Players.ToDictionary(player => player.PlayerId);
        foreach (var player in incoming.Players)
        {
            if (!players.TryGetValue(player.PlayerId, out var existing))
            {
                players[player.PlayerId] = player;
                continue;
            }

            players[player.PlayerId] = existing with
            {
                Uid = player.Uid ?? existing.Uid,
                Team = player.Team,
                ShirtNumber = player.ShirtNumber ?? existing.ShirtNumber,
                Position = player.Position ?? existing.Position,
                FirstName = player.FirstName ?? existing.FirstName,
                SecondName = player.SecondName ?? existing.SecondName,
                CommonName = player.CommonName ?? existing.CommonName,
                DisplayName = player.DisplayName.StartsWith("Player ", StringComparison.Ordinal)
                    ? existing.DisplayName
                    : player.DisplayName,
                PortraitPath = player.PortraitPath ?? existing.PortraitPath,
                Profile = MergeProfile(existing.Profile, player.Profile),
                Attributes = MergeAttributes(existing.Attributes, player.Attributes),
                InPossession = player.InPossession ?? existing.InPossession,
                OutOfPossession = player.OutOfPossession ?? existing.OutOfPossession
            };
        }

        return new RealtimeMatchMetadata(
            incoming.MatchId,
            incoming.StartedUnixMilliseconds,
            incoming.CapturedTick,
            MergeTeamMetadata(current.Home, incoming.Home, "Home"),
            MergeTeamMetadata(current.Away, incoming.Away, "Away"),
            players.Values.OrderBy(player => player.Slot).ToArray());
    }

    private static RealtimeTeamMetadata MergeTeamMetadata(
        RealtimeTeamMetadata current,
        RealtimeTeamMetadata incoming,
        string fallbackName)
    {
        return new RealtimeTeamMetadata(
            incoming.Uid ?? current.Uid,
            incoming.ClubUid ?? current.ClubUid,
            !string.IsNullOrWhiteSpace(incoming.Name) && incoming.Name != fallbackName
                ? incoming.Name
                : current.Name,
            incoming.BackgroundColour ?? current.BackgroundColour,
            incoming.ForegroundColour ?? current.ForegroundColour,
            incoming.OutlineColour ?? current.OutlineColour,
            incoming.LogoPath ?? current.LogoPath);
    }

    private static bool IsMetadataComplete(RealtimeMatchMetadata metadata)
    {
        return metadata.Home.Uid.HasValue &&
               metadata.Away.Uid.HasValue &&
               metadata.Home.BackgroundColour.HasValue &&
               metadata.Away.BackgroundColour.HasValue &&
               metadata.Home.Name != "Home" &&
               metadata.Away.Name != "Away" &&
               metadata.Players.Count > 0 &&
               metadata.Players.All(player =>
                   player.Uid.HasValue &&
                   player.ShirtNumber.HasValue &&
                   player.Profile is not null &&
                   player.Attributes is not null &&
                   !player.DisplayName.StartsWith("Player ", StringComparison.Ordinal));
    }

    private RealtimeMatchMetadata AddAssetPaths(RealtimeMatchMetadata metadata)
    {
        var players = metadata.Players.Select(player => player with
        {
            PortraitPath = player.PortraitPath ?? ResolveAssetPath("person", player.Uid, "portrait")
        }).ToArray();
        return metadata with
        {
            Home = AddTeamAssetPath(metadata.Home),
            Away = AddTeamAssetPath(metadata.Away),
            Players = players
        };
    }

    private RealtimeTeamMetadata AddTeamAssetPath(RealtimeTeamMetadata team) => team with
    {
        LogoPath = team.LogoPath ?? ResolveAssetPath("club", team.ClubUid, "logo")
    };

    private string? ResolveAssetPath(string entityType, uint? uid, string imageType) =>
        uid.HasValue && _graphicsAssets.TryResolve(entityType, uid.Value, imageType, out var path) ? path : null;

    private static PlayerProfile? MergeProfile(PlayerProfile? current, PlayerProfile? incoming)
    {
        if (incoming is null) return current;
        if (current is null) return incoming;
        return new PlayerProfile(
            incoming.WeeklyWage ?? current.WeeklyWage,
            incoming.HeightCm ?? current.HeightCm,
            incoming.Condition ?? current.Condition,
            incoming.Morale ?? current.Morale,
            incoming.CurrentAbility ?? current.CurrentAbility,
            incoming.PotentialAbility ?? current.PotentialAbility,
            incoming.CurrentReputation ?? current.CurrentReputation);
    }

    private static PlayerAttributes? MergeAttributes(PlayerAttributes? current, PlayerAttributes? incoming)
    {
        if (incoming is null) return current;
        if (current is null) return incoming;
        return new PlayerAttributes(
            MergeAttributeGroup(current.Technical, incoming.Technical),
            MergeAttributeGroup(current.Mental, incoming.Mental),
            MergeAttributeGroup(current.Physical, incoming.Physical),
            MergeAttributeGroup(current.Goalkeeping, incoming.Goalkeeping));
    }

    private static IReadOnlyDictionary<string, int> MergeAttributeGroup(
        IReadOnlyDictionary<string, int> current,
        IReadOnlyDictionary<string, int> incoming)
    {
        var result = new Dictionary<string, int>(current);
        foreach (var entry in incoming)
        {
            if (entry.Value > 0 || !result.ContainsKey(entry.Key)) result[entry.Key] = entry.Value;
        }
        return result;
    }

    private static bool MetadataContentEquals(RealtimeMatchMetadata left, RealtimeMatchMetadata right)
    {
        if (left.Home != right.Home || left.Away != right.Away || left.Players.Count != right.Players.Count)
        {
            return false;
        }

        for (var index = 0; index < left.Players.Count; index++)
        {
            var a = left.Players[index];
            var b = right.Players[index];
            if (a with { Attributes = null } != b with { Attributes = null } ||
                !AttributesEqual(a.Attributes, b.Attributes))
            {
                return false;
            }
        }

        return true;
    }

    private static bool AttributesEqual(PlayerAttributes? left, PlayerAttributes? right) =>
        ReferenceEquals(left, right) ||
        left is not null && right is not null &&
        AttributeGroupEqual(left.Technical, right.Technical) &&
        AttributeGroupEqual(left.Mental, right.Mental) &&
        AttributeGroupEqual(left.Physical, right.Physical) &&
        AttributeGroupEqual(left.Goalkeeping, right.Goalkeeping);

    private static bool AttributeGroupEqual(
        IReadOnlyDictionary<string, int> left,
        IReadOnlyDictionary<string, int> right) =>
        left.Count == right.Count && left.All(entry => right.TryGetValue(entry.Key, out var value) && value == entry.Value);
}

internal sealed record RealtimeTimelineStatus(
    string Status,
    string? MatchId,
    string? MatchAddress,
    int FrameCount,
    int LastTick,
    int? Period,
    long MissingTickCount,
    long DuplicateTickCount,
    long OutOfOrderTickCount);

internal sealed record RealtimeFrameSlice(
    string? MatchId,
    string Status,
    int TotalFrameCount,
    IReadOnlyList<RealtimeTickFrame> Frames);
