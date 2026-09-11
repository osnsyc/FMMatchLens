import type { RealtimeFrame } from "@/api/realtimeMatch"
import type {
  HeatmapGrid,
  HeatmapPhase,
  HeatmapQuery,
  HeatmapScope,
  HeatmapSnapshot,
  PositionHeatmapRange,
  TeamSide,
} from "@/types/match"

const GRID_WIDTH = 20 as const
const GRID_HEIGHT = 30 as const
const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT
const EMPTY_DENSITY = new Float32Array(CELL_COUNT)

type Accumulator = {
  sampleCount: number
  sumX: number
  sumY: number
  density: Float64Array
  output?: HeatmapGrid
  dirty: boolean
}

type Sample = {
  playerId: number
  team: TeamSide
  phase: Exclude<HeatmapPhase, "all">
  x: number
  y: number
  cell: number
}

type RecentFrame = {
  minute: number
  samples: Sample[]
}

const ranges: PositionHeatmapRange[] = ["full", "half", "recent15"]

export type HeatmapDerivationsState = {
  stores: Array<
    [PositionHeatmapRange, Array<[string, Omit<Accumulator, "output">]>]
  >
  recentFrames: RecentFrame[]
  halfKey: number
  revision: number
}

/**
 * Incremental heatmap data engine. Forward playback visits every historical
 * frame exactly once; recent15 is maintained as a +1/-1 sliding window.
 */
export class HeatmapDerivations {
  private stores: Record<PositionHeatmapRange, Map<string, Accumulator>> = {
    full: new Map(),
    half: new Map(),
    recent15: new Map(),
  }
  private recentFrames: RecentFrame[] = []
  private recentStart = 0
  private halfKey = -1
  private snapshotCache: HeatmapSnapshot = { grids: new Map(), revision: 0 }
  private indexDirty = true
  private revision = 0
  private snapshotRevision = -1

  reset() {
    for (const range of ranges) this.stores[range].clear()
    this.recentFrames = []
    this.recentStart = 0
    this.halfKey = -1
    this.snapshotCache = { grids: new Map(), revision: 0 }
    this.indexDirty = true
    this.revision = 0
    this.snapshotRevision = -1
  }

  append(frames: readonly RealtimeFrame[]) {
    for (const frame of frames) this.appendFrame(frame)
  }

  appendRange(
    frames: readonly RealtimeFrame[],
    fromInclusive: number,
    toInclusive: number
  ) {
    const start = Math.max(0, fromInclusive)
    const end = Math.min(frames.length - 1, toInclusive)
    for (let index = start; index <= end; index += 1) {
      this.appendFrame(frames[index])
    }
  }

  appendFrame(frame: RealtimeFrame) {
    this.processFrame(frame)
    this.revision += 1
  }

  snapshot(): HeatmapSnapshot {
    // Accumulator output grids are intentionally reused. Consumers receive a
    // fresh read-only index, while grid storage remains allocation-stable.
    const grids = this.indexDirty
      ? new Map<string, HeatmapGrid>()
      : (this.snapshotCache.grids as Map<string, HeatmapGrid>)
    for (const range of ranges) {
      for (const [key, accumulator] of this.stores[range]) {
        const output = toGrid(accumulator)
        if (this.indexDirty) grids.set(`${key}:${range}`, output)
      }
    }
    if (this.indexDirty || this.snapshotRevision !== this.revision) {
      this.snapshotCache = { grids, revision: this.revision }
      this.indexDirty = false
      this.snapshotRevision = this.revision
    }
    return this.snapshotCache
  }

  getHeatmap(query: HeatmapQuery): HeatmapGrid {
    return getHeatmap(this.snapshot(), query)
  }

  exportState(): HeatmapDerivationsState {
    return {
      stores: ranges.map((range) => [
        range,
        [...this.stores[range]].map(([key, accumulator]) => [
          key,
          {
            sampleCount: accumulator.sampleCount,
            sumX: accumulator.sumX,
            sumY: accumulator.sumY,
            density: accumulator.density.slice(),
            dirty: true,
          },
        ]),
      ]),
      recentFrames: this.recentFrames.slice(this.recentStart),
      halfKey: this.halfKey,
      revision: this.revision,
    }
  }

  restoreState(state: HeatmapDerivationsState) {
    this.reset()
    for (const [range, entries] of state.stores) {
      this.stores[range] = new Map(
        entries.map(([key, accumulator]) => [
          key,
          { ...accumulator, density: accumulator.density.slice() },
        ])
      )
    }
    this.recentFrames = state.recentFrames.slice()
    this.recentStart = 0
    this.halfKey = state.halfKey
    this.revision = state.revision
    this.snapshotRevision = -1
    this.indexDirty = true
  }

  private processFrame(frame: RealtimeFrame) {
    const minute = frameMinute(frame)
    const nextHalfKey = minute < 45 ? 0 : minute < 90 ? 1 : minute < 105 ? 2 : 3
    if (nextHalfKey !== this.halfKey) {
      this.halfKey = nextHalfKey
      this.stores.half.clear()
      this.indexDirty = true
    }

    const samples: Sample[] = []
    const halfWidth = validPitchHalf(frame.halfPitchWidth)
    const halfLength = validPitchHalf(frame.halfPitchLength)
    if (frame.possessionTeam != null && halfWidth && halfLength) {
      const secondHalf = frame.period === 2
      for (const player of frame.players) {
        if (
          !player.isOnPitch ||
          !Number.isFinite(player.x) ||
          !Number.isFinite(player.y)
        )
          continue
        const x = normalize(
          secondHalf ? -player.x : player.x,
          -halfWidth,
          halfWidth
        )
        const y = normalize(
          secondHalf ? player.y : -player.y,
          -halfLength,
          halfLength
        )
        const column = Math.min(
          GRID_WIDTH - 1,
          Math.floor(x / (100 / GRID_WIDTH))
        )
        const row = Math.min(
          GRID_HEIGHT - 1,
          Math.floor(y / (100 / GRID_HEIGHT))
        )
        const sample: Sample = {
          playerId: player.playerId,
          team: player.team,
          phase:
            frame.possessionTeam === player.team
              ? "inPossession"
              : "outOfPossession",
          x,
          y,
          cell: row * GRID_WIDTH + column,
        }
        samples.push(sample)
        this.applySample(this.stores.full, sample, 1)
        this.applySample(this.stores.half, sample, 1)
        this.applySample(this.stores.recent15, sample, 1)
      }
    }

    this.recentFrames.push({ minute, samples })
    const oldestMinute = Math.max(0, minute - 15)
    while (
      this.recentStart < this.recentFrames.length &&
      this.recentFrames[this.recentStart].minute < oldestMinute
    ) {
      for (const sample of this.recentFrames[this.recentStart].samples) {
        this.applySample(this.stores.recent15, sample, -1)
      }
      this.recentStart += 1
    }
    if (this.recentStart > 2_048) {
      this.recentFrames = this.recentFrames.slice(this.recentStart)
      this.recentStart = 0
    }
  }

  private applySample(
    store: Map<string, Accumulator>,
    sample: Sample,
    direction: 1 | -1
  ) {
    const scopes: HeatmapScope[] = [
      { type: "player", playerId: sample.playerId },
      { type: "team", team: sample.team },
    ]
    const phases: HeatmapPhase[] = ["all", sample.phase]
    for (const scope of scopes) {
      for (const phase of phases) {
        const key = queryPrefix(scope, phase)
        let accumulator = store.get(key)
        if (!accumulator && direction === 1) {
          accumulator = {
            sampleCount: 0,
            sumX: 0,
            sumY: 0,
            density: new Float64Array(CELL_COUNT),
            dirty: true,
          }
          store.set(key, accumulator)
          this.indexDirty = true
        }
        if (!accumulator) continue
        accumulator.sampleCount += direction
        accumulator.sumX += sample.x * direction
        accumulator.sumY += sample.y * direction
        accumulator.density[sample.cell] += direction
        accumulator.dirty = true
        if (accumulator.sampleCount <= 0) {
          store.delete(key)
          this.indexDirty = true
        }
      }
    }
  }
}

export function getHeatmap(
  snapshot: HeatmapSnapshot,
  query: HeatmapQuery
): HeatmapGrid {
  if (typeof query.range !== "string") {
    // The public query shape reserves custom tick ranges for the next iteration.
    return emptyGrid()
  }
  return (
    snapshot.grids.get(
      `${queryPrefix(query.scope, query.phase)}:${query.range}`
    ) ?? emptyGrid()
  )
}

export function combineHeatmapGrids(
  grids: readonly HeatmapGrid[]
): HeatmapGrid {
  const density = new Float32Array(CELL_COUNT)
  let sampleCount = 0
  let sumX = 0
  let sumY = 0
  for (const grid of grids) {
    sampleCount += grid.sampleCount
    sumX += grid.averageX * grid.sampleCount
    sumY += grid.averageY * grid.sampleCount
    for (let index = 0; index < CELL_COUNT; index += 1) {
      density[index] += grid.density[index] ?? 0
    }
  }
  return {
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    density,
    sampleCount,
    averageX: sampleCount > 0 ? sumX / sampleCount : 50,
    averageY: sampleCount > 0 ? sumY / sampleCount : 50,
  }
}

const COLOR_SCALE_GAUSSIAN_KERNEL = [
  0.071303, 0.131514, 0.189879, 0.214607, 0.189879, 0.131514, 0.071303,
] as const

/**
 * Shared post-blur cell-share ceiling for a set of comparable grids.
 *
 * This mirrors the renderer's seven-tap separable Gaussian kernel. Computing
 * the ceiling after smoothing keeps sparse ranges (especially recent 15m)
 * from looking artificially cold while still giving both teams the same scale.
 */
export function getHeatmapColorScaleBounds(grids: readonly HeatmapGrid[]) {
  let rawMaxCellShare = 0
  let blurredMaxCellShare = 0
  for (const grid of grids) {
    if (grid.sampleCount <= 0) continue
    for (const density of grid.density) {
      rawMaxCellShare = Math.max(rawMaxCellShare, density / grid.sampleCount)
    }
    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        let blurredDensity = 0
        for (
          let kernelY = 0;
          kernelY < COLOR_SCALE_GAUSSIAN_KERNEL.length;
          kernelY += 1
        ) {
          const sampleY = Math.min(
            GRID_HEIGHT - 1,
            Math.max(0, y + kernelY - 3)
          )
          const weightY = COLOR_SCALE_GAUSSIAN_KERNEL[kernelY]
          for (
            let kernelX = 0;
            kernelX < COLOR_SCALE_GAUSSIAN_KERNEL.length;
            kernelX += 1
          ) {
            const sampleX = Math.min(
              GRID_WIDTH - 1,
              Math.max(0, x + kernelX - 3)
            )
            blurredDensity +=
              (grid.density[sampleY * GRID_WIDTH + sampleX] ?? 0) *
              weightY *
              COLOR_SCALE_GAUSSIAN_KERNEL[kernelX]
          }
        }
        blurredMaxCellShare = Math.max(
          blurredMaxCellShare,
          blurredDensity / grid.sampleCount
        )
      }
    }
  }
  return { rawMaxCellShare, blurredMaxCellShare }
}

export function buildHeatmapSnapshot(
  frames: readonly RealtimeFrame[],
  throughIndex = frames.length - 1
): HeatmapSnapshot {
  const engine = new HeatmapDerivations()
  const end = Math.min(Math.max(throughIndex, -1), frames.length - 1)
  if (end >= 0) engine.appendRange(frames, 0, end)
  return engine.snapshot()
}

function queryPrefix(scope: HeatmapScope, phase: HeatmapPhase) {
  return scope.type === "team"
    ? `team:${scope.team}:${phase}`
    : `player:${scope.playerId}:${phase}`
}

function toGrid(accumulator: Accumulator): HeatmapGrid {
  const output = accumulator.output ?? {
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    density: new Float32Array(CELL_COUNT),
    sampleCount: 0,
    averageX: 50,
    averageY: 50,
  }
  accumulator.output = output
  if (!accumulator.dirty) return output
  output.density.set(accumulator.density)
  output.sampleCount = accumulator.sampleCount
  output.averageX =
    accumulator.sampleCount > 0
      ? accumulator.sumX / accumulator.sampleCount
      : 50
  output.averageY =
    accumulator.sampleCount > 0
      ? accumulator.sumY / accumulator.sampleCount
      : 50
  accumulator.dirty = false
  return output
}

function emptyGrid(): HeatmapGrid {
  return {
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    density: EMPTY_DENSITY,
    sampleCount: 0,
    averageX: 50,
    averageY: 50,
  }
}

function frameMinute(frame: RealtimeFrame) {
  const tick = Number.isFinite(frame.displayTick)
    ? frame.displayTick
    : frame.tick
  return Math.floor(Math.max(0, tick) / 240)
}

function validPitchHalf(value: number) {
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function normalize(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 50
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}
