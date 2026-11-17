import { useId } from "react"
import { useTranslation } from "react-i18next"

type PlayerProfileStatus = "condition" | "sharpness" | "morale"

const percentageUpperBounds = {
  condition: [50, 65, 75, 85, 100],
  sharpness: [14, 29, 44, 60, 72, 84, 100],
} as const

// Frame condition/sharpness are integer UI percentages (0–100). Archive 2.12+
// uses MATCH_PLAYER inputs; earlier 2.x archives retain their stats percentages.
function playerProfileStatusLevel(status: PlayerProfileStatus, value?: number) {
  if (value == null || !Number.isFinite(value) || value < 0) return undefined

  if (status === "morale") {
    if (!Number.isInteger(value) || value > 20) return undefined
    return Math.max(1, value)
  }

  if (value > 100) return undefined
  const percentage = Math.trunc(value)
  return (
    percentageUpperBounds[status].findIndex((upper) => percentage <= upper) + 1
  )
}

// Seven ordered theme tiers shared by condition, sharpness and morale.
const playerStatusColors = [
  "var(--player-status-tier-1)",
  "var(--player-status-tier-2)",
  "var(--player-status-tier-3)",
  "var(--player-status-tier-4)",
  "var(--player-status-tier-5)",
  "var(--player-status-tier-6)",
  "var(--player-status-tier-7)",
] as const

// Each status selects from the same palette without changing its own levels.
const playerStatusColorTiers = {
  condition: [1, 3, 4, 6, 7],
  sharpness: [1, 2, 3, 4, 5, 6, 7],
  morale: [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7],
} as const satisfies Record<PlayerProfileStatus, readonly number[]>

function playerStatusColor(status: PlayerProfileStatus, level: number) {
  const tier = playerStatusColorTiers[status][level - 1]
  return tier == null ? undefined : playerStatusColors[tier - 1]
}

// The shared arrow points up. Positive SVG rotation turns it clockwise:
// level 1 points down, 10/11 straddle right, and level 20 points up.
function moraleRotation(level: number) {
  return (180 * (20 - level)) / 19
}

// Fill the shared heart from its tip to its lobes in five discrete steps.
const conditionFillTop = [24, 20, 15, 10, 0] as const

// Vector geometry for the inline status icons.
const conditionHeartPath =
  "M16 29 5.2 16.7C-2.3 7.8 7.5-1.2 16 7.2 24.5-1.2 34.3 7.8 26.8 16.7Z"
const conditionPulsePath = "M7.5 16h4l2.5-4 3.5 8 2.5-4h4.5"
const moraleArrowPath = "M16 8 21 24 16 20 11 24Z"
const sharpnessSymbolPaths = [
  "m9 9 14 14M23 9 9 23",
  "m8 9 8 7 8-7M8 17l8 7 8-7",
  "m8 12 8 8 8-8",
  "M8 16h16",
  "m8 20 8-8 8 8",
  "m8 15 8-7 8 7M8 23l8-7 8 7",
  "m8 17 5 5L24 10",
] as const

// Optical compensation: a square needs less width than a circle to have
// comparable visual weight. 24/27 = 8/9; the 32-unit layout box is unchanged.
const sharpnessOpticalScale = 24 / 27

const labelKeys = {
  condition: "overallPhysicalCondition",
  sharpness: "matchSharpness",
  morale: "morale",
} as const

export function PlayerProfileStatusIcon({
  status,
  value,
}: {
  status: PlayerProfileStatus
  value?: number
}) {
  const { t } = useTranslation()
  const fillClipId = useId()
  const level = playerProfileStatusLevel(status, value)
  if (level == null) return <>-</>

  const label = `${t(`playerProfile.${labelKeys[status]}`)} ${level}/${status === "condition" ? 5 : status === "sharpness" ? 7 : 20}`

  const cutoutId = `${fillClipId}-cutout`
  const heartClipId = `${fillClipId}-heart`

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 32 32"
      width={32}
      height={32}
      className="inline-block size-[calc(2.5em+0.125rem)] shrink-0 align-middle"
      style={{ color: playerStatusColor(status, level) }}
    >
      <defs>
        <mask
          id={cutoutId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="32"
          height="32"
          style={{ maskType: "luminance" }}
        >
          <rect width="32" height="32" fill="white" />
          {status === "morale" ? (
            <path d={moraleArrowPath} fill="black" />
          ) : (
            <path
              d={
                status === "condition"
                  ? conditionPulsePath
                  : sharpnessSymbolPaths[level - 1]
              }
              fill="none"
              stroke="black"
              strokeWidth={status === "condition" ? 2.5 : 3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </mask>
        {status === "condition" && (
          <>
            <clipPath id={heartClipId}>
              <path d={conditionHeartPath} />
            </clipPath>
            <clipPath id={fillClipId}>
              <rect
                x="0"
                y={conditionFillTop[level - 1]}
                width="32"
                height="32"
              />
            </clipPath>
          </>
        )}
      </defs>
      {status === "morale" ? (
        <g transform={`rotate(${moraleRotation(level)} 16 16)`}>
          <circle
            cx="16"
            cy="16"
            r="13.5"
            fill="currentColor"
            mask={`url(#${cutoutId})`}
          />
        </g>
      ) : status === "sharpness" ? (
        <g
          transform={`translate(16 16) scale(${sharpnessOpticalScale}) translate(-16 -16)`}
        >
          <rect
            x="2.5"
            y="2.5"
            width="27"
            height="27"
            rx="1"
            fill="currentColor"
            mask={`url(#${cutoutId})`}
          />
        </g>
      ) : (
        <g mask={`url(#${cutoutId})`}>
          <path d={conditionHeartPath} fill="var(--player-status-track)" />
          <path
            d={conditionHeartPath}
            fill="currentColor"
            clipPath={`url(#${fillClipId})`}
          />
          {level < 5 && (
            <path
              d={`M0 ${conditionFillTop[level - 1]}h32`}
              fill="none"
              stroke="var(--player-condition-divider)"
              strokeWidth="1.5"
              clipPath={`url(#${heartClipId})`}
            />
          )}
          <path
            d={conditionHeartPath}
            fill="none"
            stroke="var(--player-condition-outline)"
            strokeWidth="0.8"
          />
        </g>
      )}
    </svg>
  )
}
