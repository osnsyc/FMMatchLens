import { useStoredChoice } from "@/hooks/useStoredPreference"
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
  const [selectedTeam, setSelectedTeam] = useStoredChoice<TeamSide>(
    "spatialMap.team",
    "home",
    ["home", "away"],
  )
  const [selectedRange, setSelectedRange] =
    useStoredChoice<PositionHeatmapRange>("spatialMap.range", "full", ["full", "half", "recent15"])
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
