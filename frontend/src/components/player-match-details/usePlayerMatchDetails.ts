import { useEffect, useMemo, useState } from "react"
import {
  analyzePlayerMovementAsync,
  EMPTY_PLAYER_MOVEMENT,
  type PlayerMovementAnalysis,
} from "@/api/playerMovement"
import type { RealtimeFrame } from "@/api/realtimeMatch"
import type { HeatmapSnapshot, MatchPlayer } from "@/types/match"

export type PlayerMatchDetailsProps = {
  player: MatchPlayer
  teamColor: string
  matchMinute: number
  matchTick: number
  movementFrames: readonly RealtimeFrame[]
  movementAnalysis?: PlayerMovementAnalysis
  heatmaps: HeatmapSnapshot
  pitchDimensions?: { length: number; width: number }
}

export function usePlayerMatchDetails({
  player,
  matchMinute,
  matchTick,
  movementFrames,
  movementAnalysis,
}: PlayerMatchDetailsProps) {
  const isGoalkeeper = playerIsGoalkeeper(player)
  const contribution =
    player.ratingContribution ?? player.resolveRatingContribution?.()
  const playedMinutes = playerMatchMinutes(player, matchMinute)
  const groups = useMemo(
    () => playerStatSections(player, isGoalkeeper),
    [isGoalkeeper, player]
  )
  const [archiveMovement, setArchiveMovement] = useState<{
    frames: readonly RealtimeFrame[]
    playerId: number
    throughTick: number
    value: PlayerMovementAnalysis
    ready: boolean
  }>(() => ({
    frames: movementFrames,
    playerId: player.id,
    throughTick: matchTick,
    value: EMPTY_PLAYER_MOVEMENT,
    ready: false,
  }))
  const movement =
    movementAnalysis ??
    (archiveMovement.frames === movementFrames &&
    archiveMovement.playerId === player.id &&
    archiveMovement.throughTick === matchTick
      ? archiveMovement.value
      : EMPTY_PLAYER_MOVEMENT)

  useEffect(() => {
    if (movementAnalysis) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void analyzePlayerMovementAsync(
        movementFrames,
        player.id,
        matchTick,
        () => cancelled
      ).then((value) => {
        if (!cancelled) {
          setArchiveMovement({
            frames: movementFrames,
            playerId: player.id,
            throughTick: matchTick,
            value,
            ready: true,
          })
        }
      })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [matchTick, movementAnalysis, movementFrames, player.id])

  const movementReady =
    Boolean(movementAnalysis) ||
    (archiveMovement.frames === movementFrames &&
      archiveMovement.playerId === player.id &&
      archiveMovement.throughTick === matchTick &&
      archiveMovement.ready)
  return { contribution, playedMinutes, groups, movement, movementReady }
}

type StatItem = { id: string; value: string }

function playerStatSections(player: MatchPlayer, isGoalkeeper: boolean) {
  const stats = player.stats
  const percent = (made?: number, attempted?: number) =>
    attempted ? `${(((made ?? 0) / attempted) * 100).toFixed(1)}%` : "0.0%"
  const combined = (made?: number, attempted?: number) =>
    `${number(made)} / ${number(attempted)} · ${percent(made, attempted)}`
  const number = (value?: number, digits = 0) =>
    Number(value ?? 0).toFixed(digits)
  const sections: Array<{ id: string; items: StatItem[] }> = []
  if (!isGoalkeeper) {
    sections.push({
      id: "attack",
      items: [
        {
          id: "goalsExpected",
          value: `${number(stats.goals)} / ${number(stats.xg, 2)}`,
        },
        {
          id: "assistsExpected",
          value: `${number(stats.assists)} / ${number(stats.xa, 2)}`,
        },
        { id: "shooting", value: combined(stats.shotsOnTarget, stats.shots) },
        {
          id: "dribblesChances",
          value: `${number(stats.dribbles)} / ${number(stats.clearCutChances)}`,
        },
      ],
    })
  }
  sections.push(
    {
      id: "passing",
      items: [
        {
          id: "passSummary",
          value: combined(stats.passesCompleted, stats.passes),
        },
        {
          id: "keyProgressivePasses",
          value: `${number(stats.keyPasses)} / ${number(stats.progressivePasses)}`,
        },
        {
          id: "crossSummary",
          value: combined(stats.crossesCompleted, stats.crosses),
        },
        { id: "chancesCreated", value: number(stats.chancesCreated) },
      ],
    },
    {
      id: "defence",
      items: [
        {
          id: "tackleSummary",
          value: combined(stats.tacklesWon, stats.tacklesAttempted),
        },
        {
          id: "aerialSummary",
          value: combined(stats.aerialsWon, stats.aerials),
        },
        {
          id: "defensiveActions",
          value: `${number(stats.interceptions)} / ${number(stats.clearances)} / ${number(stats.blocks)}`,
        },
        {
          id: "pressesPossessionWon",
          value: `${number(stats.pressesWon)} / ${number(stats.possessionWon)}`,
        },
      ],
    }
  )
  if (isGoalkeeper) {
    const saves =
      Number(stats.savesHeld ?? 0) +
      Number(stats.savesParried ?? 0) +
      Number(stats.savesTipped ?? 0)
    sections.push({
      id: "goalkeeping",
      items: [
        {
          id: "saveTypes",
          value: `${number(stats.savesHeld)} / ${number(stats.savesParried)} / ${number(stats.savesTipped)}`,
        },
        { id: "saveSummary", value: number(saves) },
        {
          id: "concededShotsFaced",
          value: `${number(stats.goalsConceded)} / ${number(stats.shotsFaced)}`,
        },
      ],
    })
  }
  return sections
}

export const playerMetricTranslationKeys: Record<string, string> = {
  goalsExpected: "playerDetails.metrics.goalsExpected",
  assistsExpected: "playerDetails.metrics.assistsExpected",
  shooting: "playerDetails.metrics.shooting",
  dribblesChances: "playerDetails.metrics.dribblesChances",
  passSummary: "playerDetails.metrics.passSummary",
  keyProgressivePasses: "playerDetails.metrics.keyProgressivePasses",
  crossSummary: "playerDetails.metrics.crossSummary",
  chancesCreated: "stats.chancesCreated",
  tackleSummary: "playerDetails.metrics.tackleSummary",
  aerialSummary: "playerDetails.metrics.aerialSummary",
  defensiveActions: "playerDetails.metrics.defensiveActions",
  pressesPossessionWon: "playerDetails.metrics.pressesPossessionWon",
  saveSummary: "playerDetails.metrics.saveSummary",
  saveTypes: "playerDetails.metrics.saveTypes",
  concededShotsFaced: "playerDetails.metrics.concededShotsFaced",
}

function playerMatchMinutes(player: MatchPlayer, matchMinute: number) {
  const start =
    player.status?.subbedOnMinute ??
    (player.isStarter || player.isOnPitch ? 0 : matchMinute)
  const end = player.status?.subbedOffMinute ?? matchMinute
  return Math.max(0, Math.round(end - start))
}

export function playerIsGoalkeeper(player: MatchPlayer) {
  return (
    player.inPossession?.position === "GK" ||
    player.outOfPossession?.position === "GK" ||
    (player.positionFamiliarities?.GK ?? 0) >= 15 ||
    player.position === "GK"
  )
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}
