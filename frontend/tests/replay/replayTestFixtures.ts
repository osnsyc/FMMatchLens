import type {
  RealtimeFrame,
  RealtimeMatchMetadata,
  RealtimeMomentumEvent,
  RealtimePlayer,
  RealtimeTeam,
} from "@/api/realtimeMatch"
import type { LocalArchiveSummary } from "@/api/localArchive"

export function replayFixture() {
  const firstHalfTick = 44 * 240
  const secondHalfTick = 46 * 240
  const recentWindowTick = 62 * 240
  const fullTimeTick = 92 * 240
  const event: RealtimeMomentumEvent = {
    eventIndex: 7,
    tick: firstHalfTick,
    lateralPosition: 5,
    longitudinalPosition: 15,
    team: "home",
    playerSlot: 1,
    playerId: 101,
    receiverPlayerSlot: 0,
    receiverPlayerId: 0,
    eventType: 7,
    flags: 0,
    sequenceIndex: 1,
    completionTick: 0,
  }
  const completedEvent: RealtimeMomentumEvent = {
    ...event,
    receiverPlayerSlot: 2,
    receiverPlayerId: 102,
    completionTick: secondHalfTick,
    trajectoryPoints: [
      { lateralPosition: 5, longitudinalPosition: 15 },
      { lateralPosition: 8, longitudinalPosition: 30 },
    ],
  }
  const replacement: RealtimeMomentumEvent = {
    ...completedEvent,
    eventIndex: 8,
    tick: recentWindowTick,
    eventType: 4,
    playerId: 102,
    playerSlot: 2,
  }

  const frames = [
    frame(0, { momentumEvents: [] }),
    frame(firstHalfTick, {
      homeGoals: 1,
      homeXg: 0.65,
      playerGoals: 1,
      playerAssists: 1,
      momentumEvents: [event],
    }),
    frame(secondHalfTick, {
      homeGoals: 1,
      homeXg: 0.7,
      playerGoals: 1,
      playerAssists: 1,
      momentumEvents: [completedEvent],
      period: 2,
      displayTick: 45 * 240,
    }),
    frame(recentWindowTick, {
      homeGoals: 1,
      awayGoals: 1,
      homeXg: 0.7,
      playerGoals: 1,
      playerAssists: 1,
      awayOwnGoals: 1,
      // Native event storage is bounded and can rotate older entries out.
      momentumEvents: [replacement],
      period: 2,
    }),
    frame(fullTimeTick, {
      homeGoals: 1,
      awayGoals: 1,
      homeXg: 0.7,
      playerGoals: 1,
      playerAssists: 1,
      awayOwnGoals: 1,
      momentumEvents: [completedEvent, replacement],
      period: 2,
      displayTick: 90 * 240,
    }),
    frame(fullTimeTick + 240, {
      homeGoals: 1,
      awayGoals: 1,
      homeXg: 0.7,
      playerGoals: 1,
      playerAssists: 1,
      awayOwnGoals: 1,
      momentumEvents: [],
      period: 2,
      displayTick: 91 * 240,
    }),
  ]
  for (let index = 1; index < frames.length; index += 1) {
    frames[index].momentum = [
      ...frames[index - 1].momentum,
      ...frames[index].momentum,
    ]
    frames[index].rollingMomentum = [
      ...frames[index - 1].rollingMomentum,
      ...frames[index].rollingMomentum,
    ]
  }
  frames[4].momentum = frames[4].momentum.slice(-2)
  frames[4].rollingMomentum = frames[4].rollingMomentum.slice(-2)
  frames[5].momentum = []
  frames[5].rollingMomentum = []
  const substitutedOff = frames[3].players.find(
    (player) => player.playerId === 201
  )
  if (substitutedOff) {
    substitutedOff.isOnPitch = false
    substitutedOff.subbedOffMinute = 62
  }
  const invalidCoordinate = frames[3].players.find(
    (player) => player.playerId === 102
  )
  if (invalidCoordinate) invalidCoordinate.x = Number.NaN
  frames[3].players.push({
    ...player(202, 4, "away", 0, 0, 0),
    isSubstitute: true,
    subbedOnMinute: 62,
  })
  frames[4].players = frames[3].players.map((entry) => ({ ...entry }))
  frames[5].players = frames[3].players.map((entry) => ({ ...entry }))
  const metadata = metadataFixture()
  const metadataTimeline = [
    metadata,
    {
      ...metadata,
      capturedTick: secondHalfTick,
      home: { ...metadata.home, name: "Updated Home" },
    },
  ]
  const summary: LocalArchiveSummary = {
    matchId: "fixture",
    fileName: "fixture.fmlens",
    startedUnixMilliseconds: 0,
    ended: true,
    frameCount: frames.length,
    firstTick: frames[0].tick,
    lastTick: frames.at(-1)?.tick ?? 0,
    homeGoals: 1,
    awayGoals: 1,
    fileSizeBytes: 0,
  }
  return { frames, metadata, metadataTimeline, summary }
}

export function frame(
  tick: number,
  options: {
    homeGoals?: number
    awayGoals?: number
    homeXg?: number
    playerGoals?: number
    playerAssists?: number
    awayOwnGoals?: number
    period?: number
    displayTick?: number
    momentumEvents?: RealtimeMomentumEvent[]
  } = {}
): RealtimeFrame {
  return {
    sequence: tick / 240,
    matchId: "fixture",
    tick,
    displayTick: options.displayTick ?? tick,
    period: options.period ?? 1,
    capturedUnixMilliseconds: tick,
    possessionTeam: tick % 480 === 0 ? "home" : "away",
    ballHolderPlayerId: 101,
    halfPitchWidth: 55,
    halfPitchLength: 75,
    momentumEvents: options.momentumEvents ?? [],
    momentum: [
      { value: tick / 240, timeTicks: tick, homeWeight: 1, awayWeight: 0 },
    ],
    rollingMomentum: [
      { value: tick / 480, timeTicks: tick, homeWeight: 1, awayWeight: 0 },
    ],
    home: team(options.homeGoals ?? 0, options.homeXg ?? 0),
    away: team(options.awayGoals ?? 0, 0.4),
    players: [
      player(
        101,
        1,
        "home",
        options.playerGoals ?? 0,
        options.playerAssists ?? 0,
        0
      ),
      player(102, 2, "home", 0, 0, 0),
      player(201, 3, "away", 0, 0, options.awayOwnGoals ?? 0),
    ],
  }
}

function team(goals: number, xg: number): RealtimeTeam {
  return {
    goals,
    xg,
    possessionTime: 0,
    shots: 0,
    shotsOnTarget: 0,
    shotsOffTarget: 0,
    blockedShots: 0,
    clearCutChances: 0,
    passes: 0,
    passesCompleted: 0,
    crosses: 0,
    crossesCompleted: 0,
    aerials: 0,
    aerialsWon: 0,
    progressivePasses: 0,
    finalThirdPasses: 0,
    tacklesAttempted: 0,
    tacklesWon: 0,
    fouls: 0,
    corners: 0,
    offsides: 0,
    yellowCards: 0,
    redCards: 0,
  }
}

function player(
  playerId: number,
  slot: number,
  side: "home" | "away",
  goals: number,
  assists: number,
  ownGoals: number
): RealtimePlayer {
  return {
    slot,
    playerId,
    team: side,
    isBallHolder: playerId === 101,
    x: playerId % 20,
    y: playerId % 30,
    rating: 7,
    isSubstitute: false,
    isOnPitch: true,
    subbedOnMinute: 0,
    subbedOffMinute: 0,
    penalties: 0,
    ownGoals,
    shotsFaced: 0,
    goals,
    assists,
  }
}

function metadataFixture(): RealtimeMatchMetadata {
  return {
    matchId: "fixture",
    startedUnixMilliseconds: 0,
    capturedTick: 0,
    home: { name: "Home" },
    away: { name: "Away" },
    players: [
      { slot: 1, playerId: 101, team: "home", displayName: "Scorer" },
      { slot: 2, playerId: 102, team: "home", displayName: "Receiver" },
      { slot: 3, playerId: 201, team: "away", displayName: "Defender" },
      { slot: 4, playerId: 202, team: "away", displayName: "Substitute" },
    ],
  }
}
