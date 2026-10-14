import type { MotionSample } from "@/api/liveMotionSource"

/** Bounded evidence about continuous intervals; a jump never enters this estimate. */
export class LiveMotionRate {
  private rates: number[] = []

  get tickPerMs() {
    if (!this.rates.length) return undefined
    const sorted = [...this.rates].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2
  }

  get multiplier() {
    return this.tickPerMs == null ? undefined : this.tickPerMs * 250
  }
  get count() {
    return this.rates.length
  }
  clear() {
    this.rates.length = 0
  }
  record(rate: number | undefined) {
    if (rate == null || !Number.isFinite(rate) || rate <= 0) return
    this.rates.push(rate)
    if (this.rates.length > 6) this.rates.shift()
  }

  isCandidate(previous: MotionSample, next: MotionSample) {
    const rate = continuousRate(previous, next),
      baseline = this.tickPerMs
    // Quantized 1/2/3-tick steps are not restart candidates. Genuine sustained
    // acceleration is confirmed by the next interval, rather than capped at 1x.
    return (
      this.rates.length >= 3 &&
      rate != null &&
      baseline != null &&
      next.tick - previous.tick >= 8 &&
      rate > baseline * 3
    )
  }
}

export function continuousRate(previous: MotionSample, next: MotionSample) {
  if (
    !previous.anchor ||
    !next.anchor ||
    previous.matchId !== next.matchId ||
    previous.generation !== next.generation ||
    previous.period !== next.period
  )
    return undefined
  const elapsed = next.receivedAtMs - previous.receivedAtMs
  return elapsed >= 40 && elapsed <= 1500 && next.tick > previous.tick
    ? (next.tick - previous.tick) / elapsed
    : undefined
}
