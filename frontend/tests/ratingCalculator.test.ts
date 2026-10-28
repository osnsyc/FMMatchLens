import { describe, expect, it } from "vitest"

import {
  calculateRatingContribution,
  decodeArchiveRatingInputs,
  decodeLiveRatingInputs,
  decodeRealtimeRatingInputs,
  deriveRatingClassification,
  observedRatingWeightConfiguration,
  selectFactorIndex,
  type RatingCalculationInput,
} from "@/lib/ratingCalculator"

describe("frontend rating classification", () => {
  it("accumulates eligible duration by the raw role active at each timeline sample", () => {
    const first = deriveRatingClassification(undefined, 100, 0x80n | 0x200000n, 0n)
    const second = deriveRatingClassification(first, 175, 0x200n, 0x400n)

    expect(first.classificationDurations).toEqual([{ categoryBit: 7, duration: 100 }])
    expect(second.classificationDurations).toEqual([
      { categoryBit: 7, duration: 100 },
      { categoryBit: 9, duration: 75 },
    ])
  })

  it("keeps an unmapped IP/OOP pair explicit instead of borrowing another role", () => {
    const result = deriveRatingClassification(undefined, 50, 0x123n, 0x456n)
    expect(result.classificationDurations).toEqual([])
    expect(result.qualityFlags).toContain("unmapped_role_ip_0x123_oop_0x456")
  })
})

function input(weights: number[], overrides: Partial<RatingCalculationInput> = {}): RatingCalculationInput {
  return {
    statsRaw: new Uint8Array(232),
    internalW25: 0,
    internalW24: 0,
    specialW2C: 0,
    specialW2D: 0,
    specialW2E: 0,
    specialW2F: 0,
    specialW30: 0,
    specialW31: 0,
    internalScore: 6_700,
    specialConditionA: 0,
    specialConditionB: 0,
    totalEligibleDuration: 10_800,
    classificationDurations: [{ categoryBit: 7, duration: 10_800 }],
    qualityFlags: [],
    ratingEvents: [],
    ratingBaseCondition: 0,
    matchPhase: 0,
    configuration: {
      weightsByCategoryBit: new Map([[7, weights]]),
    },
    nativeRating: 6.7,
    activeBaseline: 6_700,
    backgroundInput: 0,
    ...overrides,
  }
}

describe("rating reconstruction", () => {
  it("loads the frontend-owned merged observed weight table", () => {
    expect(observedRatingWeightConfiguration.weightsByCategoryBit.size).toBe(38)
    observedRatingWeightConfiguration.weightsByCategoryBit.forEach((weights) => {
      expect(weights).toHaveLength(52)
    })
  })

  it("classifies W01-W06 and W0C rating-event rewards as Shooting", () => {
    const weights = Array<number>(52).fill(0)
    weights[1] = 500
    weights[2] = 100
    weights[6] = 300
    weights[12] = 350
    const normalEvent = new Uint8Array(16)
    const specialEvent = new Uint8Array(16)
    new DataView(normalEvent.buffer).setBigUint64(0, 1n << 7n, true)
    new DataView(specialEvent.buffer).setBigUint64(0, 1n << 7n, true)
    normalEvent[0x0c] = 1
    specialEvent[0x0e] = 1

    const result = calculateRatingContribution(input(weights, {
      ratingEvents: [normalEvent, specialEvent],
      internalScore: 7_950,
    }))

    expect(result.groupContributionsPreFactor.Shooting).toBe(1_250)
    expect(result.terms.filter((term) => term.group === "Shooting").map((term) => term.index)).toEqual([1, 2, 6, 12])
    expect(result.reconstructionResidual).toBe(0)
  })

  it("does not apply W06 to the first event of two different CategoryBits", () => {
    const weights7 = Array<number>(52).fill(0)
    const weights8 = Array<number>(52).fill(0)
    weights7[6] = 300
    weights8[6] = 400
    const category7Event = new Uint8Array(16)
    const category8Event = new Uint8Array(16)
    new DataView(category7Event.buffer).setBigUint64(0, 1n << 7n, true)
    new DataView(category8Event.buffer).setBigUint64(0, 1n << 8n, true)

    const result = calculateRatingContribution(input(weights7, {
      ratingEvents: [category7Event, category8Event],
      configuration: {
        weightsByCategoryBit: new Map([[7, weights7], [8, weights8]]),
      },
    }))

    expect(result.terms.some((term) => term.index === 6)).toBe(false)
    expect(result.preFactorTotal).toBe(0)
  })

  it("splits shootout terms between Goalkeeping and Shooting by category bit", () => {
    const weights = Array<number>(52).fill(0)
    weights[44] = 100
    const outfield = calculateRatingContribution(input(weights, {
      matchPhase: 4,
      specialW2C: 2,
    }))
    const goalkeeper = calculateRatingContribution(input(weights, {
      matchPhase: 4,
      specialW2C: 2,
      classificationDurations: [{ categoryBit: 0, duration: 10_800 }],
      configuration: {
        weightsByCategoryBit: new Map([[0, weights]]),
      },
    }))

    expect(outfield.groupContributionsPreFactor.Shooting).toBe(200)
    expect(goalkeeper.groupContributionsPreFactor.Goalkeeping).toBe(200)
  })

  it("merges carry and team goals into Creativity and cards and team concessions into Defence", () => {
    const weights = Array<number>(52).fill(0)
    ;[17,18,41,43,50,51].forEach((index) => { weights[index] = 100 })
    const raw = new Uint8Array(232)
    raw[0xa1] = 1
    raw[0xa4] = 1
    raw[0xa6] = 1
    raw[0xa7] = 1
    raw[0xc9] = 1
    raw[0xca] = 1

    const result = calculateRatingContribution(input(weights, { statsRaw: raw }))

    expect(result.groupContributionsPreFactor.Creativity).toBe(300)
    expect(result.groupContributionsPreFactor.Defence).toBe(300)
  })

  it("enables W21 only when match bit 2 is set and the player has conceded zero", () => {
    const weights = Array<number>(52).fill(0)
    weights[33] = 500

    const enabled = calculateRatingContribution(input(weights, {
      ratingBaseCondition: 4,
      internalScore: 6_950,
    }))
    expect(enabled.groupContributionsPreFactor.Defence).toBe(250)
    expect(enabled.predictedInternalScore).toBe(6_950)
    expect(enabled.reconstructionResidual).toBe(0)

    const disabled = calculateRatingContribution(input(weights))
    expect(disabled.groupContributionsPreFactor.Defence).toBe(0)
  })

  it("selects the recovered global-factor branches", () => {
    expect(selectFactorIndex(-1, 1, 1, 0)).toBe(2)
    expect(selectFactorIndex(-2, 0, 1, 1)).toBe(1)
    expect(selectFactorIndex(0, -1, 0, 1)).toBe(8)
    expect(selectFactorIndex(2, 2, 2, 0)).toBe(5)
    expect(selectFactorIndex(2, 1, 1, 0)).toBe(10)
  })

  it("interpolates the factor by participation time and reports the full-pipeline residual", () => {
    const weights = Array<number>(52).fill(0)
    weights[10] = 100
    const raw = new Uint8Array(232)
    raw[0x90] = 2
    raw[0xc9] = 1

    const result = calculateRatingContribution(input(weights, {
      statsRaw: raw,
      backgroundInput: -1,
      internalScore: 6_917,
    }))

    expect(result.preFactorTotal).toBe(200)
    expect(result.selectedFactorIndex).toBe(2)
    expect(result.selectedBaseFactor).toBeCloseTo(1.1, 6)
    expect(result.effectiveFactor).toBeCloseTo(1.05, 6)
    expect(result.predictedInternalScore).toBe(6_910)
    expect(result.reconstructionResidual).toBe(7)
  })

  it("decodes the compact 36-byte live rating-only vector", () => {
    const packed = new Uint8Array(36)
    const packedView = new DataView(packed.buffer)
    packedView.setFloat32(0, 0.25, true)
    packed[5 + 9] = 2 // team conceded while on pitch
    packed[20] = 2 // goals conceded
    packed[21] = 3 // offsides
    packed[22] = 4 // headers lost
    packed[23] = 5 // possession lost
    packed[24] = 6 // presses attempted
    packed[34] = 7
    packed[35] = 19
    packed[25] = 1 // presses won
    packedView.setInt16(26, 12, true)
    const statsPacked = btoa(String.fromCharCode(...packed))

    const decoded = decodeLiveRatingInputs({
      statsPacked,
      internalW25: 0, internalW24: 0,
      specialW2C: 0, specialW2D: 0, specialW2E: 0,
      specialW2F: 0, specialW30: 0, specialW31: 0,
      rawInternalRating: 6_700,
      specialConditionA: 0, specialConditionB: 0,
      inPossessionRoleDuty: "128", outOfPossessionRoleDuty: "0",
      totalEligibleDuration: 0,
      ratingEventsCommonLength: 0, ratingEventsTail: [],
    }, {
      team: "home", rating: 6.7, xg: 0.75,
      shots: 3, goals: 0, penalties: 0, ownGoals: 0, shotsOnTarget: 0,
      savesHeld: 0, savesParried: 0, savesTipped: 0, assists: 0, dribbles: 0,
      fouls: 0, fouled: 0, tacklesAttempted: 0, tacklesWon: 0,
      aerials: 0, aerialsWon: 0, interceptions: 0, clearances: 0,
    }, {
      ratingBaseCondition: 0, matchPhase: 0, eventRewardBranch: 0,
      activeBaseline: 6_700, homeBackgroundInput: -1, awayBackgroundInput: 1,
    })

    const rawView = new DataView(decoded.statsRaw.buffer)
    expect(rawView.getFloat32(0x1c, true)).toBeCloseTo(0.75)
    expect(decoded.statsRaw[0x90]).toBe(3)
    expect(decoded.statsRaw[0xca]).toBe(2)
    expect(decoded.statsRaw[0x8c]).toBe(2)
    expect(decoded.statsRaw[0xa5]).toBe(3)
    expect(decoded.statsRaw[0xc4]).toBe(4)
    expect(decoded.statsRaw[0xd0]).toBe(5)
    expect(decoded.statsRaw[0xe4]).toBe(6)
    expect(decoded.statsRaw[0xe5]).toBe(1)
    expect(decoded.statsRaw[0xeb]).toBe(7)
    expect(decoded.statsRaw[0xed]).toBe(19)
    expect(rawView.getInt16(0xdc, true)).toBe(12)
    expect(decoded.backgroundInput).toBe(-1)
  })

  it("expands the archive-only 36-byte stat vector only when requested", () => {
    const packed = new Uint8Array(36)
    new DataView(packed.buffer).setFloat32(0, 0.25, true)
    packed[5 + 9] = 2 // Stats+0xCA: team conceded while on pitch.
    packed[20] = 2
    packed[21] = 3
    packed[22] = 4
    packed[23] = 5
    packed[24] = 6
    packed[34] = 7
    packed[35] = 19
    packed[25] = 1
    new DataView(packed.buffer).setInt16(26, 12, true)

    const decoded = decodeArchiveRatingInputs({
      statsPacked: packed,
      internalW25: 0, internalW24: 0,
      specialW2C: 0, specialW2D: 0, specialW2E: 0,
      specialW2F: 0, specialW30: 0, specialW31: 0,
      internalScore: 6_700,
      specialConditionA: 0, specialConditionB: 0,
      inPossessionRoleDuty: 0x80n, outOfPossessionRoleDuty: 0n,
      totalEligibleDuration: 0,
      classificationDurations: [], qualityFlags: ["test_quality_flag"], ratingEvents: [],
    }, {
      team: "home", rating: 6.7, xg: 0.75,
      goals: 0, penalties: 0, ownGoals: 0,
      shots: 3, shotsOnTarget: 1,
      savesHeld: 0, savesParried: 0, savesTipped: 0,
      assists: 0, dribbles: 0, fouls: 0, fouled: 0,
      tacklesAttempted: 0, tacklesWon: 0,
      aerials: 0, aerialsWon: 0, interceptions: 0, clearances: 0,
    }, {
      ratingBaseCondition: 0, matchPhase: 0, eventRewardBranch: 0,
      activeBaseline: 6_700, homeBackgroundInput: -1, awayBackgroundInput: 1,
    })

    const rawView = new DataView(decoded.statsRaw.buffer)
    expect(rawView.getFloat32(0x1c, true)).toBeCloseTo(0.75)
    expect(rawView.getFloat32(0x28, true)).toBeCloseTo(0.25)
    expect(decoded.statsRaw[0x90]).toBe(3)
    expect(decoded.statsRaw[0xca]).toBe(2)
    expect(decoded.statsRaw[0x8c]).toBe(2)
    expect(decoded.statsRaw[0xa5]).toBe(3)
    expect(decoded.statsRaw[0xc4]).toBe(4)
    expect(decoded.statsRaw[0xd0]).toBe(5)
    expect(decoded.statsRaw[0xe4]).toBe(6)
    expect(decoded.statsRaw[0xe5]).toBe(1)
    expect(decoded.statsRaw[0xeb]).toBe(7)
    expect(decoded.statsRaw[0xed]).toBe(19)
    expect(rawView.getInt16(0xdc, true)).toBe(12)
    expect(decoded.qualityFlags).toEqual(["test_quality_flag"])
  })

  it("reconstructs live rating event common-prefix tails and reuses unchanged compact input", () => {
    const eventA = new Uint8Array(16).fill(1)
    const eventB = new Uint8Array(16).fill(2)
    const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value))
    const base = {
      statsPacked: encode(new Uint8Array(36)),
      internalW25: 0, internalW24: 0,
      specialW2C: 0, specialW2D: 0, specialW2E: 0,
      specialW2F: 0, specialW30: 0, specialW31: 0,
      rawInternalRating: 6_700,
      specialConditionA: 0, specialConditionB: 0,
      inPossessionRoleDuty: "128", outOfPossessionRoleDuty: "0",
      totalEligibleDuration: 100,
    }
    const first = decodeRealtimeRatingInputs({
      ...base,
      ratingEventsCommonLength: 0,
      ratingEventsTail: [encode(eventA)],
    })
    const second = decodeRealtimeRatingInputs({
      ...base,
      ratingEventsCommonLength: 1,
      ratingEventsTail: [encode(eventB)],
    }, first)
    const unchanged = decodeRealtimeRatingInputs({
      ...base,
      ratingEventsCommonLength: 2,
      ratingEventsTail: [],
    }, second)

    expect(second.ratingEvents).toHaveLength(2)
    expect(second.ratingEvents[0]).toBe(first.ratingEvents[0])
    expect(second.ratingEvents[1]).toEqual(eventB)
    expect(unchanged).toBe(second)
  })
})
