import { useState, type CSSProperties } from "react"
import { useTranslation } from "react-i18next"

import {
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { NativeTabs } from "@/components/uitripled/native-tabs-shadcnui"
import type {
  MatchSnapshot,
  TeamSide,
  TeamStats,
} from "@/types/match"

type MatchStatsPanelProps = {
  match: MatchSnapshot
}

type StatGroup = "all" | "attack" | "defence"

type StatSource =
  | keyof TeamStats
  | "possession"
  | "passAccuracy"
  | "crossAccuracy"
  | "tackleSuccess"
  | "aerialSuccess"

type StatRow = {
  label: string
  source: StatSource
  precision?: number
  suffix?: string
  lowerIsBetter?: boolean
}

// Every raw row below maps directly to TeamTickData/Offsets.TeamBase, except
// shotsOffTarget which is derived from reliable player counters while +0x172
// remains unknown. Percentage rows are derived only when both inputs are known.
const allRows: StatRow[] = [
  { label: "stats.possession", source: "possession", suffix: "%" },
  { label: "stats.goals", source: "goals" },
  { label: "stats.expectedGoals", source: "xg", precision: 2 },
  { label: "stats.shots", source: "shots" },
  { label: "stats.shotsOnTarget", source: "shotsOnTarget" },
  { label: "stats.shotsOffTarget", source: "shotsOffTarget" },
  { label: "stats.blockedShots", source: "blockedShots" },
  { label: "stats.clearCutChances", source: "clearCutChances" },
  { label: "stats.passes", source: "passes" },
  { label: "stats.completedPasses", source: "passesCompleted" },
  { label: "stats.passAccuracy", source: "passAccuracy", suffix: "%" },
  { label: "stats.progressivePasses", source: "progressivePasses" },
  { label: "stats.finalThirdPasses", source: "finalThirdPasses" },
  { label: "stats.crosses", source: "crosses" },
  { label: "stats.crossesCompleted", source: "crossesCompleted" },
  { label: "stats.crossAccuracy", source: "crossAccuracy", suffix: "%" },
  { label: "stats.corners", source: "corners" },
  { label: "stats.offsides", source: "offsides", lowerIsBetter: true },
  { label: "stats.tacklesAttempted", source: "tacklesAttempted" },
  { label: "stats.tacklesWon", source: "tacklesWon" },
  { label: "stats.tackleSuccess", source: "tackleSuccess", suffix: "%" },
  { label: "stats.aerials", source: "aerials" },
  { label: "stats.aerialsWon", source: "aerialsWon" },
  { label: "stats.aerialSuccess", source: "aerialSuccess", suffix: "%" },
  { label: "stats.fouls", source: "fouls", lowerIsBetter: true },
  { label: "stats.yellowCards", source: "yellowCards", lowerIsBetter: true },
  { label: "stats.redCards", source: "redCards", lowerIsBetter: true },
]

const attackRows: StatRow[] = [
  { label: "stats.expectedGoals", source: "xg", precision: 2 },
  { label: "stats.shots", source: "shots" },
  { label: "stats.shotsOnTarget", source: "shotsOnTarget" },
  { label: "stats.shotsOffTarget", source: "shotsOffTarget" },
  { label: "stats.blockedShots", source: "blockedShots" },
  { label: "stats.clearCutChances", source: "clearCutChances" },
  { label: "stats.passes", source: "passes" },
  { label: "stats.completedPasses", source: "passesCompleted" },
  { label: "stats.passAccuracy", source: "passAccuracy", suffix: "%" },
  { label: "stats.progressivePasses", source: "progressivePasses" },
  { label: "stats.finalThirdPasses", source: "finalThirdPasses" },
  { label: "stats.crosses", source: "crosses" },
  { label: "stats.crossesCompleted", source: "crossesCompleted" },
  { label: "stats.crossAccuracy", source: "crossAccuracy", suffix: "%" },
  { label: "stats.corners", source: "corners" },
  { label: "stats.offsides", source: "offsides", lowerIsBetter: true },
]

const defenceRows: StatRow[] = [
  { label: "stats.tacklesAttempted", source: "tacklesAttempted" },
  { label: "stats.tacklesWon", source: "tacklesWon" },
  { label: "stats.tackleSuccess", source: "tackleSuccess", suffix: "%" },
  { label: "stats.aerials", source: "aerials" },
  { label: "stats.aerialsWon", source: "aerialsWon" },
  { label: "stats.aerialSuccess", source: "aerialSuccess", suffix: "%" },
  { label: "stats.fouls", source: "fouls", lowerIsBetter: true },
  { label: "stats.yellowCards", source: "yellowCards", lowerIsBetter: true },
  { label: "stats.redCards", source: "redCards", lowerIsBetter: true },
]

const groups: Array<{
  id: StatGroup
  label: string
  rows: StatRow[]
}> = [
    {
      id: "all",
      label: "stats.all",
      rows: allRows,
    },
    {
      id: "attack",
      label: "stats.attack",
      rows: attackRows,
    },
    {
      id: "defence",
      label: "stats.defence",
      rows: defenceRows,
    },
  ]

function percentage(
  value: number,
  total: number
) {
  return total > 0
    ? Math.round((value / total) * 100)
    : 0
}

function opposite(
  side: TeamSide
): TeamSide {
  return side === "home"
    ? "away"
    : "home"
}

export function MatchStatsPanel({
  match,
}: MatchStatsPanelProps) {
  const { t } = useTranslation()

  const [activeGroup, setActiveGroup] =
    useState<StatGroup>("all")

  const homeColor =
    match.home.color ?? "#6cabdd"

  const awayColor =
    match.away.color ?? "#ef0107"

  const activeRows =
    groups.find(
      (group) =>
        group.id === activeGroup
    )?.rows ?? allRows

  function numericValue(
    row: StatRow,
    side: TeamSide
  ) {
    const stats =
      match[side].stats

    switch (row.source) {
      case "possession":
        return possession(side)

      case "crossAccuracy":
        return percentage(
          stats.crossesCompleted,
          stats.crosses
        )

      case "passAccuracy":
        return percentage(
          stats.passesCompleted,
          stats.passes
        )

      case "tackleSuccess":
        return percentage(
          stats.tacklesWon,
          stats.tacklesAttempted
        )

      case "aerialSuccess":
        return percentage(
          stats.aerialsWon,
          stats.aerials
        )

      default:
        return Number(
          stats[
          row.source as keyof TeamStats
          ] ?? 0
        )
    }
  }

  function formattedValue(
    row: StatRow,
    side: TeamSide
  ) {
    return `${numericValue(
      row,
      side
    ).toFixed(
      row.precision ?? 0
    )}${row.suffix ?? ""}`
  }

  function barStyle(
    row: StatRow
  ): CSSProperties {
    const home = Math.max(
      0,
      numericValue(
        row,
        "home"
      )
    )

    const away = Math.max(
      0,
      numericValue(
        row,
        "away"
      )
    )

    const total =
      home + away

    if (total <= 0) {
      return {
        gridTemplateColumns:
          "1fr 1fr",
      }
    }

    if (home <= 0) {
      return {
        gridTemplateColumns: "0 1fr",
        columnGap: 0,
      }
    }

    if (away <= 0) {
      return {
        gridTemplateColumns: "1fr 0",
        columnGap: 0,
      }
    }

    return {
      gridTemplateColumns: `${home}fr ${away}fr`,
    }
  }

  function isLeading(
    row: StatRow,
    side: TeamSide
  ) {
    const current =
      numericValue(
        row,
        side
      )

    const other =
      numericValue(
        row,
        opposite(side)
      )

    if (current === other) {
      return false
    }

    return row.lowerIsBetter
      ? current < other
      : current > other
  }

  function possession(
    side: TeamSide
  ) {
    const homeTime =
      match.home.stats
        .possessionTime

    const awayTime =
      match.away.stats
        .possessionTime

    const totalTime =
      homeTime + awayTime

    if (totalTime > 0) {
      return Math.round(
        ((side === "home"
          ? homeTime
          : awayTime) /
          totalTime) *
        100
      )
    }

    return 0
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b px-4 py-2">
        <CardTitle className="whitespace-nowrap text-sm font-semibold">
          {t(
            "panels.matchStats"
          )}
        </CardTitle>

        <NativeTabs
          value={activeGroup}
          onValueChange={(
            value
          ) =>
            setActiveGroup(
              value as StatGroup
            )
          }
          renderContent={false}
          className="min-w-0 max-w-none"
          listClassName="h-6"
          triggerClassName="h-5 px-1 text-[10px]"
          items={groups.map(
            (group) => ({
              id: group.id,
              label: t(
                group.label
              ),
              content: null,
            })
          )}
        />
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <ScrollArea className="scrollbar-hidden min-h-0 flex-1">
          <div className="px-4 py-3">
            <div>
              {activeRows.map((row) => (
                <div
                  key={row.source}
                  className="py-2.5"
                >
                  {/* Statistic name */}
                  <div className="mb-2 truncate text-center text-xs leading-none text-muted-foreground">
                    {t(row.label)}
                  </div>

                  {/* Values + comparison bar */}
                  <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-1.5">
                    {/* Home value */}
                    <span
                      className={`truncate text-right text-sm leading-none tabular-nums ${isLeading(row, "home")
                          ? "font-semibold text-foreground"
                          : "font-medium text-muted-foreground"
                        }`}
                    >
                      {formattedValue(row, "home")}
                    </span>

                    {/* Comparison bar */}
                    <div
                      className="grid h-2.5 w-full min-w-0 gap-1"
                      style={barStyle(row)}
                      aria-hidden="true"
                    >
                      {/* Home bar */}
                      <div
                        className="h-full min-w-0 rounded-full"
                        style={{
                          backgroundColor: homeColor,
                        }}
                      />

                      {/* Away bar */}
                      <div
                        className="h-full min-w-0 rounded-full"
                        style={{
                          backgroundColor: awayColor,
                        }}
                      />
                    </div>

                    {/* Away value */}
                    <span
                      className={`truncate text-left text-sm leading-none tabular-nums ${isLeading(row, "away")
                          ? "font-semibold text-foreground"
                          : "font-medium text-muted-foreground"
                        }`}
                    >
                      {formattedValue(row, "away")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      </CardContent>
    </section>
  )
}
