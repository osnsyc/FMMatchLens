import type { RealtimeMomentumEvent } from "@/api/realtimeMatch"
import type {
  TacticalEventAnnotation,
  TacticalEventMetricId,
  TacticalEventPoint,
} from "@/types/match"

const CORNER_FLAG = 0x40
const ATTACKING_FREE_KICK_FLAG = 0x10
const DEFENSIVE_FREE_KICK_FLAG = 0x20
const KEY_PASS_FLAG = 0x02

const METRIC_BY_EVENT_TYPE: Partial<Record<number, TacticalEventMetricId>> = {
  1: "goals",
  2: "shotsOffTarget",
  3: "hitWoodwork",
  4: "shotsOnTarget",
  5: "blockedShots",
  6: "passesIncomplete",
  7: "passesCompleted",
  8: "passesIncomplete",
  9: "passesIncomplete",
  10: "passesIncomplete",
  11: "passesIncomplete",
  12: "crossesCompleted",
  13: "crossesIncomplete",
  14: "crossesIncomplete",
  15: "crossesIncomplete",
  16: "crossesIncomplete",
  17: "crossesIncomplete",
  18: "fouled",
  19: "foulsCommitted",
  20: "foulsCommitted",
  21: "foulsCommitted",
  23: "offsides",
  24: "clearances",
  25: "defensiveBlocks",
  26: "tacklesWon",
  27: "tacklesLost",
  28: "aerialsWon",
  29: "aerialsLost",
  31: "interceptions",
  34: "dribblesCompleted",
  37: "goalkeeperSavesHeld",
  38: "goalkeeperSavesParried",
  39: "goalkeeperSavesParried",
  45: "tacklesWon",
  49: "goals",
  52: "possessionGained",
  53: "possessionLost",
  54: "touches",
}

const ANNOTATION_BY_EVENT_TYPE: Partial<
  Record<number, TacticalEventAnnotation>
> = {
  8: "passTurnedOver",
  9: "passBlocked",
  13: "crossIntercepted",
  14: "crossBlocked",
  16: "crossOutOfPlay",
  20: "yellowCard",
  21: "redCard",
  22: "penaltyKick",
  35: "clearCutChance",
  37: "goalkeeperSaveHeld",
  38: "goalkeeperSaveParried",
  39: "goalkeeperSaveTipped",
  45: "keyTackle",
  49: "ownGoal",
}

export function nativeMomentumEventMetric(
  eventType: number
): TacticalEventMetricId | undefined {
  return METRIC_BY_EVENT_TYPE[eventType]
}

export function nativeMomentumEventMetricIds(
  item: RealtimeMomentumEvent,
  primary: TacticalEventMetricId
): TacticalEventMetricId[] {
  return item.eventType >= 6 &&
    item.eventType <= 17 &&
    (item.flags & KEY_PASS_FLAG) !== 0
    ? [primary, "keyPasses"]
    : [primary]
}

export function nativeMomentumEventAnnotations(
  item: Pick<RealtimeMomentumEvent, "eventType" | "flags">
): TacticalEventAnnotation[] {
  const annotations: TacticalEventAnnotation[] = []
  const eventValue = ANNOTATION_BY_EVENT_TYPE[item.eventType]
  if (eventValue) annotations.push(eventValue)

  if (
    (item.flags & CORNER_FLAG) !== 0 &&
    ((item.eventType >= 12 && item.eventType <= 17) || item.eventType === 52)
  ) {
    annotations.push("corner")
  }
  if ((item.flags & ATTACKING_FREE_KICK_FLAG) !== 0)
    annotations.push("attackingFreeKick")
  if ((item.flags & DEFENSIVE_FREE_KICK_FLAG) !== 0)
    annotations.push("defensiveFreeKick")
  return annotations
}

export function attachAuxiliaryEventAnnotations(
  points: Map<number, TacticalEventPoint>,
  nativeEvents: readonly RealtimeMomentumEvent[]
) {
  const auxiliaryEvents = nativeEvents.filter(
    (event) => event.eventType === 22 || event.eventType === 35
  )
  for (const auxiliary of auxiliaryEvents) {
    const annotation: TacticalEventAnnotation =
      auxiliary.eventType === 22 ? "penaltyKick" : "clearCutChance"
    let best: [number, TacticalEventPoint] | undefined
    for (const entry of points) {
      const point = entry[1]
      if (
        point.team !== auxiliary.team ||
        point.nativeEventType < 1 ||
        point.nativeEventType > 5 ||
        Math.abs(point.tick - auxiliary.tick) > 4
      )
        continue
      if (
        !best ||
        Math.abs(point.tick - auxiliary.tick) <
          Math.abs(best[1].tick - auxiliary.tick)
      )
        best = entry
    }
    if (!best || best[1].annotations?.includes(annotation)) continue
    points.set(best[0], {
      ...best[1],
      annotations: [...(best[1].annotations ?? []), annotation],
    })
  }
}
