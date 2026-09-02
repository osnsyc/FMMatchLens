using BepInEx.Unity.IL2CPP.Hook;
using FMMatchLens.Plugin.Diagnostics;
using FMMatchLens.Plugin.Domain;
using FMMatchLens.Plugin.Services;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace FMMatchLens.Plugin.Memory;

internal sealed class GameMatchTickHook : IDisposable
{
    private const int CandidateRealtimeMaxTicksPerSecond = 240;
    private const int CandidatePaceObservationSeconds = 2;
    private const int PreviousMatchTickForEpochReset = 12_000;
    private const int NewMatchTickForEpochReset = 4_096;
    private const int EpochResetConfirmationRecords = 3;

    private readonly int _instructionOffset;
    private readonly RealtimeMatchTimeline _timeline;
    private readonly MatchUpdateDelegate _hookDelegate;
    private readonly MemoryReader _memoryReader = new();
    private readonly MomentumCalculator _momentumCalculator = new();
    private readonly GameMatchTickRecordBuffer _tickRecords = new(65_536);
    private readonly GameMatchTickRecord[] _drainBatch = new GameMatchTickRecord[2_048];
    private readonly RealtimeTickFrameBuffer _realtimeFrames = new(8_192);
    private readonly RawRealtimeTickFrame[] _realtimeDrainBatch = new RawRealtimeTickFrame[2_048];
    private readonly Dictionary<nint, CandidateState> _candidates = new();
    private readonly Dictionary<nint, NativeMomentumCaptureState> _nativeMomentumStates = new();
    private readonly object _nativeMomentumGate = new();
    private readonly object _animatedUpdateGate = new();
    private readonly ConcurrentDictionary<nint, byte> _terminalMatches = new();
    private Timer? _diagnosticsTimer;
    private Timer? _tickDrainTimer;
    private INativeDetour? _detour;
    private MatchUpdateDelegate? _original;
    private nint _targetAddress;
    private long _callCount;
    private long _lastLoggedCallCount;
    private long _lastMatch;
    private long _lastParam2;
    private long _lastResult;
    private long _tickRecordSequence;
    private long _lastCandidateSummaryTimestamp;
    private long _lastReportedDropped;
    private long _lastReportedRealtimeDropped;
    private nint _lastReportedSimulation;
    private nint _lastReportedAnimated;
    private nint _stableSimulation;
    private nint _stableAnimated;
    private long _selectedAnimated;
    private int _lastReportedEndTick;
    private long _lastReportedEndTimestamp;
    private long _lastMetadataFailureTimestamp;
    private long _lastMetadataCaptureTimestamp;
    private int _isDrainingTickRecords;
    private bool _started;

    public GameMatchTickHook(
        RealtimeMatchTimeline timeline,
        int instructionOffset)
    {
        _timeline = timeline;
        _instructionOffset = instructionOffset;
        _hookDelegate = MatchUpdateHook;
    }

    public bool IsStarted => _started;

    public bool Start(bool logModuleNotLoaded = true)
    {
        if (_started)
        {
            return true;
        }

        if (IntPtr.Size != 8)
        {
            PluginLogger.Warning("GAME_MATCH match-update hook requires a 64-bit process.");
            return false;
        }

        var moduleBase = GetModuleHandle("game_plugin.dll");
        if (moduleBase == default)
        {
            if (logModuleNotLoaded)
            {
                PluginLogger.Warning("Unable to install GAME_MATCH match-update hook: game_plugin.dll is not loaded.");
            }

            return false;
        }

        _targetAddress = moduleBase + _instructionOffset;
        _momentumCalculator.SetModuleBase(moduleBase);

        try
        {
            // BepInEx's IL2CPP detour provider creates a permanent native
            // trampoline. Do not use MonoMod NativeDetour.GenerateTrampoline
            // here: in the bundled 22.07.31 version that trampoline performs
            // undo-call-redo on every Original invocation, which races when
            // MatchUpdate is called concurrently by simulation threads.
            _detour = INativeDetour.CreateAndApply(
                _targetAddress,
                _hookDelegate,
                out MatchUpdateDelegate original);
            _original = original;
            _started = true;
            if (PluginLogger.IsDebugEnabled)
            {
                _diagnosticsTimer = new Timer(
                    _ => LogDiagnostics(),
                    null,
                    TimeSpan.FromSeconds(1),
                    TimeSpan.FromSeconds(1));
            }
            _tickDrainTimer = new Timer(
                _ => DrainTickRecords(),
                null,
                TimeSpan.FromMilliseconds(100),
                TimeSpan.FromMilliseconds(100));
            PluginLogger.Debug(
                $"GAME_MATCH match-update post hook installed with permanent native trampoline at " +
                $"game_plugin.dll+0x{_instructionOffset:X} ({FormatPointer(_targetAddress)}), " +
                $"trampoline={FormatPointer(_detour.TrampolinePtr)}.");
            PluginLogger.Info("GAME_MATCH match-update hook installed.");
            return true;
        }
        catch (Exception ex)
        {
            PluginLogger.Warning($"Unable to install GAME_MATCH match-update hook: {ex.Message}");
            _detour?.Dispose();
            _detour = null;
            _original = null;
            return false;
        }
    }

    public void Stop()
    {
        if (!_started)
        {
            return;
        }

        _diagnosticsTimer?.Dispose();
        _diagnosticsTimer = null;
        _tickDrainTimer?.Dispose();
        _tickDrainTimer = null;
        _detour?.Dispose();
        _detour = null;
        _original = null;
        _started = false;
        PluginLogger.Debug("GAME_MATCH match-update hook stopped.");
    }

    public void Dispose()
    {
        Stop();
        _momentumCalculator.Dispose();
    }

    private ulong MatchUpdateHook(nint match, ulong param2)
    {
        try
        {
            var original = _original;
            if (original is null)
            {
                return 0;
            }

            // Once the real-time instance is known, serialize only that instance's
            // Original+capture section. Without this, concurrent returns can read a
            // tick already advanced by another invocation and create false gaps.
            if ((nint)Interlocked.Read(ref _selectedAnimated) == match)
            {
                lock (_animatedUpdateGate)
                {
                    return InvokeOriginalAndCapture(original, match, param2);
                }
            }

            return InvokeOriginalAndCapture(original, match, param2);
        }
        catch (Exception ex)
        {
            // A managed exception must never cross the reverse-P/Invoke boundary.
            try
            {
                PluginLogger.Error($"GAME_MATCH match-update hook failed: {ex}");
            }
            catch
            {
                // Logging is best-effort inside a native callback.
            }

            return 0;
        }
    }

    private ulong InvokeOriginalAndCapture(MatchUpdateDelegate original, nint match, ulong param2)
    {
        var result = original(match, param2);

        Interlocked.Exchange(ref _lastMatch, (long)match);
        Interlocked.Exchange(ref _lastParam2, unchecked((long)param2));
        Interlocked.Exchange(ref _lastResult, unchecked((long)result));
        Interlocked.Increment(ref _callCount);

        if (TryCaptureTickRecord(match, unchecked((uint)param2), out var record))
        {
            _tickRecords.TryWrite(record);
            var selectedAnimated = (nint)Interlocked.Read(ref _selectedAnimated);
            if (!record.IsTerminal &&
                (selectedAnimated == match || (selectedAnimated == default && record.Tick <= 2_048)))
            {
                TryCaptureRealtimeFrame(record);
            }
        }

        return result;
    }

    private void LogDiagnostics()
    {
        try
        {
            var callCount = Interlocked.Read(ref _callCount);
            var previous = Interlocked.Exchange(ref _lastLoggedCallCount, callCount);
            if (callCount == previous)
            {
                return;
            }

            var match = (nint)Interlocked.Read(ref _lastMatch);
            var param2 = unchecked((ulong)Interlocked.Read(ref _lastParam2));
            var result = unchecked((ulong)Interlocked.Read(ref _lastResult));
            PluginLogger.Debug(
                $"GAME_MATCH hook alive: calls={callCount}, callsSinceLastLog={callCount - previous}, " +
                $"match={FormatPointer(match)}, param2=0x{param2:X}, result=0x{result:X}.");
        }
        catch (Exception ex)
        {
            PluginLogger.Warning($"Unable to write GAME_MATCH hook diagnostics: {ex.Message}");
        }
    }

    private bool TryCaptureTickRecord(nint match, uint param2, out GameMatchTickRecord record)
    {
        record = default;
        if (match == default || !_memoryReader.TryReadInt32(match + Offsets.GameMatch.Tick, out var tick))
        {
            return false;
        }

        var homeTeamRead = _memoryReader.TryReadPointer(match + Offsets.GameMatch.HomeTeam, out var homeTeam);
        var awayTeamRead = _memoryReader.TryReadPointer(match + Offsets.GameMatch.AwayTeam, out var awayTeam);
        _memoryReader.TryReadByte(match + Offsets.GameMatch.MatchPlayersCount, out var playerCount);
        _memoryReader.TryReadInt32(match + Offsets.GameMatch.DisplayTick, out var displayTick);
        _memoryReader.TryReadByte(match + Offsets.GameMatch.Period, out var period);
        _memoryReader.TryReadByte(match + Offsets.GameMatch.LifecycleStateA, out var state142F8);
        _memoryReader.TryReadByte(match + Offsets.GameMatch.LifecycleStateB, out var state142F9);
        _memoryReader.TryReadByte(match + Offsets.GameMatch.LifecycleStateC, out var state142FA);
        _memoryReader.TryReadByte(match + Offsets.GameMatch.LifecycleStateD, out var state142FB);
        _memoryReader.TryReadPointer(match + Offsets.GameMatch.PossessionTeam, out var possessionTeam);
        _memoryReader.TryReadPointer(match + Offsets.GameMatch.CurrentBallHolder, out var currentBallHolder);

        var isActive = homeTeam != default && awayTeam != default && playerCount is > 0 and <= 64;
        // At full time the GAME_MATCH object remains readable, but both runtime
        // team pointers are cleared. Require successful slot reads so an invalid
        // or already-freed GAME_MATCH address cannot masquerade as full time.
        var isTerminal = homeTeamRead && awayTeamRead &&
                         homeTeam == default && awayTeam == default;
        if (isTerminal)
        {
            if (!_terminalMatches.TryAdd(match, 0))
            {
                return false;
            }
        }
        else if (!isActive)
        {
            return false;
        }
        else
        {
            // A GAME_MATCH address can be reused by a later match. Once the
            // address becomes active again it belongs to a new terminal epoch.
            _terminalMatches.TryRemove(match, out _);
        }

        ReadTeamTickValues(homeTeam, out var homeGoals, out var homeXg, out var homeShots);
        ReadTeamTickValues(awayTeam, out var awayGoals, out var awayXg, out var awayShots);

        record = new GameMatchTickRecord(
            Sequence: Interlocked.Increment(ref _tickRecordSequence),
            CapturedTimestamp: Stopwatch.GetTimestamp(),
            MatchAddress: match,
            Param2: param2,
            IsTerminal: isTerminal,
            Tick: tick,
            DisplayTick: displayTick,
            Period: period,
            State142F8: state142F8,
            State142F9: state142F9,
            State142FA: state142FA,
            State142FB: state142FB,
            PlayerCount: playerCount,
            HomeTeam: homeTeam,
            AwayTeam: awayTeam,
            PossessionTeam: possessionTeam,
            CurrentBallHolder: currentBallHolder,
            HomeGoals: homeGoals,
            AwayGoals: awayGoals,
            HomeXg: homeXg,
            AwayXg: awayXg,
            HomeShots: homeShots,
            AwayShots: awayShots);
        return true;
    }

    private void ReadTeamTickValues(nint team, out byte goals, out float xg, out byte shots)
    {
        goals = default;
        xg = default;
        shots = default;

        if (!_memoryReader.TryReadPointer(team + Offsets.Team.TeamBase, out var teamBase) || teamBase == default)
        {
            return;
        }

        _memoryReader.TryReadByte(teamBase + Offsets.TeamBase.Goals, out goals);
        if (_memoryReader.TryReadFloat(teamBase + Offsets.TeamBase.Xg, out var rawXg) && float.IsFinite(rawXg))
        {
            xg = rawXg;
        }

        _memoryReader.TryReadByte(teamBase + Offsets.TeamBase.Shots, out shots);
    }

    private void TryCaptureRealtimeFrame(in GameMatchTickRecord record)
    {
        if (!_realtimeFrames.TryRent(out var frame))
        {
            return;
        }

        var published = false;
        try
        {
            frame.Sequence = record.Sequence;
            frame.CapturedTimestamp = record.CapturedTimestamp;
            frame.MatchAddress = record.MatchAddress;
            frame.Tick = record.Tick;
            frame.DisplayTick = record.DisplayTick;
            frame.Period = record.Period;
            frame.PlayerCount = 0;
            frame.MomentumEventCount = 0;
            frame.HalfPitchWidth = 0;
            frame.HalfPitchLength = 0;
            frame.MomentumCount = 0;
            frame.RollingMomentumCount = 0;
            frame.PossessionTeam = record.PossessionTeam == record.HomeTeam
                ? TeamSide.Home
                : record.PossessionTeam == record.AwayTeam
                    ? TeamSide.Away
                    : null;
            frame.BallHolderPlayerId = 0;
            frame.Home = ReadTeamFrame(record.HomeTeam);
            frame.Away = ReadTeamFrame(record.AwayTeam);
            _momentumCalculator.Capture(
                record.MatchAddress,
                frame.Momentum,
                out frame.MomentumCount,
                frame.RollingMomentum,
                out frame.RollingMomentumCount);
            CaptureNativeMomentumEvents(record.MatchAddress, frame);

            var playerCount = Math.Min(record.PlayerCount, (byte)RawRealtimeTickFrame.MaxPlayers);
            for (var slot = 0; slot < playerCount; slot++)
            {
                // Confirmed layout: the pointer slots live directly in GAME_MATCH.
                var pointerSlot = record.MatchAddress + Offsets.GameMatch.FirstMatchPlayer + slot * IntPtr.Size;
                if (!_memoryReader.TryReadPointer(pointerSlot, out var matchPlayer) ||
                    matchPlayer == default ||
                    !TryReadPlayerFrame(matchPlayer, slot, record.CurrentBallHolder, out var player))
                {
                    continue;
                }

                frame.Players[frame.PlayerCount++] = player;
                if (player.IsBallHolder)
                {
                    frame.BallHolderPlayerId = player.PlayerId;
                }
            }

            ResolveDerivedTeamStats(frame);
            ResolveMomentumEventPlayerIds(frame);

            _realtimeFrames.Publish(frame);
            published = true;
        }
        finally
        {
            if (!published)
            {
                _realtimeFrames.ReleaseUnpublished(frame);
            }
        }
    }

    private static void ResolveDerivedTeamStats(RawRealtimeTickFrame frame)
    {
        var homeOffTarget = 0;
        var awayOffTarget = 0;
        for (var index = 0; index < frame.PlayerCount; index++)
        {
            var player = frame.Players[index];
            var offTarget = Math.Max(0,
                player.Shots - player.ShotsOnTarget - player.BlockedShots - player.HitWoodwork);
            if (player.Team == TeamSide.Home) homeOffTarget += offTarget;
            else awayOffTarget += offTarget;
        }

        frame.Home = frame.Home with { ShotsOffTarget = homeOffTarget };
        frame.Away = frame.Away with { ShotsOffTarget = awayOffTarget };
    }

    private void CaptureNativeMomentumEvents(nint match, RawRealtimeTickFrame frame)
    {
        var holder = match + Offsets.GameMatch.MomentumEventSource;
        if (!VirtualMemory.IsReadable(holder, IntPtr.Size)) return;
        var source = Marshal.ReadIntPtr(holder);
        if (!VirtualMemory.IsReadable(source, Offsets.MomentumEventSource.HalfPitchLength + sizeof(float))) return;

        var begin = Marshal.ReadIntPtr(source + Offsets.MomentumEventSource.EventsBegin);
        var end = Marshal.ReadIntPtr(source + Offsets.MomentumEventSource.EventsEnd);
        var length = (long)end - (long)begin;
        if (begin == default || length < 0 || length % Offsets.MomentumEvent.Size != 0 ||
            length / Offsets.MomentumEvent.Size > 100_000 || length > int.MaxValue ||
            (length > 0 && !VirtualMemory.IsReadable(begin, (int)length)))
        {
            return;
        }

        var halfWidth = ReadFloatDirect(source + Offsets.MomentumEventSource.HalfPitchWidth);
        var halfLength = ReadFloatDirect(source + Offsets.MomentumEventSource.HalfPitchLength);
        if (halfWidth <= 0 || halfLength <= 0) return;
        frame.HalfPitchWidth = halfWidth;
        frame.HalfPitchLength = halfLength;

        var eventCount = (int)(length / Offsets.MomentumEvent.Size);
        if (eventCount == 0) return;
        var lastSignature = ReadNativeEventSignature(begin + (eventCount - 1) * Offsets.MomentumEvent.Size);

        lock (_nativeMomentumGate)
        {
            if (!_nativeMomentumStates.TryGetValue(match, out var state))
            {
                state = new NativeMomentumCaptureState();
                _nativeMomentumStates.Add(match, state);
            }

            var reset = state.Source != source || state.Begin != begin || eventCount < state.EventCount;
            var start = eventCount;
            if (reset)
            {
                start = 0;
            }
            else if (eventCount > state.EventCount)
            {
                // The former tail is mutable. Copy it once more together with the
                // newly appended records; consumers replace duplicate event indices.
                start = Math.Max(0, state.EventCount - 1);
            }
            else if (lastSignature != state.LastSignature)
            {
                start = eventCount - 1;
            }

            var processedEventCount = eventCount;
            if (start < eventCount)
            {
                processedEventCount = start;
                for (var eventIndex = start; eventIndex < eventCount; eventIndex++)
                {
                    if (frame.MomentumEventCount >= RawRealtimeTickFrame.MaxMomentumEvents) break;
                    var address = begin + eventIndex * Offsets.MomentumEvent.Size;
                    processedEventCount = eventIndex + 1;
                    var eventType = Marshal.ReadByte(address + Offsets.MomentumEvent.EventType);
                    if (!IsPublishedMomentumEventType(eventType)) continue;

                    var rawTeam = Marshal.ReadByte(address + Offsets.MomentumEvent.Team);
                    frame.MomentumEvents[frame.MomentumEventCount++] = new NativeMomentumEventData(
                        EventIndex: eventIndex,
                        Tick: unchecked((ushort)Marshal.ReadInt16(address + Offsets.MomentumEvent.Tick)),
                        LateralPosition: ReadFloatDirect(address + Offsets.MomentumEvent.LateralPosition),
                        LongitudinalPosition: ReadFloatDirect(address + Offsets.MomentumEvent.LongitudinalPosition),
                        Team: rawTeam == 0 ? TeamSide.Home : TeamSide.Away,
                        PlayerSlot: Marshal.ReadByte(address + Offsets.MomentumEvent.PlayerSlot),
                        PlayerId: 0,
                        ReceiverPlayerSlot: Marshal.ReadByte(address + Offsets.MomentumEvent.ReceiverPlayerSlot),
                        ReceiverPlayerId: 0,
                        EventType: eventType,
                        Flags: unchecked((ushort)Marshal.ReadInt16(address + Offsets.MomentumEvent.Flags)));
                }
            }

            state.Source = source;
            state.Begin = begin;
            state.EventCount = processedEventCount;
            state.LastSignature = lastSignature;
        }
    }

    private static bool IsPublishedMomentumEventType(byte eventType)
    {
        return eventType is
            >= Offsets.MomentumEvent.ShotGoal and <= Offsets.MomentumEvent.ShotBlocked or
            Offsets.MomentumEvent.PassCompleted or
            Offsets.MomentumEvent.PassIncompleteA or
            Offsets.MomentumEvent.PassIncompleteB or
            Offsets.MomentumEvent.PassIncompleteC or
            >= Offsets.MomentumEvent.CrossCompleted and <= Offsets.MomentumEvent.CrossIncompleteD or
            Offsets.MomentumEvent.Fouled or
            Offsets.MomentumEvent.FoulCommittedA or
            Offsets.MomentumEvent.FoulCommittedB or
            >= Offsets.MomentumEvent.TackleWon and <= Offsets.MomentumEvent.AerialLost or
            Offsets.MomentumEvent.Interception or
            Offsets.MomentumEvent.DribbleCompleted or
            Offsets.MomentumEvent.Touch;
    }

    private static void ResolveMomentumEventPlayerIds(RawRealtimeTickFrame frame)
    {
        for (var eventIndex = 0; eventIndex < frame.MomentumEventCount; eventIndex++)
        {
            var item = frame.MomentumEvents[eventIndex];
            var teamSlot = 0;
            var playerId = 0;
            var receiverPlayerId = 0;
            var resolveReceiver = item.EventType is
                Offsets.MomentumEvent.PassCompleted or Offsets.MomentumEvent.CrossCompleted;
            for (var playerIndex = 0; playerIndex < frame.PlayerCount; playerIndex++)
            {
                var player = frame.Players[playerIndex];
                if (player.Team != item.Team) continue;
                if (teamSlot == item.PlayerSlot) playerId = player.PlayerId;
                if (resolveReceiver && teamSlot == item.ReceiverPlayerSlot)
                    receiverPlayerId = player.PlayerId;
                teamSlot++;

                if (playerId > 0 &&
                    (!resolveReceiver || item.ReceiverPlayerSlot == byte.MaxValue || receiverPlayerId > 0)) break;
            }

            frame.MomentumEvents[eventIndex] = item with
            {
                PlayerId = playerId,
                ReceiverPlayerId = receiverPlayerId,
            };
        }
    }

    private static ulong ReadNativeEventSignature(nint address)
    {
        if (!VirtualMemory.IsReadable(address, Offsets.MomentumEvent.Size)) return 0;
        var hash = 1469598103934665603UL;
        hash = (hash ^ unchecked((ushort)Marshal.ReadInt16(address + Offsets.MomentumEvent.Tick))) * 1099511628211UL;
        hash = (hash ^ Marshal.ReadByte(address + Offsets.MomentumEvent.PlayerSlot)) * 1099511628211UL;
        hash = (hash ^ Marshal.ReadByte(address + Offsets.MomentumEvent.Team)) * 1099511628211UL;
        hash = (hash ^ Marshal.ReadByte(address + Offsets.MomentumEvent.EventType)) * 1099511628211UL;
        hash = (hash ^ unchecked((uint)Marshal.ReadInt32(address + Offsets.MomentumEvent.LateralPosition))) * 1099511628211UL;
        return (hash ^ unchecked((uint)Marshal.ReadInt32(address + Offsets.MomentumEvent.LongitudinalPosition))) * 1099511628211UL;
    }

    private bool TryReadPlayerFrame(nint matchPlayer, int slot, nint ballHolder, out PlayerTickData player)
    {
        player = default;
        if (!VirtualMemory.IsReadable(matchPlayer, Offsets.MatchPlayer.Stats + IntPtr.Size))
        {
            return false;
        }

        var stats = Marshal.ReadIntPtr(matchPlayer + Offsets.MatchPlayer.Stats);
        if (stats == default || !VirtualMemory.IsReadable(stats + Offsets.PlayerStats.Id, Offsets.PlayerStats.ShotsFaced - Offsets.PlayerStats.Id + 1))
        {
            return false;
        }

        var playerId = Marshal.ReadInt32(stats + Offsets.PlayerStats.Id);
        var team = ReadByteDirect(stats + Offsets.PlayerStats.TeamSideUnconfirmed) == 1 ? TeamSide.Away : TeamSide.Home;
        var starterFlag = ReadByteDirect(stats + Offsets.PlayerStats.StarterSubstituteFlag);
        var subbedOn = ReadByteDirect(stats + Offsets.PlayerStats.SubbedOnMinute);
        var subbedOff = ReadByteDirect(stats + Offsets.PlayerStats.SubbedOffMinute);

        player = new PlayerTickData(
            Slot: slot,
            PlayerId: playerId != 0 ? playerId : slot + 1,
            Team: team,
            IsBallHolder: matchPlayer == ballHolder,
            X: ReadFloatDirect(matchPlayer + Offsets.MatchPlayer.PositionX),
            Y: ReadFloatDirect(matchPlayer + Offsets.MatchPlayer.PositionY),
            Rating: Marshal.ReadInt16(stats + Offsets.PlayerStats.RatingTimes100) / 100f,
            IsSubstitute: (starterFlag & 0x20) != 0,
            IsOnPitch: ((starterFlag & 0x20) == 0 || subbedOn > 0) && subbedOff == 0,
            SubbedOnMinute: subbedOn,
            SubbedOffMinute: subbedOff,
            Penalties: ReadByteDirect(stats + Offsets.PlayerStats.Penalties),
            OwnGoals: ReadByteDirect(stats + Offsets.PlayerStats.OwnGoals),
            OverallPhysicalCondition: ReadByteDirect(stats + Offsets.PlayerStats.OverallPhysicalCondition),
            MatchSharpness: ReadByteDirect(stats + Offsets.PlayerStats.MatchSharpness),
            Goals: ReadByteDirect(stats + Offsets.PlayerStats.Goals),
            Assists: ReadByteDirect(stats + Offsets.PlayerStats.Assists),
            Xg: ReadFloatDirect(stats + Offsets.PlayerStats.Xg),
            Xa: ReadFloatDirect(stats + Offsets.PlayerStats.Xa),
            Shots: ReadByteDirect(stats + Offsets.PlayerStats.Shots),
            ShotsOnTarget: ReadByteDirect(stats + Offsets.PlayerStats.ShotsOnTarget),
            BlockedShots: ReadByteDirect(stats + Offsets.PlayerStats.BlockedShotsUnconfirmed),
            ClearCutChances: ReadByteDirect(stats + Offsets.PlayerStats.ClearCutChances),
            HitWoodwork: ReadByteDirect(stats + Offsets.PlayerStats.HitWoodwork),
            Dribbles: ReadByteDirect(stats + Offsets.PlayerStats.Dribbles),
            Fouls: ReadByteDirect(stats + Offsets.PlayerStats.Fouls),
            Fouled: ReadByteDirect(stats + Offsets.PlayerStats.Fouled),
            Crosses: ReadByteDirect(stats + Offsets.PlayerStats.Crosses),
            CrossesCompleted: ReadByteDirect(stats + Offsets.PlayerStats.CrossesCompleted),
            Passes: ReadByteDirect(stats + Offsets.PlayerStats.Passes),
            PassesCompleted: ReadByteDirect(stats + Offsets.PlayerStats.PassesCompleted),
            KeyPasses: ReadByteDirect(stats + Offsets.PlayerStats.KeyPasses),
            TacklesAttempted: ReadByteDirect(stats + Offsets.PlayerStats.TacklesAttempted),
            TacklesWon: ReadByteDirect(stats + Offsets.PlayerStats.TacklesWon),
            KeyTackles: ReadByteDirect(stats + Offsets.PlayerStats.KeyTackles),
            Aerials: ReadByteDirect(stats + Offsets.PlayerStats.Aerials),
            AerialsWon: ReadByteDirect(stats + Offsets.PlayerStats.AerialsWon),
            Interceptions: ReadByteDirect(stats + Offsets.PlayerStats.Interceptions),
            ThrowIns: ReadByteDirect(stats + Offsets.PlayerStats.ThrowIns),
            Corners: ReadByteDirect(stats + Offsets.PlayerStats.Corners),
            DefensiveFreeKicks: ReadByteDirect(stats + Offsets.PlayerStats.DefensiveFreeKicks),
            AttackingFreeKicks: ReadByteDirect(stats + Offsets.PlayerStats.AttackingFreeKicks),
            Clearances: ReadByteDirect(stats + Offsets.PlayerStats.Clearances),
            ShotsFaced: ReadByteDirect(stats + Offsets.PlayerStats.ShotsFaced),
            DistanceM: ReadFloatDirect(stats + Offsets.PlayerStats.DistanceM));
        return true;
    }

    private TeamTickData ReadTeamFrame(nint team)
    {
        if (!_memoryReader.TryReadPointer(team + Offsets.Team.TeamBase, out var teamBase) ||
            teamBase == default ||
            !VirtualMemory.IsReadable(teamBase, Offsets.TeamBase.MatchSquadUnconfirmed + IntPtr.Size))
        {
            return default;
        }

        return new TeamTickData(
            Goals: ReadByteDirect(teamBase + Offsets.TeamBase.Goals),
            Xg: ReadFloatDirect(teamBase + Offsets.TeamBase.Xg),
            PossessionTime: Marshal.ReadInt32(teamBase + Offsets.TeamBase.PossessionTime),
            Shots: ReadByteDirect(teamBase + Offsets.TeamBase.Shots),
            ShotsOnTarget: ReadByteDirect(teamBase + Offsets.TeamBase.ShotsOnTarget),
            // +0x172 does not equal the native missed-target event count in the
            // validated 3-1 match. Keep the API field neutral until it is
            // reconciled from reliable player/native-event data.
            ShotsOffTarget: 0,
            BlockedShots: ReadByteDirect(teamBase + Offsets.TeamBase.BlockedShots),
            ClearCutChances: ReadByteDirect(teamBase + Offsets.TeamBase.ClearCutChances),
            Passes: unchecked((ushort)Marshal.ReadInt16(teamBase + Offsets.TeamBase.Passes)),
            PassesCompleted: unchecked((ushort)Marshal.ReadInt16(teamBase + Offsets.TeamBase.PassesCompleted)),
            Crosses: Marshal.ReadInt16(teamBase + Offsets.TeamBase.Crosses),
            CrossesCompleted: Marshal.ReadInt16(teamBase + Offsets.TeamBase.CrossesCompleted),
            Aerials: Marshal.ReadInt16(teamBase + Offsets.TeamBase.Aerials),
            AerialsWon: Marshal.ReadInt16(teamBase + Offsets.TeamBase.AerialsWon),
            ProgressivePasses: Marshal.ReadInt16(teamBase + Offsets.TeamBase.ProgressivePasses),
            FinalThirdPasses: Marshal.ReadInt16(teamBase + Offsets.TeamBase.FinalThirdPasses),
            TacklesAttempted: ReadByteDirect(teamBase + Offsets.TeamBase.TacklesAttempted),
            TacklesWon: ReadByteDirect(teamBase + Offsets.TeamBase.TacklesWon),
            Fouls: ReadByteDirect(teamBase + Offsets.TeamBase.Fouls),
            Corners: ReadByteDirect(teamBase + Offsets.TeamBase.Corners),
            Offsides: ReadByteDirect(teamBase + Offsets.TeamBase.Offsides),
            YellowCards: ReadByteDirect(teamBase + Offsets.TeamBase.YellowCardsUnconfirmed),
            RedCards: ReadByteDirect(teamBase + Offsets.TeamBase.RedCardsUnconfirmed));
    }

    private static byte ReadByteDirect(nint address) => Marshal.ReadByte(address);

    private static float ReadFloatDirect(nint address)
    {
        var value = BitConverter.Int32BitsToSingle(Marshal.ReadInt32(address));
        return float.IsFinite(value) ? value : 0f;
    }

    private void TryCapturePlayerMetadata(nint match)
    {
        var captureTimestamp = Stopwatch.GetTimestamp();
        if (_lastMetadataCaptureTimestamp != 0 &&
            captureTimestamp - _lastMetadataCaptureTimestamp < Stopwatch.Frequency)
        {
            return;
        }

        _lastMetadataCaptureTimestamp = captureTimestamp;
        try
        {
            CapturePlayerMetadata(match);
        }
        catch (Exception ex)
        {
            var now = Stopwatch.GetTimestamp();
            if (now - _lastMetadataFailureTimestamp >= Stopwatch.Frequency * 5)
            {
                _lastMetadataFailureTimestamp = now;
                PluginLogger.Warning($"Unable to capture player name metadata: {ex.Message}");
            }
        }
    }

    private void CapturePlayerMetadata(nint match)
    {
        if (!_timeline.NeedsPlayerMetadata ||
            !_candidates.TryGetValue(match, out var state) ||
            !state.HasActiveRecord)
        {
            return;
        }

        var source = state.LastActiveRecord;
        var metadata = new List<RealtimePlayerMetadata>(source.PlayerCount);
        for (var slot = 0; slot < Math.Min(source.PlayerCount, (byte)RawRealtimeTickFrame.MaxPlayers); slot++)
        {
            var pointerSlot = match + Offsets.GameMatch.FirstMatchPlayer + slot * IntPtr.Size;
            if (!_memoryReader.TryReadPointer(pointerSlot, out var matchPlayer) || matchPlayer == default)
            {
                continue;
            }

            _memoryReader.TryReadPointer(matchPlayer + Offsets.MatchPlayer.Person, out var person);
            _memoryReader.TryReadPointer(matchPlayer + Offsets.MatchPlayer.Stats, out var stats);
            _memoryReader.TryReadPointer(person + Offsets.Person.FullContract, out var fullContract);
            var playerId = stats != default && _memoryReader.TryReadInt32(stats + Offsets.PlayerStats.Id, out var id)
                ? id
                : slot + 1;
            var playerUid = ReadUid(person + Offsets.Person.Uid);
            var shirtNumber = fullContract != default &&
                _memoryReader.TryReadByte(fullContract + Offsets.FullContract.SquadNumber, out var number) && number > 0
                    ? number
                    : (byte?)null;
            var team = stats != default && _memoryReader.TryReadByte(stats + Offsets.PlayerStats.TeamSideUnconfirmed, out var side) && side == 1
                ? TeamSide.Away
                : TeamSide.Home;

            var firstName = ReadPersonName(person, Offsets.Person.FirstName);
            var secondName = ReadPersonName(person, Offsets.Person.SecondName);
            var commonName = ReadPersonName(person, Offsets.Person.CommonName);
            var displayName = !string.IsNullOrWhiteSpace(commonName)
                ? commonName
                : string.Join(' ', new[] { firstName, secondName }.Where(value => !string.IsNullOrWhiteSpace(value))!);
            if (string.IsNullOrWhiteSpace(displayName))
            {
                displayName = $"Player {playerId}";
            }

            var positionFamiliarities = ReadPlayerPositionFamiliarities(person);

            metadata.Add(new RealtimePlayerMetadata(
                slot,
                playerId,
                playerUid,
                team,
                shirtNumber,
                FormatPlayerPosition(positionFamiliarities),
                firstName,
                secondName,
                commonName,
                displayName,
                null,
                ReadPlayerProfile(person, fullContract),
                ReadPlayerAttributes(person),
                ReadTacticalAssignment(matchPlayer, inPossession: true),
                ReadTacticalAssignment(matchPlayer, inPossession: false),
                positionFamiliarities));
        }

        if (metadata.Count > 0)
        {
            _memoryReader.TryReadPointer(match + Offsets.GameMatch.HomeTeam, out var homeTeam);
            _memoryReader.TryReadPointer(match + Offsets.GameMatch.AwayTeam, out var awayTeam);
            _timeline.SetMetadata(
                ReadTeamMetadata(homeTeam, "Home"),
                ReadTeamMetadata(awayTeam, "Away"),
                metadata);
        }
    }

    private PlayerTacticalAssignment? ReadTacticalAssignment(nint matchPlayer, bool inPossession)
    {
        var positionOffset = inPossession
            ? Offsets.MatchPlayer.InPossessionPosition
            : Offsets.MatchPlayer.OutOfPossessionPosition;
        var roleOffset = inPossession
            ? Offsets.MatchPlayer.InPossessionRoleDuty
            : Offsets.MatchPlayer.OutOfPossessionRoleDuty;

        return _memoryReader.TryReadUInt32(matchPlayer + positionOffset, out var positionMask) &&
               _memoryReader.TryReadUInt64(matchPlayer + roleOffset, out var roleDuty)
            ? TacticalFormationDecoder.Decode(positionMask, roleDuty, inPossession)
            : null;
    }

    private RealtimeTeamMetadata ReadTeamMetadata(nint team, string fallbackName)
    {
        _memoryReader.TryReadPointer(team + Offsets.Team.DbTeam, out var dbTeam);
        _memoryReader.TryReadPointer(dbTeam + Offsets.DbTeam.Club, out var club);

        return new RealtimeTeamMetadata(
            ReadUid(dbTeam + Offsets.DbTeam.Uid),
            ReadUid(club + Offsets.Club.Uid),
            ReadInlineNameInstance(club, Offsets.Club.ShortName) ?? fallbackName,
            ReadUInt32(team + Offsets.Team.BackgroundColour),
            ReadUInt32(team + Offsets.Team.ForegroundColour),
            ReadUInt32(team + Offsets.Team.OutlineColour),
            null);
    }

    private IReadOnlyDictionary<string, int>? ReadPlayerPositionFamiliarities(nint person)
    {
        if (person == default)
        {
            return null;
        }

        var actualPlayer = person + Offsets.Person.ActualPlayerDelta;
        var familiarities = new Dictionary<string, int>(PlayerPositionFamiliarity.Labels.Length, StringComparer.Ordinal);
        for (var index = 0; index < PlayerPositionFamiliarity.Labels.Length; index++)
        {
            if (_memoryReader.TryReadByte(actualPlayer + Offsets.ActualPlayer.PositionGk + index, out var value))
            {
                familiarities[PlayerPositionFamiliarity.Labels[index]] = value;
            }
        }

        return familiarities.Count > 0 ? familiarities : null;
    }

    private static string? FormatPlayerPosition(IReadOnlyDictionary<string, int>? familiarities)
    {
        if (familiarities is null || familiarities.Count == 0) return null;

        var bestValue = 0;
        string? bestLabel = null;
        foreach (var label in PlayerPositionFamiliarity.Labels)
        {
            if (!familiarities.TryGetValue(label, out var value)) continue;

            if (value > bestValue)
            {
                bestValue = value;
                bestLabel = label;
            }
        }

        return bestValue > 0 ? bestLabel : null;
    }

    private PlayerProfile? ReadPlayerProfile(nint person, nint fullContract)
    {
        if (person == default)
        {
            return null;
        }

        var actualPlayer = person + Offsets.Person.ActualPlayerDelta;
        var profile = new PlayerProfile(
            ReadPositiveInt32(fullContract + Offsets.FullContract.WeeklyWage),
            ReadPositiveInt16(actualPlayer + Offsets.ActualPlayer.Height),
            ReadPositiveInt16(actualPlayer + Offsets.ActualPlayer.Condition),
            ReadPositiveInt16(actualPlayer + Offsets.ActualPlayer.Morale),
            ReadPositiveInt16(actualPlayer + Offsets.ActualPlayer.CurrentAbility),
            ReadPositiveInt16(actualPlayer + Offsets.ActualPlayer.PotentialAbility),
            ReadPositiveInt16(actualPlayer + Offsets.ActualPlayer.CurrentReputation));
        return profile.WeeklyWage.HasValue || profile.HeightCm.HasValue || profile.Condition.HasValue || profile.Morale.HasValue
            ? profile
            : null;
    }

    private PlayerAttributes? ReadPlayerAttributes(nint person)
    {
        if (person == default)
        {
            return null;
        }

        var player = person + Offsets.Person.ActualPlayerDelta;
        var attributes = new PlayerAttributes(
            new Dictionary<string, int>
            {
                ["Crossing"] = ReadAttribute(player, Offsets.ActualPlayer.Crossing),
                ["Dribbling"] = ReadAttribute(player, Offsets.ActualPlayer.Dribbling),
                ["Finishing"] = ReadAttribute(player, Offsets.ActualPlayer.Finishing),
                ["First Touch"] = ReadAttribute(player, Offsets.ActualPlayer.FirstTouch),
                ["Heading"] = ReadAttribute(player, Offsets.ActualPlayer.Heading),
                ["Long Shots"] = ReadAttribute(player, Offsets.ActualPlayer.LongShots),
                ["Marking"] = ReadAttribute(player, Offsets.ActualPlayer.Marking),
                ["Passing"] = ReadAttribute(player, Offsets.ActualPlayer.Passing),
                ["Penalty Taking"] = ReadAttribute(player, Offsets.ActualPlayer.PenaltyTaking),
                ["Tackling"] = ReadAttribute(player, Offsets.ActualPlayer.Tackling),
                ["Technique"] = ReadAttribute(player, Offsets.ActualPlayer.Technique),
                ["Corners"] = ReadAttribute(player, Offsets.ActualPlayer.Corners),
                ["Free Kicks"] = ReadAttribute(player, Offsets.ActualPlayer.FreeKicks),
                ["Long Throws"] = ReadAttribute(player, Offsets.ActualPlayer.LongThrows),
            },
            new Dictionary<string, int>
            {
                ["Aggression"] = ReadAttribute(player, Offsets.ActualPlayer.Aggression),
                ["Anticipation"] = ReadAttribute(player, Offsets.ActualPlayer.Anticipation),
                ["Bravery"] = ReadAttribute(player, Offsets.ActualPlayer.Bravery),
                ["Composure"] = ReadAttribute(player, Offsets.ActualPlayer.Composure),
                ["Concentration"] = ReadAttribute(player, Offsets.ActualPlayer.Concentration),
                ["Decisions"] = ReadAttribute(player, Offsets.ActualPlayer.Decisions),
                ["Determination"] = ReadAttribute(player, Offsets.ActualPlayer.Determination),
                ["Flair"] = ReadAttribute(player, Offsets.ActualPlayer.Flair),
                ["Leadership"] = ReadAttribute(player, Offsets.ActualPlayer.Leadership),
                ["Off The Ball"] = ReadAttribute(player, Offsets.ActualPlayer.OffTheBall),
                ["Positioning"] = ReadAttribute(player, Offsets.ActualPlayer.Positioning),
                ["Teamwork"] = ReadAttribute(player, Offsets.ActualPlayer.Teamwork),
                ["Vision"] = ReadAttribute(player, Offsets.ActualPlayer.Vision),
                ["Work Rate"] = ReadAttribute(player, Offsets.ActualPlayer.WorkRate),
            },
            new Dictionary<string, int>
            {
                ["Acceleration"] = ReadAttribute(player, Offsets.ActualPlayer.Acceleration),
                ["Agility"] = ReadAttribute(player, Offsets.ActualPlayer.Agility),
                ["Balance"] = ReadAttribute(player, Offsets.ActualPlayer.Balance),
                ["Jumping Reach"] = ReadAttribute(player, Offsets.ActualPlayer.JumpingReach),
                ["Natural Fitness"] = ReadAttribute(player, Offsets.ActualPlayer.NaturalFitness),
                ["Pace"] = ReadAttribute(player, Offsets.ActualPlayer.Pace),
                ["Stamina"] = ReadAttribute(player, Offsets.ActualPlayer.Stamina),
                ["Strength"] = ReadAttribute(player, Offsets.ActualPlayer.Strength),
            },
            new Dictionary<string, int>
            {
                ["Aerial Reach"] = ReadAttribute(player, Offsets.ActualPlayer.AerialReach),
                ["Command Of Area"] = ReadAttribute(player, Offsets.ActualPlayer.CommandOfArea),
                ["Communication"] = ReadAttribute(player, Offsets.ActualPlayer.Communication),
                ["Eccentricity"] = ReadAttribute(player, Offsets.ActualPlayer.Eccentricity),
                ["Handling"] = ReadAttribute(player, Offsets.ActualPlayer.Handling),
                ["Kicking"] = ReadAttribute(player, Offsets.ActualPlayer.Kicking),
                ["One On Ones"] = ReadAttribute(player, Offsets.ActualPlayer.OneOnOnes),
                ["Punching"] = ReadAttribute(player, Offsets.ActualPlayer.Punching),
                ["Reflexes"] = ReadAttribute(player, Offsets.ActualPlayer.Reflexes),
                ["Rushing Out"] = ReadAttribute(player, Offsets.ActualPlayer.RushingOut),
                ["Throwing"] = ReadAttribute(player, Offsets.ActualPlayer.Throwing),
            });
        return attributes.Technical.Values.Any(value => value > 0) ||
               attributes.Mental.Values.Any(value => value > 0) ||
               attributes.Physical.Values.Any(value => value > 0) ||
               attributes.Goalkeeping.Values.Any(value => value > 0)
            ? attributes
            : null;
    }

    private int ReadAttribute(nint player, int offset)
    {
        return _memoryReader.TryReadByte(player + offset, out var value) && value <= 100 ? value : 0;
    }

    private int? ReadPositiveInt16(nint address)
    {
        return _memoryReader.TryReadInt16(address, out var value) && value > 0 ? value : null;
    }

    private int? ReadPositiveInt32(nint address)
    {
        return _memoryReader.TryReadInt32(address, out var value) && value > 0 ? value : null;
    }

    private uint? ReadUid(nint address)
    {
        return ReadUInt32(address);
    }

    private uint? ReadUInt32(nint address)
    {
        return _memoryReader.TryReadUInt32(address, out var value) && value != 0 ? value : null;
    }

    private string? ReadPersonName(nint person, int fieldOffset)
    {
        // CE chain: MATCH_PLAYER -> +0x28 PERSON -> +nameOffset name object
        // -> +0 character buffer -> +0x4 zero-terminated UTF-8 text.
        return ReadName(person, fieldOffset);
    }

    private string? ReadName(nint owner, int fieldOffset)
    {
        if (owner == default ||
            !_memoryReader.TryReadPointer(owner + fieldOffset, out var nameObject) ||
            nameObject == default ||
            !_memoryReader.TryReadPointer(nameObject + Offsets.Name.CharacterBuffer, out var characterBuffer) ||
            characterBuffer == default)
        {
            return null;
        }

        var textAddress = characterBuffer + Offsets.Name.Text;
        if (!VirtualMemory.IsReadable(textAddress, Offsets.Name.MaxLength))
        {
            return null;
        }

        var bytes = new byte[Offsets.Name.MaxLength];
        Marshal.Copy(textAddress, bytes, 0, bytes.Length);
        var length = Array.IndexOf(bytes, (byte)0);
        if (length < 0)
        {
            length = bytes.Length;
        }

        try
        {
            var value = new UTF8Encoding(false, true).GetString(bytes, 0, length);
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }
        catch (DecoderFallbackException)
        {
            var value = Encoding.Latin1.GetString(bytes, 0, length);
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }
    }

    private string? ReadInlineNameInstance(nint owner, int fieldOffset)
    {
        // CLUB_SHORT_NAME is [CLUB + fieldOffset] -> instance, with inline text at instance + 0x4.
        if (owner == default ||
            !_memoryReader.TryReadPointer(owner + fieldOffset, out var nameInstance) ||
            nameInstance == default)
        {
            return null;
        }

        return ReadText(nameInstance + Offsets.Name.Text);
    }

    private static string? ReadText(nint textAddress)
    {
        if (!VirtualMemory.IsReadable(textAddress, Offsets.Name.MaxLength))
        {
            return null;
        }

        var bytes = new byte[Offsets.Name.MaxLength];
        Marshal.Copy(textAddress, bytes, 0, bytes.Length);
        var length = Array.IndexOf(bytes, (byte)0);
        if (length < 0)
        {
            length = bytes.Length;
        }

        try
        {
            var value = new UTF8Encoding(false, true).GetString(bytes, 0, length);
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }
        catch (DecoderFallbackException)
        {
            var value = Encoding.Latin1.GetString(bytes, 0, length);
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }
    }

    private void DrainTickRecords()
    {
        if (Interlocked.Exchange(ref _isDrainingTickRecords, 1) == 1)
        {
            return;
        }

        try
        {
            var count = _tickRecords.Drain(_drainBatch);
            if (count == 0)
            {
                DrainRealtimeFrames();
                ReportDroppedRecords();
                return;
            }

            for (var i = 0; i < count; i++)
            {
                ObserveCandidate(_drainBatch[i]);
            }

            var (simulation, animated) = ClassifyCandidates(_drainBatch[count - 1].CapturedTimestamp);
            if (simulation != default && animated != default && IsLikelyRealtimeAnimated(animated, _drainBatch[count - 1].CapturedTimestamp))
            {
                _stableSimulation = simulation;
                _stableAnimated = animated;
                if ((nint)Interlocked.Read(ref _selectedAnimated) != animated)
                {
                    // Pre-selection candidate frames may already have been released.
                    // Force the first selected callback to replay every published native event
                    // currently retained by the event vector.
                    lock (_nativeMomentumGate)
                    {
                        _nativeMomentumStates.Remove(animated);
                    }
                }
                Interlocked.Exchange(ref _selectedAnimated, (long)animated);
                _timeline.Begin(animated);
                TryCapturePlayerMetadata(animated);
            }

            DrainRealtimeFrames();

            for (var i = 0; i < count; i++)
            {
                ReportMatchEnded(_drainBatch[i]);
            }

            ReportCandidateSummary(simulation, animated, _drainBatch[count - 1].CapturedTimestamp);
            ReportDroppedRecords();
        }
        catch (Exception ex)
        {
            PluginLogger.Warning($"Unable to drain GAME_MATCH tick records: {ex.Message}");
        }
        finally
        {
            Interlocked.Exchange(ref _isDrainingTickRecords, 0);
        }
    }

    private void DrainRealtimeFrames()
    {
        var count = _realtimeFrames.Drain(_realtimeDrainBatch);
        if (count == 0)
        {
            return;
        }

        try
        {
            var selectedAnimated = (nint)Interlocked.Read(ref _selectedAnimated);
            if (selectedAnimated == default)
            {
                return;
            }

            // Native callbacks can complete on different threads. Sort the drained
            // window so a later callback cannot make us reject an earlier tick.
            Array.Sort(_realtimeDrainBatch, 0, count, RawFrameTickComparer.Instance);
            for (var i = 0; i < count; i++)
            {
                var frame = _realtimeDrainBatch[i];
                if (frame.MatchAddress == selectedAnimated)
                {
                    _timeline.Append(frame);
                }
            }
        }
        finally
        {
            _realtimeFrames.Release(_realtimeDrainBatch, count);
        }
    }

    private void ObserveCandidate(in GameMatchTickRecord record)
    {
        if (!_candidates.TryGetValue(record.MatchAddress, out var state))
        {
            state = new CandidateState();
            _candidates.Add(record.MatchAddress, state);
        }
        else if (!record.IsTerminal && ObserveTickEpochReset(state, record.Tick))
        {
            var previousTick = state.LastTick;
            var belongsToCurrentSession = record.MatchAddress == _stableSimulation ||
                                          record.MatchAddress == _stableAnimated ||
                                          record.MatchAddress == (nint)Interlocked.Read(ref _selectedAnimated);
            PluginLogger.Debug(
                $"GAME_MATCH tick epoch reset detected: match={FormatPointer(record.MatchAddress)}, " +
                $"previousTick={previousTick}, newTick={record.Tick}, " +
                $"currentSession={belongsToCurrentSession}.");

            if (belongsToCurrentSession)
            {
                FinalizeTimelineForEpochReset(record.MatchAddress, previousTick, record.Tick);
            }
            else
            {
                _candidates.Remove(record.MatchAddress);
            }

            state = new CandidateState();
            _candidates[record.MatchAddress] = state;
        }

        if (record.IsTerminal)
        {
            state.IsTerminal = true;
            state.TerminalTick = record.Tick;
            state.LastSeenTimestamp = record.CapturedTimestamp;
            return;
        }

        if (!state.HasTick)
        {
            state.FirstTick = record.Tick;
            state.FirstSeenTimestamp = record.CapturedTimestamp;
        }

        if (state.HasTick && record.Tick > state.LastTick + 1)
        {
            state.GapCount += record.Tick - state.LastTick - 1;
        }
        else if (state.HasTick && record.Tick <= state.LastTick)
        {
            state.OutOfOrderCount++;
        }

        if (!state.HasTick || record.Tick > state.LastTick)
        {
            state.LastTick = record.Tick;
            state.LastAdvanceTimestamp = record.CapturedTimestamp;
        }

        state.HasTick = true;
        state.LastSeenTimestamp = record.CapturedTimestamp;
        state.RecordCount++;
        state.LastActiveRecord = record;
        state.HasActiveRecord = true;
    }

    private static bool ObserveTickEpochReset(CandidateState state, int tick)
    {
        var isLowTickAfterCompletedMatch = state.HasTick &&
                                           state.LastTick >= PreviousMatchTickForEpochReset &&
                                           tick is >= 0 and <= NewMatchTickForEpochReset;
        if (!isLowTickAfterCompletedMatch)
        {
            state.EpochResetProbeCount = 0;
            state.EpochResetFirstTick = 0;
            state.EpochResetMaxTick = 0;
            return false;
        }

        if (state.EpochResetProbeCount == 0)
        {
            state.EpochResetFirstTick = tick;
            state.EpochResetMaxTick = tick;
        }
        else
        {
            state.EpochResetMaxTick = Math.Max(state.EpochResetMaxTick, tick);
        }

        state.EpochResetProbeCount++;
        return state.EpochResetProbeCount >= EpochResetConfirmationRecords &&
               state.EpochResetMaxTick > state.EpochResetFirstTick;
    }

    private void FinalizeTimelineForEpochReset(nint resetAddress, int previousTick, int newTick)
    {
        var selectedAnimated = (nint)Interlocked.Exchange(ref _selectedAnimated, 0);
        if (selectedAnimated != default)
        {
            _timeline.MarkEnded(selectedAnimated);
            var timelineStatus = _timeline.GetStatus();
            PluginLogger.Debug(
                $"GAME_MATCH realtime timeline finalized by tick epoch reset: " +
                $"resetMatch={FormatPointer(resetAddress)}, selectedAnimated={FormatPointer(selectedAnimated)}, " +
                $"tick={previousTick}->{newTick}, frames={timelineStatus.FrameCount}, " +
                $"lastTick={timelineStatus.LastTick}.");
        }

        ResetCandidateSession("tick epoch reset");
    }

    private void ReportMatchEnded(in GameMatchTickRecord record)
    {
        if (!record.IsTerminal ||
            (record.MatchAddress != _stableSimulation && record.MatchAddress != _stableAnimated) ||
            !_candidates.TryGetValue(record.MatchAddress, out var state) ||
            !state.HasActiveRecord)
        {
            return;
        }

        if (_lastReportedEndTick == record.Tick &&
            record.CapturedTimestamp - _lastReportedEndTimestamp < Stopwatch.Frequency * 5)
        {
            return;
        }

        _lastReportedEndTick = record.Tick;
        _lastReportedEndTimestamp = record.CapturedTimestamp;
        var final = state.LastActiveRecord;
        PluginLogger.Info(
            $"GAME_MATCH ended: score={final.HomeGoals}-{final.AwayGoals}, " +
            $"xg={final.HomeXg:0.000}-{final.AwayXg:0.000}, shots={final.HomeShots}-{final.AwayShots}.");
        PluginLogger.Debug(
            $"GAME_MATCH end details: match={FormatPointer(record.MatchAddress)}, terminalTick={record.Tick}, " +
            $"finalDataTick={final.Tick}, period={record.Period}, " +
            $"runtimeTeams={FormatPointer(record.HomeTeam)}/{FormatPointer(record.AwayTeam)}, " +
            $"lifecycleStates={record.State142F8}/{record.State142F9}/{record.State142FA}/{record.State142FB}.");

        if (record.MatchAddress == _stableAnimated)
        {
            // Stop native callbacks from queuing more frames for the completed
            // animated instance before the archive is finalized.
            Interlocked.CompareExchange(ref _selectedAnimated, 0, (long)record.MatchAddress);
            _timeline.MarkEnded(record.MatchAddress);
            var timelineStatus = _timeline.GetStatus();
            PluginLogger.Debug(
                $"GAME_MATCH realtime timeline finalized: frames={timelineStatus.FrameCount}, " +
                $"lastTick={timelineStatus.LastTick}, missingTicks={timelineStatus.MissingTickCount}, " +
                $"duplicates={timelineStatus.DuplicateTickCount}, outOfOrder={timelineStatus.OutOfOrderTickCount}.");
            ResetCandidateSession("full time");
        }
    }

    private void ResetCandidateSession(string reason)
    {
        _candidates.Clear();
        lock (_nativeMomentumGate)
        {
            _nativeMomentumStates.Clear();
        }
        _stableSimulation = default;
        _stableAnimated = default;
        Interlocked.Exchange(ref _selectedAnimated, 0);
        _lastReportedSimulation = default;
        _lastReportedAnimated = default;
        _lastCandidateSummaryTimestamp = 0;
        _lastMetadataCaptureTimestamp = 0;
        PluginLogger.Debug($"GAME_MATCH candidate session cleared after {reason}; reused addresses may start a new match.");
    }

    private (nint Simulation, nint Animated) ClassifyCandidates(long now)
    {
        var recentThreshold = now - Stopwatch.Frequency * 2;
        nint simulation = default;
        var simulationTick = int.MinValue;

        foreach (var pair in _candidates)
        {
            var state = pair.Value;
            if (state.LastAdvanceTimestamp >= recentThreshold && state.LastTick > simulationTick)
            {
                simulation = pair.Key;
                simulationTick = state.LastTick;
            }
        }

        nint animated = default;
        var bestDeltaError = int.MaxValue;
        foreach (var pair in _candidates)
        {
            if (pair.Key == simulation || pair.Value.LastAdvanceTimestamp < recentThreshold)
            {
                continue;
            }

            var deltaError = Math.Abs((simulationTick - pair.Value.LastTick) - 360);
            if (deltaError < bestDeltaError)
            {
                bestDeltaError = deltaError;
                animated = pair.Key;
            }
        }

        if (bestDeltaError > 16)
        {
            animated = default;
        }

        return (simulation, animated);
    }

    private bool IsLikelyRealtimeAnimated(nint animated, long now)
    {
        if (!_candidates.TryGetValue(animated, out var state) || !state.HasTick)
        {
            return false;
        }

        var elapsedTicks = now - state.FirstSeenTimestamp;
        if (elapsedTicks < Stopwatch.Frequency * CandidatePaceObservationSeconds)
        {
            return false;
        }

        var elapsedSeconds = elapsedTicks / (double)Stopwatch.Frequency;
        var ticksPerSecond = Math.Max(0, state.LastTick - state.FirstTick) / elapsedSeconds;
        return ticksPerSecond <= CandidateRealtimeMaxTicksPerSecond;
    }

    private void ReportCandidateSummary(nint simulation, nint animated, long now)
    {
        if (!PluginLogger.IsDebugEnabled)
        {
            return;
        }

        var selectionChanged = simulation != _lastReportedSimulation || animated != _lastReportedAnimated;
        if (!selectionChanged && now - _lastCandidateSummaryTimestamp < Stopwatch.Frequency)
        {
            return;
        }

        _lastReportedSimulation = simulation;
        _lastReportedAnimated = animated;
        _lastCandidateSummaryTimestamp = now;

        var simulationTick = simulation != default && _candidates.TryGetValue(simulation, out var simulationState)
            ? simulationState.LastTick
            : 0;
        var animatedTick = animated != default && _candidates.TryGetValue(animated, out var animatedState)
            ? animatedState.LastTick
            : 0;
        var delta = animated == default ? 0 : simulationTick - animatedTick;

        PluginLogger.Debug(
            $"GAME_MATCH candidate selection: simulation={FormatPointer(simulation)} tick={simulationTick}, " +
            $"animated={FormatPointer(animated)} tick={animatedTick}, delta={delta}.");

        foreach (var pair in _candidates)
        {
            var state = pair.Value;
            PluginLogger.Debug(
                $"GAME_MATCH candidate health: match={FormatPointer(pair.Key)}, tick={state.LastTick}, " +
                $"records={state.RecordCount}, missingTicks={state.GapCount}, outOfOrder={state.OutOfOrderCount}.");
        }
    }

    private void ReportDroppedRecords()
    {
        var dropped = _tickRecords.Dropped;
        if (dropped != _lastReportedDropped)
        {
            _lastReportedDropped = dropped;
            PluginLogger.Warning($"GAME_MATCH tick record buffer dropped records: total={dropped}.");
        }

        var realtimeDropped = _realtimeFrames.Dropped;
        if (realtimeDropped != _lastReportedRealtimeDropped)
        {
            _lastReportedRealtimeDropped = realtimeDropped;
            PluginLogger.Warning($"GAME_MATCH realtime frame buffer dropped records: total={realtimeDropped}.");
        }
    }

    private static string FormatPointer(nint address)
    {
        return address == default ? "0x0" : $"0x{(long)address:X}";
    }

    // ABI note: this matches the current Ghidra decompile:
    // ulonglong FUN_183e08ad0(longlong param_1, ulonglong param_2).
    // The function returns uVar23 & 0xffffffff, but the native ABI return register is RAX.
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate ulong MatchUpdateDelegate(nint match, ulong param2);

    private sealed class CandidateState
    {
        public bool HasTick;
        public int FirstTick;
        public long FirstSeenTimestamp;
        public long LastAdvanceTimestamp;
        public int LastTick;
        public long LastSeenTimestamp;
        public long RecordCount;
        public long GapCount;
        public long OutOfOrderCount;
        public bool IsTerminal;
        public int TerminalTick;
        public bool HasActiveRecord;
        public GameMatchTickRecord LastActiveRecord;
        public int EpochResetProbeCount;
        public int EpochResetFirstTick;
        public int EpochResetMaxTick;
    }

    private sealed class NativeMomentumCaptureState
    {
        public nint Source;
        public nint Begin;
        public int EventCount;
        public ulong LastSignature;
    }

    private sealed class RawFrameTickComparer : IComparer<RawRealtimeTickFrame>
    {
        public static readonly RawFrameTickComparer Instance = new();

        public int Compare(RawRealtimeTickFrame? left, RawRealtimeTickFrame? right)
        {
            if (ReferenceEquals(left, right))
            {
                return 0;
            }

            if (left is null)
            {
                return 1;
            }

            if (right is null)
            {
                return -1;
            }

            var addressComparison = ((long)left.MatchAddress).CompareTo((long)right.MatchAddress);
            return addressComparison != 0
                ? addressComparison
                : left.Tick != right.Tick
                    ? left.Tick.CompareTo(right.Tick)
                    : left.Sequence.CompareTo(right.Sequence);
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern nint GetModuleHandle(string moduleName);
}
