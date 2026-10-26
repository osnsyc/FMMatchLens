import { useTranslation } from "react-i18next"

import { MultiStateButton } from "@/components/ui/multi-state-button"
import type { PositionHeatmapRange, TeamSide } from "@/types/match"

export type SpatialMapView = "heatmap" | "passMap"

type MapPanelControlsProps = {
  selectedRange: PositionHeatmapRange
  selectedTeam: TeamSide
  onRangeChange: (range: PositionHeatmapRange) => void
  onTeamChange: (team: TeamSide) => void
  heatmapTour?: boolean
  showTeam?: boolean
}

export function MapPanelControls({
  selectedRange,
  selectedTeam,
  onRangeChange,
  onTeamChange,
  heatmapTour = false,
  showTeam = true,
}: MapPanelControlsProps) {
  const { t } = useTranslation()

  return (
    <>
      <MultiStateButton
        data-tour={heatmapTour ? "heatmap-range" : undefined}
        data-tour-state={heatmapTour ? selectedRange : undefined}
        value={selectedRange}
        onValueChange={onRangeChange}
        variant="outline"
        size="sm"
        className="min-w-14 px-2 text-[11px]"
        aria-label={t("heatmap.range")}
        contextMenuClassName="min-w-32"
        states={[
          { value: "full", label: t("heatmapRange.full") },
          { value: "half", label: t("heatmapRange.half") },
          { value: "recent15", label: t("heatmapRange.recent15") },
        ] satisfies Array<{ value: PositionHeatmapRange; label: string }>}
      />
      {showTeam && (
        <MultiStateButton
          value={selectedTeam}
          onValueChange={onTeamChange}
          variant="outline"
          size="sm"
          className="min-w-12 px-2 text-[11px]"
          aria-label={t("heatmap.team")}
          contextMenuClassName="min-w-28"
          states={[
            { value: "home", label: t("common.home") },
            { value: "away", label: t("common.away") },
          ] satisfies Array<{ value: TeamSide; label: string }>}
        />
      )}
    </>
  )
}
