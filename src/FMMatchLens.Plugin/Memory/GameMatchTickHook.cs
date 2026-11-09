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
using Tactics = FMMatchLens.Plugin.Memory.Offsets.Tactics;

namespace FMMatchLens.Plugin.Memory;

internal sealed class GameMatchTickHook : IDisposable
{
    private const int CandidateRealtimeMaxTicksPerSecond = 240;
    private const int CandidatePaceObservationSeconds = 2;
    private const int CandidatePairConfirmationCount = 3;
    private const int CandidateRecentSeconds = 2;
    // The supported FM27 build runs simulation 180 game seconds ahead of the
    // displayed instance (4 ticks/second). FM26's 360-tick lead rejects this pair.
    private const int CandidateExpectedTickDelta = 720;
    private const int CandidateTickDeltaTolerance = 16;
    private const int LockHealthLogSeconds = 5;
    private const int DrainHealthLogSeconds = 5;
    private const int DrainStallWarningSeconds = 2;
    private const int MaxPendingDiagnosticMessages = 256;
    private const int MaxDiagnosticMessagesPerFlush = 128;
    private const int PreLockCaptureMaxTick = 2_048;
    private const int RealtimeFrameBufferCapacity = 8_192;
    private const int PreLockFramePoolReserve = 1_024;
    private const int MaxPreLockCachedFrames = RealtimeFrameBufferCapacity - PreLockFramePoolReserve;
    private const int MaxPreLockCachedFramesPerCandidate = PreLockCaptureMaxTick + 1;

    // Only the newest four native trajectory points are retained. If the native
    // vector is longer, earlier path segments and turns are intentionally lost;
    // the event anchor remains available separately as the logical action origin.
    // Keep this limit in sync with ArchiveFrameCodec.MaxTrajectoryPoints.
    private const int MaxStoredMomentumTrajectoryPoints = 4;
    private const int MaxNativeMomentumTrajectoryPoints = 4_096;
    private const int MonitoredMomentumEventCount = 4;
    private const int ActiveRatingBaseline = 6_700;

    private readonly RealtimeMatchTimeline _timeline;
    private readonly MatchUpdateDelegate _hookDelegate;
    private readonly MemoryReader _memoryReader = new();
    private readonly PlayerUidCache _playerUids = new(RawRealtimeTickFrame.MaxPlayers, Stopwatch.Frequency);
    // One selected viewing instance. Candidates continue to be audited while it
    // is active, but no other pair can acquire a capture session.
    private volatile CaptureSession? _activeSession;
    private PendingPair? _pendingPair;
    private readonly ConcurrentDictionary<nint, IdentityObservation> _instanceIdentities = new();
    private long _instanceGeneration;
    private int _identityCount;
    private long _lastSessionIdentityProbe;
    private long _identityCapacityDrops;
    private long _reportedIdentityCapacityDrops;
    private readonly GameMatchTickRecordBuffer _tickRecords = new(65_536);
    private readonly GameMatchTickRecord[] _drainBatch = new GameMatchTickRecord[2_048];
    private readonly RealtimeTickFrameBuffer _realtimeFrames = new(RealtimeFrameBufferCapacity);
    private readonly RawRealtimeTickFrame[] _realtimeDrainBatch = new RawRealtimeTickFrame[2_048];
    private readonly Dictionary<nint, CandidateState> _candidates = new();
    private readonly Dictionary<nint, PreLockFrameCache> _preLockFrames = new();
    private readonly Dictionary<nint, NativeMomentumCaptureState> _nativeMomentumStates = new();
    private readonly Dictionary<(nint Match, int Slot), RatingResearchPlayerData> _lastRatingResearchBySlot = new();
    private readonly Dictionary<nint, (float Home, float Away)> _ratingBackgroundByMatch = new();
    private readonly Dictionary<nint, int> _lastRatingCapturedTickByMatch = new();
    private readonly Dictionary<nint, long> _ratingGenerations = new();
    private readonly Dictionary<nint, RatingResearchMatchData?> _lastRatingMatchByMatch = new();
    private readonly object _nativeMomentumGate = new();
    private readonly object _ratingCaptureGate = new();
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
    private long _lastTargetTick;
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
    private long _selectedAnimated;
    private long _lastMetadataFailureTimestamp;
    private long _drainSequence;
    private long _drainStartedTimestamp;
    private long _lastDrainCompletedTimestamp;
    private long _lastDrainHealthTimestamp;
    private long _lastDrainStallWarningTimestamp;

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
    private bool _buildRejected;
    private bool _tacticsLayoutSupported;
    private int _activeHookCalls;

    public GameMatchTickHook(RealtimeMatchTimeline timeline)
    {
        _timeline = timeline;
        _hookDelegate = MatchUpdateHook;
    }

    public bool IsStarted => _started;
    public bool ShouldRetry => !_buildRejected;

    public bool Start(bool logModuleNotLoaded = true)
    {
        if (_started)
        {
            return true;
        }

        if (IntPtr.Size != 8)
        {
            PluginLogger.Warning("GAME_MATCH Advance hook requires a 64-bit process.");
            return false;
        }

        var moduleBase = GetModuleHandle("game_plugin.dll");
        if (moduleBase == default)
        {
            if (logModuleNotLoaded)
            {
                PluginLogger.Warning("Unable to install GAME_MATCH Advance hook: game_plugin.dll is not loaded.");
            }

            return false;
        }

        GamePluginBuild build;
        string modulePath;
        string sha256;
        var supportedBuild = false;
        try
        {
            supportedBuild = GamePluginBuildCatalog.TryResolve(
                moduleBase,
                out build,
                out modulePath,
                out sha256);
            PluginLogger.Info($"Detected game_plugin.dll: sha256={sha256}, path={modulePath}.");

            if (!supportedBuild)
            {
                if (!GamePluginBuildCatalog.IsFunctionEntry(moduleBase, build.MatchTickHookRva))
                {
                    _buildRejected = true;
                    PluginLogger.Warning(
                        $"Unrecognized game_plugin.dll build; match capture is disabled because fallback RVA " +
                        $"0x{build.MatchTickHookRva:X} is not a function entry for sha256={sha256}.");
                    return false;
                }

                PluginLogger.Warning(
                    $"Unrecognized game_plugin.dll build; trying fallback GAME_MATCH hook RVA " +
                    $"0x{build.MatchTickHookRva:X} for sha256={sha256}.");
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
        // Tactical offsets have only been verified against this exact binary.
        _tacticsLayoutSupported = supportedBuild && build.Distribution == "steam-26340721";
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
            StartCaptureWorkers();
            PluginLogger.Debug(
                $"GAME_MATCH Advance post hook installed with permanent native trampoline at " +
                $"game_plugin.dll+0x{_instructionOffset:X} ({FormatPointer(_targetAddress)}), " +
                $"trampoline={FormatPointer(_detour.TrampolinePtr)}.");
            PluginLogger.Info(
                $"GAME_MATCH Advance hook installed for {build.Distribution} build " +
                $"(sha256={build.Sha256}, rva=0x{build.MatchTickHookRva:X}).");
            return true;
        }
        catch (Exception ex)
        {
            PluginLogger.Warning($"Unable to install GAME_MATCH Advance hook: {ex.Message}");
            _detour?.Dispose();
            _detour = null;
            _original = null;
            return false;
        }
    }

    private void StartCaptureWorkers()
    {
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
    }

    public void Stop()
    {
        if (!_started) return;
        _detour?.Dispose();
        _detour = null;
        SpinWait.SpinUntil(() => Volatile.Read(ref _activeHookCalls) == 0);
        _original = null;
        _started = false;
        _diagnosticsTimer?.DisposeAsync().AsTask().GetAwaiter().GetResult();
        _diagnosticsTimer = null;
        _tickDrainTimer?.DisposeAsync().AsTask().GetAwaiter().GetResult();
        _tickDrainTimer = null;
        for (var i = 0; i < 40 && (_tickRecords.Count != 0 || _realtimeFrames.ReadyCount != 0); i++)
            DrainTickRecords();
        if (_activeSession is { } session) CloseSession(session, false, "plugin stop");
        FlushPendingDiagnostics();
        _playerUids.Invalidate();
        ClearRatingCaptureState();
        PluginLogger.Debug("GAME_MATCH Advance capture stopped.");
    }

    public void Dispose() => Stop();

    private void MatchUpdateHook(nint match, uint mode, int targetTick)
    {
        Interlocked.Increment(ref _activeHookCalls);
        try
        {
            var original = _original;
            if (original is null) return;
            // Preserve Original+capture serialization for the selected instance.
            if (_activeSession is { } session && session.Animated == match)
            {
                lock (session.CaptureGate)
                    InvokeOriginalAndCapture(original, match, mode, targetTick);
            }
            else InvokeOriginalAndCapture(original, match, mode, targetTick);
        }
        catch (Exception ex)
        {
            try { QueueDiagnostic(DiagnosticSeverity.Error, $"GAME_MATCH Advance hook failed: {ex}"); }
            catch { /* Never propagate managed exceptions across the native boundary. */ }
        }
        finally
        {
            Interlocked.Decrement(ref _activeHookCalls);
        }
    }

    private void InvokeOriginalAndCapture(
        MatchUpdateDelegate original, nint match, uint mode, int targetTick)
    {
        VirtualMemory.InvalidateActiveReadScopes();
        original(match, mode, targetTick);
        using var memoryScope = VirtualMemory.BeginReadScope();
        Interlocked.Exchange(ref _lastMatch, (long)match);
        Interlocked.Exchange(ref _lastParam2, mode);
        Interlocked.Exchange(ref _lastTargetTick, targetTick);
        Interlocked.Increment(ref _callCount);
        CaptureUpdatedMatch(match, mode);
    }

    private void CaptureUpdatedMatch(nint match, uint mode)
    {
        var captured = TryCaptureTickRecord(match, mode, out var record, out var homeValues, out var awayValues);
        if (!captured) return;
        var observation = ObserveInstanceIdentity(record);
        record = record with { InstanceGeneration = observation.Generation, Identity = observation.Identity };
        var capture = _activeSession;
        var hasCapture = capture is not null && capture.Animated == match;
        if (hasCapture && capture!.Generation != record.InstanceGeneration) capture.Invalidated = true;
        try
        {
            if (!record.IsTerminal && record.InstanceGeneration != 0 &&
                (hasCapture && !capture!.Invalidated && capture.Generation == record.InstanceGeneration ||
                 (!hasCapture || capture!.Generation != record.InstanceGeneration) && record.Tick is >= 0 and <= PreLockCaptureMaxTick))
            {
                var queued = TryCaptureRealtimeFrame(record, homeValues, awayValues);
                record = record with { FinalFrameQueued = record.FinishedByFlags && queued };
            }
        }
        finally
        {
            // Publish after the frame, including explicit failure evidence when
            // snapshot capture throws. Never finalize ahead of its consumption.
            _tickRecords.TryWrite(record);
        }
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
                    var targetTick = Interlocked.Read(ref _lastTargetTick);
                    PluginLogger.Debug(
                        $"[Advance] GAME_MATCH hook alive: calls={callCount}, callsSinceLastLog={callCount - previous}, " +
                        $"match={FormatPointer(match)}, mode={param2}, targetTick={targetTick}.");
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

    private bool TryCaptureTickRecord(
        nint match, ulong param2, out GameMatchTickRecord record,
        out TeamTickSnapshot homeValues, out TeamTickSnapshot awayValues)
    {
        record = default;
        homeValues = awayValues = default;
        if (match == default || !_memoryReader.TryReadInt32(match + Offsets.GameMatch.Tick, out var tick))
        {
            return false;
        }

        var homeTeamRead = _memoryReader.TryReadPointer(match + Offsets.GameMatch.HomeTeam, out var homeTeam);
        var awayTeamRead = _memoryReader.TryReadPointer(match + Offsets.GameMatch.AwayTeam, out var awayTeam);
        var homePlayerCountRead = TryReadTeamPlayerCount(homeTeam, out var homePlayerCount);
        var awayPlayerCountRead = TryReadTeamPlayerCount(awayTeam, out var awayPlayerCount);
        _memoryReader.TryReadInt32(match + Offsets.GameMatch.DisplayTick, out var displayTick);
        _memoryReader.TryReadByte(match + Offsets.GameMatch.Period, out var period);
        var finishedByFlags = _memoryReader.TryReadUInt32(match + Offsets.GameMatch.RatingBaseCondition, out var matchFlags) &&
                              (matchFlags & 4) != 0;
        _memoryReader.TryReadByte(match + Offsets.GameMatch.LifecycleStateA, out var lifecycleStateA);
        _memoryReader.TryReadByte(match + Offsets.GameMatch.LifecycleStateB, out var lifecycleStateB);
        _memoryReader.TryReadByte(match + Offsets.GameMatch.LifecycleStateC, out var lifecycleStateC);
        _memoryReader.TryReadByte(match + Offsets.GameMatch.LifecycleStateD, out var lifecycleStateD);
        _memoryReader.TryReadPointer(match + Offsets.GameMatch.PossessionTeam, out var possessionTeam);
        _memoryReader.TryReadPointer(match + Offsets.GameMatch.CurrentBallHolder, out var currentBallHolder);

        var totalPlayerCount = homePlayerCount + awayPlayerCount;
        var isActive = homeTeam != default && awayTeam != default && homeTeam != awayTeam &&
                       homePlayerCountRead && awayPlayerCountRead &&
                       homePlayerCount > 0 && awayPlayerCount > 0 &&
                       totalPlayerCount <= RawRealtimeTickFrame.MaxPlayers;
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
            _playerUids.Invalidate();
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

        homeValues = TeamTickSnapshot.Read(_memoryReader, homeTeam);
        awayValues = TeamTickSnapshot.Read(_memoryReader, awayTeam);

        record = new GameMatchTickRecord(
            Sequence: Interlocked.Increment(ref _tickRecordSequence),
            CapturedTimestamp: Stopwatch.GetTimestamp(),
            MatchAddress: match,
            Param2: param2,
            IsTerminal: isTerminal,
            Tick: tick,
            DisplayTick: displayTick,
            Period: period,
            LifecycleStateA: lifecycleStateA,
            LifecycleStateB: lifecycleStateB,
            LifecycleStateC: lifecycleStateC,
            LifecycleStateD: lifecycleStateD,
            HomePlayerCount: homePlayerCount,
            AwayPlayerCount: awayPlayerCount,
            HomeTeam: homeTeam,
            AwayTeam: awayTeam,
            PossessionTeam: possessionTeam,
            CurrentBallHolder: currentBallHolder,
            HomeGoals: homeValues.Goals,
            AwayGoals: awayValues.Goals,
            HomeXg: homeValues.Xg,
            AwayXg: awayValues.Xg,
            HomeShots: homeValues.Shots,
            AwayShots: awayValues.Shots) { FinishedByFlags = finishedByFlags };
        return true;
    }

    private bool TryReadTeamPlayerCount(nint team, out byte playerCount)
    {
        playerCount = 0;
        return team != default &&
               _memoryReader.TryReadByte(team + Offsets.Team.PlayerCount, out playerCount) &&
               playerCount <= RawRealtimeTickFrame.MaxPlayers;
    }

    private bool TryCaptureRealtimeFrame(
        in GameMatchTickRecord record, in TeamTickSnapshot homeValues, in TeamTickSnapshot awayValues)
    {
        if (!_realtimeFrames.TryRent(out var frame))
        {
            return false;
        }

        var published = false;
        try
        {
            frame.Sequence = record.Sequence;
            frame.InstanceGeneration = record.InstanceGeneration;
            frame.FinishedByFlags = record.FinishedByFlags;
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
            frame.RatingResearch = null;
            frame.Tactics = null;
            frame.PossessionTeam = record.PossessionTeam == record.HomeTeam
                ? TeamSide.Home
                : record.PossessionTeam == record.AwayTeam
                    ? TeamSide.Away
                    : null;
            frame.BallHolderPlayerId = 0;
            CaptureBallPosition(record.MatchAddress, frame);
            frame.Home = ReadTeamFrame(homeValues);
            frame.Away = ReadTeamFrame(awayValues);
            NativeMomentumSource momentumSource;
            if (_activeSession is { Invalidated: false } session && session.Animated == record.MatchAddress &&
                session.Generation == record.InstanceGeneration) session.Momentum.Capture(
                record.MatchAddress,
                out momentumSource,
                frame.Momentum,
                out frame.MomentumCount,
                frame.RollingMomentum,
                out frame.RollingMomentumCount);
            else NativeMomentumSource.TryRead(record.MatchAddress, out momentumSource);
            CaptureNativeMomentumEvents(record.MatchAddress, frame, momentumSource);

            Span<nint> capturedMatchPlayers = stackalloc nint[RawRealtimeTickFrame.MaxPlayers];
            var uidCapture = _playerUids.Begin(record.MatchAddress, record.HomeTeam, record.AwayTeam, record.Tick, Stopwatch.GetTimestamp());
            CaptureTeamPlayerFrames(
                frame,
                record.HomeTeam,
                record.HomePlayerCount,
                TeamSide.Home,
                slotOffset: 0,
                record.CurrentBallHolder,
                uidCapture,
                capturedMatchPlayers);
            CaptureTeamPlayerFrames(
                frame,
                record.AwayTeam,
                record.AwayPlayerCount,
                TeamSide.Away,
                slotOffset: record.HomePlayerCount,
                record.CurrentBallHolder,
                uidCapture,
                capturedMatchPlayers);

            CaptureRatingFrameData(record.MatchAddress, record.Tick, frame, capturedMatchPlayers);
            if (_tacticsLayoutSupported && _activeSession is { Invalidated: false } tacticalSession &&
                tacticalSession.Animated == record.MatchAddress && tacticalSession.Generation == record.InstanceGeneration)
                frame.Tactics = tacticalSession.Tactics.Capture(record.HomeTeam, record.AwayTeam, frame, capturedMatchPlayers);

            ResolveDerivedTeamStats(frame);
            ResolveMomentumEventPlayerIds(
                frame,
                record.HomeTeam,
                record.HomePlayerCount,
                record.AwayTeam,
                record.AwayPlayerCount);

            _realtimeFrames.Publish(frame);
            published = true;
            return true;
        }
        finally
        {
            if (!published)
            {
                _realtimeFrames.ReleaseUnpublished(frame);
            }
        }
    }

    private void CaptureBallPosition(nint match, RawRealtimeTickFrame frame)
    {
        var ball = BallPositionSnapshot.Read(_memoryReader, match);
        frame.BallXCentimeters = ball.X;
        frame.BallYCentimeters = ball.Y;
        frame.BallZCentimeters = ball.Z;
    }

    private void CaptureTeamPlayerFrames(
        RawRealtimeTickFrame frame,
        nint team,
        int playerCount,
        TeamSide teamSide,
        int slotOffset,
        nint ballHolder,
        in PlayerUidCache.Capture uidCapture,
        Span<nint> capturedMatchPlayers)
    {
        for (var teamSlot = 0; teamSlot < playerCount && frame.PlayerCount < RawRealtimeTickFrame.MaxPlayers; teamSlot++)
        {
            var pointerSlot = team + Offsets.Team.PlayerTable + teamSlot * IntPtr.Size;
            var apiSlot = slotOffset + teamSlot;
            if (!_memoryReader.TryReadPointer(pointerSlot, out var matchPlayer) ||
                matchPlayer == default ||
                !TryReadPlayerFrame(matchPlayer, apiSlot, teamSide, ballHolder, uidCapture, out var player))
            {
                continue;
            }

            capturedMatchPlayers[frame.PlayerCount] = matchPlayer;
            frame.Players[frame.PlayerCount++] = player;
            if (player.IsBallHolder)
            {
                frame.BallHolderPlayerId = player.PlayerId;
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

    private void CaptureNativeMomentumEvents(nint match, RawRealtimeTickFrame frame, in NativeMomentumSource snapshot)
    {
        if (snapshot.Address == 0) return;
        var source = snapshot.Address;
        var begin = snapshot.Begin;
        frame.HalfPitchWidth = snapshot.HalfWidth;
        frame.HalfPitchLength = snapshot.HalfLength;
        var eventCount = snapshot.Count;
        if (eventCount == 0) return;

        lock (_nativeMomentumGate)
        {
            if (!_nativeMomentumStates.TryGetValue(match, out var state))
            {
                state = new NativeMomentumCaptureState { Generation = frame.InstanceGeneration };
                _nativeMomentumStates.Add(match, state);
            }
            if (state.Generation > frame.InstanceGeneration) return;
            if (state.Generation != frame.InstanceGeneration)
                _nativeMomentumStates[match] = state = new NativeMomentumCaptureState { Generation = frame.InstanceGeneration };

            var reset = state.Source != source || state.Begin != begin || eventCount < state.EventCount;
            if (state.Source != source || eventCount < state.EventCount)
            {
                state.TailChangeCount = 0;
                state.MaxBackfillDepth = 0;
            }
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
            if (!reset && start < state.EventCount)
            {
                state.TailChangeCount++;
                state.MaxBackfillDepth = Math.Max(state.MaxBackfillDepth, state.EventCount - start);
            }
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
            frame.MomentumNativeTailChanges = state.TailChangeCount;
            frame.MomentumMaxBackfillDepth = state.MaxBackfillDepth;
        }
    }

    private static bool IsPublishedMomentumEventType(byte eventType)
    {
        // Preserve the native output type range. The UI
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
        // Callers validate the complete MomentumEvent before reading its header.
        begin = Marshal.ReadIntPtr(address + Offsets.MomentumEvent.TrajectoryPointsBegin);
        var end = Marshal.ReadIntPtr(address + Offsets.MomentumEvent.TrajectoryPointsEnd);
        var capacity = Marshal.ReadIntPtr(address + Offsets.MomentumEvent.TrajectoryPointsCapacity);
        pointCount = 0;
        var startAddress = (ulong)begin;
        var endAddress = (ulong)end;
        var capacityAddress = (ulong)capacity;
        if (begin == default || endAddress <= startAddress || capacityAddress < endAddress)
        {
            return false;
        }

        var length = endAddress - startAddress;
        if (length % Offsets.MomentumEvent.TrajectoryPointSize != 0 ||
            (capacityAddress - startAddress) % Offsets.MomentumEvent.TrajectoryPointSize != 0 ||
            length / Offsets.MomentumEvent.TrajectoryPointSize > MaxNativeMomentumTrajectoryPoints)
        {
            return false;
        }

        var count = (int)(length / Offsets.MomentumEvent.TrajectoryPointSize);
        if (!VirtualMemory.IsReadable(begin, (int)length))
        {
            // Preserve valid vectors crossing readable regions. The original
            // per-point read also rejected a point crossing a region boundary.
            for (var index = 0; index < count; index++)
            {
                if (!VirtualMemory.IsReadable(
                        begin + index * Offsets.MomentumEvent.TrajectoryPointSize,
                        Offsets.MomentumEvent.TrajectoryPointSize)) return false;
            }
        }
        pointCount = count;
        return true;
    }

    private void ResolveMomentumEventPlayerIds(
        RawRealtimeTickFrame frame,
        nint homeTeam,
        int homePlayerCount,
        nint awayTeam,
        int awayPlayerCount)
    {
        Span<long> ids = stackalloc long[RawRealtimeTickFrame.MaxPlayers];
        var identities = new FramePlayerIdentityCache(ids, homePlayerCount, awayPlayerCount);
        for (var index = 0; index < frame.PlayerCount; index++)
            identities.Remember(frame.Players[index].Slot, frame.Players[index].PlayerId);
        for (var eventIndex = 0; eventIndex < frame.MomentumEventCount; eventIndex++)
        {
            var item = frame.MomentumEvents[eventIndex];
            var team = item.Team == TeamSide.Home ? homeTeam : awayTeam;
            var playerCount = item.Team == TeamSide.Home ? homePlayerCount : awayPlayerCount;
            var playerId = TryResolveMomentumEventPlayerId(team, playerCount, item.PlayerSlot, item.Team == TeamSide.Home, identities, out var actorId)
                ? actorId
                : 0;
            var receiverPlayerId = item.ReceiverPlayerSlot != byte.MaxValue &&
                                   TryResolveMomentumEventPlayerId(
                                       team,
                                       playerCount,
                                       item.ReceiverPlayerSlot,
                                       item.Team == TeamSide.Home,
                                       identities,
                                       out var receiverId)
                ? receiverId
                : 0;

            frame.MomentumEvents[eventIndex] = item with
            {
                PlayerId = playerId,
                ReceiverPlayerId = receiverPlayerId,
            };
        }
    }

    private bool TryResolveMomentumEventPlayerId(
        nint team, int playerCount, int slot, bool home, in FramePlayerIdentityCache identities, out long playerId)
    {
        playerId = 0;
        if (team == default || slot is < 0 or >= RawRealtimeTickFrame.MaxPlayers ||
            slot >= playerCount) return false;
        if (identities.TryGet(home, slot, out playerId))
        {
            return true;
        }
        if (!_memoryReader.TryReadPointer(team + Offsets.Team.PlayerTable + slot * IntPtr.Size, out var matchPlayer) ||
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

    private bool TryReadPlayerFrame(
        nint matchPlayer,
        int slot,
        TeamSide team,
        nint ballHolder,
        in PlayerUidCache.Capture uidCapture,
        out PlayerTickData player)
    {
        player = default;
        if (!VirtualMemory.IsReadable(matchPlayer, Offsets.MatchPlayer.Stats + IntPtr.Size))
        {
            return false;
        }

        var stats = Marshal.ReadIntPtr(matchPlayer + Offsets.MatchPlayer.Stats);
        if (stats == default || !VirtualMemory.IsReadable(
                stats,
                Offsets.PlayerStats.RatingInputReadableSize))
        {
            return false;
        }

        var playerUid = PlayerUidReader.TryReadValidatedPlayer(_memoryReader, uidCapture, slot, matchPlayer, out var uid) ? uid : (uint?)null;
        var playerId = playerUid.HasValue ? playerUid.Value : FallbackPlayerIdentity(slot);
        var starterFlag = ReadByteDirect(stats + Offsets.PlayerStats.StarterSubstituteFlag);
        var subbedOn = ReadByteDirect(stats + Offsets.PlayerStats.SubbedOnMinute);
        var subbedOff = ReadByteDirect(stats + Offsets.PlayerStats.SubbedOffMinute);
        ReadPlayerMovement(matchPlayer, out var speedCentimetersPerSecond, out var angleDegrees);

        player = new PlayerTickData(
            Slot: slot,
            PlayerId: playerId,
            Team: team,
            IsBallHolder: matchPlayer == ballHolder,
            X: ReadFloatDirect(matchPlayer + Offsets.MatchPlayer.PositionX),
            Y: ReadFloatDirect(matchPlayer + Offsets.MatchPlayer.PositionY),
            SpeedCentimetersPerSecond: speedCentimetersPerSecond,
            AngleDegrees: angleDegrees,
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
            ProgressivePasses: ReadByteDirect(stats + Offsets.PlayerStats.ProgressivePasses),
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

    private void CaptureRatingFrameData(
        nint match,
        int tick,
        RawRealtimeTickFrame frame,
        ReadOnlySpan<nint> capturedMatchPlayers)
    {
        lock (_ratingCaptureGate)
        {
            if (_ratingGenerations.TryGetValue(match, out var generation))
            {
                if (generation > frame.InstanceGeneration) return;
                if (generation != frame.InstanceGeneration) ClearRatingInstanceLocked(match);
            }
            _ratingGenerations[match] = frame.InstanceGeneration;
            if (_lastRatingCapturedTickByMatch.TryGetValue(match, out var previousTick) && previousTick == tick)
            {
                _lastRatingMatchByMatch.TryGetValue(match, out var previousMatch);
                frame.RatingResearch = previousMatch;
                for (var index = 0; index < frame.PlayerCount; index++)
                {
                    var slot = frame.Players[index].Slot;
                    if (_lastRatingResearchBySlot.TryGetValue((match, slot), out var previousPlayer))
                    {
                        frame.Players[index] = frame.Players[index] with { RatingResearch = previousPlayer };
                        continue;
                    }

                    var matchPlayer = capturedMatchPlayers[index];
                    if (matchPlayer != default &&
                        _memoryReader.TryReadPointer(matchPlayer + Offsets.MatchPlayer.Stats, out var stats) &&
                        stats != default)
                    {
                        frame.Players[index] = frame.Players[index] with
                        {
                            RatingResearch = CaptureRatingPlayerData(match, matchPlayer, stats, slot),
                        };
                    }
                }
                return;
            }

            frame.RatingResearch = CaptureRatingMatchData(match);
            for (var index = 0; index < frame.PlayerCount; index++)
            {
                var matchPlayer = capturedMatchPlayers[index];
                if (matchPlayer == default ||
                    !_memoryReader.TryReadPointer(matchPlayer + Offsets.MatchPlayer.Stats, out var stats) ||
                    stats == default)
                {
                    continue;
                }

                frame.Players[index] = frame.Players[index] with
                {
                    RatingResearch = CaptureRatingPlayerData(
                        match,
                        matchPlayer,
                        stats,
                        frame.Players[index].Slot),
                };
            }
            _lastRatingMatchByMatch[match] = frame.RatingResearch;
            _lastRatingCapturedTickByMatch[match] = tick;
        }
    }

    private RatingResearchMatchData? CaptureRatingMatchData(nint match)
    {
        _memoryReader.TryReadUInt32(match + Offsets.GameMatch.RatingBaseCondition, out var baseCondition);
        _memoryReader.TryReadByte(match + Offsets.GameMatch.LifecycleStateC, out var matchPhase);
        _memoryReader.TryReadByte(match + Offsets.GameMatch.EventRewardBranch, out var eventRewardBranch);
        if (!TryGetOrCaptureRatingBackground(match, out var background)) return null;
        return new RatingResearchMatchData(
            baseCondition,
            matchPhase,
            eventRewardBranch,
            ActiveRatingBaseline,
            background.Home,
            background.Away);
    }

    private bool TryGetOrCaptureRatingBackground(nint match, out (float Home, float Away) value)
    {
        if (_ratingBackgroundByMatch.TryGetValue(match, out value)) return true;
        if (!TryReadTeamRatingBackground(match, Offsets.GameMatch.HomeTeam, out var home) ||
            !TryReadTeamRatingBackground(match, Offsets.GameMatch.AwayTeam, out var away))
        {
            value = default;
            return false;
        }
        value = (home, away);
        _ratingBackgroundByMatch[match] = value;
        return true;
    }

    private bool TryReadTeamRatingBackground(nint match, int teamOffset, out float value)
    {
        value = 0;
        if (!_memoryReader.TryReadPointer(match + teamOffset, out var team) ||
            team == default ||
            !_memoryReader.TryReadPointer(team + Offsets.Team.PlayerTable, out var player) ||
            player == default ||
            !_memoryReader.TryReadPointer(player + Offsets.MatchPlayer.RatingContext298, out var context) ||
            context == default ||
            !_memoryReader.TryReadFloat(context + Offsets.RatingContext.MatchBackgroundInput, out value))
        {
            value = 0;
            return false;
        }
        return float.IsFinite(value);
    }

    private RatingResearchPlayerData CaptureRatingPlayerData(
        nint match,
        nint player,
        nint stats,
        int slot)
    {
        var cacheKey = (match, slot);
        _lastRatingResearchBySlot.TryGetValue(cacheKey, out var previous);
        ReadPointer(player, Offsets.MatchPlayer.RatingContext288, out var context288);
        ReadPointer(player, Offsets.MatchPlayer.RatingContext290, out var context290);

        var ratingEvents = ReadRawRecords(
            player,
            Offsets.MatchPlayer.RatingEventsBegin,
            Offsets.MatchPlayer.RatingEventsEnd,
            Offsets.RatingEvent.Size,
            previous?.RatingEventsRaw);
        var eligibleDuration = ReadEligibleDuration(player);
        var inPossessionRoleDuty = ReadUInt64(player, Offsets.MatchPlayer.InPossessionRoleDuty);

        var result = new RatingResearchPlayerData(
            Stats: CaptureRatingStatsInputs(stats),
            InternalW25: ReadInt32(player, Offsets.MatchPlayer.InternalW25),
            InternalW24: ReadInt32(player, Offsets.MatchPlayer.InternalW24),
            SpecialW2C: ReadSByte(player, Offsets.MatchPlayer.SpecialW2C),
            SpecialW2D: ReadSByte(player, Offsets.MatchPlayer.SpecialW2D),
            SpecialW2E: ReadSByte(player, Offsets.MatchPlayer.SpecialW2E),
            SpecialW2F: ReadByte(player, Offsets.MatchPlayer.SpecialW2F),
            SpecialW30: ReadByte(player, Offsets.MatchPlayer.SpecialW30),
            SpecialW31: ReadByte(player, Offsets.MatchPlayer.SpecialW31),
            RawInternalRating: ReadInt32(player, Offsets.MatchPlayer.RawInternalRating),
            InPossessionRoleDuty: inPossessionRoleDuty,
            OutOfPossessionRoleDuty: ReadUInt64(player, Offsets.MatchPlayer.OutOfPossessionRoleDuty),
            SpecialConditionA: ReadSByte(context288, Offsets.RatingContext.SpecialCondition),
            SpecialConditionB: ReadSByte(context290, Offsets.RatingContext.SpecialCondition),
            TeamAEventCounterCandidate: ReadByte(context288, Offsets.RatingContext.EventCounterCandidate),
            TeamBEventCounterCandidate: ReadByte(context290, Offsets.RatingContext.EventCounterCandidate),
            TeamAEventAdjustmentCandidate: ReadByte(context288, Offsets.RatingContext.EventAdjustmentCandidate),
            TeamBEventAdjustmentCandidate: ReadByte(context290, Offsets.RatingContext.EventAdjustmentCandidate),
            TotalEligibleDuration: eligibleDuration,
            RatingEventsRaw: ratingEvents);
        _lastRatingResearchBySlot[cacheKey] = result;
        return result;

        bool ReadPointer(nint source, int offset, out nint value)
        {
            value = default;
            return source != default && _memoryReader.TryReadPointer(source + offset, out value);
        }
        int ReadInt32(nint source, int offset) =>
            source != default && _memoryReader.TryReadInt32(source + offset, out var value) ? value : 0;
        ulong ReadUInt64(nint source, int offset) =>
            source != default && _memoryReader.TryReadUInt64(source + offset, out var value) ? value : 0;
        byte ReadByte(nint source, int offset) =>
            source != default && _memoryReader.TryReadByte(source + offset, out var value) ? value : (byte)0;
        sbyte ReadSByte(nint source, int offset) => unchecked((sbyte)ReadByte(source, offset));
        float ReadFloat(nint source, int offset) =>
            source != default && _memoryReader.TryReadFloat(source + offset, out var value) && float.IsFinite(value)
                ? value
                : 0f;
        short ReadInt16(nint source, int offset) =>
            source != default && _memoryReader.TryReadInt16(source + offset, out var value) ? value : (short)0;
        RatingStatsInputs CaptureRatingStatsInputs(nint source) => new(
            ReadFloat(source, Offsets.PlayerStats.Xg),
            ReadFloat(source, Offsets.PlayerStats.OpenPlayXa),
            ReadByte(source, Offsets.PlayerStats.Goals),
            ReadByte(source, Offsets.PlayerStats.PenaltyAttempts),
            ReadByte(source, Offsets.PlayerStats.Penalties),
            ReadByte(source, Offsets.PlayerStats.OwnGoals),
            ReadByte(source, Offsets.PlayerStats.Shots),
            ReadByte(source, Offsets.PlayerStats.ShotsOnTarget),
            ReadByte(source, Offsets.PlayerStats.SavesHeld),
            ReadByte(source, Offsets.PlayerStats.SavesParried),
            ReadByte(source, Offsets.PlayerStats.SavesTipped),
            ReadByte(source, Offsets.PlayerStats.DefensiveBlocks),
            ReadByte(source, Offsets.PlayerStats.PenaltiesFaced),
            ReadByte(source, Offsets.PlayerStats.PenaltiesSaved),
            ReadByte(source, Offsets.PlayerStats.Assists),
            ReadByte(source, Offsets.PlayerStats.ChancesCreated),
            ReadByte(source, Offsets.PlayerStats.Dribbles),
            ReadByte(source, Offsets.PlayerStats.Fouls),
            ReadByte(source, Offsets.PlayerStats.Fouled),
            ReadByte(source, Offsets.PlayerStats.YellowCards),
            ReadByte(source, Offsets.PlayerStats.RedCards),
            ReadByte(source, Offsets.PlayerStats.OpenPlayKeyPasses),
            ReadByte(source, Offsets.PlayerStats.TacklesAttempted),
            ReadByte(source, Offsets.PlayerStats.TacklesWon),
            ReadByte(source, Offsets.PlayerStats.Aerials),
            ReadByte(source, Offsets.PlayerStats.AerialsWon),
            ReadByte(source, Offsets.PlayerStats.Interceptions),
            ReadByte(source, Offsets.PlayerStats.ErrorsLeadingToShotOrGoalCandidate),
            ReadByte(source, Offsets.PlayerStats.TeamGoalsWhileOnPitch),
            ReadByte(source, Offsets.PlayerStats.TeamConcededWhileOnPitch),
            ReadByte(source, Offsets.PlayerStats.PossessionWon),
            ReadByte(source, Offsets.PlayerStats.Clearances),
            ReadByte(source, Offsets.PlayerStats.CrossAttemptsTypeOne),
            ReadByte(source, Offsets.PlayerStats.CrossAttemptsTypeTwo),
            ReadByte(source, Offsets.PlayerStats.CrossCompletionsTypeOne),
            ReadByte(source, Offsets.PlayerStats.CrossCompletionsTypeTwo),
            ReadByte(source, Offsets.PlayerStats.GoalsConceded),
            ReadByte(source, Offsets.PlayerStats.Offsides),
            ReadByte(source, Offsets.PlayerStats.HeadersLost),
            ReadByte(source, Offsets.PlayerStats.PossessionLost),
            ReadByte(source, Offsets.PlayerStats.PressesAttempted),
            ReadByte(source, Offsets.PlayerStats.PressesWon),
            ReadInt16(source, Offsets.PlayerStats.ShortPassesAttemptedCandidate),
            ReadInt16(source, Offsets.PlayerStats.LongPassesAttemptedCandidate),
            ReadInt16(source, Offsets.PlayerStats.ShortPassesCompletedCandidate),
            ReadInt16(source, Offsets.PlayerStats.LongPassesCompletedCandidate),
            ReadByte(source, Offsets.PlayerStats.ShotsOutsideBox),
            ReadByte(source, Offsets.PlayerStats.Sprints));
    }

    private IReadOnlyList<byte[]> ReadRawRecords(
        nint owner,
        int beginOffset,
        int endOffset,
        int recordSize,
        IReadOnlyList<byte[]>? previous)
    {
        const int maximumRecords = 4_096;
        if (!_memoryReader.TryReadPointer(owner + beginOffset, out var begin) ||
            !_memoryReader.TryReadPointer(owner + endOffset, out var end) ||
            begin == default)
        {
            return Array.Empty<byte[]>();
        }

        var byteLength = (long)end - (long)begin;
        if (byteLength < 0 || byteLength % recordSize != 0 ||
            byteLength / recordSize > maximumRecords || byteLength > int.MaxValue ||
            (byteLength > 0 && !VirtualMemory.IsReadable(begin, checked((int)byteLength))))
        {
            return Array.Empty<byte[]>();
        }

        var count = checked((int)(byteLength / recordSize));
        if (count == 0) return Array.Empty<byte[]>();
        byte[][]? records = previous?.Count == count ? null : new byte[count][];
        for (var index = 0; index < count; index++)
        {
            var address = begin + index * recordSize;
            var unchanged = previous is not null && index < previous.Count &&
                            RawRecordMatches(address, previous[index], recordSize);
            if (records is null && !unchanged)
            {
                records = new byte[count][];
                for (var prefix = 0; prefix < index; prefix++) records[prefix] = previous![prefix];
            }

            if (records is null) continue;
            if (unchanged) records[index] = previous![index];
            else
            {
                records[index] = new byte[recordSize];
                Marshal.Copy(address, records[index], 0, recordSize);
            }
        }
        return records ?? previous!;
    }

    private static bool RawRecordMatches(nint address, byte[] previous, int recordSize)
    {
        if (previous.Length != recordSize) return false;
        var offset = 0;
        for (; offset + sizeof(long) <= recordSize; offset += sizeof(long))
        {
            if (Marshal.ReadInt64(address + offset) != BitConverter.ToInt64(previous, offset)) return false;
        }
        for (; offset < recordSize; offset++)
        {
            if (Marshal.ReadByte(address + offset) != previous[offset]) return false;
        }
        return true;
    }

    private int ReadEligibleDuration(nint player)
    {
        if (!_memoryReader.TryReadPointer(player + Offsets.MatchPlayer.CategoryHistoryBegin, out var begin) ||
            !_memoryReader.TryReadPointer(player + Offsets.MatchPlayer.CategoryHistoryEnd, out var end) ||
            begin == default)
        {
            return 0;
        }

        var byteLength = (long)end - (long)begin;
        if (byteLength < 0 || byteLength % Offsets.RatingCategoryHistory.Size != 0 ||
            byteLength / Offsets.RatingCategoryHistory.Size > 4_096 || byteLength > int.MaxValue ||
            (byteLength > 0 && !VirtualMemory.IsReadable(begin, checked((int)byteLength))))
        {
            return 0;
        }

        long total = 0;
        var count = checked((int)(byteLength / Offsets.RatingCategoryHistory.Size));
        for (var index = 0; index < count; index++)
        {
            var record = begin + index * Offsets.RatingCategoryHistory.Size;
            var encoded = unchecked((ushort)Marshal.ReadInt16(record + Offsets.RatingCategoryHistory.EncodedCategory));
            if (!RatingCategoryHistoryDecoder.IsEligible(encoded)) continue;
            var duration = Marshal.ReadInt32(record + Offsets.RatingCategoryHistory.Duration);
            if (duration > 0) total += duration;
        }
        return checked((int)Math.Min(total, int.MaxValue));
    }

    private void ClearRatingCaptureState()
    {
        lock (_ratingCaptureGate)
        {
            _lastRatingResearchBySlot.Clear();
            _ratingBackgroundByMatch.Clear();
            _lastRatingCapturedTickByMatch.Clear();
            _ratingGenerations.Clear();
            _lastRatingMatchByMatch.Clear();
        }
    }

    private bool ReadPlayerMovement(
        nint matchPlayer,
        out ushort speedCentimetersPerSecond,
        out ushort? angleDegrees)
    {
        speedCentimetersPerSecond = 0;
        angleDegrees = null;
        if (!_memoryReader.TryReadPointer(
                matchPlayer + Offsets.MatchPlayer.PositionHistory,
                out var positionHistory) ||
            positionHistory == default ||
            !VirtualMemory.IsReadable(
                positionHistory,
                Offsets.PositionHistory.Angle + sizeof(ushort)))
        {
            return false;
        }

        var speedMetersPerSecond = ReadFloatDirect(positionHistory + Offsets.PositionHistory.Speed);
        var angle = unchecked((ushort)Marshal.ReadInt16(
            positionHistory + Offsets.PositionHistory.Angle));
        if (!float.IsFinite(speedMetersPerSecond) || speedMetersPerSecond < 0 ||
            speedMetersPerSecond > ushort.MaxValue / 100f || angle > 360)
        {
            return false;
        }

        speedCentimetersPerSecond = checked((ushort)Math.Round(
            speedMetersPerSecond * 100f,
            MidpointRounding.AwayFromZero));
        angleDegrees = angle;
        return true;
    }

    private TeamTickData ReadTeamFrame(in TeamTickSnapshot snapshot)
    {
        var teamBase = snapshot.TeamBase;
        if (teamBase == default ||
            !VirtualMemory.IsReadable(teamBase, Offsets.TeamBase.MatchSquadUnconfirmed + IntPtr.Size))
        {
            return default;
        }

        return new TeamTickData(
            Goals: snapshot.Goals,
            Xg: snapshot.Xg,
            PossessionTime: Marshal.ReadInt32(teamBase + Offsets.TeamBase.PossessionTime),
            Shots: snapshot.Shots,
            ShotsOnTarget: ReadByteDirect(teamBase + Offsets.TeamBase.ShotsOnTarget),
            FirstHalfShots: ReadByteDirect(teamBase + Offsets.TeamBase.FirstHalfShots),
            SecondHalfShots: ReadByteDirect(teamBase + Offsets.TeamBase.SecondHalfShots),
            // +0x172 does not equal the native missed-target event count in the
            // validated 3-1 match because it stores second-half shots. Keep the
            // API field derived from reliable player/native-event data.
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
            YellowCards: ReadByteDirect(teamBase + Offsets.TeamBase.YellowCards),
            RedCards: ReadByteDirect(teamBase + Offsets.TeamBase.RedCards));
    }

    private static byte ReadByteDirect(nint address) => Marshal.ReadByte(address);

    private static float ReadFloatDirect(nint address)
    {
        var value = BitConverter.Int32BitsToSingle(Marshal.ReadInt32(address));
        return float.IsFinite(value) ? value : 0f;
    }

    private void TryCapturePlayerMetadata(nint match)
    {
        var session = _activeSession;
        if (session is null || session.Animated != match || session.Invalidated) return;
        var captureTimestamp = Stopwatch.GetTimestamp();
        if (session.LastMetadataTimestamp != 0 &&
            captureTimestamp - session.LastMetadataTimestamp < Stopwatch.Frequency)
        {
            return;
        }

        try
        {
            if (!Monitor.TryEnter(session.CaptureGate)) return;
            Action? publish;
            try
            {
                using var scope = VirtualMemory.BeginReadScope();
                session.LastMetadataTimestamp = captureTimestamp;
                publish = CapturePlayerMetadata(match);
            }
            finally { Monitor.Exit(session.CaptureGate); }
            // Encoding and writer operations use managed copies, outside the
            // gate that serializes this match's Original+capture callbacks.
            publish?.Invoke();
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

    private Action? CapturePlayerMetadata(nint match)
    {
        var session = _activeSession;
        if (session is null || session.Animated != match || session.Invalidated || !session.CanReadMetadata || !session.Timeline.NeedsPlayerMetadata ||
            !_candidates.TryGetValue(match, out var state) ||
            !state.HasActiveRecord)
        {
            return null;
        }

        var source = state.LastActiveRecord;
        if (!_memoryReader.TryReadPointer(match + Offsets.GameMatch.HomeTeam, out var currentHome) ||
            !_memoryReader.TryReadPointer(match + Offsets.GameMatch.AwayTeam, out var currentAway)) return null;
        var currentIdentity = ReadInstanceIdentity(currentHome, currentAway);
        if (!currentIdentity.HasTeams || session.Identity.DiffersFrom(currentIdentity) ||
            currentHome != source.HomeTeam || currentAway != source.AwayTeam)
        {
            if (session.Identity.DiffersFrom(currentIdentity))
            {
                session.Invalidated = true;
                QueueDiagnostic(DiagnosticSeverity.Info,
                    $"GAME_MATCH metadata identity rejected: match={FormatPointer(match)}, before={session.Identity}, after={currentIdentity}.");
            }
            return null;
        }
        state.MatchDate ??= ReadTemporaryMatchDate(match);
        var metadata = new List<RealtimePlayerMetadata>(source.PlayerCount);
        CaptureTeamPlayerMetadata(
            metadata,
            source.HomeTeam,
            source.HomePlayerCount,
            TeamSide.Home,
            slotOffset: 0);
        CaptureTeamPlayerMetadata(
            metadata,
            source.AwayTeam,
            source.AwayPlayerCount,
            TeamSide.Away,
            slotOffset: source.HomePlayerCount);

        if (metadata.Count > 0)
        {
            var homeMetadata = ReadTeamMetadata(source.HomeTeam, "Home");
            var awayMetadata = ReadTeamMetadata(source.AwayTeam, "Away");
            var date = state.MatchDate;
            var competition = ReadCompetitionMetadata(match);
            return () => session.Timeline.SetMetadata(homeMetadata, awayMetadata, metadata, date, competition);
        }
        return null;
    }

    private void CaptureTeamPlayerMetadata(
        List<RealtimePlayerMetadata> metadata,
        nint team,
        int playerCount,
        TeamSide teamSide,
        int slotOffset)
    {
        for (var teamSlot = 0; teamSlot < playerCount; teamSlot++)
        {
            var pointerSlot = team + Offsets.Team.PlayerTable + teamSlot * IntPtr.Size;
            if (!_memoryReader.TryReadPointer(pointerSlot, out var matchPlayer) || matchPlayer == default)
            {
                continue;
            }

            var slot = slotOffset + teamSlot;

            _memoryReader.TryReadPointer(matchPlayer + Offsets.MatchPlayer.Person, out var person);
            _memoryReader.TryReadPointer(person + Offsets.Person.FullContract, out var fullContract);
            var playerUid = ReadUid(person + Offsets.Person.Uid);
            var playerId = playerUid.HasValue ? playerUid.Value : FallbackPlayerIdentity(slot);
            var squadNumber = fullContract != default &&
                _memoryReader.TryReadByte(fullContract + Offsets.FullContract.SquadNumber, out var contractNumber) && contractNumber > 0
                    ? contractNumber
                    : (byte?)null;
            var shirtNumber = _memoryReader.TryReadByte(matchPlayer + Offsets.MatchPlayer.ShirtNumber, out var matchNumber) && matchNumber > 0
                ? matchNumber
                : (byte?)null;
            var shirtName = ReadInlineNameInstance(matchPlayer, Offsets.MatchPlayer.ShirtName);
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
            if (string.IsNullOrWhiteSpace(shirtName))
            {
                shirtName = displayName;
            }

            var positionFamiliarities = ReadPlayerPositionFamiliarities(person);

            metadata.Add(new RealtimePlayerMetadata(
                slot,
                playerId,
                playerUid,
                teamSide,
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
                positionFamiliarities,
                shirtName,
                squadNumber));
        }

    }

    private RealtimeCompetitionMetadata? ReadCompetitionMetadata(nint match)
    {
        _memoryReader.TryReadPointer(match + Offsets.GameMatch.Competition, out var competition);
        var uid = competition == default
            ? ReadUid(match + Offsets.GameMatch.CompetitionId)
            : ReadUid(competition + Offsets.Competition.Uid) ?? ReadUid(match + Offsets.GameMatch.CompetitionId);
        var name = competition == default
            ? null
            : ReadInlineNameInstance(competition, Offsets.Competition.Name);
        var primaryColour = ReadOptionalUInt32(match + Offsets.GameMatch.CompetitionPrimaryColour);
        var secondaryColour = ReadOptionalUInt32(match + Offsets.GameMatch.CompetitionSecondaryColour);
        var tertiaryColour = ReadOptionalUInt32(match + Offsets.GameMatch.CompetitionTertiaryColour);
        return uid.HasValue || name is not null || primaryColour.HasValue || secondaryColour.HasValue || tertiaryColour.HasValue
            ? new RealtimeCompetitionMetadata(uid, name, null, primaryColour, secondaryColour, tertiaryColour)
            : null;
    }

    private bool TryReadPlayerUid(nint matchPlayer, out uint uid)
    {
        uid = 0;
        return matchPlayer != default &&
               _memoryReader.TryReadPointer(matchPlayer + Offsets.MatchPlayer.Person, out var person) &&
               person != default &&
               PlayerUidReader.TryReadPerson(_memoryReader, person, out uid);
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
        _memoryReader.TryReadPointer(team + Offsets.Team.TeamBase, out var teamBase);
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
            ReadManagerMetadata(team),
            IconForegroundColor: KitColor(Offsets.TeamBase.IconForegroundColor),
            IconBackgroundColor: KitColor(Offsets.TeamBase.IconBackgroundColor),
            ShirtBackgroundColor: KitColor(Offsets.TeamBase.ShirtBackgroundColor),
            ShirtForegroundColor: KitColor(Offsets.TeamBase.ShirtForegroundColor),
            ShirtOutlineColor: KitColor(Offsets.TeamBase.ShirtOutlineColor),
            GoalkeeperShirtBackgroundColor: KitColor(Offsets.TeamBase.GoalkeeperShirtBackgroundColor),
            GoalkeeperShirtForegroundColor: KitColor(Offsets.TeamBase.GoalkeeperShirtForegroundColor),
            GoalkeeperShirtOutlineColor: KitColor(Offsets.TeamBase.GoalkeeperShirtOutlineColor),
            ShirtStyle: KitByte(Offsets.TeamBase.ShirtStyle),
            ShirtBackType: KitByte(Offsets.TeamBase.ShirtBackType),
            GoalkeeperShirtStyle: KitByte(Offsets.TeamBase.GoalkeeperShirtStyle),
            GoalkeeperShirtBackType: KitByte(Offsets.TeamBase.GoalkeeperShirtBackType),
            ShirtNumberColor: KitColor(Offsets.TeamBase.ShirtNumberColor),
            ShirtNumberOutlineColor: KitColor(Offsets.TeamBase.ShirtNumberOutlineColor),
            GoalkeeperShirtNumberColor: KitColor(Offsets.TeamBase.GoalkeeperShirtNumberColor),
            GoalkeeperShirtNumberOutlineColor: KitColor(Offsets.TeamBase.GoalkeeperShirtNumberOutlineColor));

        // Static metadata refresh only, never a second per-player/tick path.
        // Each target is checked through MemoryReader, including style bytes
        // beyond the colour block. Failed reads remain nullable for retries.
        uint? KitColor(int offset) => teamBase != default ? ReadUInt32(teamBase + offset) : null;
        byte? KitByte(int offset) => teamBase != default &&
            _memoryReader.TryReadByte(teamBase + offset, out var value) ? value : null;
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
            ReadOptionalByte(actualPlayer + Offsets.ActualPlayer.Morale),
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
            ReadOptionalByte(person + Offsets.Person.YouthGoals),
            ReadPositiveInt16(actualPlayer + Offsets.ActualPlayer.MatchSharpness),
            ReadPlayerSeasonStats(actualPlayer));
        return profile.WeeklyWage.HasValue || profile.HeightCm.HasValue || profile.Condition.HasValue || profile.MatchSharpness.HasValue || profile.Morale.HasValue ||
               profile.DateOfBirth is not null || profile.NationUid.HasValue || profile.BodyType.HasValue || profile.GuideValueGbp.HasValue ||
               profile.InternationalApps.HasValue || profile.YouthApps.HasValue || profile.SeasonStats is not null
            ? profile
            : null;
    }

    private PlayerSeasonStats? ReadPlayerSeasonStats(nint actualPlayer)
    {
        if (!_memoryReader.TryReadPointer(actualPlayer + Offsets.ActualPlayer.SeasonStats, out var seasonStats) ||
            seasonStats == default)
        {
            return null;
        }

        return new PlayerSeasonStats(
            Friendly: ReadPlayerSeasonStatsSlot(seasonStats, Offsets.SeasonStats.Friendly),
            League: ReadPlayerSeasonStatsSlot(seasonStats, Offsets.SeasonStats.League),
            Cup: ReadPlayerSeasonStatsSlot(seasonStats, Offsets.SeasonStats.Cup),
            OtherCompetition: ReadPlayerSeasonStatsSlot(seasonStats, Offsets.SeasonStats.OtherCompetition),
            International: ReadPlayerSeasonStatsSlot(seasonStats, Offsets.SeasonStats.International),
            ClubTotal: ReadPlayerSeasonStatsSlot(seasonStats, Offsets.SeasonStats.ClubTotal),
            Unknown: ReadPlayerSeasonStatsSlot(seasonStats, Offsets.SeasonStats.Unknown),
            InternationalTotal: ReadPlayerSeasonStatsSlot(seasonStats, Offsets.SeasonStats.InternationalTotal));
    }

    private PlayerSeasonStatsSlot? ReadPlayerSeasonStatsSlot(nint seasonStats, int offset)
    {
        if (!_memoryReader.TryReadPointer(seasonStats + offset, out var slot) || slot == default)
        {
            return null;
        }

        _memoryReader.TryReadPointer(slot + Offsets.SeasonStatsSlot.DetailedStats, out var detailed);
        return new PlayerSeasonStatsSlot(
            RatingSumTimes10: ReadOptionalUInt16(slot + Offsets.SeasonStatsSlot.RatingSumTimes10),
            Minutes: ReadOptionalUInt16(slot + Offsets.SeasonStatsSlot.Minutes),
            Starts: ReadOptionalByte(slot + Offsets.SeasonStatsSlot.Starts),
            SubstituteAppearances: ReadOptionalByte(slot + Offsets.SeasonStatsSlot.SubstituteAppearances),
            Appearances: ReadOptionalByte(slot + Offsets.SeasonStatsSlot.Appearances),
            Goals: ReadOptionalByte(slot + Offsets.SeasonStatsSlot.Goals),
            Assists: ReadOptionalByte(slot + Offsets.SeasonStatsSlot.Assists),
            GoalsConceded: ReadOptionalByte(slot + Offsets.SeasonStatsSlot.GoalsConceded),
            PenaltyAttempts: ReadOptionalByte(slot + Offsets.SeasonStatsSlot.PenaltyAttempts),
            PenaltiesScored: ReadOptionalByte(slot + Offsets.SeasonStatsSlot.PenaltiesScored),
            PlayerOfMatchAwards: ReadOptionalByte(slot + Offsets.SeasonStatsSlot.PlayerOfMatchAwards),
            RedCards: ReadOptionalByte(slot + Offsets.SeasonStatsSlot.RedCards),
            YellowCards: ReadOptionalByte(slot + Offsets.SeasonStatsSlot.YellowCards),
            CleanSheets: ReadOptionalByte(slot + Offsets.SeasonStatsSlot.CleanSheets),
            Detailed: detailed == default ? null : ReadPlayerSeasonDetailedStats(detailed));
    }

    private PlayerSeasonDetailedStats ReadPlayerSeasonDetailedStats(nint detailed) => new(
        TeamGoals: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.TeamGoals),
        TeamGoalsConceded: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.TeamGoalsConceded),
        Wins: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.Wins),
        Losses: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.Losses),
        PassesAttempted: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.PassesAttempted),
        PassesCompleted: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.PassesCompleted),
        TacklesAttempted: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.TacklesAttempted),
        TacklesWon: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.TacklesWon),
        HeadersAttempted: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.HeadersAttempted),
        HeadersWon: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.HeadersWon),
        Dribbles: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.Dribbles),
        Fouls: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.Fouls),
        Fouled: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.Fouled),
        Shots: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.Shots),
        ShotsOnTarget: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.ShotsOnTarget),
        ErrorsLeadingToGoal: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.ErrorsLeadingToGoal),
        DistanceKmTimes10: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.DistanceKmTimes10),
        Offsides: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.Offsides),
        // +0x34 is not open-play crosses completed; do not publish a known-wrong value.
        OpenPlayCrossesCompleted: null,
        KeyPasses: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.KeyPasses),
        KeyTackles: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.KeyTackles),
        Interceptions: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.Interceptions),
        ChancesCreated: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.ChancesCreated),
        Blocks: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.Blocks),
        PossessionLost: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.PossessionLost),
        PossessionWon: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.PossessionWon),
        ExpectedGoalsTimes100: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.ExpectedGoalsTimes100),
        ExpectedAssistsTimes100: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.ExpectedAssistsTimes100),
        Clearances: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.Clearances),
        GoalsOutsideBox: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.GoalsOutsideBox),
        OpenPlayCrossesAttempted: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.OpenPlayCrossesAttempted),
        ShotsOutsideBox: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.ShotsOutsideBox),
        GoalsPreventedTimes100: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.GoalsPreventedTimes100),
        Sprints: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.Sprints),
        ProgressivePasses: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.ProgressivePasses),
        PressesAttempted: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.PressesAttempted),
        PressesWon: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.PressesWon),
        OpenPlayKeyPasses: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.OpenPlayKeyPasses),
        NonPenaltyExpectedGoalsTimes100: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.NonPenaltyExpectedGoalsTimes100),
        CrossesAttempted: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.CrossesAttempted),
        CrossesCompleted: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.CrossesCompleted),
        HeadersLost: ReadOptionalUInt16(detailed + Offsets.SeasonDetailedStats.HeadersLost));

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
                ["Left Foot"] = ReadAttribute(player, Offsets.ActualPlayer.LeftFoot),
                ["Right Foot"] = ReadAttribute(player, Offsets.ActualPlayer.RightFoot),
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
            },
            _memoryReader.TryReadUInt64(person + Offsets.Person.Traits, out var traits)
                ? traits.ToString("X16", CultureInfo.InvariantCulture)
                : null);
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

    private int? ReadOptionalUInt16(nint address)
    {
        return _memoryReader.TryReadUInt16(address, out var value) ? value : null;
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
            if (count > 0)
            {
                Volatile.Write(ref _drainStage, (int)DrainStage.Candidates);
                for (var i = 0; i < count; i++)
                {
                    ObserveCandidate(_drainBatch[i]);
                }

            }
            PrunePreLockFrameCaches();

            Volatile.Write(ref _drainStage, (int)DrainStage.RealtimeFrames);
            DrainRealtimeFrames();

            Volatile.Write(ref _drainStage, (int)DrainStage.MatchEnd);
            for (var i = 0; i < count; i++)
            {
                ReportMatchEnded(_drainBatch[i]);
            }
            CompleteConsumedFinalFrame();

            var diagnosticTimestamp = Stopwatch.GetTimestamp();
            ValidateSessionIdentities(diagnosticTimestamp);
            // Drain the old session's final frames and release it before a new
            // pair can start confirming. Busy sessions never pre-confirm a successor.
            Volatile.Write(ref _drainStage, (int)DrainStage.Classification);
            var classification = ClassifyCandidates(diagnosticTimestamp);
            UpdateCandidateLock(classification, diagnosticTimestamp);
            if (_activeSession is { } session) TryCapturePlayerMetadata(session.Animated);
            PruneIdentityObservations();

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
            // Native callbacks can complete on different threads. Sort the drained
            // window so a later callback cannot make us reject an earlier tick.
            Array.Sort(_realtimeDrainBatch, 0, count, RawFrameTickComparer.Instance);
            for (; processed < count; processed++)
            {
                var frame = _realtimeDrainBatch[processed];
                var retained = false;
                try
                {
                    if (_activeSession is { } session && session.Animated == frame.MatchAddress)
                    {
                        if (frame.InstanceGeneration == session.Generation)
                        {
                            var appended = false;
                            try { appended = session.Timeline.Append(frame); }
                            finally
                            {
                                if (frame.FinishedByFlags)
                                {
                                    if (appended) session.FinalFrameSequence = frame.Sequence;
                                    else session.FinalFrameRejected = true;
                                }
                            }
                        }
                        else retained = TryCachePreLockFrame(frame);
                    }
                    else retained = TryCachePreLockFrame(frame);
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
            frame.InstanceGeneration != candidate.Generation || !CanCachePreLockFrames(candidate))
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
        if (candidate.IsTerminal || !candidate.HasActiveRecord)
        {
            return false;
        }

        var homeRead = _memoryReader.TryReadPointer(address + Offsets.GameMatch.HomeTeam, out var homeTeam);
        var awayRead = _memoryReader.TryReadPointer(address + Offsets.GameMatch.AwayTeam, out var awayTeam);
        var homePlayerCountRead = TryReadTeamPlayerCount(homeTeam, out var homePlayerCount);
        var awayPlayerCountRead = TryReadTeamPlayerCount(awayTeam, out var awayPlayerCount);
        if (!homeRead || !awayRead || !homePlayerCountRead || !awayPlayerCountRead)
        {
            // A transient read failure is not enough evidence to discard early data.
            return true;
        }

        return homeTeam != default && awayTeam != default && homeTeam != awayTeam &&
               homePlayerCount > 0 && awayPlayerCount > 0 &&
               homePlayerCount + awayPlayerCount <= RawRealtimeTickFrame.MaxPlayers &&
               (candidate.ProbedHomeTeam == default || candidate.ProbedHomeTeam == homeTeam) &&
               (candidate.ProbedAwayTeam == default || candidate.ProbedAwayTeam == awayTeam);
    }

    private static bool CanCachePreLockFrames(CandidateState candidate) =>
        !candidate.IsTerminal && candidate.HasActiveRecord && !candidate.LastActiveRecord.FinishedByFlags;

    private (int Cached, int Appended, int FirstTick, int LastTick, int PitchBackfilled, int PitchSourceTick)
        CommitPreLockFrames(nint selectedAnimated, RealtimeMatchTimeline timeline, long generation)
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
                if (frame.InstanceGeneration == generation && timeline.Append(frame))
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
        if (record.InstanceGeneration == 0 || record.Identity is null) return;
        if (!_instanceIdentities.TryGetValue(record.MatchAddress, out var observation) ||
            Volatile.Read(ref observation.Generation) != record.InstanceGeneration) return;
        if (!_candidates.TryGetValue(record.MatchAddress, out var state) || state.Generation != record.InstanceGeneration)
        {
            ReleasePreLockFrameCache(record.MatchAddress);
            // New identities invalidate old queued frames. No Tick-based release.
            if (_activeSession is { } oldSession && oldSession.Animated == record.MatchAddress && oldSession.Generation != record.InstanceGeneration)
            {
                oldSession.Invalidated = true;
                QueueDiagnostic(DiagnosticSeverity.Info,
                    $"GAME_MATCH capture identity changed: match={FormatPointer(record.MatchAddress)}, before={oldSession.Identity}, after={record.Identity}.");
            }
            ClearInstanceDerivedState(record.MatchAddress, record.InstanceGeneration - 1);
            state = new CandidateState { Generation = record.InstanceGeneration };
            _candidates[record.MatchAddress] = state;
            _playerUids.Invalidate();
        }
        state.HomeDbTeamUid = record.Identity.HomeUid ?? 0;
        state.AwayDbTeamUid = record.Identity.AwayUid ?? 0;
        state.HomeTeamUidReadable = record.Identity.HomeUid.HasValue;
        state.AwayTeamUidReadable = record.Identity.AwayUid.HasValue;
        state.HomeManagerUid = record.Identity.HomeManager;
        state.AwayManagerUid = record.Identity.AwayManager;
        state.ProbedHomeTeam = record.HomeTeam;
        state.ProbedAwayTeam = record.AwayTeam;
        state.IsTerminal = record.IsTerminal;
        if (!state.HasTick)
        {
            state.FirstTick = record.Tick;
            state.FirstSeenTimestamp = record.CapturedTimestamp;
        }
        if (state.HasTick && record.Tick > state.LastTick + 1) state.GapCount += record.Tick - state.LastTick - 1;
        else if (state.HasTick && record.Tick <= state.LastTick) state.OutOfOrderCount++;
        if (!state.HasTick || record.Tick > state.LastTick)
        {
            state.LastTick = record.Tick;
            state.LastAdvanceTimestamp = record.CapturedTimestamp;
        }
        state.HasTick = true;
        state.LastSeenTimestamp = record.CapturedTimestamp;
        state.RecordCount++;
        if (!record.IsTerminal)
        {
            state.LastActiveRecord = record;
            state.HasActiveRecord = true;
        }
    }

    private void ReportMatchEnded(in GameMatchTickRecord record)
    {
        var session = _activeSession;
        if (!record.FinishedByFlags || session is null || session.Animated != record.MatchAddress ||
            record.InstanceGeneration != session.Generation) return;
        session.EndObserved = true;
        session.FinalFrameQueued |= record.FinalFrameQueued;
    }

    private void CompleteConsumedFinalFrame()
    {
        if (_activeSession is not { } session) return;
        // A frame carries its own completion evidence, even if the lightweight
        // record queue overflowed. Queued frames can arrive in a later drain.
        if (session.FinalFrameSequence != 0)
            CloseSession(session, true, "finished flag 0x4; final frame consumed");
        else if (session.FinalFrameRejected || session.EndObserved && !session.FinalFrameQueued)
        {
            QueueDiagnostic(DiagnosticSeverity.Warning,
                $"GAME_MATCH final frame missing: match={FormatPointer(session.Animated)}; archive remains incomplete.");
            CloseSession(session, false, "missing final frame");
        }
    }

    private void CloseSession(CaptureSession session, bool finished, string reason)
    {
        if (!ReferenceEquals(_activeSession, session)) return;
        lock (session.CaptureGate)
        {
            session.Invalidated = true;
        }
        if (finished) session.Timeline.MarkEnded(session.Animated);
        else session.Timeline.MarkInterrupted(session.Animated);
        _activeSession = null;
        session.Momentum.Dispose();
        _pendingPair = null;
        _candidates.TryGetValue(session.Animated, out var candidate);
        if (candidate is null || candidate.Generation == session.Generation) ReleasePreLockFrameCache(session.Animated);
        if (candidate is not null && candidate.Generation == session.Generation)
        {
            _candidates.Remove(session.Animated);
            if (!finished && _instanceIdentities.TryGetValue(session.Animated, out var observed) && observed.Generation == session.Generation)
                RemoveIdentityObservation(session.Animated, observed);
            ClearInstanceDerivedState(session.Animated, session.Generation);
        }
        _playerUids.Invalidate();
        QueueDiagnostic(DiagnosticSeverity.Info,
            $"GAME_MATCH session released: match={FormatPointer(session.Animated)}, generation={session.Generation}, " +
            $"reason={reason}, normalCompletionRequested={finished}, activeSessions=0.");
        _stableAnimated = _stableSimulation = 0;
        Interlocked.Exchange(ref _selectedAnimated, 0);
        _locatorState = LocatorState.Discovering;
    }

    private void ValidateSessionIdentities(long now)
    {
        if (now - _lastSessionIdentityProbe < Stopwatch.Frequency) return;
        _lastSessionIdentityProbe = now;
        if (_activeSession is { } session)
        {
            // A queued final snapshot is managed data and no longer depends on
            // the native object's lifetime. Let its bounded queue drain first.
            if (session.EndObserved && session.FinalFrameQueued) return;
            if (session.Invalidated)
            {
                CloseSession(session, false, "identity generation changed");
                return;
            }
            var probe = TryReadSessionIdentity(session, out var home, out var away, out var current);
            if (probe == SessionIdentityProbe.Busy) return;
            if (probe == SessionIdentityProbe.Unreadable)
            {
                session.CanReadMetadata = false;
                session.ClearedTeamObservations = 0;
                if (++session.UnreadableObservations >= 2)
                    CloseSession(session, false, "runtime address unreadable (confirmed)");
                return;
            }
            session.UnreadableObservations = 0;
            if (home == 0 && away == 0)
            {
                session.CanReadMetadata = false;
                if (++session.ClearedTeamObservations >= 2) CloseSession(session, false, "runtime teams cleared (confirmed)");
                return;
            }
            session.ClearedTeamObservations = 0;
            if (session.Identity.DiffersFrom(current))
            {
                QueueDiagnostic(DiagnosticSeverity.Info,
                    $"GAME_MATCH identity changed: match={FormatPointer(session.Animated)}, before={session.Identity}, after={current}.");
                CloseSession(session, false, "team/manager/first-player identity changed");
            }
            // Missing identities block metadata refresh but never fabricate full time.
            else session.CanReadMetadata = current.HasTeams;
        }
    }

    private SessionIdentityProbe TryReadSessionIdentity(CaptureSession session, out nint home, out nint away,
        out MatchInstanceIdentity current)
    {
        home = away = 0;
        current = session.Identity;
        // Do not block the drain on a long native Advance or inspect a match
        // while its selected callback is updating the same native structures.
        if (!Monitor.TryEnter(session.CaptureGate)) return SessionIdentityProbe.Busy;
        try
        {
            using var scope = VirtualMemory.BeginReadScope();
            if (!_memoryReader.TryReadPointer(session.Animated + Offsets.GameMatch.HomeTeam, out home) ||
                !_memoryReader.TryReadPointer(session.Animated + Offsets.GameMatch.AwayTeam, out away)) return SessionIdentityProbe.Unreadable;
            current = ReadInstanceIdentity(home, away);
            return SessionIdentityProbe.Readable;
        }
        finally { Monitor.Exit(session.CaptureGate); }
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
                    $"{(_activeSession is not null ? "current_session" : classification.Pairs.Count == 0 ? "no_pair" : classification.Pairs.Count == 1 ? "confirm_pair" : "ambiguous_pairs")}, activeSessions={(_activeSession is null ? 0 : 1)}.");
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
                $"awayTeam={FormatPointer(record.AwayTeam)}, players={record.PlayerCount} " +
                $"(home={record.HomePlayerCount},away={record.AwayPlayerCount}), " +
                $"homeUid={FormatUid(state.HomeTeamUidReadable, state.HomeDbTeamUid)}, " +
                $"awayUid={FormatUid(state.AwayTeamUidReadable, state.AwayDbTeamUid)}, " +
                $"homeManagerUid={state.HomeManagerUid?.ToString(CultureInfo.InvariantCulture) ?? "unknown"}, " +
                $"awayManagerUid={state.AwayManagerUid?.ToString(CultureInfo.InvariantCulture) ?? "unknown"}, " +
                $"generation={state.Generation}, firstPlayers={state.LastActiveRecord.Identity?.HomeFirstPlayer ?? "unknown"}/{state.LastActiveRecord.Identity?.AwayFirstPlayer ?? "unknown"}, " +
                $"firstPlayerUids={state.LastActiveRecord.Identity?.HomeFirstPlayerUid?.ToString() ?? "unknown"}/{state.LastActiveRecord.Identity?.AwayFirstPlayerUid?.ToString() ?? "unknown"}, " +
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

    private static string FormatFingerprint(CandidateState state) =>
        state.HomeTeamUidReadable && state.AwayTeamUidReadable
            ? $"{state.HomeDbTeamUid}:{state.AwayDbTeamUid}"
            : "unknown";

    private void ReportDroppedRecords()
    {
        var identityDrops = Interlocked.Read(ref _identityCapacityDrops);
        if (identityDrops != _reportedIdentityCapacityDrops)
        {
            _reportedIdentityCapacityDrops = identityDrops;
            QueueDiagnostic(DiagnosticSeverity.Warning, $"GAME_MATCH identity capacity drops: total={identityDrops}, capacity=512.");
        }
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

        _pendingDiagnosticMessages.Enqueue(new PendingDiagnosticMessage(severity, $"[Advance] {message}"));
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
                $"[Advance] GAME_MATCH drain stalled: cycle={Interlocked.Read(ref _drainSequence)}, " +
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
            $"[Advance] GAME_MATCH drain health: cycle={Interlocked.Read(ref _drainSequence)}, draining={draining}, " +
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

    // FM27 outer update receives the GAME_MATCH pointer in RCX and a 32-bit value in EDX.
    // Capture after it returns, once the native tick increment has completed.
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate void MatchUpdateDelegate(nint match, uint mode, int targetTick);

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
        Classification,
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
        public long Generation;
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
        public bool HasActiveRecord;
        public GameMatchTickRecord LastActiveRecord;
        public string? MatchDate;
        public nint ProbedHomeTeam;
        public nint ProbedAwayTeam;
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
        public long Generation;
        private readonly ulong[] _signatures = new ulong[MonitoredMomentumEventCount];

        public nint Source;
        public nint Begin;
        public int EventCount;
        public int SignatureStart;
        public int SignatureCount;
        public long TailChangeCount;
        public int MaxBackfillDepth;

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

    private bool TryReadDbTeamUid(nint team, out uint uid)
    {
        uid = default;
        return team != default &&
               _memoryReader.TryReadPointer(team + Offsets.Team.DbTeam, out var dbTeam) &&
               dbTeam != default &&
               _memoryReader.TryReadUInt32(dbTeam + Offsets.DbTeam.Uid, out uid) &&
               uid != 0;
    }

    private (long Generation, MatchInstanceIdentity? Identity) ObserveInstanceIdentity(in GameMatchTickRecord record)
    {
        if (!_instanceIdentities.TryGetValue(record.MatchAddress, out var observation))
        {
            if (Interlocked.Increment(ref _identityCount) > 512)
            {
                Interlocked.Decrement(ref _identityCount);
                Interlocked.Increment(ref _identityCapacityDrops);
                return default;
            }
            observation = new IdentityObservation();
            if (!_instanceIdentities.TryAdd(record.MatchAddress, observation))
            {
                Interlocked.Decrement(ref _identityCount);
                if (!_instanceIdentities.TryGetValue(record.MatchAddress, out observation)) return default;
            }
        }
        lock (observation.Gate)
        {
            observation.LastSeen = record.CapturedTimestamp;
            // Cheap team checks on every callback; names and optional managers
            // are refreshed at a fixed deadline or at lifecycle endpoints.
            uint? homeUid = TryReadDbTeamUid(record.HomeTeam, out var home) ? home : null;
            uint? awayUid = TryReadDbTeamUid(record.AwayTeam, out var away) ? away : null;
            var teamsChanged = observation.Identity is { } prior &&
                (homeUid.HasValue && prior.HomeUid.HasValue && homeUid != prior.HomeUid ||
                 awayUid.HasValue && prior.AwayUid.HasValue && awayUid != prior.AwayUid);
            if (observation.Identity is null || teamsChanged || record.FinishedByFlags || observation.Finished && !record.FinishedByFlags ||
                record.CapturedTimestamp >= observation.RefreshAt)
            {
                var current = ReadInstanceIdentity(record.HomeTeam, record.AwayTeam);
                if (observation.Identity is null || observation.Identity.DiffersFrom(current) ||
                    observation.Finished && !record.FinishedByFlags)
                {
                    observation.Generation = Interlocked.Increment(ref _instanceGeneration);
                    observation.Identity = current;
                }
                else observation.Identity = observation.Identity with
                {
                    HomeUid = observation.Identity.HomeUid ?? current.HomeUid,
                    AwayUid = observation.Identity.AwayUid ?? current.AwayUid,
                    HomeManager = observation.Identity.HomeManager ?? current.HomeManager,
                    AwayManager = observation.Identity.AwayManager ?? current.AwayManager,
                    HomeFirstPlayer = observation.Identity.HomeFirstPlayer ?? current.HomeFirstPlayer,
                    AwayFirstPlayer = observation.Identity.AwayFirstPlayer ?? current.AwayFirstPlayer,
                    HomeFirstPlayerUid = observation.Identity.HomeFirstPlayerUid ?? current.HomeFirstPlayerUid,
                    AwayFirstPlayerUid = observation.Identity.AwayFirstPlayerUid ?? current.AwayFirstPlayerUid
                };
                observation.RefreshAt = record.CapturedTimestamp + Stopwatch.Frequency;
            }
            observation.Finished = record.FinishedByFlags;
            return (observation.Generation, observation.Identity);
        }
    }

    private MatchInstanceIdentity ReadInstanceIdentity(nint home, nint away)
    {
        uint? homeUid = TryReadDbTeamUid(home, out var h) ? h : null;
        uint? awayUid = TryReadDbTeamUid(away, out var a) ? a : null;
        TryReadManagerIdentity(home, out _, out _, out _, out var homeManager);
        TryReadManagerIdentity(away, out _, out _, out _, out var awayManager);
        var homePlayer = FirstPlayer(home);
        var awayPlayer = FirstPlayer(away);
        return new(homeUid, awayUid, homeManager, awayManager, homePlayer.Name, awayPlayer.Name, homePlayer.Uid, awayPlayer.Uid);
    }

    private (uint? Uid, string? Name) FirstPlayer(nint team)
    {
        if (team == 0 || !_memoryReader.TryReadPointer(team + Offsets.Team.PlayerTable, out var player) || player == 0 ||
            !_memoryReader.TryReadPointer(player + Offsets.MatchPlayer.Person, out var person) || person == 0) return default;
        var uid = ReadUid(person + Offsets.Person.Uid);
        var name = ReadPersonName(person, Offsets.Person.CommonName);
        if (string.IsNullOrWhiteSpace(name)) name = string.Join(' ', new[]
        {
            ReadPersonName(person, Offsets.Person.FirstName), ReadPersonName(person, Offsets.Person.SecondName)
        }.Where(value => !string.IsNullOrWhiteSpace(value)));
        if (string.IsNullOrWhiteSpace(name) || name.Length > 128 || name.Any(char.IsControl)) return (uid, null);
        return (uid, name);
    }

    private void PruneIdentityObservations()
    {
        if (_instanceIdentities.Count < 448) return;
        foreach (var pair in _instanceIdentities.OrderBy(pair => pair.Value.LastSeen).Take(64))
        {
            if (_activeSession?.Animated == pair.Key) continue;
            RemoveIdentityObservation(pair.Key, pair.Value);
            _candidates.Remove(pair.Key);
            ReleasePreLockFrameCache(pair.Key);
            _terminalMatches.TryRemove(pair.Key, out _);
            ClearInstanceDerivedState(pair.Key);
            QueueDiagnostic(DiagnosticSeverity.Debug, $"GAME_MATCH identity cache evicted: match={FormatPointer(pair.Key)}.");
        }
    }

    private void ClearInstanceDerivedState(nint match, long maximumGeneration = long.MaxValue)
    {
        lock (_nativeMomentumGate)
            if (_nativeMomentumStates.TryGetValue(match, out var state) && state.Generation <= maximumGeneration)
                _nativeMomentumStates.Remove(match);
        lock (_ratingCaptureGate)
        {
            if (!_ratingGenerations.TryGetValue(match, out var generation) || generation <= maximumGeneration)
                ClearRatingInstanceLocked(match);
        }
    }

    private void ClearRatingInstanceLocked(nint match)
    {
        _ratingGenerations.Remove(match);
        _ratingBackgroundByMatch.Remove(match);
        _lastRatingCapturedTickByMatch.Remove(match);
        _lastRatingMatchByMatch.Remove(match);
        foreach (var key in _lastRatingResearchBySlot.Keys.Where(key => key.Match == match).ToArray())
            _lastRatingResearchBySlot.Remove(key);
    }

    private sealed class IdentityObservation
    {
        public readonly object Gate = new();
        public MatchInstanceIdentity? Identity;
        public long Generation, LastSeen, RefreshAt;
        public bool Finished;
    }

    private void RemoveIdentityObservation(nint address, IdentityObservation expected)
    {
        if (((ICollection<KeyValuePair<nint, IdentityObservation>>)_instanceIdentities).Remove(new(address, expected)))
            Interlocked.Decrement(ref _identityCount);
    }

    private static string GetEligibilityReason(CandidateState state, long now)
    {
        if (state.IsTerminal || state.HasActiveRecord && state.LastActiveRecord.FinishedByFlags) return "terminal";
        if (!state.HasActiveRecord || state.LastActiveRecord.HomeTeam == default ||
            state.LastActiveRecord.AwayTeam == default ||
            state.LastActiveRecord.HomeTeam == state.LastActiveRecord.AwayTeam ||
            state.LastActiveRecord.PlayerCount is 0 or > 64)
        {
            return "invalid_shape";
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

            var possible = new List<CandidatePair>();
            foreach (var simulation in group.Value)
            foreach (var candidate in group.Value)
            {
                if (_activeSession?.Animated == simulation.Key) continue;
                if (_activeSession is { } session && session.Simulation == candidate.Key &&
                    session.SimulationGeneration == candidate.Value.Generation) continue;
                if (candidate.Key == simulation.Key || !IsLikelyRealtimeAnimated(candidate.Key, now)) continue;
                var delta = simulation.Value.LastTick - candidate.Value.LastTick;
                if (Math.Abs(delta - CandidateExpectedTickDelta) > CandidateTickDeltaTolerance) continue;
                possible.Add(new CandidatePair(group.Key, simulation.Key, candidate.Key,
                    simulation.Value.LastTick, candidate.Value.LastTick, delta,
                    CalculateTickRate(candidate.Value, now)));
            }
            // Preserve all valid alternatives. A single-session selector must
            // not hide an ambiguous three-instance group by greedily taking one edge.
            pairs.AddRange(possible);
        }
        return new CandidateClassification(pairs.ToArray(), eligibleCount, groups.Count);
    }

    private void UpdateCandidateLock(CandidateClassification classification, long now)
    {
        if (_activeSession is not null || classification.Pairs.Count != 1)
        {
            _pendingPair = null;
            _locatorState = _activeSession is not null ? LocatorState.Locked : LocatorState.Discovering;
            return;
        }
        var pair = classification.Pairs[0];
        var animated = _candidates[pair.Animated];
        var simulation = _candidates[pair.Simulation];
        if (_pendingPair is not { } pending || pending.Animated != pair.Animated ||
            pending.Simulation != pair.Simulation || pending.Generation != animated.Generation ||
            pending.SimulationGeneration != simulation.Generation)
            _pendingPair = pending = new PendingPair(pair.Animated, pair.Simulation, animated.Generation, simulation.Generation);
        var animatedSequence = animated.LastActiveRecord.Sequence;
        var simulationSequence = simulation.LastActiveRecord.Sequence;
        if (pending.AnimatedSequence == animatedSequence && pending.SimulationSequence == simulationSequence) return;
        pending.AnimatedSequence = animatedSequence;
        pending.SimulationSequence = simulationSequence;
        pending.Count++;
        _locatorState = LocatorState.Confirming;
        if (pending.Count >= CandidatePairConfirmationCount)
        {
            LockAnimatedCandidate(pair, now);
            _pendingPair = null;
        }
    }

    private void LockAnimatedCandidate(CandidatePair pair, long now)
    {
        if (_activeSession is not null) return;
        var state = _candidates[pair.Animated];
        var identity = state.LastActiveRecord.Identity;
        if (identity is null || !identity.HasTeams) return;
        var timeline = _timeline;
        var simulationGeneration = _candidates.TryGetValue(pair.Simulation, out var simulationState) ? simulationState.Generation : 0;
        var session = new CaptureSession(pair.Animated, pair.Simulation, state.Generation, simulationGeneration, identity, timeline);
        timeline.Begin(pair.Animated);
        _activeSession = session;
        _lastSessionIdentityProbe = 0;
        _stableAnimated = pair.Animated;
        _stableSimulation = pair.Simulation;
        _locatorState = LocatorState.Locked;
        Interlocked.Exchange(ref _selectedAnimated, (long)pair.Animated);
        TryCapturePlayerMetadata(pair.Animated);
        var committed = CommitPreLockFrames(pair.Animated, timeline, state.Generation);
        QueueDiagnostic(DiagnosticSeverity.Info,
            $"GAME_MATCH animation locked: address={FormatPointer(pair.Animated)}, simulation={FormatPointer(pair.Simulation)}, " +
            $"fingerprint={pair.Fingerprint}, generation={state.Generation}, delta={pair.TickDelta}, " +
            $"activeSessions=1, preLockAppended={committed.Appended}, preLockRange={committed.FirstTick}-{committed.LastTick}.");
    }

    private sealed class CaptureSession(nint animated, nint simulation, long generation, long simulationGeneration,
        MatchInstanceIdentity identity, RealtimeMatchTimeline timeline)
    {
        public readonly object CaptureGate = new();
        public readonly MomentumCalculator Momentum = new();
        public readonly TacticalStateSampler Tactics = new();
        public readonly nint Animated = animated, Simulation = simulation;
        public readonly long Generation = generation;
        public readonly long SimulationGeneration = simulationGeneration;
        public readonly MatchInstanceIdentity Identity = identity;
        public readonly RealtimeMatchTimeline Timeline = timeline;
        public volatile bool Invalidated;
        public bool CanReadMetadata = true;
        public long LastMetadataTimestamp;
        public long FinalFrameSequence;
        public bool EndObserved, FinalFrameQueued, FinalFrameRejected;
        public int ClearedTeamObservations;
        public int UnreadableObservations;
    }

    private enum SessionIdentityProbe { Busy, Unreadable, Readable }

    private sealed class PendingPair(nint animated, nint simulation, long generation, long simulationGeneration)
    {
        public readonly nint Animated = animated, Simulation = simulation;
        public readonly long Generation = generation, SimulationGeneration = simulationGeneration;
        public int Count;
        public long AnimatedSequence = -1, SimulationSequence = -1;
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

    // Owned by one confirmed animated-match session. Called only inside the hook's
    // existing post-Original read scope; never retains native pointers in snapshots.
    internal sealed class TacticalStateSampler
    {
        private readonly object _gate = new();
        private readonly MemoryReader _reader = new();
        private TacticalSnapshot? _snapshot;
        private nint _home, _away, _homeContext, _awayContext;
        private int _lastTick = -1;
        private long _nextSample;
        private long _revision;
        private int _remainingVectorBytes;

        public TacticalSnapshot? Capture(nint home, nint away, RawRealtimeTickFrame frame, ReadOnlySpan<nint> players)
        {
            // A nested/concurrent callback must not wait behind native memory traversal.
            if (!Monitor.TryEnter(_gate)) return null;
            try
            {
                var now = Stopwatch.GetTimestamp();
                if (home != _home || away != _away || frame.Tick < _lastTick)
                {
                    _home = home;
                    _away = away;
                    _snapshot = null;
                    _nextSample = 0;
                }
                _lastTick = frame.Tick;
                if (now < _nextSample && !frame.FinishedByFlags) return _snapshot;
                _nextSample = now + Stopwatch.Frequency;
                _remainingVectorBytes = 131_072;
                _reader.TryReadPointer(home + Offsets.Team.Manager, out var homeContext);
                _reader.TryReadPointer(away + Offsets.Team.Manager, out var awayContext);
                if (homeContext != _homeContext || awayContext != _awayContext)
                {
                    _snapshot = null;
                    _homeContext = homeContext;
                    _awayContext = awayContext;
                }
                var next = new TacticalSnapshot(frame.Tick, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    ReadTeam(homeContext, TeamSide.Home, frame, players), ReadTeam(awayContext, TeamSide.Away, frame, players));
                if (!TacticalSnapshotEquality.Same(_snapshot, next)) _snapshot = next with { Revision = ++_revision };
                return _snapshot;
            }
            finally { Monitor.Exit(_gate); }
        }

        private TacticalTeamData ReadTeam(nint context, TeamSide side, RawRealtimeTickFrame frame, ReadOnlySpan<nint> pointers)
        {
            var players = new List<TacticalPlayerSlot>();
            for (var i = 0; i < frame.PlayerCount; i++)
            {
                var player = frame.Players[i];
                if (player.Team != side) continue;
                int? roster = _reader.TryReadByte(pointers[i] + Offsets.MatchPlayer.TacticalRosterSlot, out var r) ? unchecked((sbyte)r) : null;
                int? tactic = _reader.TryReadByte(pointers[i] + Offsets.MatchPlayer.TacticalFormationSlot, out var t) ? unchecked((sbyte)t) : null;
                uint? oppositionPosition = _reader.TryReadUInt32(pointers[i] + Offsets.MatchPlayer.OppositionPositionKey, out var key) ? key : null;
                players.Add(new(player.Slot, player.PlayerId, roster, tactic, oppositionPosition));
            }
            if (context == 0) return new("unavailable", null, null, null, null, players.ToArray());
            var processing = ReadConfiguration(context + Tactics.Context.ProcessingConfiguration);
            var command = ReadConfiguration(context + Tactics.Context.CommandConfiguration);
            var personal = ReadBytes(context + Tactics.Context.PersonalOpposition, Tactics.PersonalOppositionCount * Tactics.PersonalOppositionRecordSize);
            TacticalOppositionPosition[]? positions = null;
            if (_reader.TryReadByte(context + Tactics.Context.PositionOppositionCount, out var count) && count <= Tactics.PositionOppositionCapacity &&
                (count == 0 || VirtualMemory.IsReadable(context + Tactics.Context.PositionOppositionEntries, count * Tactics.OppositionPosition.Size)))
            {
                positions = new TacticalOppositionPosition[count];
                for (var i = 0; i < count; i++)
                {
                    var record = context + Tactics.Context.PositionOppositionEntries + i * Tactics.OppositionPosition.Size;
                    var packed = (uint)(Marshal.ReadByte(record + Tactics.OppositionPosition.Instructions) | Marshal.ReadByte(record + Tactics.OppositionPosition.Instructions + 1) << 8 | Marshal.ReadByte(record + Tactics.OppositionPosition.Instructions + 2) << 16);
                    positions[i] = new(unchecked((uint)Marshal.ReadInt32(record + Tactics.OppositionPosition.PositionKey)), packed);
                }
            }
            var complete = processing is not null && command is not null && personal is not null && positions is not null &&
                Complete(processing) && Complete(command) && players.All(p => p.RosterSlot.HasValue && p.TacticSlot.HasValue && p.OppositionPositionKey.HasValue);
            return new(complete ? "complete" : "partial", processing, command, personal, positions, players.ToArray());
        }

        private static bool Complete(TacticalConfiguration config) => config.NameUtf8 is not null && config.InPossessionOverrides is not null && config.OutOfPossessionOverrides is not null &&
            config.InPossession.Concat(config.OutOfPossession).All(p => p.Instructions is not null && p.Applicability is not null) &&
            config.InPossessionOverrides.Concat(config.OutOfPossessionOverrides).SelectMany(p => p.Positions).All(p => p.Instructions is not null && p.Applicability is not null);

        private TacticalConfiguration? ReadConfiguration(nint address)
        {
            if (!VirtualMemory.IsReadable(address, Tactics.Configuration.Size)) return null;
            byte[]? name = null;
            var text = Marshal.ReadIntPtr(address + Tactics.Configuration.Name);
            if (text == default) name = Array.Empty<byte>();
            else if (_reader.TryReadInt32(text + Tactics.Text.Length, out var length) && length is >= 0 and <= 1024)
                name = length == 0 ? Array.Empty<byte>() : ReadBytes(text + Tactics.Text.Utf8, length);
            return new(ReadBytesDirect(address + Tactics.Configuration.TeamInstructions, Tactics.Configuration.TeamInstructionsSize), unchecked((uint)Marshal.ReadInt32(address + Tactics.Configuration.StyleKey)), name,
                Marshal.ReadByte(address + Tactics.Configuration.AdditionalState), Marshal.ReadByte(address + Tactics.Configuration.Mentality), ReadBytesDirect(address + Tactics.Configuration.PhaseSlotMapping, Tactics.FormationSlotCount),
                ReadPositionsDirect(address + Tactics.Configuration.InPossession, Tactics.FormationSlotCount), ReadPositionsDirect(address + Tactics.Configuration.OutOfPossession, Tactics.FormationSlotCount),
                ReadOverrides(address + Tactics.Configuration.InPossessionOverrides), ReadOverrides(address + Tactics.Configuration.OutOfPossessionOverrides));
        }

        private TacticalPosition[] ReadPositionsDirect(nint address, int count)
        {
            var positions = new TacticalPosition[count];
            for (var i = 0; i < count; i++)
            {
                var p = address + i * Tactics.Position.Size;
                TacticalRoleInstructions[]? roles = null;
                if (TryVector(p + Tactics.Position.Instructions, Tactics.RoleInstructions.Size, 64, out var start, out var length))
                {
                    roles = new TacticalRoleInstructions[length];
                    for (var j = 0; j < length; j++)
                    {
                        var item = start + j * Tactics.RoleInstructions.Size;
                        roles[j] = new(Hex(item + Tactics.RoleInstructions.RoleKey), Hex(item + Tactics.RoleInstructions.Bits), unchecked((uint)Marshal.ReadInt32(item + Tactics.RoleInstructions.MarkPosition)), unchecked((sbyte)Marshal.ReadByte(item + Tactics.RoleInstructions.MarkPlayer)));
                    }
                }
                TacticalApplicability[]? applicability = null;
                if (TryVector(p + Tactics.Position.Applicability, Tactics.Applicability.Size, 64, out start, out length))
                {
                    applicability = new TacticalApplicability[length];
                    for (var j = 0; j < length; j++) applicability[j] = new(Marshal.ReadInt32(start + j * Tactics.Applicability.Size + Tactics.Applicability.InstructionId), Hex(start + j * Tactics.Applicability.Size + Tactics.Applicability.RoleMask));
                }
                positions[i] = new(unchecked((uint)Marshal.ReadInt32(p + Tactics.Position.PositionMask)), Marshal.ReadByte(p + Tactics.Position.Auxiliary), Marshal.ReadByte(p + Tactics.Position.Flags), Hex(p + Tactics.Position.RoleDuty), roles, applicability);
            }
            return positions;
        }

        private TacticalPersonalOverride[]? ReadOverrides(nint tree)
        {
            if (!_reader.TryReadPointer(tree + Tactics.OverrideTree.Header, out var header) || header == 0 ||
                !_reader.TryReadUInt64(tree + Tactics.OverrideTree.Count, out var declaredCount) || declaredCount > Tactics.PersonalOppositionCount ||
                !VirtualMemory.IsReadable(header, Tactics.OverrideTree.HeaderSize)) return null;
            var result = new List<TacticalPersonalOverride>();
            var pending = new Stack<nint>();
            var visited = new HashSet<nint>();
            pending.Push(Marshal.ReadIntPtr(header + Tactics.OverrideTree.Root));
            while (pending.Count != 0)
            {
                var node = pending.Pop();
                if (node == header) continue;
                if (node == 0 || !visited.Add(node) || visited.Count > Tactics.PersonalOppositionCount || !VirtualMemory.IsReadable(node, Tactics.OverrideTree.NodeSize)) return null;
                if (Marshal.ReadByte(node + Tactics.OverrideTree.Sentinel) != 0) return null;
                if (!TryVector(node + Tactics.OverrideTree.Positions, Tactics.Position.Size, Tactics.FormationSlotCount, out var begin, out var count)) return null;
                result.Add(new(unchecked((uint)Marshal.ReadInt32(node + Tactics.OverrideTree.PersonKey)), ReadPositionsDirect(begin, count)));
                pending.Push(Marshal.ReadIntPtr(node + Tactics.OverrideTree.Left));
                pending.Push(Marshal.ReadIntPtr(node + Tactics.OverrideTree.Right));
            }
            if ((ulong)result.Count != declaredCount) return null;
            return result.OrderBy(value => value.PersonKey).ToArray();
        }

        private bool TryVector(nint vector, int stride, int maximum, out nint begin, out int count)
        {
            begin = 0;
            count = 0;
            if (!VirtualMemory.IsReadable(vector, Tactics.Vector.Size)) return false;
            begin = Marshal.ReadIntPtr(vector + Tactics.Vector.Begin);
            var end = Marshal.ReadIntPtr(vector + Tactics.Vector.End);
            var capacity = Marshal.ReadIntPtr(vector + Tactics.Vector.Capacity);
            if (begin == 0) return end == default && capacity == default;
            var bytes = (long)end - (long)begin;
            var capacityBytes = (long)capacity - (long)begin;
            if ((long)begin < 0 || (long)end < 0 || (long)capacity < 0 || bytes < 0 || capacityBytes < bytes || bytes % stride != 0 || capacityBytes % stride != 0 ||
                bytes / stride > maximum || bytes > _remainingVectorBytes || bytes > int.MaxValue) return false;
            if (bytes > 0 && !VirtualMemory.IsReadable(begin, (int)bytes)) return false;
            _remainingVectorBytes -= (int)bytes;
            count = (int)(bytes / stride);
            return true;
        }

        private byte[]? ReadBytes(nint address, int count) => VirtualMemory.IsReadable(address, count) ? ReadBytesDirect(address, count) : null;
        private static byte[] ReadBytesDirect(nint address, int count)
        {
            var result = new byte[count];
            Marshal.Copy(address, result, 0, count);
            return result;
        }
        private static string Hex(nint address) => unchecked((ulong)Marshal.ReadInt64(address)).ToString("X16");
    }
}
