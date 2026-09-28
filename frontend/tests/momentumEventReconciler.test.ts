import { describe, expect, it, vi } from "vitest"

import { MomentumEventReconciler } from "@/api/momentumEventReconciler"
import type { RealtimeMomentumEvent } from "@/api/realtimeMatch"

describe("MomentumEventReconciler", () => {
  it("emits add revision zero for a new event", () => {
    const [update] = new MomentumEventReconciler().apply([event()])
    expect(update).toMatchObject({
      operation: "add",
      sequenceIndex: 100,
      revision: 0,
      updateSequence: 1,
    })
  })

  it("ignores identical repeated observations", () => {
    const reconciler = seeded()
    expect(reconciler.apply([event()])).toEqual([])
  })

  it("suppresses relocation as a public update", () => {
    const reconciler = seeded()
    expect(reconciler.apply([event({ eventIndex: 51 })])).toEqual([])
    expect(reconciler.diagnostics.relocations).toBe(1)
  })

  it("emits semantic revisions", () => {
    const reconciler = seeded()
    expect(reconciler.apply([event({ flags: 0x407 })])[0]).toMatchObject({
      operation: "update",
      revision: 1,
    })
  })

  it("handles relocation plus revision as one update", () => {
    const reconciler = seeded()
    const updates = reconciler.apply([event({ eventIndex: 51, flags: 0x407 })])
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ operation: "update", revision: 1 })
  })

  it("diagnoses a SequenceIndex collision without overwriting", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    const reconciler = seeded()
    expect(
      reconciler.apply([event({ tick: 9_000, team: "away", playerSlot: 8 })])
    ).toEqual([])
    expect(reconciler.diagnostics.sequenceCollisions).toBe(1)
    expect(warning).toHaveBeenCalledOnce()
    warning.mockRestore()
  })

  it("treats late player resolution as a semantic update", () => {
    const reconciler = new MomentumEventReconciler()
    reconciler.apply([event({ playerId: 0 })])
    const [update] = reconciler.apply([event({ playerId: 12_345 })])
    expect(update).toMatchObject({ operation: "update", revision: 1 })
    expect(reconciler.diagnostics.sequenceCollisions).toBe(0)
  })
})

function seeded() {
  const reconciler = new MomentumEventReconciler()
  reconciler.apply([event()])
  return reconciler
}

function event(
  overrides: Partial<RealtimeMomentumEvent> = {}
): RealtimeMomentumEvent {
  return {
    eventIndex: 50,
    tick: 100,
    lateralPosition: 1,
    longitudinalPosition: 2,
    trajectoryPoints: [{ lateralPosition: 1, longitudinalPosition: 2 }],
    team: "home",
    playerSlot: 3,
    playerId: 123,
    receiverPlayerSlot: 4,
    receiverPlayerId: 456,
    eventType: 7,
    flags: 0x001,
    sequenceIndex: 100,
    completionTick: 101,
    ...overrides,
  }
}
