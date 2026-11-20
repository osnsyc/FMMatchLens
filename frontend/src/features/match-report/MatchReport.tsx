import { useTranslation } from "react-i18next"
import { Momentum } from "@/components/Momentum"
import { useLayoutEffect, useRef, useState } from "react"
import { MomentumEventMap } from "@/components/MomentumEventMap"
import { XgTimeline } from "@/components/XgTimeline"
import { XgMap } from "@/components/XgMap"
import { MatchStatsPanel } from "@/components/MatchStatsPanel"
import { PassMap } from "@/components/PassMap"
import { ScoreHeader } from "@/components/ScoreHeader"
import { ReportPlayerDetails } from "./ReportPlayerDetails"
import { FormationReportPitch } from "./ReportFormation"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { StoredPreferenceContext } from "@/hooks/useStoredPreference"
import { useMatchKits } from "@/hooks/useMatchKits"
import { ReportKitSymbols } from "./ReportKitSymbols"
import { ReportSubstitutes } from "./ReportSubstitutes"
import { ReportMatchTimeline } from "./ReportMatchTimeline"
import { reportFontEmbedCSS } from "./reportFonts"
import {
  REPORT_WIDTH,
  REPORT_HEIGHT,
  REPORT_LAYOUT_WIDTH,
  type MatchReportContext,
} from "./reportTypes"
import type { MatchSnapshot, TeamSide } from "@/types/match"
import { resolvePitchDimensions } from "@/components/pitch/pitchGeometry"

const noop = () => {}
const emptyFrames = [] as const

export function MatchReport({
  match,
  context,
}: {
  match: MatchSnapshot
  context?: MatchReportContext
}) {
  const { t } = useTranslation()
  const layoutRef = useRef<HTMLDivElement>(null)
  const [layoutHeight, setLayoutHeight] = useState(
    (REPORT_HEIGHT * REPORT_LAYOUT_WIDTH) / REPORT_WIDTH
  )
  useLayoutEffect(() => {
    const layout = layoutRef.current!
    const update = () => setLayoutHeight(layout.offsetHeight)
    const observer = new ResizeObserver(update)
    observer.observe(layout)
    update()
    return () => observer.disconnect()
  }, [])
  const scale = Math.min(
    REPORT_WIDTH / REPORT_LAYOUT_WIDTH,
    REPORT_HEIGHT / layoutHeight
  )
  const kits = useMatchKits(match.home.colorSource, match.away.colorSource)
  const pitch = resolvePitchDimensions(match.pitchDimensions)
  // 336px pitch width, 24px host padding, 44px header and 2px borders.
  const passMapHeight = Math.ceil((336 * pitch.length) / pitch.width) + 70
  const pom =
    match.pomUid && match.pomUid > 0
      ? match.players.find((player) => player.uid === match.pomUid)
      : undefined
  const mapProps = {
    match,
    isFocusMode: false,
    selectedRange: "full" as const,
    onViewChange: noop,
    onTeamChange: noop,
    onRangeChange: noop,
  }
  const formations = (side: TeamSide) => (
    <div
      className="match-report-team-column"
      data-report-column={`formation-${side}`}
    >
      <Card className="match-report-formation">
        <CardHeader className="px-3 py-2">
          <CardTitle className="text-sm">
            {match[side].name} · {t("teamTactics.inPossession")}
          </CardTitle>
        </CardHeader>
        <FormationReportPitch
          match={match}
          side={side}
          phase="inPossession"
          kits={kits}
        />
      </Card>
      <ReportSubstitutes match={match} side={side} kits={kits} />
      <Card
        className="match-report-passmap"
        data-report-passmap={side}
        style={{ height: passMapHeight }}
      >
        <PassMap {...mapProps} selectedTeam={side} />
      </Card>
    </div>
  )
  const pomCard = (
    <Card className="match-report-pom" data-report-pom>
      <CardHeader className="px-3 py-2">
        <CardTitle className="text-sm">{t("report.pom")}</CardTitle>
      </CardHeader>
      {pom ? (
        <ReportPlayerDetails
          player={pom}
          teamColor={
            match[pom.team].color ?? `var(--team-${pom.team}-fallback)`
          }
          matchMinute={match.clock.minute}
          matchTick={match.clock.elapsedTick}
          movementFrames={context?.movementFrames ?? emptyFrames}
          movementAnalysis={context?.pomMovement}
          heatmaps={match.heatmaps}
          pitchDimensions={match.pitchDimensions}
        />
      ) : (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {t("report.noPom")}
        </Card>
      )}
    </Card>
  )
  return (
    <StoredPreferenceContext value={false}>
      <div
        data-match-report
        inert
        className="match-report-frame bg-background text-foreground"
        style={{ width: REPORT_WIDTH, height: REPORT_HEIGHT }}
      >
        <div
          ref={layoutRef}
          className="match-report"
          style={{
            width: REPORT_LAYOUT_WIDTH,
            transform: `translate(${(REPORT_WIDTH - REPORT_LAYOUT_WIDTH * scale) / 2}px, ${(REPORT_HEIGHT - layoutHeight * scale) / 2}px) scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <style>{reportFontEmbedCSS + reportStyles}</style>
          <ReportKitSymbols kits={kits} />
          <div className="match-report-banner">
            <ScoreHeader match={match} reportMode />
          </div>
          <div className="match-report-columns">
            {formations("home")}
            <div className="match-report-center">
              <div
                className="match-report-column"
                data-report-column="home-analysis"
              >
                <Card data-report-chart className="match-report-chart">
                  <Momentum match={match} reportMode />
                </Card>
                <Card
                  className="match-report-momentum-map"
                  data-report-momentum-map
                >
                  <CardHeader className="px-4 py-2">
                    <CardTitle className="text-sm">
                      {t("report.momentumMap")}
                    </CardTitle>
                  </CardHeader>
                  <MomentumEventMap
                    events={match.tacticalEvents}
                    home={match.home}
                    away={match.away}
                    pitchDimensions={match.pitchDimensions}
                  />
                </Card>
                {pom?.team === "away" ? (
                  <ReportMatchTimeline match={match} />
                ) : (
                  pomCard
                )}
              </div>
              <div className="match-report-column" data-report-column="stats">
                <Card className="match-report-stats">
                  <MatchStatsPanel
                    match={match}
                    isFocusMode={false}
                    exportMode
                  />
                </Card>
              </div>
              <div
                className="match-report-column"
                data-report-column="away-analysis"
              >
                <Card data-report-chart className="match-report-chart">
                  <XgTimeline match={match} reportMode />
                </Card>
                <Card className="match-report-xgmap">
                  <CardHeader className="px-4 py-2">
                    <CardTitle className="text-sm">{t("xg.map")}</CardTitle>
                  </CardHeader>
                  <XgMap
                    match={match}
                    homeColor={match.home.color ?? "var(--team-home-fallback)"}
                    awayColor={match.away.color ?? "var(--team-away-fallback)"}
                  />
                </Card>
                {pom?.team === "away" ? (
                  pomCard
                ) : (
                  <ReportMatchTimeline match={match} />
                )}
              </div>
            </div>
            {formations("away")}
          </div>
        </div>
      </div>
    </StoredPreferenceContext>
  )
}

const reportStyles = `
.match-report-frame {
  position: relative;
  overflow: hidden;
  pointer-events: none;
}
.match-report {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  pointer-events: none;
}
.match-report-banner {
  height: 104px;
  flex-shrink: 0;
}
.match-report .xg-score-summary > span {
  font-size: 20px;
  line-height: 24px;
}
.match-report .xg-score-summary > span:nth-child(2) {
  font-size: 14px;
}
.match-report [data-slot="card-title"]::before {
  display: none;
  content: none;
}
.match-report [data-slot="card-title"] {
  font-size: 16px;
  line-height: 24px;
}
.match-report [data-slot="card-header"] {
  flex-shrink: 0;
}
.match-report-columns {
  position: relative;
  display: grid;
  grid-template-columns: 360px 560px 360px 560px 360px;
  align-items: stretch;
  gap: 12px;
}
.match-report-center {
  position: absolute;
  inset: 0;
  display: grid;
  min-height: 0;
  min-width: 0;
  grid-column: 2 / 5;
  grid-row: 1;
  grid-template-columns: 560px 360px 560px;
  grid-template-rows: minmax(0, 1fr);
  gap: 12px;
}
.match-report-column {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
}
.match-report-team-column {
  display: grid;
  min-width: 0;
  grid-row: 1;
  grid-template-rows: 560px 1fr auto;
  gap: 12px;
}
.match-report-team-column[data-report-column="formation-home"] {
  grid-column: 1;
}
.match-report-team-column[data-report-column="formation-away"] {
  grid-column: 5;
}
.match-report-column[data-report-column="home-analysis"] {
  grid-column: 1;
  grid-row: 1;
}
.match-report-column[data-report-column="stats"] {
  grid-column: 2;
  grid-row: 1;
}
.match-report-column[data-report-column="away-analysis"] {
  grid-column: 3;
  grid-row: 1;
}
.match-report-pom {
  display: flex;
  min-width: 0;
  min-height: 0;
  gap: 0;
  padding: 0;
  flex-direction: column;
  flex: 1;
}
.match-report-pom > [data-slot="card"] {
  flex: 1;
  width: 100%;
  max-width: none;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  --tw-ring-shadow: 0 0 transparent;
}
.report-pom-details {
  min-height: 0;
  padding: 0 10px 10px;
  gap: 0;
}
.report-pom-layout {
  display: grid;
  flex: 1;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
}
.report-pom-body {
  display: grid;
  min-height: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.report-pom-technical-column {
  display: grid;
  min-height: 0;
  grid-template-rows: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.report-pom-analysis-column {
  display: flex;
  min-height: 0;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}
.report-pom-identity {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 52px 106px;
  gap: 8px;
  align-items: center;
  padding-inline: 16px;
  border-color: color-mix(in srgb, var(--important-event) 48%, var(--border));
  background:
    radial-gradient(
      ellipse 100% 160% at 50% 35%,
      color-mix(in srgb, var(--important-event) 24%, transparent),
      color-mix(in srgb, var(--important-event) 5%, transparent) 100%
    ),
    linear-gradient(
      110deg,
      color-mix(in srgb, var(--important-event) 6%, var(--card)) 0%,
      color-mix(in srgb, var(--important-event) 8%, var(--card)) 50%,
      color-mix(in srgb, var(--important-event) 6%, var(--card)) 100%
    );
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--important-event) 28%, transparent),
    0 0 12px color-mix(in srgb, var(--important-event) 9%, transparent);
}
.report-pom-identity > :not(.report-pom-laurel) {
  position: relative;
  z-index: 1;
}
.report-pom-laurel {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 94%;
  height: 100%;
  color: var(--important-event);
  opacity: 0.14;
  transform: translate(-50%, -50%);
}
:root[data-scheme="light"] .report-pom-laurel {
  opacity: 0.24;
}
:root[data-scheme="light"] .report-laurel-leaf {
  stroke: var(--important-event);
  stroke-width: 1;
  stroke-linejoin: round;
  fill-opacity: 0.55;
}
.report-pom-number-position {
  font-size: 16px;
  line-height: 20px;
}
.report-pom-name {
  display: flex;
  min-height: 64px;
  align-items: center;
  padding: 8px;
  border-radius: 4px;
  background: linear-gradient(
    110deg,
    color-mix(in srgb, var(--important-event) 5%, transparent),
    transparent
  );
  text-shadow: 0 0 12px
    color-mix(in srgb, var(--important-event) 20%, transparent);
}
.report-pom-layout [class*="mb-2"] {
  margin-bottom: 4px;
}
.report-pom-metrics {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: space-evenly;
}
.report-pom-metrics > div {
  min-height: 20px;
  line-height: 18px;
}
.report-pom-layout h3 {
  font-size: 13px;
  line-height: 20px;
}
.report-pom-layout [class~="text-[8px]"],
.report-pom-layout [class~="text-[9px]"],
.report-pom-layout [class~="text-[10px]"] {
  font-size: 11px;
}
.report-pom-identity dd {
  font-size: 13px !important;
}
.report-pom-layout [data-report-rating] .grid-cols-3 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.report-pom-layout [data-report-movement] [role="img"] {
  height: 64px;
}
.report-pom-layout [data-report-movement] .w-20 [class~="text-[8px]"] {
  white-space: normal;
  overflow: visible;
}
.match-report-column > [data-slot="card"],
.match-report-pom [data-slot="card"] {
  min-width: 0;
}
.match-report-formation {
  height: 560px;
  gap: 0;
  padding: 0;
  overflow: hidden;
}
.match-report-formation > .formation-focus-pitch {
  flex: 1;
  border: 0;
}
.match-report-chart {
  height: 280px;
  flex-shrink: 0;
  gap: 0;
  padding: 0;
  overflow: hidden;
}
.match-report-passmap {
  gap: 0;
  padding: 0;
  overflow: hidden;
}
.match-report-xgmap,
.match-report-momentum-map {
  height: 380px;
  flex-shrink: 0;
  gap: 0;
  padding: 0;
  overflow: hidden;
}
.match-report-stats {
  flex: 1;
  gap: 0;
  padding: 0;
  overflow: hidden;
}
.match-report-stats > section {
  height: 100%;
}
.report-stat-rows {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}
.report-stat-row {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  justify-content: center;
}
.report-stat-group {
  display: flex;
  min-height: 0;
  flex-basis: 0;
  flex-direction: column;
}
.report-stat-group-title {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  padding-block: 8px;
  font-size: 20px;
  line-height: 28px;
  font-weight: 700;
}
.report-stat-group-leading,
.report-stat-group-trailing {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
.report-stat-group-leading::before,
.report-stat-group-trailing::before {
  content: "";
  flex: 1;
  border-top: 1px solid var(--border);
}
.report-stat-group-leading svg {
  flex-shrink: 0;
}
.report-stat-row > div:first-child {
  font-size: 14px;
  line-height: 18px;
}
.report-stat-row > div > span {
  font-size: 16px;
}
.report-stat-group-rows {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}
.match-report [data-slot="card-action"],
.match-report [role="tablist"] {
  display: none;
}
.match-report *,
.match-report *::before,
.match-report *::after {
  animation: none !important;
  transition: none !important;
}

.report-formation-player-marker {
  display: inline-flex;
  align-items: flex-end;
  gap: 4px;
  height: 30px;
}
.report-formation-player-sidebar {
  display: flex;
  min-width: 16px;
  flex-direction: column;
  align-items: flex-start;
}
.report-player-status-row {
  display: flex;
  min-height: 14px;
  align-items: center;
  gap: 2px;
}
.report-player-status-row svg,
.report-player-status-row img {
  width: 13px;
  height: 13px;
}
.report-substitutes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 4px;
  padding: 14px 8px;
}
.report-substitute-player {
  position: relative;
  display: flex;
  min-height: 48px;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  border-radius: 4px;
}
.report-substitute-player[data-played="false"]::after {
  content: "";
  position: absolute;
  inset: -3px;
  border-radius: inherit;
  background: color-mix(in srgb, var(--card) 65%, transparent);
}
.report-match-timeline {
  flex: 1;
  min-height: 0;
  gap: 0;
  padding: 0 0 12px;
  overflow: hidden;
}
.report-events-body {
  position: relative;
  flex: 1;
  min-height: 0;
  margin: 0 12px;
}
.report-events-body::before {
  position: absolute;
  content: "";
  left: 50%;
  top: 0;
  bottom: 0;
  border-left: 1px solid var(--border);
}
.report-events-list {
  position: absolute;
  top: 0;
  left: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  transform-origin: top left;
}
.report-event-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px minmax(0, 1fr);
  min-height: 36px;
  align-items: center;
  padding: 6px 0;
  font-size: 14px;
  line-height: 24px;
}
.report-event-row[data-team="away"] {
  text-align: left;
}
.report-event-content {
  display: flex;
  max-width: 100%;
  min-width: 0;
  width: 100%;
  align-items: baseline;
  gap: 8px;
  grid-column: 1;
  grid-row: 1;
  flex-direction: row-reverse;
  text-align: right;
}
.report-event-row[data-team="away"] .report-event-content {
  grid-column: 3;
  flex-direction: row;
  text-align: left;
}
.report-event-time {
  position: relative;
  z-index: 1;
  grid-column: 2;
  grid-row: 1;
  background: var(--card);
  text-align: center;
  flex-shrink: 0;
  min-width: 30px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--muted-foreground);
}
.report-event-icon {
  display: inline-flex;
  flex-shrink: 0;
  align-self: center;
}
.report-event-people {
  display: flex;
  flex: 1;
  min-width: 0;
  gap: 6px;
  flex-direction: row-reverse;
  align-items: baseline;
  justify-content: flex-start;
}
.report-event-primary,
.report-event-secondary {
  min-width: 0;
  overflow-wrap: anywhere;
}
.match-report .formation-focus-name {
  font-size: 12px;
  line-height: 16px;
  max-width: 112px;
}
.match-report .formation-focus-caption {
  font-size: 14px;
  line-height: 20px;
}
.report-formation-rating {
  display: inline-flex;
  min-width: 22px;
  height: 16px;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.report-event-row[data-team="away"] .report-event-people {
  flex-direction: row;
}
.report-event-secondary {
  color: var(--muted-foreground);
}
.report-event-row[data-timeline-event="substitution"] .report-event-primary {
  color: var(--status-positive);
}
.report-event-row[data-timeline-event="substitution"] .report-event-secondary {
  color: var(--status-negative);
}
`
