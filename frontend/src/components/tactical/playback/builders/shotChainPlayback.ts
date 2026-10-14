import type { RealtimeFrame } from "@/api/realtimeMatch"
import {
  buildPlaybackFrames,
  needsDisplayRotation,
} from "@/components/tactical/playback/core/frameProjector"
import {
  eventCompletionTick,
  frameIndexesForTickRange,
} from "@/components/tactical/playback/core/playbackRange"
import type {
  PlaybackRange,
  TacticalPlayback,
} from "@/components/tactical/playback/core/types"
import type { ShotChain } from "@/components/tactical/tacticalScene"
import type { MatchPlayer } from "@/types/match"

export const SHOT_CHAIN_PLAYBACK_PADDING_TICKS = 8

export function buildShotChainPlayback(
  chain: ShotChain,
  frames: readonly RealtimeFrame[],
  players: ReadonlyMap<number, MatchPlayer>
): TacticalPlayback | null {
  const firstEvent = chain.events[0]
  const shot = chain.events.at(-1)
  if (!firstEvent || !shot || chain.events.length < 2 || frames.length === 0)
    return null
  const range = shotChainPlaybackTickRange(chain)
  const indexes = frameIndexesForTickRange(frames, range)
  if (!indexes) return null
  const playbackFrames = buildPlaybackFrames(
    frames,
    indexes.start,
    indexes.end,
    players,
    needsDisplayRotation(firstEvent)
  )
  if (playbackFrames.length < 2) return null
  return {
    id: chain.id,
    team: chain.team,
    range,
    frames: playbackFrames,
    trail: { target: "ball" },
    overlays: [],
  }
}

export function shotChainPlaybackTickRange(chain: ShotChain): PlaybackRange {
  const firstEvent = chain.events[0]
  const shot = chain.events.at(-1)
  const startTick = firstEvent?.tick ?? 0
  return {
    startTick,
    endTick: shot ? eventCompletionTick(shot) : startTick,
  }
}

export function isShotChainPlaybackTrigger(chain: ShotChain, eventId: string) {
  return chain.events[0]?.id === eventId
}
