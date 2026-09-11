import {
  HistoricalDerivations,
  type HistoricalDerivationsState,
} from "@/api/replay/replayDerivations"
import { metadataAtTick } from "@/api/archiveMetadata"
import type { ReplayArchive } from "@/api/replay/replayTypes"
import { toMatchSnapshot } from "@/api/realtimeMatch"
import type { MatchSnapshot } from "@/types/match"

type ReplayCheckpoint = {
  index: number
  state: HistoricalDerivationsState
}

export type ReplaySessionOptions = {
  checkpointInterval?: number
  maxCheckpoints?: number
}

export class ReplaySession {
  readonly frameCount: number
  private readonly checkpointInterval: number
  private readonly maxCheckpoints: number
  private readonly derivations = new HistoricalDerivations()
  private readonly checkpoints = new Map<number, ReplayCheckpoint>()
  private index = -1
  private cachedSnapshot?: MatchSnapshot
  private disposed = false
  private readonly archive: ReplayArchive
  private processedFrames = 0

  constructor(archive: ReplayArchive, options: ReplaySessionOptions = {}) {
    this.archive = archive
    this.frameCount = archive.frameCount
    this.checkpointInterval = Math.max(1, options.checkpointInterval ?? 2_400)
    this.maxCheckpoints = Math.max(1, options.maxCheckpoints ?? 4)
  }

  get currentIndex() {
    return this.index
  }

  get checkpointCount() {
    return this.checkpoints.size
  }

  get processedFrameCount() {
    return this.processedFrames
  }

  advanceTo(frameIndex: number): MatchSnapshot {
    this.assertActive()
    const target = this.clampIndex(frameIndex)
    if (target === this.index && this.cachedSnapshot) return this.cachedSnapshot
    if (target < this.index) return this.seek(target)

    // A prior playback pass may already have a checkpoint between the current
    // cursor and a forward seek target. Reuse it instead of replaying that
    // known range again.
    const forwardCheckpoint = this.nearestCheckpoint(target)
    if (forwardCheckpoint && forwardCheckpoint.index > this.index) {
      this.derivations.restoreState(forwardCheckpoint.state)
      this.index = forwardCheckpoint.index
      this.cachedSnapshot = undefined
      this.touchCheckpoint(forwardCheckpoint)
    }

    for (let next = this.index + 1; next <= target; next += 1) {
      this.derivations.appendFrame(
        this.archive.frames[next],
        this.archive.streamRevisions[next]
      )
      this.processedFrames += 1
      this.index = next
      if (
        next === 0 ||
        (next % this.checkpointInterval === 0 &&
          target - next < this.checkpointInterval)
      ) {
        this.saveCheckpoint(next)
      }
    }
    return this.buildSnapshot()
  }

  seek(frameIndex: number): MatchSnapshot {
    this.assertActive()
    const target = this.clampIndex(frameIndex)
    if (target >= this.index) return this.advanceTo(target)
    const checkpoint = this.nearestCheckpoint(target)
    if (checkpoint) {
      this.derivations.restoreState(checkpoint.state)
      this.index = checkpoint.index
      this.touchCheckpoint(checkpoint)
    } else {
      this.derivations.reset()
      this.index = -1
    }
    this.cachedSnapshot = undefined
    return this.advanceTo(target)
  }

  reset() {
    this.assertActive()
    this.derivations.reset()
    this.checkpoints.clear()
    this.index = -1
    this.processedFrames = 0
    this.cachedSnapshot = undefined
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.derivations.reset()
    this.checkpoints.clear()
    this.cachedSnapshot = undefined
  }

  private buildSnapshot() {
    this.cachedSnapshot = replaySnapshot(
      this.archive,
      this.index,
      this.derivations,
      this.cachedSnapshot
    )
    return this.cachedSnapshot
  }

  private saveCheckpoint(index: number) {
    if (
      !this.checkpoints.has(index) &&
      this.checkpoints.size >= this.maxCheckpoints
    ) {
      const earliestCached = [...this.checkpoints.keys()].find(
        (key) => key !== 0
      )
      // A backward replay should not evict all of the warm forward path. Frame
      // zero already bounds the cold prefix, so retain the farther LRU entries.
      if (earliestCached != null && index < earliestCached) return
    }
    const checkpoint = { index, state: this.derivations.exportState() }
    this.checkpoints.delete(index)
    this.checkpoints.set(index, checkpoint)
    while (this.checkpoints.size > this.maxCheckpoints) {
      const removable = [...this.checkpoints.keys()].find((key) => key !== 0)
      if (removable == null) break
      this.checkpoints.delete(removable)
    }
  }

  private nearestCheckpoint(target: number) {
    let selected: ReplayCheckpoint | undefined
    for (const checkpoint of this.checkpoints.values()) {
      if (
        checkpoint.index <= target &&
        (!selected || checkpoint.index > selected.index)
      ) {
        selected = checkpoint
      }
    }
    return selected
  }

  private touchCheckpoint(checkpoint: ReplayCheckpoint) {
    if (checkpoint.index === 0) return
    this.checkpoints.delete(checkpoint.index)
    this.checkpoints.set(checkpoint.index, checkpoint)
  }

  private clampIndex(index: number) {
    if (this.frameCount === 0) throw new Error("Replay archive has no frames")
    return Math.min(this.frameCount - 1, Math.max(0, Math.trunc(index)))
  }

  private assertActive() {
    if (this.disposed) throw new Error("ReplaySession has been disposed")
  }
}

/** Builds the bootstrap screen without creating a second persistent session. */
export function buildInitialReplaySnapshot(archive: ReplayArchive) {
  if (archive.frameCount === 0) throw new Error("Replay archive has no frames")
  const derivations = new HistoricalDerivations()
  derivations.appendFrame(archive.frames[0], archive.streamRevisions[0])
  return replaySnapshot(archive, 0, derivations)
}

function replaySnapshot(
  archive: ReplayArchive,
  index: number,
  derivations: HistoricalDerivations,
  previous?: MatchSnapshot
) {
  const frame = archive.frames[index]
  const historical = derivations.snapshot(frame.tick)
  const metadata =
    metadataAtTick(archive.metadataTimeline, frame.tick) ??
    archive.metadataTimeline[0] ??
    archive.metadata
  return toMatchSnapshot(
    frame,
    historical.xgTimeline,
    metadata,
    historical.events,
    historical.heatmaps,
    historical.tacticalEvents,
    historical.momentum,
    historical.rollingMomentum,
    undefined,
    previous
  )
}

export function replayFrameIndexAtPercent(ticks: Int32Array, percent: number) {
  if (ticks.length <= 1) return 0
  const clamped = Math.min(100, Math.max(0, percent))
  const target =
    ticks[0] + ((ticks[ticks.length - 1] - ticks[0]) * clamped) / 100
  let low = 0
  let high = ticks.length - 1
  while (low < high) {
    const middle = (low + high) >>> 1
    if (ticks[middle] < target) low = middle + 1
    else high = middle
  }
  if (low === 0) return 0
  return target - ticks[low - 1] <= ticks[low] - target ? low - 1 : low
}
