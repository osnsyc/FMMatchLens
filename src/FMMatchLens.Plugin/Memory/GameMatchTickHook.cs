using BepInEx.Unity.IL2CPP.Hook;
using FMMatchLens.Plugin.Diagnostics;
using FMMatchLens.Plugin.Domain;
using FMMatchLens.Plugin.Services;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace FMMatchLens.Plugin.Memory;

internal sealed class GameMatchTickHook : IDisposable
{
    private const int CandidateRealtimeMaxTicksPerSecond = 240;
    private const int CandidatePaceObservationSeconds = 2;
    private const int CandidateIdentityRetryMilliseconds = 500;
    private const int CandidatePairConfirmationCount = 3;
    private const int CandidateRecentSeconds = 2;
    private const int CandidateExpectedTickDelta = 360;
    private const int CandidateTickDeltaTolerance = 16;
    private const int LockHealthLogSeconds = 5;
    private const int DrainHealthLogSeconds = 5;
    private const int DrainStallWarningSeconds = 2;
    private const int LockedAnimationTerminalProbeSeconds = 30;
    private const int MaxPendingDiagnosticMessages = 256;
    private const int MaxDiagnosticMessagesPerFlush = 128;
    private const int PreLockCaptureMaxTick = 2_048;
    private const int RealtimeFrameBufferCapacity = 8_192;
    private const int PreLockFramePoolReserve = 1_024;
    private const int MaxPreLockCachedFrames = RealtimeFrameBufferCapacity - PreLockFramePoolReserve;
    private const int MaxPreLockCachedFramesPerCandidate = PreLockCaptureMaxTick + 1;
    private const int PreviousMatchTickForEpochReset = 12_000;
    private const int NewMatchTickForEpochReset = 4_096;
    private const int EpochResetConfirmationRecords = 3;
    // Only the newest four native trajectory points are retained. If the native
    // vector is longer, earlier path segments and turns are intentionally lost;
    // the event anchor remains available separately as the logical action origin.
    // Keep this limit in sync with ArchiveFrameCodec.MaxTrajectoryPoints.
    private const int MaxStoredMomentumTrajectoryPoints = 4;
    private const int MonitoredMomentumEventCount = 4;

    private readonly RealtimeMatchTimeline _timeline;
    private readonly MatchUpdateDelegate _hookDelegate;
    private readonly MemoryReader _memoryReader = new();
    private readonly MomentumCalculator _momentumCalculator = new();
    private readonly GameMatchTickRecordBuffer _tickRecords = new(65_536);
    private readonly GameMatchTickRecord[] _drainBatch = new GameMatchTickRecord[2_048];
    private readonly RealtimeTickFrameBuffer _realtimeFrames = new(RealtimeFrameBufferCapacity);
    private readonly RawRealtimeTickFrame[] _realtimeDrainBatch = new RawRealtimeTickFrame[2_048];
    private readonly Dictionary<nint, CandidateState> _candidates = new();
    private readonly Dictionary<nint, PreLockFrameCache> _preLockFrames = new();
    private readonly Dictionary<nint, NativeMomentumCaptureState> _nativeMomentumStates = new();
    private readonly object _nativeMomentumGate = new();
    private readonly object _animatedUpdateGate = new();
    private readonly ConcurrentDictionary<nint, byte> _terminalMatches = new();
    private readonly ConcurrentQueue<PendingDiagnosticMessage> _pendingDiagnosticMessages = new();
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
    private long _lastLockHealthTimestamp;
    private long _lastReportedDropped;
    private long _lastReportedRealtimeDropped;
    private nint _lastReportedSimulation;
    private nint _lastReportedAnimated;
    private nint _stableSimulation;
    private nint _stableAnimated;
    private LocatorState _locatorState;
    private MatchFingerprint _pendingFingerprint;
    private nint _pendingSimulation;
    private nint _pendingAnimated;
    private int _pendingConfirmationCount;
    private long _pendingFirstTimestamp;
    private long _selectedAnimated;
    private int _lastReportedEndTick;
    private long _lastReportedEndTimestamp;
    private long _lastMetadataFailureTimestamp;
    private long _lastMetadataCaptureTimestamp;
    private long _drainSequence;
    private long _drainStartedTimestamp;
    private long _lastDrainCompletedTimestamp;
    private long _lastDrainHealthTimestamp;
    private long _lastDrainStallWarningTimestamp;
    private long _lastLockedAnimationTerminalProbeTimestamp;
    private long _droppedDiagnosticMessages;
    private long _lastReportedDroppedDiagnosticMessages;
    private long _droppedPreLockFrames;
    private long _lastReportedDroppedPreLockFrames;
    private int _preLockFrameCount;
    private int _pendingDiagnosticMessageCount;
    private int _drainStage;
    private int _isDrainingTickRecords;
    private int _isLoggingDiagnostics;
    private int _instructionOffset;
    private bool _started;
    private bool _unsupportedBuild;

    public GameMatchTickHook(RealtimeMatchTimeline timeline)
    {
        _timeline = timeline;
        _hookDelegate = MatchUpdateHook;
    }

    public bool IsStarted => _started;
    public bool ShouldRetry => !_unsupportedBuild;

    public bool Start(bool logModuleNotLoaded = true)
    {
        if (_started)
        {
            return true;
        }

        if (_unsupportedBuild)
        {
            return false;
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

        GamePluginBuild build;
        string modulePath;
        string sha256;
        try
        {
            if (!GamePluginBuildCatalog.TryResolve(moduleBase, out build, out modulePath, out sha256))
            {
                _unsupportedBuild = true;
                PluginLogger.Warning(
                    $"Unsupported game_plugin.dll build; GAME_MATCH hook was not installed. " +
                    $"sha256={sha256}, path={modulePath}");
                return false;
            }
        }
        catch (Exception ex)
        {
            if (logModuleNotLoaded)
            {
                PluginLogger.Warning($"Unable to identify game_plugin.dll build: {ex.Message}");
            }

            return false;
        }

        _instructionOffset = build.MatchTickHookRva;
        _targetAddress = moduleBase + _instructionOffset;

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
            Interlocked.Exchange(ref _lastDrainCompletedTimestamp, Stopwatch.GetTimestamp());
            // This timer is also the non-critical log pump. Keep it alive in
            // release mode so queued lifecycle warnings never run on the native
            // hook or tick-drain threads.
            _diagnosticsTimer = new Timer(
                _ => LogDiagnostics(),
                null,
                TimeSpan.FromSeconds(1),
                TimeSpan.FromSeconds(1));
            _tickDrainTimer = new Timer(
                _ => DrainTickRecords(),
                null,
                TimeSpan.FromMilliseconds(100),
                TimeSpan.FromMilliseconds(100));
            PluginLogger.Debug(
                $"GAME_MATCH match-update post hook installed with permanent native trampoline at " +
                $"game_plugin.dll+0x{_instructionOffset:X} ({FormatPointer(_targetAddress)}), " +
                $"trampoline={FormatPointer(_detour.TrampolinePtr)}.");
            PluginLogger.Info(
                $"GAME_MATCH match-update hook installed for {build.Distribution} build " +
                $"(sha256={build.Sha256}, rva=0x{build.MatchTickHookRva:X}).");
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
                QueueDiagnostic(DiagnosticSeverity.Error, $"GAME_MATCH match-update hook failed: {ex}");
            }
            catch
            {
                // Diagnostics are best-effort inside a native callback.
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
                (selectedAnimated == match ||
                 (selectedAnimated == default && record.Tick is >= 0 and <= PreLockCaptureMaxTick)))
            {
                TryCaptureRealtimeFrame(record);
            }
        }

        return result;
    }

    private void LogDiagnostics()
    {
        if (Interlocked.Exchange(ref _isLoggingDiagnostics, 1) == 1)
        {
            return;
        }

        try
        {
            if (PluginLogger.IsDebugEnabled)
            {
                var callCount = Interlocked.Read(ref _callCount);
                var previous = Interlocked.Exchange(ref _lastLoggedCallCount, callCount);
                if (callCount != previous)
                {
                    var match = (nint)Interlocked.Read(ref _lastMatch);
                    var param2 = unchecked((ulong)Interlocked.Read(ref _lastParam2));
                    var result = unchecked((ulong)Interlocked.Read(ref _lastResult));
                    PluginLogger.Debug(
                        $"GAME_MATCH hook alive: calls={callCount}, callsSinceLastLog={callCount - previous}, " +
                        $"match={FormatPointer(match)}, param2=0x{param2:X}, result=0x{result:X}.");
                }
            }

            FlushPendingDiagnostics();
            ReportDrainHealth(Stopwatch.GetTimestamp());
        }
        catch (Exception ex)
        {
            PluginLogger.Warning($"Unable to write GAME_MATCH hook diagnostics: {ex.Message}");
        }
        finally
        {
            Interlocked.Exchange(ref _isLoggingDiagnostics, 0);
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

        var isActive = homeTeam != default && awayTeam != default && homeTeam != awayTeam &&
                       playerCount is > 0 and <= 64;
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
            ResolveMomentumEventPlayerIds(frame, record.HomeTeam, record.AwayTeam);

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
                start = state.EventCount;
                // A later shot/result may backfill any of the four former tail
                // records. Only re-publish from the earliest one that changed.
                for (var eventIndex = state.SignatureStart;
                     eventIndex < state.SignatureStart + state.SignatureCount;
                     eventIndex++)
                {
                    var signature = ReadNativeEventSignature(begin + eventIndex * Offsets.MomentumEvent.Size);
                    if (!state.TryGetSignature(eventIndex, out var previousSignature) ||
                        signature != previousSignature)
                    {
                        start = Math.Min(start, eventIndex);
                    }
                }
            }
            else
            {
                var monitoredStart = Math.Max(0, eventCount - MonitoredMomentumEventCount);
                for (var eventIndex = monitoredStart; eventIndex < eventCount; eventIndex++)
                {
                    var signature = ReadNativeEventSignature(begin + eventIndex * Offsets.MomentumEvent.Size);
                    if (!state.TryGetSignature(eventIndex, out var previousSignature) ||
                        signature != previousSignature)
                    {
                        start = Math.Min(start, eventIndex);
                    }
                }
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
                    if (rawTeam > (byte)TeamSide.Away) continue;
                    TryReadMomentumEventTrajectory(address, out var trajectoryPoints);
                    frame.MomentumEvents[frame.MomentumEventCount++] = new NativeMomentumEventData(
                        EventIndex: eventIndex,
                        Tick: unchecked((ushort)Marshal.ReadInt16(address + Offsets.MomentumEvent.Tick)),
                        LateralPosition: ReadFloatDirect(address + Offsets.MomentumEvent.LateralPosition),
                        LongitudinalPosition: ReadFloatDirect(address + Offsets.MomentumEvent.LongitudinalPosition),
                        TrajectoryPoints: trajectoryPoints,
                        Team: rawTeam == 0 ? TeamSide.Home : TeamSide.Away,
                        PlayerSlot: Marshal.ReadByte(address + Offsets.MomentumEvent.PlayerSlot),
                        PlayerId: 0,
                        ReceiverPlayerSlot: Marshal.ReadByte(address + Offsets.MomentumEvent.ReceiverPlayerSlot),
                        ReceiverPlayerId: 0,
                        EventType: eventType,
                        Flags: unchecked((ushort)Marshal.ReadInt16(address + Offsets.MomentumEvent.Flags)),
                        SequenceIndex: Marshal.ReadInt32(address + Offsets.MomentumEvent.SequenceIndex),
                        CompletionTick: unchecked((ushort)Marshal.ReadInt16(address + Offsets.MomentumEvent.CompletionTick)));
                }
            }

            state.Source = source;
            state.Begin = begin;
            state.EventCount = processedEventCount;
            state.UpdateSignatures(begin, processedEventCount);
        }
    }

    private static bool IsPublishedMomentumEventType(byte eventType)
    {
        // Preserve every output currently reachable from FUN_183cf0930. The UI
        // may ignore unnamed types, but archives retain them for later mapping.
        return eventType is >= Offsets.MomentumEvent.ShotGoal and <= Offsets.MomentumEvent.UnknownEvent55;
    }

    private static bool TryReadMomentumEventTrajectory(
        nint address,
        out NativeMomentumTrajectoryPoint[] points)
    {
        points = Array.Empty<NativeMomentumTrajectoryPoint>();

        if (!TryGetMomentumEventTrajectory(address, out var begin, out var nativeCount))
        {
            return false;
        }

        var storedCount = Math.Min(nativeCount, MaxStoredMomentumTrajectoryPoints);
        var result = new NativeMomentumTrajectoryPoint[storedCount];
        var firstStoredIndex = nativeCount - storedCount;
        for (var index = 0; index < storedCount; index++)
        {
            var sourceIndex = firstStoredIndex + index;
            var point = begin + sourceIndex * Offsets.MomentumEvent.TrajectoryPointSize;
            if (!VirtualMemory.IsReadable(point, Offsets.MomentumEvent.TrajectoryPointSize))
            {
                return false;
            }
            var lateral = ReadFloatDirect(point + Offsets.MomentumEventTrajectoryPoint.LateralPosition);
            var longitudinal = ReadFloatDirect(point + Offsets.MomentumEventTrajectoryPoint.LongitudinalPosition);
            if (!float.IsFinite(lateral) || !float.IsFinite(longitudinal) ||
                Math.Abs(lateral) > 1_000 || Math.Abs(longitudinal) > 1_000)
            {
                return false;
            }

            result[index] = new NativeMomentumTrajectoryPoint(lateral, longitudinal);
        }

        points = result;
        return true;
    }

    private static bool TryGetMomentumEventTrajectory(nint address, out nint begin, out int pointCount)
    {
        begin = Marshal.ReadIntPtr(address + Offsets.MomentumEvent.TrajectoryPointsBegin);
        var end = Marshal.ReadIntPtr(address + Offsets.MomentumEvent.TrajectoryPointsEnd);
        var length = (long)end - (long)begin;
        if (begin == default || length < Offsets.MomentumEvent.TrajectoryPointSize ||
            length % Offsets.MomentumEvent.TrajectoryPointSize != 0 || length > int.MaxValue)
        {
            pointCount = 0;
            return false;
        }

        pointCount = checked((int)(length / Offsets.MomentumEvent.TrajectoryPointSize));
        return true;
    }

    private void ResolveMomentumEventPlayerIds(
        RawRealtimeTickFrame frame,
        nint homeTeam,
        nint awayTeam)
    {
        for (var eventIndex = 0; eventIndex < frame.MomentumEventCount; eventIndex++)
        {
            var item = frame.MomentumEvents[eventIndex];
            var team = item.Team == TeamSide.Home ? homeTeam : awayTeam;
            var playerId = TryResolveMomentumEventPlayerId(team, item.PlayerSlot, out var actorId)
                ? actorId
                : 0;
            var receiverPlayerId = item.ReceiverPlayerSlot != byte.MaxValue &&
                                   TryResolveMomentumEventPlayerId(team, item.ReceiverPlayerSlot, out var receiverId)
                ? receiverId
                : 0;

            frame.MomentumEvents[eventIndex] = item with
            {
                PlayerId = playerId,
                ReceiverPlayerId = receiverPlayerId,
            };
        }
    }

    private bool TryResolveMomentumEventPlayerId(nint team, int slot, out long playerId)
    {
        playerId = 0;
        if (team == default || slot is < 0 or >= RawRealtimeTickFrame.MaxPlayers ||
            !_memoryReader.TryReadByte(team + Offsets.Team.PlayerCount, out var playerCount) ||
            slot >= playerCount ||
            !_memoryReader.TryReadPointer(team + Offsets.Team.PlayerTable + slot * IntPtr.Size, out var matchPlayer) ||
            matchPlayer == default ||
            !TryReadPlayerUid(matchPlayer, out var uid))
        {
            playerId = 0;
            return false;
        }

        playerId = uid;
        return true;
    }

    private static ulong ReadNativeEventSignature(nint address)
    {
        if (!VirtualMemory.IsReadable(address, Offsets.MomentumEvent.Size)) return 0;
        var hash = 1469598103934665603UL;
        hash = (hash ^ unchecked((ushort)Marshal.ReadInt16(address + Offsets.MomentumEvent.Tick))) * 1099511628211UL;
        hash = (hash ^ Marshal.ReadByte(address + Offsets.MomentumEvent.PlayerSlot)) * 1099511628211UL;
        hash = (hash ^ Marshal.ReadByte(address + Offsets.MomentumEvent.Team)) * 1099511628211UL;
        hash = (hash ^ Marshal.ReadByte(address + Offsets.MomentumEvent.ReceiverPlayerSlot)) * 1099511628211UL;
        hash = (hash ^ Marshal.ReadByte(address + Offsets.MomentumEvent.EventType)) * 1099511628211UL;
        hash = (hash ^ unchecked((uint)Marshal.ReadInt32(address + Offsets.MomentumEvent.SequenceIndex))) * 1099511628211UL;
        hash = (hash ^ unchecked((ushort)Marshal.ReadInt16(address + Offsets.MomentumEvent.Flags))) * 1099511628211UL;
        hash = (hash ^ unchecked((ushort)Marshal.ReadInt16(address + Offsets.MomentumEvent.CompletionTick))) * 1099511628211UL;
        hash = (hash ^ unchecked((uint)Marshal.ReadInt32(address + Offsets.MomentumEvent.LateralPosition))) * 1099511628211UL;
        hash = (hash ^ unchecked((uint)Marshal.ReadInt32(address + Offsets.MomentumEvent.LongitudinalPosition))) * 1099511628211UL;
        var trajectoryCount = TryGetMomentumEventTrajectory(address, out _, out var pointCount)
            ? unchecked((uint)pointCount)
            : uint.MaxValue;
        hash = (hash ^ trajectoryCount) * 1099511628211UL;
        return hash;
    }

    private bool TryReadPlayerFrame(nint matchPlayer, int slot, nint ballHolder, out PlayerTickData player)
    {
        player = default;
        if (!VirtualMemory.IsReadable(matchPlayer, Offsets.MatchPlayer.Stats + IntPtr.Size))
        {
            return false;
        }

        var stats = Marshal.ReadIntPtr(matchPlayer + Offsets.MatchPlayer.Stats);
        if (stats == default || !VirtualMemory.IsReadable(
                stats + Offsets.PlayerStats.NonUniqueMatchStatKey,
                Offsets.PlayerStats.ShotsFaced - Offsets.PlayerStats.NonUniqueMatchStatKey + 1))
        {
            return false;
        }

        var playerUid = TryReadPlayerUid(matchPlayer, out var uid) ? uid : (uint?)null;
        var playerId = playerUid.HasValue ? playerUid.Value : FallbackPlayerIdentity(slot);
        var team = ReadByteDirect(stats + Offsets.PlayerStats.TeamSideUnconfirmed) == 1 ? TeamSide.Away : TeamSide.Home;
        var starterFlag = ReadByteDirect(stats + Offsets.PlayerStats.StarterSubstituteFlag);
        var subbedOn = ReadByteDirect(stats + Offsets.PlayerStats.SubbedOnMinute);
        var subbedOff = ReadByteDirect(stats + Offsets.PlayerStats.SubbedOffMinute);

        player = new PlayerTickData(
            Slot: slot,
            PlayerId: playerId,
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
            SavesHeld: ReadByteDirect(stats + Offsets.PlayerStats.SavesHeld),
            SavesParried: ReadByteDirect(stats + Offsets.PlayerStats.SavesParried),
            SavesTipped: ReadByteDirect(stats + Offsets.PlayerStats.SavesTipped),
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
                QueueDiagnostic(DiagnosticSeverity.Warning, $"Unable to capture player name metadata: {ex.Message}");
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
        state.MatchDate ??= ReadTemporaryMatchDate(match);
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
            var playerUid = ReadUid(person + Offsets.Person.Uid);
            var playerId = playerUid.HasValue ? playerUid.Value : FallbackPlayerIdentity(slot);
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
                metadata,
                state.MatchDate);
        }
    }

    private bool TryReadPlayerUid(nint matchPlayer, out uint uid)
    {
        uid = 0;
        return matchPlayer != default &&
               _memoryReader.TryReadPointer(matchPlayer + Offsets.MatchPlayer.Person, out var person) &&
               person != default &&
               _memoryReader.TryReadUInt32(person + Offsets.Person.Uid, out uid) &&
               uid != 0;
    }

    private static long FallbackPlayerIdentity(int slot) => -(long)(slot + 1);

    private string? ReadTemporaryMatchDate(nint match)
    {
        // TODO: This is a temporary match-date solution. Reading the date from the
        // home team's schedule is sufficient for current metadata, but a direct,
        // authoritative field should be located in GAME_MATCH instead.
        if (!_memoryReader.TryReadPointer(match + Offsets.GameMatch.HomeTeam, out var homeTeam) ||
            homeTeam == default ||
            !_memoryReader.TryReadPointer(homeTeam + Offsets.Team.DbTeam, out var dbTeam) ||
            dbTeam == default ||
            !_memoryReader.TryReadPointer(dbTeam + Offsets.DbTeam.Schedule, out var schedule) ||
            schedule == default)
        {
            return null;
        }

        return ReadFmDate(schedule + Offsets.Schedule.CurrentMatch + Offsets.ScheduleMatch.Date);
    }

    private string? ReadFmDate(nint address)
    {
        if (!_memoryReader.TryReadUInt32(address, out var rawDate)) return null;

        var year = checked((int)(rawDate >> 16));
        var dayOfYear = checked((int)(rawDate & 0x1FF));
        if (year is < 1900 or > 2100 ||
            dayOfYear < 1 ||
            dayOfYear > (DateTime.IsLeapYear(year) ? 366 : 365))
        {
            return null;
        }

        return new DateTime(year, 1, 1)
            .AddDays(dayOfYear - 1)
            .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
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
            null,
            ReadManagerMetadata(team));
    }

    private RealtimeManagerMetadata? ReadManagerMetadata(nint team)
    {
        if (!TryReadManagerIdentity(team, out var person, out _, out var kind, out var uid) ||
            kind is not (ManagerKind.Human or ManagerKind.Staff))
        {
            return null;
        }

        return new RealtimeManagerMetadata(
            uid,
            ReadPersonName(person, Offsets.Person.FirstName),
            ReadPersonName(person, Offsets.Person.SecondName),
            kind == ManagerKind.Human);
    }

    private bool TryReadManagerIdentity(
        nint team,
        out nint person,
        out uint rttiOffset,
        out ManagerKind kind,
        out uint? uid)
    {
        person = default;
        rttiOffset = default;
        kind = ManagerKind.Unknown;
        uid = null;
        if (team == default ||
            !_memoryReader.TryReadPointer(team + Offsets.Team.Manager, out var manager) ||
            manager == default ||
            !_memoryReader.TryReadPointer(manager + Offsets.Manager.Person, out person) ||
            person == default ||
            !_memoryReader.TryReadPointer(person, out var virtualFunctionTable) ||
            virtualFunctionTable == default ||
            !_memoryReader.TryReadPointer(virtualFunctionTable + Offsets.Rtti.Metadata, out var rttiMetadata) ||
            rttiMetadata == default ||
            !_memoryReader.TryReadUInt32(rttiMetadata + Offsets.Rtti.SubobjectOffset, out rttiOffset))
        {
            return false;
        }

        kind = rttiOffset switch
        {
            Offsets.Rtti.HumanManagerPersonOffset => ManagerKind.Human,
            Offsets.Rtti.StaffPersonOffset => ManagerKind.Staff,
            _ => ManagerKind.Unsupported
        };
        uid = ReadUid(person + Offsets.Person.Uid);
        return true;
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
        _memoryReader.TryReadPointer(person + Offsets.Person.Nation, out var nation);
        var bodyType = _memoryReader.TryReadByte(actualPlayer + Offsets.ActualPlayer.BodyType, out var rawBodyType) &&
                       rawBodyType is >= 1 and <= 5
            ? rawBodyType
            : (byte?)null;
        var profile = new PlayerProfile(
            ReadPositiveInt32(fullContract + Offsets.FullContract.WeeklyWage),
            ReadPositiveInt16(actualPlayer + Offsets.ActualPlayer.Height),
            ReadPositiveInt16(actualPlayer + Offsets.ActualPlayer.Condition),
            ReadPositiveInt16(actualPlayer + Offsets.ActualPlayer.Morale),
            ReadPositiveInt16(actualPlayer + Offsets.ActualPlayer.CurrentAbility),
            ReadPositiveInt16(actualPlayer + Offsets.ActualPlayer.PotentialAbility),
            ReadPositiveInt16(actualPlayer + Offsets.ActualPlayer.CurrentReputation),
            ReadFmDate(person + Offsets.Person.DateOfBirth),
            nation == default ? null : ReadUid(nation + Offsets.Nation.Uid),
            bodyType,
            ReadOptionalUInt32(actualPlayer + Offsets.ActualPlayer.GuideValueGbp),
            ReadOptionalByte(person + Offsets.Person.InternationalApps),
            ReadOptionalByte(person + Offsets.Person.InternationalGoals),
            ReadOptionalByte(person + Offsets.Person.YouthApps),
            ReadOptionalByte(person + Offsets.Person.YouthGoals));
        return profile.WeeklyWage.HasValue || profile.HeightCm.HasValue || profile.Condition.HasValue || profile.Morale.HasValue ||
               profile.DateOfBirth is not null || profile.NationUid.HasValue || profile.BodyType.HasValue || profile.GuideValueGbp.HasValue ||
               profile.InternationalApps.HasValue || profile.YouthApps.HasValue
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

    private uint? ReadOptionalUInt32(nint address)
    {
        return _memoryReader.TryReadUInt32(address, out var value) ? value : null;
    }

    private int? ReadOptionalByte(nint address)
    {
        return _memoryReader.TryReadByte(address, out var value) ? value : null;
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

        Interlocked.Increment(ref _drainSequence);
        Interlocked.Exchange(ref _drainStartedTimestamp, Stopwatch.GetTimestamp());
        Volatile.Write(ref _drainStage, (int)DrainStage.TickRecords);
        try
        {
            var count = _tickRecords.Drain(_drainBatch);
            CandidateClassification? classification = null;
            if (count > 0)
            {
                Volatile.Write(ref _drainStage, (int)DrainStage.Candidates);
                for (var i = 0; i < count; i++)
                {
                    ObserveCandidate(_drainBatch[i]);
                }

                var now = _drainBatch[count - 1].CapturedTimestamp;
                Volatile.Write(ref _drainStage, (int)DrainStage.Identity);
                foreach (var pair in _candidates)
                {
                    RefreshCandidateIdentity(pair.Key, pair.Value, now);
                }

                Volatile.Write(ref _drainStage, (int)DrainStage.Classification);
                classification = ClassifyCandidates(now);
                if (_locatorState != LocatorState.Locked)
                {
                    Volatile.Write(ref _drainStage, (int)DrainStage.LockUpdate);
                    UpdateCandidateLock(classification, now);
                }
            }

            if (_locatorState != LocatorState.Locked)
            {
                Volatile.Write(ref _drainStage, (int)DrainStage.PreLockFrames);
                PrunePreLockFrameCaches();
            }

            Volatile.Write(ref _drainStage, (int)DrainStage.RealtimeFrames);
            DrainRealtimeFrames();

            Volatile.Write(ref _drainStage, (int)DrainStage.MatchEnd);
            for (var i = 0; i < count; i++)
            {
                ReportMatchEnded(_drainBatch[i]);
            }

            var diagnosticTimestamp = Stopwatch.GetTimestamp();
            ProbeLockedAnimationTerminal(diagnosticTimestamp);

            Volatile.Write(ref _drainStage, (int)DrainStage.Diagnostics);
            ReportCandidateSummary(classification, diagnosticTimestamp);
            ReportLockHealth(diagnosticTimestamp);
            ReportDroppedRecords();
        }
        catch (Exception ex)
        {
            QueueDiagnostic(DiagnosticSeverity.Warning, $"Unable to drain GAME_MATCH tick records: {ex.Message}");
        }
        finally
        {
            Interlocked.Exchange(ref _lastDrainCompletedTimestamp, Stopwatch.GetTimestamp());
            Volatile.Write(ref _drainStage, (int)DrainStage.Idle);
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

        var processed = 0;
        try
        {
            var selectedAnimated = (nint)Interlocked.Read(ref _selectedAnimated);
            // Native callbacks can complete on different threads. Sort the drained
            // window so a later callback cannot make us reject an earlier tick.
            Array.Sort(_realtimeDrainBatch, 0, count, RawFrameTickComparer.Instance);
            for (; processed < count; processed++)
            {
                var frame = _realtimeDrainBatch[processed];
                var retained = false;
                try
                {
                    if (selectedAnimated == default)
                    {
                        retained = TryCachePreLockFrame(frame);
                    }
                    else if (frame.MatchAddress == selectedAnimated)
                    {
                        _timeline.Append(frame);
                    }
                }
                finally
                {
                    _realtimeDrainBatch[processed] = null!;
                    if (!retained)
                    {
                        _realtimeFrames.Release(frame);
                    }
                }
            }
        }
        finally
        {
            // If sorting or processing throws, every frame still owned by this
            // drain batch must return to the pool. Frames already transferred to
            // a pre-lock cache have had their batch slot cleared.
            for (; processed < count; processed++)
            {
                var frame = _realtimeDrainBatch[processed];
                if (frame is not null)
                {
                    _realtimeFrames.Release(frame);
                    _realtimeDrainBatch[processed] = null!;
                }
            }
        }
    }

    private bool TryCachePreLockFrame(RawRealtimeTickFrame frame)
    {
        if (frame.Tick is < 0 or > PreLockCaptureMaxTick ||
            !_candidates.TryGetValue(frame.MatchAddress, out var candidate) ||
            !CanCachePreLockFrames(candidate))
        {
            return false;
        }

        if (!_preLockFrames.TryGetValue(frame.MatchAddress, out var cache))
        {
            if (Volatile.Read(ref _preLockFrameCount) >= MaxPreLockCachedFrames)
            {
                Interlocked.Increment(ref _droppedPreLockFrames);
                return false;
            }

            cache = new PreLockFrameCache();
            _preLockFrames.Add(frame.MatchAddress, cache);
        }

        if (cache.Frames.TryGetValue(frame.Tick, out var previous))
        {
            // Match the live timeline's ordering: the first callback for a tick
            // wins. It may contain a newly published native event that a later
            // duplicate no longer carries.
            if (previous.Sequence <= frame.Sequence)
            {
                return false;
            }

            cache.Frames[frame.Tick] = frame;
            _realtimeFrames.Release(previous);
            return true;
        }

        if (cache.Frames.Count >= MaxPreLockCachedFramesPerCandidate ||
            Volatile.Read(ref _preLockFrameCount) >= MaxPreLockCachedFrames)
        {
            Interlocked.Increment(ref _droppedPreLockFrames);
            return false;
        }

        cache.Frames.Add(frame.Tick, frame);
        Interlocked.Increment(ref _preLockFrameCount);
        return true;
    }

    private void PrunePreLockFrameCaches()
    {
        if (_preLockFrames.Count == 0)
        {
            return;
        }

        List<nint>? rejected = null;
        foreach (var pair in _preLockFrames)
        {
            if (_candidates.TryGetValue(pair.Key, out var candidate) &&
                IsRetainablePreLockCandidate(pair.Key, candidate))
            {
                continue;
            }

            rejected ??= new List<nint>();
            rejected.Add(pair.Key);
        }

        if (rejected is null)
        {
            return;
        }

        var releasedFrames = 0;
        foreach (var address in rejected)
        {
            releasedFrames += ReleasePreLockFrameCache(address);
        }

        QueueDiagnostic(
            DiagnosticSeverity.Debug,
            $"GAME_MATCH pre-lock frame caches pruned: candidates={rejected.Count}, frames={releasedFrames}, " +
            $"remainingCached={Volatile.Read(ref _preLockFrameCount)}.");
    }

    private bool IsRetainablePreLockCandidate(nint address, CandidateState candidate)
    {
        if (candidate.IsTerminal || !candidate.HasActiveRecord ||
            ClassifyManagerPair(candidate) == ManagerPairClassification.Rejected)
        {
            return false;
        }

        var homeRead = _memoryReader.TryReadPointer(address + Offsets.GameMatch.HomeTeam, out var homeTeam);
        var awayRead = _memoryReader.TryReadPointer(address + Offsets.GameMatch.AwayTeam, out var awayTeam);
        var playerCountRead = _memoryReader.TryReadByte(
            address + Offsets.GameMatch.MatchPlayersCount,
            out var playerCount);
        if (!homeRead || !awayRead || !playerCountRead)
        {
            // A transient read failure is not enough evidence to discard early data.
            return true;
        }

        return homeTeam != default && awayTeam != default && homeTeam != awayTeam &&
               playerCount is > 0 and <= 64 &&
               (candidate.ProbedHomeTeam == default || candidate.ProbedHomeTeam == homeTeam) &&
               (candidate.ProbedAwayTeam == default || candidate.ProbedAwayTeam == awayTeam);
    }

    private static bool CanCachePreLockFrames(CandidateState candidate) =>
        ClassifyManagerPair(candidate) != ManagerPairClassification.Rejected &&
        (candidate.HomeManagerKind == ManagerKind.Human ||
         candidate.AwayManagerKind == ManagerKind.Human);

    private (int Cached, int Appended, int FirstTick, int LastTick, int PitchBackfilled, int PitchSourceTick)
        CommitPreLockFrames(nint selectedAnimated)
    {
        if (!_preLockFrames.Remove(selectedAnimated, out var cache) || cache.Frames.Count == 0)
        {
            return (0, 0, -1, -1, 0, -1);
        }

        var frames = cache.Frames.Values
            .OrderBy(frame => frame.Tick)
            .ThenBy(frame => frame.Sequence)
            .ToArray();
        var (pitchBackfilled, pitchSourceTick) = BackfillLeadingPitchDimensions(frames);
        Interlocked.Add(ref _preLockFrameCount, -frames.Length);
        var appended = 0;
        try
        {
            foreach (var frame in frames)
            {
                if (_timeline.Append(frame))
                {
                    appended++;
                }
            }
        }
        finally
        {
            foreach (var frame in frames)
            {
                _realtimeFrames.Release(frame);
            }
        }

        return (frames.Length, appended, frames[0].Tick, frames[^1].Tick, pitchBackfilled, pitchSourceTick);
    }

    private static (int Backfilled, int SourceTick) BackfillLeadingPitchDimensions(
        IReadOnlyList<RawRealtimeTickFrame> frames)
    {
        var sourceIndex = -1;
        for (var index = 0; index < frames.Count; index++)
        {
            var frame = frames[index];
            if (HasValidPitchDimensions(frame.HalfPitchWidth, frame.HalfPitchLength))
            {
                sourceIndex = index;
                break;
            }
        }

        if (sourceIndex <= 0)
        {
            return (0, sourceIndex == 0 ? frames[0].Tick : -1);
        }

        var source = frames[sourceIndex];
        var backfilled = 0;
        for (var index = 0; index < sourceIndex; index++)
        {
            var frame = frames[index];
            if (frame.HalfPitchWidth != 0 && frame.HalfPitchLength != 0)
            {
                continue;
            }

            frame.HalfPitchWidth = source.HalfPitchWidth;
            frame.HalfPitchLength = source.HalfPitchLength;
            backfilled++;
        }

        return (backfilled, source.Tick);
    }

    private static bool HasValidPitchDimensions(float halfWidth, float halfLength) =>
        float.IsFinite(halfWidth) && float.IsFinite(halfLength) &&
        halfWidth is > 0 and <= 1_000 && halfLength is > 0 and <= 1_000;

    private (int Candidates, int Frames) ReleaseExcludedPreLockFrameCaches(nint selectedAnimated = default)
    {
        if (_preLockFrames.Count == 0)
        {
            return (0, 0);
        }

        var addresses = _preLockFrames.Keys
            .Where(address => address != selectedAnimated)
            .ToArray();
        var releasedFrames = 0;
        foreach (var address in addresses)
        {
            releasedFrames += ReleasePreLockFrameCache(address);
        }

        return (addresses.Length, releasedFrames);
    }

    private int ReleasePreLockFrameCache(nint address)
    {
        if (!_preLockFrames.Remove(address, out var cache))
        {
            return 0;
        }

        var count = cache.Frames.Count;
        foreach (var frame in cache.Frames.Values)
        {
            _realtimeFrames.Release(frame);
        }

        Interlocked.Add(ref _preLockFrameCount, -count);
        return count;
    }

    private void ObserveCandidate(in GameMatchTickRecord record)
    {
        if (!_candidates.TryGetValue(record.MatchAddress, out var state))
        {
            state = new CandidateState();
            _candidates.Add(record.MatchAddress, state);
        }
        else if (!record.IsTerminal && state.IsTerminal)
        {
            // A non-selected terminal address may be reused without ending the
            // current session. Treat the active object as a fresh candidate epoch.
            ReleasePreLockFrameCache(record.MatchAddress);
            state = new CandidateState();
            _candidates[record.MatchAddress] = state;
        }
        else if (!record.IsTerminal && ObserveTickEpochReset(state, record.Tick))
        {
            var previousTick = state.LastTick;
            var belongsToCurrentSession = record.MatchAddress == _stableSimulation ||
                                          record.MatchAddress == _stableAnimated ||
                                          record.MatchAddress == (nint)Interlocked.Read(ref _selectedAnimated);
            QueueDiagnostic(DiagnosticSeverity.Debug,
                $"GAME_MATCH tick epoch reset detected: match={FormatPointer(record.MatchAddress)}, " +
                $"previousTick={previousTick}, newTick={record.Tick}, " +
                $"currentSession={belongsToCurrentSession}.");

            if (belongsToCurrentSession)
            {
                FinalizeTimelineForEpochReset(record.MatchAddress, previousTick, record.Tick);
            }
            else
            {
                ReleasePreLockFrameCache(record.MatchAddress);
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
            QueueDiagnostic(DiagnosticSeverity.Debug,
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
        QueueDiagnostic(DiagnosticSeverity.Info,
            $"GAME_MATCH ended: score={final.HomeGoals}-{final.AwayGoals}, " +
            $"xg={final.HomeXg:0.000}-{final.AwayXg:0.000}, shots={final.HomeShots}-{final.AwayShots}.");
        QueueDiagnostic(DiagnosticSeverity.Debug,
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
            QueueDiagnostic(DiagnosticSeverity.Debug,
                $"GAME_MATCH realtime timeline finalized: frames={timelineStatus.FrameCount}, " +
                $"lastTick={timelineStatus.LastTick}, missingTicks={timelineStatus.MissingTickCount}, " +
                $"duplicates={timelineStatus.DuplicateTickCount}, outOfOrder={timelineStatus.OutOfOrderTickCount}.");
            ResetCandidateSession("full time");
        }
    }

    private void ProbeLockedAnimationTerminal(long now)
    {
        if (_locatorState != LocatorState.Locked ||
            now - _lastLockedAnimationTerminalProbeTimestamp <
            Stopwatch.Frequency * LockedAnimationTerminalProbeSeconds)
        {
            return;
        }

        _lastLockedAnimationTerminalProbeTimestamp = now;
        var animated = _stableAnimated;
        if (animated == default)
        {
            return;
        }

        var homeTeamRead = _memoryReader.TryReadPointer(
            animated + Offsets.GameMatch.HomeTeam,
            out var homeTeam);
        var awayTeamRead = _memoryReader.TryReadPointer(
            animated + Offsets.GameMatch.AwayTeam,
            out var awayTeam);
        if (!homeTeamRead || !awayTeamRead)
        {
            QueueDiagnostic(
                DiagnosticSeverity.Debug,
                $"GAME_MATCH locked animation terminal probe: address={FormatPointer(animated)}, " +
                $"result=unreadable, homeRead={homeTeamRead}, awayRead={awayTeamRead}.");
            return;
        }

        if (homeTeam != default || awayTeam != default)
        {
            QueueDiagnostic(
                DiagnosticSeverity.Debug,
                $"GAME_MATCH locked animation terminal probe: address={FormatPointer(animated)}, " +
                $"result=active, runtimeTeams={FormatPointer(homeTeam)}/{FormatPointer(awayTeam)}.");
            return;
        }

        QueueDiagnostic(
            DiagnosticSeverity.Info,
            $"GAME_MATCH locked animation terminal probe detected cleared runtime teams: " +
            $"address={FormatPointer(animated)}.");
        Interlocked.CompareExchange(ref _selectedAnimated, 0, (long)animated);
        _timeline.MarkEnded(animated);
        var timelineStatus = _timeline.GetStatus();
        QueueDiagnostic(
            DiagnosticSeverity.Debug,
            $"GAME_MATCH realtime timeline finalized by active terminal probe: " +
            $"frames={timelineStatus.FrameCount}, lastTick={timelineStatus.LastTick}, " +
            $"missingTicks={timelineStatus.MissingTickCount}, duplicates={timelineStatus.DuplicateTickCount}, " +
            $"outOfOrder={timelineStatus.OutOfOrderTickCount}.");
        ResetCandidateSession("active terminal probe");
    }

    private void ResetCandidateSession(string reason)
    {
        var releasedPreLock = ReleaseExcludedPreLockFrameCaches();
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
        _lastLockHealthTimestamp = 0;
        _lastLockedAnimationTerminalProbeTimestamp = 0;
        _lastMetadataCaptureTimestamp = 0;
        _locatorState = LocatorState.Discovering;
        _pendingFingerprint = default;
        _pendingSimulation = default;
        _pendingAnimated = default;
        _pendingConfirmationCount = 0;
        _pendingFirstTimestamp = 0;
        QueueDiagnostic(
            DiagnosticSeverity.Debug,
            $"GAME_MATCH candidate session cleared after {reason}; reused addresses may start a new match; " +
            $"releasedPreLockCandidates={releasedPreLock.Candidates}, releasedPreLockFrames={releasedPreLock.Frames}.");
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

        return CalculateTickRate(state, now) <= CandidateRealtimeMaxTicksPerSecond;
    }

    private static double CalculateTickRate(CandidateState state, long now)
    {
        var elapsedTicks = Math.Max(1, now - state.FirstSeenTimestamp);
        var elapsedSeconds = elapsedTicks / (double)Stopwatch.Frequency;
        return Math.Max(0, state.LastTick - state.FirstTick) / elapsedSeconds;
    }

    private void ReportCandidateSummary(CandidateClassification? classification, long now)
    {
        if (!PluginLogger.IsDebugEnabled)
        {
            return;
        }

        if (classification is not null)
        {
            var uniquePair = classification.Pairs.Count == 1 ? classification.Pairs[0] : (CandidatePair?)null;
            var simulation = uniquePair?.Simulation ?? default;
            var animated = uniquePair?.Animated ?? default;
            var selectionChanged = simulation != _lastReportedSimulation || animated != _lastReportedAnimated;
            if (selectionChanged || now - _lastCandidateSummaryTimestamp >= Stopwatch.Frequency)
            {
                _lastReportedSimulation = simulation;
                _lastReportedAnimated = animated;
                _lastCandidateSummaryTimestamp = now;

                QueueDiagnostic(DiagnosticSeverity.Debug,
                    $"GAME_MATCH candidate classification: locator={_locatorState.ToString().ToLowerInvariant()}, " +
                    $"eligible={classification.EligibleCount}, groups={classification.GroupCount}, " +
                    $"pairs={classification.Pairs.Count}, result=" +
                    $"{(classification.Pairs.Count == 0 ? "no_pair" : classification.Pairs.Count == 1 ? "unique_pair" : "ambiguous_pair")}.");
            }
        }

        foreach (var pair in _candidates)
        {
            var state = pair.Value;
            var reason = GetEligibilityReason(state, now);
            if (string.Equals(state.LastReportedEligibilityReason, reason, StringComparison.Ordinal))
            {
                continue;
            }

            state.LastReportedEligibilityReason = reason;
            var record = state.LastActiveRecord;
            QueueDiagnostic(DiagnosticSeverity.Debug,
                $"GAME_MATCH candidate evidence: address={FormatPointer(pair.Key)}, tick={state.LastTick}, " +
                $"ageMs={Math.Max(0, now - state.LastSeenTimestamp) * 1_000 / Stopwatch.Frequency}, " +
                $"rate={CalculateTickRate(state, now):0.0}, homeTeam={FormatPointer(record.HomeTeam)}, " +
                $"awayTeam={FormatPointer(record.AwayTeam)}, players={record.PlayerCount}, " +
                $"homeUid={FormatUid(state.HomeTeamUidReadable, state.HomeDbTeamUid)}, " +
                $"awayUid={FormatUid(state.AwayTeamUidReadable, state.AwayDbTeamUid)}, " +
                $"homeManagerRtti={FormatManagerRtti(state.HomeManagerReadable, state.HomeManagerRttiOffset)}, " +
                $"awayManagerRtti={FormatManagerRtti(state.AwayManagerReadable, state.AwayManagerRttiOffset)}, " +
                $"homeManagerUid={state.HomeManagerUid?.ToString(CultureInfo.InvariantCulture) ?? "unknown"}, " +
                $"awayManagerUid={state.AwayManagerUid?.ToString(CultureInfo.InvariantCulture) ?? "unknown"}, " +
                $"fingerprint={FormatFingerprint(state)}, eligible={reason == "eligible"}, " +
                $"reason={reason}, records={state.RecordCount}, " +
                $"missingTicks={state.GapCount}, outOfOrder={state.OutOfOrderCount}.");
        }
    }

    private void ReportLockHealth(long now)
    {
        if (!PluginLogger.IsDebugEnabled || _locatorState != LocatorState.Locked ||
            now - _lastLockHealthTimestamp < Stopwatch.Frequency * LockHealthLogSeconds)
        {
            return;
        }

        _lastLockHealthTimestamp = now;
        var selected = (nint)Interlocked.Read(ref _selectedAnimated);
        if (!_candidates.TryGetValue(selected, out var state))
        {
            QueueDiagnostic(
                DiagnosticSeverity.Debug,
                $"GAME_MATCH lock health: address={FormatPointer(selected)}, candidateMissing=true.");
            return;
        }

        var record = state.LastActiveRecord;
        QueueDiagnostic(DiagnosticSeverity.Debug,
            $"GAME_MATCH lock health: address={FormatPointer(selected)}, tick={state.LastTick}, " +
            $"lastAdvanceAgeMs={Math.Max(0, now - state.LastAdvanceTimestamp) * 1_000 / Stopwatch.Frequency}, " +
            $"records={state.RecordCount}, missingTicks={state.GapCount}, outOfOrder={state.OutOfOrderCount}, " +
            $"runtimeTeamsReadable={record.HomeTeam != default && record.AwayTeam != default}.");
    }

    private static string FormatUid(bool readable, uint uid) => readable
        ? uid.ToString(CultureInfo.InvariantCulture)
        : "unknown";

    private static string FormatManagerRtti(bool readable, uint offset) => readable
        ? $"0x{offset:X}"
        : "unreadable";

    private static string FormatFingerprint(CandidateState state) =>
        state.HomeTeamUidReadable && state.AwayTeamUidReadable
            ? $"{state.HomeDbTeamUid}:{state.AwayDbTeamUid}"
            : "unknown";

    private static string FormatManagerPair(CandidateState? state) => state is null
        ? "unknown/unknown"
        : $"{FormatManagerKind(state.HomeManagerKind)}/{FormatManagerKind(state.AwayManagerKind)}";

    private static string FormatManagerKind(ManagerKind kind) => kind switch
    {
        ManagerKind.Human => "human",
        ManagerKind.Staff => "ai",
        ManagerKind.Unsupported => "unsupported",
        _ => "unknown"
    };

    private void ReportDroppedRecords()
    {
        var dropped = _tickRecords.Dropped;
        if (dropped != _lastReportedDropped)
        {
            _lastReportedDropped = dropped;
            QueueDiagnostic(
                DiagnosticSeverity.Warning,
                $"GAME_MATCH tick record buffer dropped records: total={dropped}.");
        }

        var realtimeDropped = _realtimeFrames.Dropped;
        if (realtimeDropped != _lastReportedRealtimeDropped)
        {
            _lastReportedRealtimeDropped = realtimeDropped;
            QueueDiagnostic(
                DiagnosticSeverity.Warning,
                $"GAME_MATCH realtime frame buffer dropped records: total={realtimeDropped}.");
        }

        var preLockDropped = Interlocked.Read(ref _droppedPreLockFrames);
        if (preLockDropped != _lastReportedDroppedPreLockFrames)
        {
            _lastReportedDroppedPreLockFrames = preLockDropped;
            QueueDiagnostic(
                DiagnosticSeverity.Warning,
                $"GAME_MATCH pre-lock frame cache dropped records: total={preLockDropped}, " +
                $"cached={Volatile.Read(ref _preLockFrameCount)}.");
        }
    }

    private void QueueDiagnostic(DiagnosticSeverity severity, string message)
    {
        if (severity == DiagnosticSeverity.Debug && !PluginLogger.IsDebugEnabled)
        {
            return;
        }

        var pendingCount = Interlocked.Increment(ref _pendingDiagnosticMessageCount);
        if (pendingCount > MaxPendingDiagnosticMessages)
        {
            Interlocked.Decrement(ref _pendingDiagnosticMessageCount);
            Interlocked.Increment(ref _droppedDiagnosticMessages);
            return;
        }

        _pendingDiagnosticMessages.Enqueue(new PendingDiagnosticMessage(severity, message));
    }

    private void FlushPendingDiagnostics()
    {
        var flushed = 0;
        while (flushed < MaxDiagnosticMessagesPerFlush &&
               _pendingDiagnosticMessages.TryDequeue(out var pending))
        {
            Interlocked.Decrement(ref _pendingDiagnosticMessageCount);
            switch (pending.Severity)
            {
                case DiagnosticSeverity.Info:
                    PluginLogger.Info(pending.Message);
                    break;
                case DiagnosticSeverity.Warning:
                    PluginLogger.Warning(pending.Message);
                    break;
                case DiagnosticSeverity.Error:
                    PluginLogger.Error(pending.Message);
                    break;
                default:
                    PluginLogger.Debug(pending.Message);
                    break;
            }

            flushed++;
        }

        var dropped = Interlocked.Read(ref _droppedDiagnosticMessages);
        var previous = Interlocked.Exchange(ref _lastReportedDroppedDiagnosticMessages, dropped);
        if (dropped != previous)
        {
            PluginLogger.Warning(
                $"GAME_MATCH diagnostic queue dropped messages: total={dropped}, " +
                $"pending={Volatile.Read(ref _pendingDiagnosticMessageCount)}.");
        }
    }

    private void ReportDrainHealth(long now)
    {
        if (!PluginLogger.IsDebugEnabled)
        {
            return;
        }

        var draining = Volatile.Read(ref _isDrainingTickRecords) != 0;
        var stage = (DrainStage)Volatile.Read(ref _drainStage);
        var started = Interlocked.Read(ref _drainStartedTimestamp);
        var completed = Interlocked.Read(ref _lastDrainCompletedTimestamp);
        var activeMilliseconds = draining && started != 0
            ? Math.Max(0, now - started) * 1_000 / Stopwatch.Frequency
            : 0;
        var completedAgeMilliseconds = completed == 0
            ? -1
            : Math.Max(0, now - completed) * 1_000 / Stopwatch.Frequency;

        if (draining && activeMilliseconds >= DrainStallWarningSeconds * 1_000L)
        {
            if (now - _lastDrainStallWarningTimestamp < Stopwatch.Frequency * DrainHealthLogSeconds)
            {
                return;
            }

            _lastDrainStallWarningTimestamp = now;
            PluginLogger.Warning(
                $"GAME_MATCH drain stalled: cycle={Interlocked.Read(ref _drainSequence)}, " +
                $"stage={stage.ToString().ToLowerInvariant()}, activeMs={activeMilliseconds}, " +
                $"lastCompletedAgeMs={completedAgeMilliseconds}, tickQueue={_tickRecords.Count}, " +
                $"realtimeQueue={_realtimeFrames.ReadyCount}, tickDropped={_tickRecords.Dropped}, " +
                $"realtimeDropped={_realtimeFrames.Dropped}, preLockCached={Volatile.Read(ref _preLockFrameCount)}, " +
                $"preLockDropped={Interlocked.Read(ref _droppedPreLockFrames)}, " +
                $"diagnosticQueue={Volatile.Read(ref _pendingDiagnosticMessageCount)}.");
            return;
        }

        if (now - _lastDrainHealthTimestamp < Stopwatch.Frequency * DrainHealthLogSeconds)
        {
            return;
        }

        _lastDrainHealthTimestamp = now;
        PluginLogger.Debug(
            $"GAME_MATCH drain health: cycle={Interlocked.Read(ref _drainSequence)}, draining={draining}, " +
            $"stage={stage.ToString().ToLowerInvariant()}, activeMs={activeMilliseconds}, " +
            $"lastCompletedAgeMs={completedAgeMilliseconds}, tickQueue={_tickRecords.Count}, " +
            $"realtimeQueue={_realtimeFrames.ReadyCount}, tickDropped={_tickRecords.Dropped}, " +
            $"realtimeDropped={_realtimeFrames.Dropped}, preLockCached={Volatile.Read(ref _preLockFrameCount)}, " +
            $"preLockDropped={Interlocked.Read(ref _droppedPreLockFrames)}, " +
            $"diagnosticQueue={Volatile.Read(ref _pendingDiagnosticMessageCount)}.");
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

    private enum DiagnosticSeverity
    {
        Debug,
        Info,
        Warning,
        Error
    }

    private enum DrainStage
    {
        Idle,
        TickRecords,
        Candidates,
        Identity,
        PreLockFrames,
        Classification,
        LockUpdate,
        RealtimeFrames,
        MatchEnd,
        Diagnostics
    }

    private sealed record PendingDiagnosticMessage(DiagnosticSeverity Severity, string Message);

    private enum LocatorState
    {
        Discovering,
        Confirming,
        Locked
    }

    private enum ManagerKind
    {
        Unknown,
        Staff,
        Human,
        Unsupported
    }

    private enum ManagerPairClassification
    {
        Pending,
        Rejected,
        Eligible
    }

    private readonly record struct MatchFingerprint(uint HomeTeamUid, uint AwayTeamUid)
    {
        public override string ToString() => $"{HomeTeamUid}:{AwayTeamUid}";
    }

    private readonly record struct CandidatePair(
        MatchFingerprint Fingerprint,
        nint Simulation,
        nint Animated,
        int SimulationTick,
        int AnimatedTick,
        int TickDelta,
        double AnimatedTicksPerSecond);

    private sealed record CandidateClassification(
        IReadOnlyList<CandidatePair> Pairs,
        int EligibleCount,
        int GroupCount);

    private sealed class PreLockFrameCache
    {
        public Dictionary<int, RawRealtimeTickFrame> Frames { get; } = new();
    }

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
        public string? MatchDate;
        public nint ProbedHomeTeam;
        public nint ProbedAwayTeam;
        public long LastIdentityProbeTimestamp;
        public bool HomeManagerReadable;
        public bool AwayManagerReadable;
        public uint HomeManagerRttiOffset;
        public uint AwayManagerRttiOffset;
        public ManagerKind HomeManagerKind;
        public ManagerKind AwayManagerKind;
        public uint? HomeManagerUid;
        public uint? AwayManagerUid;
        public bool HomeTeamUidReadable;
        public bool AwayTeamUidReadable;
        public uint HomeDbTeamUid;
        public uint AwayDbTeamUid;
        public string? LastReportedEligibilityReason;
    }

    private sealed class NativeMomentumCaptureState
    {
        private readonly ulong[] _signatures = new ulong[MonitoredMomentumEventCount];

        public nint Source;
        public nint Begin;
        public int EventCount;
        public int SignatureStart;
        public int SignatureCount;

        public bool TryGetSignature(int eventIndex, out ulong signature)
        {
            var offset = eventIndex - SignatureStart;
            if (offset < 0 || offset >= SignatureCount)
            {
                signature = 0;
                return false;
            }

            signature = _signatures[offset];
            return true;
        }

        public void UpdateSignatures(nint begin, int eventCount)
        {
            SignatureStart = Math.Max(0, eventCount - MonitoredMomentumEventCount);
            SignatureCount = eventCount - SignatureStart;
            for (var index = 0; index < SignatureCount; index++)
            {
                _signatures[index] = ReadNativeEventSignature(
                    begin + (SignatureStart + index) * Offsets.MomentumEvent.Size);
            }
        }
    }

    private void RefreshCandidateIdentity(nint address, CandidateState state, long now)
    {
        if (state.IsTerminal || !state.HasActiveRecord ||
            state.LastSeenTimestamp < now - Stopwatch.Frequency * CandidateRecentSeconds)
        {
            return;
        }

        var record = state.LastActiveRecord;
        if (state.ProbedHomeTeam != record.HomeTeam || state.ProbedAwayTeam != record.AwayTeam)
        {
            ReleasePreLockFrameCache(address);
            ResetCandidateIdentity(state);
            state.ProbedHomeTeam = record.HomeTeam;
            state.ProbedAwayTeam = record.AwayTeam;
        }

        var managerPair = ClassifyManagerPair(state);
        var identityComplete = managerPair == ManagerPairClassification.Rejected ||
                               managerPair == ManagerPairClassification.Eligible &&
                               state.HomeTeamUidReadable && state.AwayTeamUidReadable;
        if (identityComplete ||
            now - state.LastIdentityProbeTimestamp < Stopwatch.Frequency * CandidateIdentityRetryMilliseconds / 1_000)
        {
            return;
        }

        state.LastIdentityProbeTimestamp = now;
        state.HomeManagerReadable = TryReadManagerIdentity(
            record.HomeTeam,
            out _,
            out state.HomeManagerRttiOffset,
            out state.HomeManagerKind,
            out state.HomeManagerUid);
        state.AwayManagerReadable = TryReadManagerIdentity(
            record.AwayTeam,
            out _,
            out state.AwayManagerRttiOffset,
            out state.AwayManagerKind,
            out state.AwayManagerUid);
        state.HomeTeamUidReadable = TryReadDbTeamUid(record.HomeTeam, out state.HomeDbTeamUid);
        state.AwayTeamUidReadable = TryReadDbTeamUid(record.AwayTeam, out state.AwayDbTeamUid);
    }

    private static void ResetCandidateIdentity(CandidateState state)
    {
        state.LastIdentityProbeTimestamp = 0;
        state.HomeManagerReadable = false;
        state.AwayManagerReadable = false;
        state.HomeManagerRttiOffset = 0;
        state.AwayManagerRttiOffset = 0;
        state.HomeManagerKind = ManagerKind.Unknown;
        state.AwayManagerKind = ManagerKind.Unknown;
        state.HomeManagerUid = null;
        state.AwayManagerUid = null;
        state.HomeTeamUidReadable = false;
        state.AwayTeamUidReadable = false;
        state.HomeDbTeamUid = 0;
        state.AwayDbTeamUid = 0;
        state.LastReportedEligibilityReason = null;
    }

    private static ManagerPairClassification ClassifyManagerPair(CandidateState state)
    {
        if (state.HomeManagerKind == ManagerKind.Unsupported ||
            state.AwayManagerKind == ManagerKind.Unsupported)
        {
            return ManagerPairClassification.Rejected;
        }

        if (state.HomeManagerKind == ManagerKind.Unknown ||
            state.AwayManagerKind == ManagerKind.Unknown)
        {
            return ManagerPairClassification.Pending;
        }

        return state.HomeManagerKind == ManagerKind.Human ||
               state.AwayManagerKind == ManagerKind.Human
            ? ManagerPairClassification.Eligible
            : ManagerPairClassification.Rejected;
    }

    private bool TryReadDbTeamUid(nint team, out uint uid)
    {
        uid = default;
        return team != default &&
               _memoryReader.TryReadPointer(team + Offsets.Team.DbTeam, out var dbTeam) &&
               dbTeam != default &&
               _memoryReader.TryReadUInt32(dbTeam + Offsets.DbTeam.Uid, out uid) &&
               uid != 0;
    }

    private static string GetEligibilityReason(CandidateState state, long now)
    {
        if (state.IsTerminal) return "terminal";
        if (!state.HasActiveRecord || state.LastActiveRecord.HomeTeam == default ||
            state.LastActiveRecord.AwayTeam == default ||
            state.LastActiveRecord.HomeTeam == state.LastActiveRecord.AwayTeam ||
            state.LastActiveRecord.PlayerCount is 0 or > 64)
        {
            return "invalid_shape";
        }

        var managerPair = ClassifyManagerPair(state);
        if (managerPair == ManagerPairClassification.Pending)
        {
            return "manager_unreadable";
        }
        if (managerPair == ManagerPairClassification.Rejected)
        {
            return state.HomeManagerKind == ManagerKind.Unsupported ||
                   state.AwayManagerKind == ManagerKind.Unsupported
                ? "unsupported_manager"
                : "no_human_manager";
        }

        if (!state.HomeTeamUidReadable || !state.AwayTeamUidReadable) return "team_uid_unreadable";
        if (state.HomeDbTeamUid == state.AwayDbTeamUid) return "same_team_uid";
        return state.LastAdvanceTimestamp < now - Stopwatch.Frequency * CandidateRecentSeconds
            ? "stale"
            : "eligible";
    }

    private static bool TryGetEligibleFingerprint(
        CandidateState state,
        long now,
        out MatchFingerprint fingerprint)
    {
        if (GetEligibilityReason(state, now) != "eligible")
        {
            fingerprint = default;
            return false;
        }

        fingerprint = new MatchFingerprint(state.HomeDbTeamUid, state.AwayDbTeamUid);
        return true;
    }

    private CandidateClassification ClassifyCandidates(long now)
    {
        var groups = new Dictionary<MatchFingerprint, List<KeyValuePair<nint, CandidateState>>>();
        var eligibleCount = 0;
        foreach (var candidate in _candidates)
        {
            if (!TryGetEligibleFingerprint(candidate.Value, now, out var fingerprint)) continue;
            eligibleCount++;
            if (!groups.TryGetValue(fingerprint, out var group))
            {
                group = new List<KeyValuePair<nint, CandidateState>>();
                groups.Add(fingerprint, group);
            }
            group.Add(candidate);
        }

        var pairs = new List<CandidatePair>();
        foreach (var group in groups)
        {
            if (group.Value.Count < 2) continue;

            var simulation = group.Value
                .OrderByDescending(candidate => candidate.Value.LastTick)
                .ThenBy(candidate => (long)candidate.Key)
                .First();
            CandidatePair? best = null;
            var bestError = int.MaxValue;
            foreach (var candidate in group.Value)
            {
                if (candidate.Key == simulation.Key || !IsLikelyRealtimeAnimated(candidate.Key, now)) continue;
                var delta = simulation.Value.LastTick - candidate.Value.LastTick;
                var error = Math.Abs(delta - CandidateExpectedTickDelta);
                if (error > CandidateTickDeltaTolerance || error >= bestError) continue;
                bestError = error;
                best = new CandidatePair(
                    group.Key,
                    simulation.Key,
                    candidate.Key,
                    simulation.Value.LastTick,
                    candidate.Value.LastTick,
                    delta,
                    CalculateTickRate(candidate.Value, now));
            }

            if (best.HasValue) pairs.Add(best.Value);
        }

        return new CandidateClassification(pairs.ToArray(), eligibleCount, groups.Count);
    }

    private void UpdateCandidateLock(CandidateClassification classification, long now)
    {
        if (classification.Pairs.Count != 1)
        {
            ResetPendingPair();
            return;
        }

        var pair = classification.Pairs[0];
        var samePendingPair = _locatorState == LocatorState.Confirming &&
                              _pendingFingerprint == pair.Fingerprint &&
                              _pendingSimulation == pair.Simulation &&
                              _pendingAnimated == pair.Animated;
        if (!samePendingPair)
        {
            _locatorState = LocatorState.Confirming;
            _pendingFingerprint = pair.Fingerprint;
            _pendingSimulation = pair.Simulation;
            _pendingAnimated = pair.Animated;
            _pendingConfirmationCount = 1;
            _pendingFirstTimestamp = now;
        }
        else
        {
            _pendingConfirmationCount++;
        }

        QueueDiagnostic(DiagnosticSeverity.Debug,
            $"GAME_MATCH pair confirmation: fingerprint={pair.Fingerprint}, " +
            $"simulation={FormatPointer(pair.Simulation)} simulationTick={pair.SimulationTick}, " +
            $"animated={FormatPointer(pair.Animated)} animatedTick={pair.AnimatedTick}, " +
            $"delta={pair.TickDelta}, animatedRate={pair.AnimatedTicksPerSecond:0.0}, " +
            $"confirmation={_pendingConfirmationCount}/{CandidatePairConfirmationCount}.");

        if (_pendingConfirmationCount < CandidatePairConfirmationCount) return;
        LockAnimatedCandidate(pair, now);
    }

    private void LockAnimatedCandidate(CandidatePair pair, long now)
    {
        _locatorState = LocatorState.Locked;
        _stableSimulation = pair.Simulation;
        _stableAnimated = pair.Animated;
        _lastLockedAnimationTerminalProbeTimestamp = now;
        var hasCachedPreLockFrames = _preLockFrames.TryGetValue(pair.Animated, out var preLockCache) &&
                                     preLockCache.Frames.Count > 0;
        lock (_nativeMomentumGate)
        {
            // If no early frame survived candidate filtering, replay the native
            // event vector on the first selected callback. Cached frames already
            // contain those events and must not be followed by a duplicate replay.
            if (!hasCachedPreLockFrames)
            {
                _nativeMomentumStates.Remove(pair.Animated);
            }
        }
        Interlocked.Exchange(ref _selectedAnimated, (long)pair.Animated);
        _timeline.Begin(pair.Animated);
        TryCapturePlayerMetadata(pair.Animated);
        var committedPreLock = (
            Cached: 0,
            Appended: 0,
            FirstTick: -1,
            LastTick: -1,
            PitchBackfilled: 0,
            PitchSourceTick: -1);
        (int Candidates, int Frames) releasedPreLock;
        try
        {
            committedPreLock = CommitPreLockFrames(pair.Animated);
        }
        finally
        {
            releasedPreLock = ReleaseExcludedPreLockFrameCaches(pair.Animated);
        }

        _candidates.TryGetValue(pair.Animated, out var animatedState);
        var observationMilliseconds = animatedState is null
            ? 0
            : (now - animatedState.FirstSeenTimestamp) * 1_000 / Stopwatch.Frequency;
        var confirmationMilliseconds = Math.Max(0, now - _pendingFirstTimestamp) * 1_000 / Stopwatch.Frequency;
        QueueDiagnostic(DiagnosticSeverity.Info,
            $"GAME_MATCH animation locked: address={FormatPointer(pair.Animated)}, " +
            $"simulation={FormatPointer(pair.Simulation)}, fingerprint={pair.Fingerprint}, " +
            $"tick={pair.AnimatedTick}, simulationTick={pair.SimulationTick}, delta={pair.TickDelta}, " +
            $"managers={FormatManagerPair(animatedState)}, " +
            $"confirmation={CandidatePairConfirmationCount}/{CandidatePairConfirmationCount}, " +
            $"confirmationMs={confirmationMilliseconds}, observationMs={observationMilliseconds}.");
        var committedTickRange = committedPreLock.Cached == 0
            ? "none"
            : $"{committedPreLock.FirstTick}-{committedPreLock.LastTick}";
        QueueDiagnostic(DiagnosticSeverity.Info,
            $"GAME_MATCH pre-lock frames committed: address={FormatPointer(pair.Animated)}, " +
            $"cached={committedPreLock.Cached}, appended={committedPreLock.Appended}, " +
            $"tickRange={committedTickRange}, " +
            $"pitchBackfilled={committedPreLock.PitchBackfilled}, " +
            $"pitchSourceTick={committedPreLock.PitchSourceTick}, " +
            $"releasedCandidates={releasedPreLock.Candidates}, releasedFrames={releasedPreLock.Frames}, " +
            $"remainingCached={Volatile.Read(ref _preLockFrameCount)}.");
    }

    private void ResetPendingPair()
    {
        if (_locatorState == LocatorState.Locked) return;
        _locatorState = LocatorState.Discovering;
        _pendingFingerprint = default;
        _pendingSimulation = default;
        _pendingAnimated = default;
        _pendingConfirmationCount = 0;
        _pendingFirstTimestamp = 0;
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
