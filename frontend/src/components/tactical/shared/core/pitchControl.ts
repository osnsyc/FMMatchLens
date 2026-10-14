import type { TacticalMotionFrame } from "./types"

export type ControlPlayer = {
  x: number
  y: number
  vx: number
  vy: number
  team: "home" | "away"
}
export type ControlGrid = {
  columns: number
  rows: number
  values: Float32Array
}

/** Community approximation to Figure 9, as documented in Wide_Open_Spaces_FMMatchLens.md. */
export function influenceRadius(distance: number) {
  return Math.min(10, 4 + 6 * (distance / 18) ** 3)
}

export function prepareInfluences(
  players: readonly ControlPlayer[],
  ball: { x: number; y: number },
  radiusFn = influenceRadius
) {
  return players
    .filter((p) => [p.x, p.y, p.vx, p.vy].every(Number.isFinite))
    .map((p) => {
      const rawSpeed = Math.hypot(p.vx, p.vy)
      const speed = Math.min(rawSpeed, 12.99)
      const c = rawSpeed ? p.vx / rawSpeed : 1
      const s = rawSpeed ? p.vy / rawSpeed : 0
      const radius = radiusFn(Math.hypot(p.x - ball.x, p.y - ball.y))
      const k = (speed / 13) ** 2
      const alongInverse = 1 / ((radius * (1 + k)) / 2) ** 2
      const acrossInverse = 1 / ((radius * (1 - k)) / 2) ** 2
      return {
        c,
        s,
        alongInverse,
        acrossInverse,
        mx: p.x + 0.5 * speed * c,
        my: p.y + 0.5 * speed * s,
        q0: (0.5 * speed) ** 2 * alongInverse,
        sign: p.team === "home" ? 1 : -1,
      }
    })
}

export function controlAt(
  influences: ReturnType<typeof prepareInfluences>,
  x: number,
  y: number
) {
  let delta = 0
  for (const p of influences) {
    const dx = x - p.mx,
      dy = y - p.my
    const along = p.c * dx + p.s * dy,
      across = -p.s * dx + p.c * dy
    const q = along * along * p.alongInverse + across * across * p.acrossInverse
    delta += p.sign * Math.exp(Math.max(-700, Math.min(70, -0.5 * (q - p.q0))))
  }
  return 1 / (1 + Math.exp(-Math.max(-60, Math.min(60, delta))))
}

/** Same pure calculation for live and archive; grid stays in physical metres. */
export function calculatePitchControl(
  frame: TacticalMotionFrame,
  step = 2
): ControlGrid | undefined {
  const pitch = frame.pitchDimensions,
    ball = frame.ball?.positionMeters
  if (
    !pitch ||
    !ball ||
    ![pitch.length, pitch.width, ball.x, ball.y, step].every(Number.isFinite) ||
    pitch.length <= 0 ||
    pitch.width <= 0 ||
    step <= 0
  )
    return undefined
  // Missing physical tracking must never fall back to clipped display positions.
  if (
    frame.players.some(
      (p) =>
        !p.positionMeters ||
        !p.velocity ||
        ![
          p.positionMeters.x,
          p.positionMeters.y,
          p.velocity.x,
          p.velocity.y,
        ].every(Number.isFinite)
    )
  )
    return undefined
  const influences = prepareInfluences(
    frame.players.flatMap((p) =>
      p.velocity && p.positionMeters
        ? [
            {
              x: p.positionMeters.x,
              y: p.positionMeters.y,
              vx: p.velocity.x,
              vy: p.velocity.y,
              team: p.team,
            },
          ]
        : []
    ),
    ball
  )
  const columns = Math.ceil(pitch.length / step) + 1,
    rows = Math.ceil(pitch.width / step) + 1
  const values = new Float32Array(columns * rows)
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++)
      values[y * columns + x] = controlAt(
        influences,
        (x * pitch.length) / (columns - 1),
        (y * pitch.width) / (rows - 1)
      )
  return { columns, rows, values }
}
