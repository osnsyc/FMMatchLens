import { useState } from "react"

import { PassMap } from "@/components/PassMap"
import { ZonePanel } from "@/components/ZonePanel"
import type { SpatialMapView } from "@/components/map/MapPanelControls"
import type {
  MatchSnapshot,
  PositionHeatmapRange,
  TeamSide,
} from "@/types/match"

type SpatialMapPanelProps = {
  match: MatchSnapshot
  isFocusMode: boolean
  view: SpatialMapView
  onViewChange: (view: SpatialMapView) => void
}

export function SpatialMapPanel({
  match,
  isFocusMode,
  view,
  onViewChange,
}: SpatialMapPanelProps) {
  const [selectedTeam, setSelectedTeam] = useState<TeamSide>("home")
  const [selectedRange, setSelectedRange] =
    useState<PositionHeatmapRange>("full")
  const sharedProps = {
    match,
    selectedTeam,
    selectedRange,
    onViewChange,
    onTeamChange: setSelectedTeam,
    onRangeChange: setSelectedRange,
  }

  return view === "passMap" ? (
    <PassMap {...sharedProps} isFocusMode={isFocusMode} />
  ) : (
    <ZonePanel {...sharedProps} isFocusMode={isFocusMode} />
  )
}
