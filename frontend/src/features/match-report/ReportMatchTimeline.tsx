import { useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { TimelineEventIcon } from "@/components/TimelineEventIcon"
import { AssistIcon } from "@/components/AssistIcon"
import { buildTimelineEvents } from "@/lib/matchTimelineEvents"
import type { MatchSnapshot } from "@/types/match"

export function ReportMatchTimeline({ match }: { match: MatchSnapshot }) {
  const { t } = useTranslation()
  const events = buildTimelineEvents(match, t, { groupSimultaneous: false })
  const bodyRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const body = bodyRef.current
    const list = listRef.current
    if (!body || !list) return
    const measure = () => {
      const next = Math.min(
        1,
        body.clientHeight / Math.max(1, list.scrollHeight)
      )
      if (body.clientHeight > 0)
        // Widening the scaled list can unwrap names; only shrink so the
        // observer cannot alternate between two wrapping widths.
        setScale((current) => (next < current - 0.001 ? next : current))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    observer.observe(list)
    measure()
    return () => observer.disconnect()
  }, [match])
  return (
    <Card className="report-match-timeline" data-report-match-timeline>
      <CardHeader className="shrink-0 px-3 py-2">
        <CardTitle className="text-sm">{t("report.events")}</CardTitle>
      </CardHeader>
      <div ref={bodyRef} className="report-events-body">
        {events.length ? (
          <ol
            ref={listRef}
            className="report-events-list"
            style={{ width: `${100 / scale}%`, transform: `scale(${scale})` }}
          >
            {events.map((event) => (
              <li
                key={event.id}
                className="report-event-row"
                data-team={event.team}
                data-timeline-event={event.type}
                aria-label={`${event.minute}' ${event.label}`}
              >
                <time className="report-event-time">{event.minute}'</time>
                <div className="report-event-content">
                  <span className="report-event-icon" title={event.label}>
                    <TimelineEventIcon event={event} />
                  </span>
                  <span className="report-event-people">
                    <strong className="report-event-primary">
                      {event.primaryPeople.join(" / ") || event.label}
                    </strong>
                    {event.secondaryPeople.length > 0 && (
                      <>
                        {event.type === "goal" && (
                          <span
                            className="report-event-icon text-primary"
                            title={t("squad.assist")}
                          >
                            <AssistIcon className="size-4" aria-hidden />
                          </span>
                        )}
                        <span className="report-event-secondary">
                          {event.secondaryPeople.join(" / ")}
                        </span>
                      </>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="p-6 text-center text-xs text-muted-foreground">
            {t("report.noEvents")}
          </p>
        )}
      </div>
    </Card>
  )
}
