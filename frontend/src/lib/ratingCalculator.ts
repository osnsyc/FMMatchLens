import type {
  ArchiveRatingInputs,
  RatingContribution,
  RatingContributionGroup,
  RealtimeRatingInputs,
  RealtimeRatingModel,
} from "@/api/realtimeMatch"
import type { TeamSide } from "@/types/match"

export type RatingWeightConfiguration = {
  weightsByCategoryBit: Map<number, number[]>
}

// This is a frontend interpretation rule
const observedWeightsByCategoryBit: Readonly<Record<number, readonly number[]>> = {
  0: [
    /* W00-W0F */ -720, 600, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 7,
    /* W10-W1F */ 0, 20, 30, 40, -8, 0, 7, 40, -20, 50, -40, 50, 0, -300, 0, 20,
    /* W20-W2F */ -20, 500, -300, 100, 200, 400, 450, 0, 125, -50, -100, -300, 200, -200, 300, 100,
    /* W30-W33 */ 300, -100, 50, -100,
  ],
  1: [
    /* W00-W0F */ -520, 500, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 5,
    /* W10-W1F */ -15, 20, 30, 40, -8, 0, 7, 56, -28, 70, -40, 100, 30, -200, 10, 20,
    /* W20-W2F */ -20, 300, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -75,
  ],
  3: [
    /* W00-W0F */ -800, 500, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 5,
    /* W10-W1F */ -15, 40, 30, 60, -12, 0, 10, 56, -28, 50, -40, 100, 30, -200, 10, 20,
    /* W20-W2F */ -20, 300, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -75,
  ],
  4: [
    /* W00-W0F */ -680, 500, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 7,
    /* W10-W1F */ -21, 20, 30, 40, -8, 0, 7, 56, -28, 70, -40, 100, 10, -200, 15, 20,
    /* W20-W2F */ -20, 250, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -50,
  ],
  5: [
    /* W00-W0F */ -440, 500, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 7,
    /* W10-W1F */ -21, 20, 30, 40, -8, 0, 7, 40, -20, 50, -40, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -50,
  ],
  6: [
    /* W00-W0F */ -750, 500, 100, 200, 350, 400, 300, 4, 350, 200, 30, 20, 350, -200, 40, 7,
    /* W10-W1F */ -21, 40, 30, 60, -12, 0, 10, 40, -20, 25, -40, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -50,
  ],
  7: [
    /* W00-W0F */ -1000, 500, 100, 200, 350, 400, 300, 4, 350, 200, 30, 20, 350, -200, 40, 7,
    /* W10-W1F */ -21, 40, 30, 60, -12, 0, 10, 40, -20, 25, -40, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -50,
  ],
  9: [
    /* W00-W0F */ -810, 550, 100, 200, 350, 400, 300, 4, 350, 200, 42, 28, 350, -200, 40, 7,
    /* W10-W1F */ -21, 40, 30, 40, -8, 0, 10, 40, -20, 50, -40, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 75, -50,
  ],
  10: [
    /* W00-W0F */ -620, 550, 100, 200, 350, 400, 300, 4, 350, 200, 42, 28, 350, -200, 40, 7,
    /* W10-W1F */ -14, 40, 30, 40, -8, 0, 10, 40, -20, 25, -20, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 25, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 75, -50,
  ],
  11: [
    /* W00-W0F */ -600, 550, 100, 200, 350, 400, 300, 4, 350, 200, 42, 28, 350, -200, 40, 7,
    /* W10-W1F */ -14, 20, 30, 40, -8, 0, 10, 40, -20, 25, -20, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 25, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 75, -50,
  ],
  12: [
    /* W00-W0F */ -770, 600, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 7,
    /* W10-W1F */ 0, 20, 30, 40, -8, 0, 7, 40, -20, 50, -40, 50, 0, -300, 0, 20,
    /* W20-W2F */ -20, 500, -300, 100, 200, 400, 450, 0, 125, -50, -100, -300, 200, -200, 300, 100,
    /* W30-W33 */ 300, -100, 50, -100,
  ],
  14: [
    /* W00-W0F */ -700, 500, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 5,
    /* W10-W1F */ -15, 28, 30, 40, -8, 0, 7, 56, -28, 70, -40, 100, 30, -200, 10, 20,
    /* W20-W2F */ -20, 300, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -75,
  ],
  15: [
    /* W00-W0F */ -620, 500, 100, 200, 350, 400, 300, 4, 350, 200, 30, 20, 350, -200, 40, 7,
    /* W10-W1F */ -21, 20, 30, 40, -8, 0, 10, 40, -20, 40, -40, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -50,
  ],
  16: [
    /* W00-W0F */ -600, 500, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 7,
    /* W10-W1F */ -21, 20, 30, 40, -8, 0, 7, 40, -20, 50, -40, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -50,
  ],
  17: [
    /* W00-W0F */ -700, 500, 100, 200, 350, 400, 300, 4, 350, 200, 30, 20, 350, -200, 40, 7,
    /* W10-W1F */ -21, 40, 30, 40, -8, 0, 10, 40, -20, 25, -40, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -50,
  ],
  18: [
    /* W00-W0F */ -600, 550, 100, 200, 350, 400, 300, 4, 350, 200, 42, 28, 350, -200, 40, 7,
    /* W10-W1F */ -14, 20, 30, 40, -8, 0, 10, 40, -20, 25, -20, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 25, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 75, -50,
  ],
  19: [
    /* W00-W0F */ -600, 550, 100, 200, 350, 400, 300, 4, 350, 200, 42, 28, 350, -200, 40, 7,
    /* W10-W1F */ -14, 20, 30, 40, -8, 0, 10, 40, -20, 25, -20, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 25, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 75, -50,
  ],
  24: [
    /* W00-W0F */ -580, 500, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 5,
    /* W10-W1F */ -15, 28, 30, 40, -8, 0, 7, 56, -28, 70, -40, 100, 30, -200, 10, 20,
    /* W20-W2F */ -20, 300, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -75,
  ],
  27: [
    /* W00-W0F */ -865, 550, 100, 200, 350, 400, 300, 4, 350, 200, 42, 28, 350, -200, 40, 7,
    /* W10-W1F */ -21, 40, 30, 40, -8, 0, 10, 40, -20, 25, -20, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 75, -50,
  ],
  29: [
    /* W00-W0F */ -480, 500, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 5,
    /* W10-W1F */ -15, 20, 30, 40, -8, 0, 7, 56, -28, 70, -40, 100, 30, -200, 10, 20,
    /* W20-W2F */ -20, 300, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -75,
  ],
  31: [
    /* W00-W0F */ -600, 550, 100, 200, 350, 400, 300, 4, 350, 200, 42, 28, 350, -200, 40, 7,
    /* W10-W1F */ -14, 20, 30, 40, -8, 0, 10, 40, -20, 25, -20, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 25, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 75, -50,
  ],
  32: [
    /* W00-W0F */ -850, 550, 100, 200, 350, 400, 300, 4, 350, 200, 42, 28, 350, -200, 40, 7,
    /* W10-W1F */ -21, 40, 30, 40, -8, 0, 10, 40, -20, 50, -40, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 75, -50,
  ],
  35: [
    /* W00-W0F */ -680, 500, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 7,
    /* W10-W1F */ -21, 20, 30, 40, -8, 0, 7, 56, -28, 70, -40, 100, 10, -200, 15, 20,
    /* W20-W2F */ -20, 250, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -50,
  ],
  38: [
    /* W00-W0F */ -940, 500, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 5,
    /* W10-W1F */ -15, 40, 30, 60, -12, 0, 10, 56, -28, 50, -40, 100, 30, -200, 10, 20,
    /* W20-W2F */ -20, 300, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -75,
  ],
  40: [
    /* W00-W0F */ -620, 550, 100, 200, 350, 400, 300, 4, 350, 200, 42, 28, 350, -200, 40, 7,
    /* W10-W1F */ -14, 40, 30, 40, -8, 0, 10, 40, -20, 25, -20, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 25, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 75, -50,
  ],
  41: [
    /* W00-W0F */ -810, 550, 100, 200, 350, 400, 300, 4, 350, 200, 42, 28, 350, -200, 40, 7,
    /* W10-W1F */ -21, 40, 30, 40, -8, 0, 10, 40, -20, 50, -40, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 75, -50,
  ],
  43: [
    /* W00-W0F */ -600, 500, 100, 200, 350, 400, 300, 4, 350, 200, 30, 20, 350, -200, 40, 7,
    /* W10-W1F */ -21, 40, 30, 60, -12, 0, 10, 40, -20, 25, -40, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -50,
  ],
  44: [
    /* W00-W0F */ -610, 500, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 5,
    /* W10-W1F */ -15, 20, 30, 40, -8, 0, 7, 56, -28, 50, -40, 100, 30, -200, 10, 20,
    /* W20-W2F */ -20, 300, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -75,
  ],
  45: [
    /* W00-W0F */ -1090, 550, 100, 200, 350, 400, 300, 4, 350, 200, 42, 28, 350, -200, 40, 7,
    /* W10-W1F */ -21, 40, 30, 40, -8, 0, 10, 40, -20, 25, -20, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 75, -50,
  ],
  46: [
    /* W00-W0F */ -720, 500, 100, 200, 350, 400, 300, 4, 350, 200, 30, 20, 350, -200, 40, 7,
    /* W10-W1F */ -21, 20, 30, 40, -8, 0, 10, 40, -20, 25, -40, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -50,
  ],
  48: [
    /* W00-W0F */ -440, 500, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 7,
    /* W10-W1F */ -21, 20, 30, 40, -8, 0, 7, 40, -20, 50, -40, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -50,
  ],
  49: [
    /* W00-W0F */ -750, 500, 100, 200, 350, 400, 300, 4, 350, 200, 30, 20, 350, -200, 40, 7,
    /* W10-W1F */ -21, 40, 30, 60, -12, 0, 10, 40, -20, 25, -40, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -50,
  ],
  51: [
    /* W00-W0F */ -520, 500, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 5,
    /* W10-W1F */ -15, 24, 30, 40, -8, 0, 7, 56, -28, 70, -40, 100, 30, -200, 10, 20,
    /* W20-W2F */ -20, 300, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -75,
  ],
  52: [
    /* W00-W0F */ -740, 500, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 5,
    /* W10-W1F */ -15, 24, 30, 40, -8, 0, 7, 56, -28, 70, -40, 100, 30, -200, 10, 20,
    /* W20-W2F */ -20, 300, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -75,
  ],
  53: [
    /* W00-W0F */ -770, 600, 100, 200, 350, 400, 300, 4, 300, 200, 30, 20, 350, -200, 30, 7,
    /* W10-W1F */ 0, 20, 30, 40, -8, 0, 7, 40, -20, 50, -40, 50, 0, -300, 0, 20,
    /* W20-W2F */ -20, 500, -300, 100, 200, 400, 450, 0, 125, -50, -100, -300, 200, -200, 300, 100,
    /* W30-W33 */ 300, -100, 50, -100,
  ],
  55: [
    /* W00-W0F */ -790, 500, 100, 200, 350, 400, 300, 4, 350, 200, 30, 20, 350, -200, 40, 5,
    /* W10-W1F */ -15, 20, 30, 40, -8, 0, 10, 56, -28, 50, -40, 100, 30, -200, 10, 20,
    /* W20-W2F */ -20, 300, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -75,
  ],
  56: [
    /* W00-W0F */ -810, 550, 100, 200, 350, 400, 300, 4, 350, 200, 42, 28, 350, -200, 40, 7,
    /* W10-W1F */ -21, 40, 30, 40, -8, 0, 10, 40, -20, 50, -40, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 75, -50,
  ],
  57: [
    /* W00-W0F */ -550, 500, 100, 200, 350, 400, 300, 4, 350, 200, 30, 20, 350, -200, 40, 7,
    /* W10-W1F */ -21, 20, 30, 40, -8, 0, 10, 40, -20, 25, -40, 50, 10, -200, 10, 20,
    /* W20-W2F */ -20, 75, -300, 0, 0, 0, 0, 0, 0, -50, -100, -300, 200, -200, 0, 100,
    /* W30-W33 */ 0, -100, 50, -50,
  ],
}

function createObservedWeightConfiguration(): RatingWeightConfiguration {
  const weightsByCategoryBit = new Map<number, number[]>()
  Object.entries(observedWeightsByCategoryBit).forEach(([rawBit, sourceWeights]) => {
    if (sourceWeights.length !== 52) {
      throw new Error(`Observed CategoryBit ${rawBit} must define W00-W33`)
    }
    weightsByCategoryBit.set(Number(rawBit), [...sourceWeights])
  })
  return { weightsByCategoryBit }
}

export const observedRatingWeightConfiguration = createObservedWeightConfiguration()

// RoleDuty flags that do not identify the tactical role used by the rating table.
export const ratingDutyMask = 0x200000n | 0x400000n | 0x800000n
  | 0x2000000n | 0x4000000n | 0x400000000n

// Frontend interpretation rule. Keeping it beside the weights lets new mappings be
// shipped without changing capture or archive data.
export const ratingRoleCategoryBits: ReadonlyMap<bigint, number> = new Map([
  [0x200n, 9], [0x20000n, 17], [0x4000000000n, 38], [0x10000n, 16], [0x400000000000n, 46],
  [0x1000000n, 24], [0x1000n, 12], [0x2n, 1], [0x800n, 11], [0x80000000n, 31],
  [0x100000000000000n, 56], [0x20n, 5], [0x400n, 10], [0x8000n, 15], [0x10n, 4],
  [0x10000000000n, 40], [0x1n, 0], [0x800000000n, 35], [0x8000000n, 27],
  [0x10000000000000n, 52], [0x2000000000000n, 49], [0x100000000000n, 44], [0x4000n, 14],
  [0x200000000000000n, 57], [0x20000000n, 29], [0x20000000000000n, 53], [0x80000n, 19],
  [0x80000000000000n, 55], [0x20000000000n, 41], [0x100000000n, 32], [0x40000n, 18],
  [0x80n, 7], [0x8n, 3], [0x8000000000000n, 51], [0x1000000000000n, 48],
  [0x200000000000n, 45], [0x40n, 6], [0x80000000000n, 43],
])

export type RatingClassificationState = {
  totalEligibleDuration: number
  classificationDurations: Array<{ categoryBit: number; duration: number }>
  qualityFlags: string[]
}

const ratingRolePairCategoryBits: ReadonlyMap<string, number> = new Map()

export function ratingCategoryBitForRoles(inPossessionRoleDuty: bigint, outOfPossessionRoleDuty: bigint) {
  const inRole = inPossessionRoleDuty & ~ratingDutyMask
  const outRole = outOfPossessionRoleDuty & ~ratingDutyMask
  return ratingRolePairCategoryBits.get(`${inRole}:${outRole}`) ?? ratingRoleCategoryBits.get(inRole)
}

export function deriveRatingClassification(
  previous: RatingClassificationState | undefined,
  totalEligibleDuration: number,
  inPossessionRoleDuty: bigint,
  outOfPossessionRoleDuty: bigint,
): RatingClassificationState {
  if (previous && totalEligibleDuration === previous.totalEligibleDuration) return previous
  const reset = previous != null && totalEligibleDuration < previous.totalEligibleDuration
  const previousTotal = reset ? 0 : previous?.totalEligibleDuration ?? 0
  const durations = new Map(
    reset ? [] : previous?.classificationDurations.map((item) => [item.categoryBit, item.duration] as const) ?? [],
  )
  const qualityFlags = reset ? ["classification_duration_reset"] : [...(previous?.qualityFlags ?? [])]
  if (!previous && totalEligibleDuration > 0) qualityFlags.push("partial_classification_history")
  const delta = Math.max(0, totalEligibleDuration - previousTotal)
  if (delta > 0) {
    const categoryBit = ratingCategoryBitForRoles(inPossessionRoleDuty, outOfPossessionRoleDuty)
    if (categoryBit == null) {
      qualityFlags.push(
        `unmapped_role_ip_0x${inPossessionRoleDuty.toString(16).toUpperCase()}_oop_0x${outOfPossessionRoleDuty.toString(16).toUpperCase()}`,
      )
    } else {
      durations.set(categoryBit, (durations.get(categoryBit) ?? 0) + delta)
    }
  }
  return {
    totalEligibleDuration,
    classificationDurations: [...durations].sort((left, right) => left[0] - right[0])
      .map(([categoryBit, duration]) => ({ categoryBit, duration })),
    qualityFlags: [...new Set(qualityFlags)],
  }
}

export type RatingCalculationInput = {
  statsRaw: Uint8Array
  internalW25: number
  internalW24: number
  specialW2C: number
  specialW2D: number
  specialW2E: number
  specialW2F: number
  specialW30: number
  specialW31: number
  internalScore: number
  specialConditionA: number
  specialConditionB: number
  totalEligibleDuration: number
  classificationDurations: Array<{ categoryBit: number; duration: number }>
  qualityFlags: string[]
  ratingEvents: Uint8Array[]
  ratingBaseCondition: number
  matchPhase: number
  configuration?: RatingWeightConfiguration
  nativeRating: number
  activeBaseline: number
  backgroundInput: number
}

const groups: RatingContributionGroup[] = [
  "BaseContext", "Shooting", "Creativity", "Passing", "Defence", "Goalkeeping",
]

// Active +0x88 configuration record observed for the supported FM26 build.
const factorPairs: ReadonlyArray<readonly [number, number]> = [
  [1.2, 1], [1.2, 1], [1.1, 1], [1.1, 1], [1, 1], [1, 1],
  [1, 1], [1, 1], [1, 1], [1, 1], [1, 1],
]

export function calculateRatingContribution(source: RatingCalculationInput): RatingContribution {
  const preGroups = Object.fromEntries(groups.map((group) => [group, 0])) as Record<RatingContributionGroup, number>
  const flags = [...source.qualityFlags]
  const terms: RatingContribution["terms"] = []
  const configuration = source.configuration ?? observedRatingWeightConfiguration
  let nativeSum = 0

  nativeSum += addRatingEvents(source, configuration, preGroups, terms, flags)
    if (source.totalEligibleDuration <= 0) flags.push("zero_eligible_duration")
    else {
      const inputs = readInputs(source)
      for (const duration of source.classificationDurations.filter((item) => item.duration > 0)) {
        const weights = configuration.weightsByCategoryBit.get(duration.categoryBit)
        if (!weights || weights.length !== 52) {
          flags.push(`missing_weight_bit_${duration.categoryBit}`)
          continue
        }
        const capped = Math.min(duration.duration, 21_600)
        const fraction21600 = capped / 21_600
        const w00 = Math.trunc(weights[0] * capped / 21_600)
        addIndependentTerm(0, fraction21600, w00)

        const goalsAgainst = source.statsRaw[0xca]
        const w21Enabled = (source.ratingBaseCondition & 0x04) !== 0 && goalsAgainst === 0
        const w21 = w21Enabled ? Math.trunc(weights[33] * capped / 21_600) : 0
        addIndependentTerm(33, w21Enabled ? fraction21600 : 0, w21)

        const saves = (source.statsRaw[0x99] + source.statsRaw[0x9a] + source.statsRaw[0x9b]) & 0xff
        const goalkeeperBit = isGoalkeeperCategoryBit(duration.categoryBit)
        const activity = saves + goalsAgainst
        const multiplier = goalkeeperBit && activity < 5 ? 5 - activity : 0
        const w28 = Math.trunc(weights[40] * multiplier * capped / 21_600)
        addIndependentTerm(40, multiplier * fraction21600, w28)

        const fraction = duration.duration / source.totalEligibleDuration
        let weightedRaw = 0
        for (let index = 7; index < 52; index += 1) {
          if (index === 12 || index === 33 || index === 40) continue
          const product = weights[index] * inputs[index]
          weightedRaw += product
          const contribution = product * fraction
          const group = groupFor(index, duration.categoryBit)
          preGroups[group] += contribution
          if (contribution !== 0) terms.push({
            index, categoryBit: duration.categoryBit, group, input: inputs[index], coefficient: weights[index],
            contribution, postFactorContribution: 0, confidence: confidenceFor(index),
          })
        }
        const scaled = Math.fround(Math.fround(weightedRaw) * Math.fround(fraction))
        nativeSum += roundAwayFromZero(scaled)

        function addIndependentTerm(index: number, input: number, contribution: number) {
          const group = groupFor(index, duration.categoryBit)
          preGroups[group] += contribution
          nativeSum += contribution
          if (contribution !== 0) terms.push({
            index, categoryBit: duration.categoryBit, group, input, coefficient: weights![index],
            contribution, postFactorContribution: 0, confidence: confidenceFor(index),
          })
        }
      }
    }
  const scored = signedByte(source.statsRaw[0xc9])
  const conceded = signedByte(source.statsRaw[0xca])
  const factorIndex = selectFactorIndex(Math.trunc(source.backgroundInput), scored - conceded, scored, conceded)
  const selectedBaseFactor = Math.fround(factorPairs[factorIndex][nativeSum >= 0 ? 0 : 1])
  const durationFactor = Math.fround(Math.min(Math.max(source.totalEligibleDuration, 0), 21_600) / 21_600)
  const effectiveFactor = source.totalEligibleDuration >= 21_600
    ? selectedBaseFactor
    : Math.fround(1 + Math.fround(Math.fround(selectedBaseFactor - 1) * durationFactor))
  const scaledTotal = Math.fround(Math.fround(nativeSum) * effectiveFactor)
  const scaledContribution = roundAwayFromZero(scaledTotal)
  const predictedInternalScore = Math.min(10_000, Math.max(0, source.activeBaseline + scaledContribution))
  const postGroups = Object.fromEntries(groups.map((group) => [group, preGroups[group] * effectiveFactor])) as Record<RatingContributionGroup, number>
  terms.forEach((term) => { term.postFactorContribution = term.contribution * effectiveFactor })

  flags.push("tick_sample_may_follow_native_calculation", "w04_w05_context_formula_unresolved")
  return {
    nativeRating: source.nativeRating,
    internalScore: source.internalScore,
    groupContributionsPreFactor: preGroups,
    groupContributionsPostFactor: postGroups,
    preFactorTotal: nativeSum,
    selectedFactorIndex: factorIndex,
    selectedBaseFactor,
    effectiveFactor,
    globalFactorAdjustment: scaledContribution - nativeSum,
    predictedInternalScore,
    reconstructionResidual: source.internalScore - predictedInternalScore,
    classificationDurations: source.classificationDurations,
    qualityFlags: [...new Set(flags)],
    terms,
    limitation: "Near-exact reconstruction with active baseline and global factor. W04/W05 remain unresolved; residual is model reconciliation error, not a football contribution.",
  }
}

export function decodeLiveRatingInputs(
  value: RealtimeRatingInputs,
  player: { team: TeamSide; rating: number },
  model: RealtimeRatingModel,
  configuration: RatingWeightConfiguration = observedRatingWeightConfiguration,
): RatingCalculationInput {
  return decodeArchiveRatingInputs(decodeRealtimeRatingInputs(value), player, model, configuration)
}

export function decodeRealtimeRatingInputs(
  value: RealtimeRatingInputs,
  previous?: ArchiveRatingInputs,
): ArchiveRatingInputs {
  const statsPacked = decodeBase64(value.statsPacked)
  if (statsPacked.byteLength !== 36) throw new Error("Live rating stats payload has an invalid size")
  const common = Math.trunc(value.ratingEventsCommonLength)
  if (common < 0 || common > (previous?.ratingEvents.length ?? 0)) {
    throw new Error("Live rating event delta has no matching baseline")
  }
  const ratingEvents = [
    ...(previous?.ratingEvents.slice(0, common) ?? []),
    ...value.ratingEventsTail.map(decodeBase64),
  ]
  const inPossessionRoleDuty = parseRoleDuty(value.inPossessionRoleDuty)
  const outOfPossessionRoleDuty = parseRoleDuty(value.outOfPossessionRoleDuty)
  const classification = deriveRatingClassification(
    previous,
    value.totalEligibleDuration,
    inPossessionRoleDuty,
    outOfPossessionRoleDuty,
  )
  const decoded: ArchiveRatingInputs = {
    statsPacked,
    internalW25: value.internalW25, internalW24: value.internalW24,
    specialW2C: value.specialW2C, specialW2D: value.specialW2D, specialW2E: value.specialW2E,
    specialW2F: value.specialW2F, specialW30: value.specialW30, specialW31: value.specialW31,
    internalScore: value.rawInternalRating,
    specialConditionA: value.specialConditionA, specialConditionB: value.specialConditionB,
    inPossessionRoleDuty, outOfPossessionRoleDuty,
    totalEligibleDuration: value.totalEligibleDuration,
    classificationDurations: classification.classificationDurations,
    qualityFlags: classification.qualityFlags,
    ratingEvents,
  }
  return previous && sameArchiveRatingInputs(previous, decoded) ? previous : decoded
}

function sameArchiveRatingInputs(left: ArchiveRatingInputs, right: ArchiveRatingInputs) {
  return bytesEqual(left.statsPacked, right.statsPacked)
    && left.internalW25 === right.internalW25 && left.internalW24 === right.internalW24
    && left.specialW2C === right.specialW2C && left.specialW2D === right.specialW2D && left.specialW2E === right.specialW2E
    && left.specialW2F === right.specialW2F && left.specialW30 === right.specialW30 && left.specialW31 === right.specialW31
    && left.internalScore === right.internalScore
    && left.specialConditionA === right.specialConditionA && left.specialConditionB === right.specialConditionB
    && left.inPossessionRoleDuty === right.inPossessionRoleDuty
    && left.outOfPossessionRoleDuty === right.outOfPossessionRoleDuty
    && left.totalEligibleDuration === right.totalEligibleDuration
    && left.qualityFlags.length === right.qualityFlags.length
    && left.qualityFlags.every((item, index) => item === right.qualityFlags[index])
    && left.classificationDurations.length === right.classificationDurations.length
    && left.classificationDurations.every((item, index) => item.categoryBit === right.classificationDurations[index].categoryBit && item.duration === right.classificationDurations[index].duration)
    && left.ratingEvents.length === right.ratingEvents.length
    && left.ratingEvents.every((item, index) => item === right.ratingEvents[index] || bytesEqual(item, right.ratingEvents[index]))
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
}

export function decodeArchiveRatingInputs(
  value: ArchiveRatingInputs,
  player: RealtimePlayerRatingSource,
  model: RealtimeRatingModel,
  configuration: RatingWeightConfiguration = observedRatingWeightConfiguration,
): RatingCalculationInput {
  const packed = value.statsPacked
  if (packed.byteLength !== 36) throw new Error("Archive rating stats payload has an invalid size")
  const raw = new Uint8Array(238)
  const view = new DataView(raw.buffer)
  view.setFloat32(0x1c, player.xg ?? 0, true)
  raw.set(packed.subarray(0, 4), 0x28)
  const byte = (offset: number, input: number | undefined) => { raw[offset] = (input ?? 0) & 0xff }
  byte(0x8b, player.goals); byte(0x8d, packed[4]); byte(0x8e, player.penalties); byte(0x8f, player.ownGoals)
  byte(0x90, player.shots); byte(0x91, player.shotsOnTarget)
  byte(0x99, player.savesHeld); byte(0x9a, player.savesParried); byte(0x9b, player.savesTipped)
  const uniqueOffsets = [0x9c, 0x9d, 0x9e, 0xa0, 0xa6, 0xa7, 0xbd, 0xc8, 0xc9, 0xca, 0xcf, 0xd7, 0xd8, 0xd9, 0xda]
  uniqueOffsets.forEach((offset, index) => { raw[offset] = packed[5 + index] })
  const confirmedOffsets = [0x8c, 0xa5, 0xc4, 0xd0, 0xe4, 0xe5]
  confirmedOffsets.forEach((offset, index) => { raw[offset] = packed[20 + index] })
  byte(0x9f, player.assists); byte(0xa1, player.dribbles); byte(0xa3, player.fouls); byte(0xa4, player.fouled)
  byte(0xbe, player.tacklesAttempted); byte(0xbf, player.tacklesWon)
  byte(0xc2, player.aerials); byte(0xc3, player.aerialsWon); byte(0xc7, player.interceptions); byte(0xd1, player.clearances)
  raw.set(packed.subarray(26, 28), 0xdc)
  raw.set(packed.subarray(28, 30), 0xde)
  raw.set(packed.subarray(30, 32), 0xe0)
  raw.set(packed.subarray(32, 34), 0xe2)
  raw[0xeb] = packed[34]
  raw[0xed] = packed[35]
  return {
    statsRaw: raw,
    internalW25: value.internalW25, internalW24: value.internalW24,
    specialW2C: value.specialW2C, specialW2D: value.specialW2D, specialW2E: value.specialW2E,
    specialW2F: value.specialW2F, specialW30: value.specialW30, specialW31: value.specialW31,
    internalScore: value.internalScore,
    specialConditionA: value.specialConditionA, specialConditionB: value.specialConditionB,
    totalEligibleDuration: value.totalEligibleDuration,
    classificationDurations: value.classificationDurations,
    qualityFlags: value.qualityFlags,
    ratingEvents: value.ratingEvents,
    ratingBaseCondition: model.ratingBaseCondition,
    matchPhase: model.matchPhase,
    configuration,
    nativeRating: player.rating,
    activeBaseline: model.activeBaseline,
    backgroundInput: player.team === "home" ? model.homeBackgroundInput : model.awayBackgroundInput,
  }
}

type RealtimePlayerRatingSource = {
  team: TeamSide
  rating: number
  xg?: number
  goals?: number
  penalties?: number
  ownGoals?: number
  shots?: number
  shotsOnTarget?: number
  savesHeld?: number
  savesParried?: number
  savesTipped?: number
  assists?: number
  dribbles?: number
  fouls?: number
  fouled?: number
  tacklesAttempted?: number
  tacklesWon?: number
  aerials?: number
  aerialsWon?: number
  interceptions?: number
  clearances?: number
}

function parseRoleDuty(value: string) {
  if (!/^\d+$/.test(value)) throw new Error("Live rating RoleDuty payload is invalid")
  const parsed = BigInt(value)
  if (parsed > 0xffffffffffffffffn) throw new Error("Live rating RoleDuty payload exceeds uint64")
  return parsed
}

function addRatingEvents(
  source: RatingCalculationInput,
  configuration: RatingWeightConfiguration,
  target: Record<RatingContributionGroup, number>,
  terms: RatingContribution["terms"],
  flags: string[],
) {
  let sum = 0
  const eventCountsByCategoryBit = new Map<number, number>()
  source.ratingEvents.forEach((raw) => {
    if (raw.byteLength !== 16) { flags.push("invalid_rating_event_record"); return }
    const mask = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getBigUint64(0, true)
    if (mask === 0n || (mask & (mask - 1n)) !== 0n) { flags.push(`unmapped_rating_event_mask_0x${mask.toString(16).toUpperCase()}`); return }
    let bit = 0
    for (let value = mask; value > 1n; value >>= 1n) bit += 1
    const weights = configuration.weightsByCategoryBit.get(bit)
    if (!weights) { flags.push(`missing_weight_bit_${bit}`); return }
    const add = (index: number) => {
      const contribution = weights[index]
      const group = groupFor(index, bit)
      target[group] += contribution
      sum += contribution
      if (contribution !== 0) terms.push({
        index, categoryBit: bit, group, input: 1, coefficient: contribution,
        contribution, postFactorContribution: 0, confidence: confidenceFor(index),
      })
    }
    const priorCategoryEvents = eventCountsByCategoryBit.get(bit) ?? 0
    if (priorCategoryEvents > 0) add(6)
    eventCountsByCategoryBit.set(bit, priorCategoryEvents + 1)
    if (raw[0x0e] !== 0) { add(12); return }
    add(1)
    if (raw[0x0c] === 1) add(2)
    else if (raw[0x0c] === 2) add(3)
  })
  return sum
}

function readInputs(source: RatingCalculationInput) {
  const raw = source.statsRaw
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const byte = (offset: number) => raw[offset]
  const int16 = (offset: number) => view.getInt16(offset, true)
  const values = Array<number>(52).fill(0)
  values[7] = Math.min(0, Math.trunc(Math.fround(Math.fround(byte(0x8b) - view.getFloat32(0x1c, true)) * 100)))
  values[8] = byte(0x9f); values[9] = Math.max(byte(0x9f) - 1, 0)
  values[10] = byte(0x90); values[11] = byte(0x91); values[13] = byte(0x8d) - byte(0x8e); values[14] = byte(0xbd)
  const completedPasses = (int16(0xe0) + int16(0xe2)) & 0xffff
  const attemptedPasses = (int16(0xdc) + int16(0xde)) & 0xffff
  values[15] = completedPasses; values[16] = attemptedPasses - completedPasses
  values[17] = byte(0xa1); values[18] = byte(0xa4)
  const completedCrosses = byte(0xd9) + byte(0xda)
  values[19] = completedCrosses; values[20] = byte(0xd7) + byte(0xd8) - completedCrosses
  values[21] = byte(0xa0); values[22] = Math.trunc(Math.fround(view.getFloat32(0x28, true) * 100))
  values[23] = byte(0xbf); values[24] = byte(0xbe) - byte(0xbf); values[25] = byte(0xc7); values[26] = byte(0xa3)
  values[27] = byte(0x9c); values[28] = byte(0xd1); values[29] = byte(0xc8); values[30] = byte(0xcf)
  values[31] = byte(0xc3); values[32] = byte(0xc2) - byte(0xc3); values[34] = byte(0x8f)
  values[35] = (byte(0x99) + byte(0x9a) + byte(0x9b)) & 0xff
  values[36] = source.internalW24; values[37] = source.internalW25; values[38] = byte(0x9e); values[39] = byte(0x9d) - byte(0x9e)
  values[41] = byte(0xa6) === 1 ? 1 : 0; values[42] = byte(0xa6) === 2 ? 1 : 0; values[43] = byte(0xa7)
  if (source.matchPhase === 4 || source.specialConditionA > 0 || source.specialConditionB > 0) {
    values[44] = source.specialW2C; values[45] = source.specialW2D; values[46] = source.specialW2E
    values[47] = source.specialW2F; values[48] = source.specialW30; values[49] = source.specialW31
  }
  values[50] = signedByte(byte(0xc9)); values[51] = signedByte(byte(0xca))
  return values
}

export function selectFactorIndex(background: number, delta: number, scored: number, conceded: number) {
  if (background < 0) {
    if (delta >= 0) {
      if (scored === conceded) return background === -1 ? 3 : 1
      return background === -1 ? 2 : 0
    }
    if (delta === background) return 5
    return background < delta ? 4 : 10
  }
  if (background === 0) return delta > 0 ? 2 : delta < 0 ? 8 : 5
  if (delta <= 0) {
    if (scored === conceded) return background > 1 ? 7 : 9
    return background > 1 ? 6 : 8
  }
  if (delta === background) return 5
  return background <= delta ? 4 : 10
}

function groupFor(index: number, categoryBit: number): RatingContributionGroup {
  if (index === 0) return "BaseContext"
  if ([1,2,3,4,5,6,7,10,11,12,13].includes(index)) return "Shooting"
  if ([8,9,14,17,18,21,22,50].includes(index)) return "Creativity"
  if ([15,16,19,20].includes(index)) return "Passing"
  if ([23,24,25,26,27,28,29,30,31,32,33,34,41,42,43,51].includes(index)) return "Defence"
  if ([35,36,37,38,39,40].includes(index)) return "Goalkeeping"
  if ([44,45,46,47,48,49].includes(index)) return isGoalkeeperCategoryBit(categoryBit) ? "Goalkeeping" : "Shooting"
  throw new RangeError(`Unsupported rating weight index W${index.toString(16).toUpperCase().padStart(2, "0")}`)
}

function isGoalkeeperCategoryBit(categoryBit: number) {
  return categoryBit === 0 || categoryBit === 12 || categoryBit === 53
}

function confidenceFor(index: number) {
  if ([0,1,2,3,4,5,6,8,9,10,11,12,23,24,31,32,33,34,40,50,51].includes(index)) return "confirmed"
  if ([15,16,25,27,30].includes(index)) return "very-high"
  if ([7,14,17,18,19,20,22,26,28,35,41].includes(index)) return "high"
  if ([13,38,39].includes(index)) return "medium-high"
  if ([21,29,36,37,42].includes(index)) return "medium"
  return "unknown"
}

function signedByte(value: number) { return value > 127 ? value - 256 : value }
function roundAwayFromZero(value: number) { return value < 0 ? -Math.round(-value) : Math.round(value) }
function decodeBase64(value: string) {
  const decoded = atob(value)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}
