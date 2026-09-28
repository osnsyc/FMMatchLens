import type {
  RealtimeMomentumEvent,
  RealtimeMomentumEventUpdate,
} from "@/api/realtimeMatch"

type LogicalEventState = {
  event: RealtimeMomentumEvent
  revision: number
}

/** Rebuilds the logical upsert stream when reading legacy raw archives. */
export class MomentumEventReconciler {
  private events = new Map<number, LogicalEventState>()
  private nextUpdateSequence = 1
  readonly diagnostics = {
    relocations: 0,
    semanticRevisions: 0,
    sequenceCollisions: 0,
  }

  apply(
    observations: readonly RealtimeMomentumEvent[]
  ): RealtimeMomentumEventUpdate[] {
    const updates: RealtimeMomentumEventUpdate[] = []
    for (const event of observations) {
      const previous = this.events.get(event.sequenceIndex)
      if (!previous) {
        this.events.set(event.sequenceIndex, { event, revision: 0 })
        updates.push(this.createUpdate("add", event, 0))
        continue
      }
      if (!isPlausibleSameLogicalEvent(previous.event, event)) {
        this.diagnostics.sequenceCollisions += 1
        console.warn("Momentum SequenceIndex collision", {
          sequenceIndex: event.sequenceIndex,
          existing: previous.event,
          incoming: event,
        })
        continue
      }
      if (sameMomentumEventSemanticContent(previous.event, event)) {
        if (previous.event.eventIndex !== event.eventIndex)
          this.diagnostics.relocations += 1
        previous.event = event
        continue
      }
      if (previous.event.eventIndex !== event.eventIndex)
        this.diagnostics.relocations += 1
      previous.event = event
      previous.revision += 1
      this.diagnostics.semanticRevisions += 1
      updates.push(this.createUpdate("update", event, previous.revision))
    }
    return updates
  }

  private createUpdate(
    operation: RealtimeMomentumEventUpdate["operation"],
    event: RealtimeMomentumEvent,
    revision: number
  ): RealtimeMomentumEventUpdate {
    return {
      updateSequence: this.nextUpdateSequence++,
      operation,
      sequenceIndex: event.sequenceIndex,
      revision,
      event,
    }
  }
}

export function isPlausibleSameLogicalEvent(
  previous: RealtimeMomentumEvent,
  current: RealtimeMomentumEvent
) {
  return (
    previous.sequenceIndex === current.sequenceIndex &&
    previous.tick === current.tick &&
    previous.team === current.team &&
    previous.playerSlot === current.playerSlot
  )
}

export function sameMomentumEventSemanticContent(
  left: RealtimeMomentumEvent,
  right: RealtimeMomentumEvent
) {
  if (
    left.sequenceIndex !== right.sequenceIndex ||
    left.tick !== right.tick ||
    left.lateralPosition !== right.lateralPosition ||
    left.longitudinalPosition !== right.longitudinalPosition ||
    left.trajectoryStartLateralPosition !==
      right.trajectoryStartLateralPosition ||
    left.trajectoryStartLongitudinalPosition !==
      right.trajectoryStartLongitudinalPosition ||
    left.trajectoryEndLateralPosition !== right.trajectoryEndLateralPosition ||
    left.trajectoryEndLongitudinalPosition !==
      right.trajectoryEndLongitudinalPosition ||
    left.team !== right.team ||
    left.playerSlot !== right.playerSlot ||
    left.playerId !== right.playerId ||
    left.receiverPlayerSlot !== right.receiverPlayerSlot ||
    left.receiverPlayerId !== right.receiverPlayerId ||
    left.eventType !== right.eventType ||
    left.flags !== right.flags ||
    left.completionTick !== right.completionTick
  )
    return false

  const leftPoints = left.trajectoryPoints ?? []
  const rightPoints = right.trajectoryPoints ?? []
  return (
    leftPoints.length === rightPoints.length &&
    leftPoints.every(
      (point, index) =>
        point.lateralPosition === rightPoints[index]?.lateralPosition &&
        point.longitudinalPosition === rightPoints[index]?.longitudinalPosition
    )
  )
}
