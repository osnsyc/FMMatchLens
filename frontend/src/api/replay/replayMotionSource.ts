import type { RealtimeFrame } from "@/api/realtimeMatch"

export type ReplayMotionStatus = "buffering" | "playing" | "paused" | "ended"
export type ReplayMotionSnapshot = {
  frames: readonly RealtimeFrame[]
  position: number
  playing: boolean
}

/** Shares the timeline's fractional frame cursor; owns no timer or frame copies. */
export class ReplayMotionSource {
  private snapshot: ReplayMotionSnapshot = {
    frames: [],
    position: 0,
    playing: false,
  }
  private listeners = new Set<(snapshot: ReplayMotionSnapshot) => void>()
  getSnapshot() {
    return this.snapshot
  }
  get subscriberCount() {
    return this.listeners.size
  }
  subscribe(listener: (snapshot: ReplayMotionSnapshot) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  setFrames(frames: readonly RealtimeFrame[]) {
    if (frames === this.snapshot.frames) return
    this.snapshot = { frames, position: 0, playing: false }
    this.publish()
  }
  seek(position: number) {
    if (!Number.isFinite(position)) return
    this.snapshot = { ...this.snapshot, position: this.clamp(position) }
    this.publish()
  }
  setPlaying(playing: boolean) {
    if (playing === this.snapshot.playing) return
    this.snapshot = { ...this.snapshot, playing }
    this.publish()
  }
  advance(elapsedMilliseconds: number, speed: number) {
    const previous = this.snapshot
    if (
      !previous.playing ||
      !previous.frames.length ||
      !Number.isFinite(elapsedMilliseconds) ||
      !Number.isFinite(speed) ||
      speed <= 0
    )
      return previous
    const position = this.clamp(
      previous.position + (Math.max(0, elapsedMilliseconds) * speed) / 250
    )
    const playing = position < previous.frames.length - 1
    this.snapshot = { ...previous, position, playing }
    this.publish()
    return this.snapshot
  }
  clear() {
    this.snapshot = { frames: [], position: 0, playing: false }
    this.publish()
  }
  private clamp(position: number) {
    return Math.max(
      0,
      Math.min(Math.max(0, this.snapshot.frames.length - 1), position)
    )
  }
  private publish() {
    for (const listener of this.listeners) listener(this.snapshot)
  }
}
