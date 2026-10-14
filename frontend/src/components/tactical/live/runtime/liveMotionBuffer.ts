import type { MotionSample } from "@/api/liveMotionSource"
export class LiveMotionBuffer {
  readonly samples: MotionSample[] = []
  append(sample: MotionSample) {
    this.samples.push(sample)
    while (
      this.samples.length > 32 ||
      (this.samples.length > 2 &&
        sample.receivedAtMs - this.samples[0].receivedAtMs > 3000)
    )
      this.samples.shift()
  }
  clear() {
    this.samples.length = 0
  }
}
