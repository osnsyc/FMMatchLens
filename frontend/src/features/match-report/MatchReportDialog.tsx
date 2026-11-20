import { useEffect, useRef, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { MatchReport } from "./MatchReport"
import { exportReportPng, reportFilename, reportReady } from "./exportReport"
import type { MatchSnapshot } from "@/types/match"
import {
  REPORT_WIDTH,
  REPORT_HEIGHT,
  type MatchReportContext,
} from "./reportTypes"

// Two 32px toolbars, two 12px gaps, 32px padding and 2px borders.
const dialogChromeHeight = 122
const dialogChromeWidth = 34

export function MatchReportDialog({
  match,
  context,
  onClose,
}: {
  match: MatchSnapshot
  context?: MatchReportContext
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[120] bg-[var(--surface-overlay)]" />
        <Dialog.Popup
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-[121] flex h-[92dvh] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-2xl"
          style={{
            width: `min(96vw, calc((92dvh - ${dialogChromeHeight}px) * ${REPORT_WIDTH / REPORT_HEIGHT} + ${dialogChromeWidth}px))`,
          }}
        >
          <div className="flex h-8 shrink-0 items-center gap-3">
            <Dialog.Title className="mr-auto text-lg font-semibold">
              {t("report.title")}
            </Dialog.Title>
            <Button variant="ghost" onClick={onClose}>
              {t("common.close")}
            </Button>
          </div>
          <ReportPreview match={match} context={context} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ReportPreview({
  match,
  context,
}: {
  match: MatchSnapshot
  context?: MatchReportContext
}) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const exportingRef = useRef(false)
  const exportControllerRef = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      exportControllerRef.current?.abort()
      exportControllerRef.current = null
    },
    []
  )
  const [status, setStatus] = useState<
    "preparing" | "ready" | "exporting" | "error"
  >("preparing")
  const failed = useRef(false)
  useEffect(() => {
    const viewport = viewportRef.current!
    const update = () =>
      setScale(
        Math.min(
          viewport.clientWidth / REPORT_WIDTH,
          viewport.clientHeight / REPORT_HEIGHT
        )
      )
    const resize = new ResizeObserver(update)
    resize.observe(viewport)
    update()
    return () => resize.disconnect()
  }, [])
  useEffect(() => {
    const host = hostRef.current!
    const check = () => {
      if (exportingRef.current || failed.current) return
      try {
        setStatus(reportReady(host) ? "ready" : "preparing")
      } catch {
        failed.current = true
        setStatus("error")
      }
    }
    const observer = new MutationObserver(check)
    observer.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-report-heatmap", "data-report-resource"],
    })
    const timer = window.setTimeout(() => {
      if (exportingRef.current || failed.current) return
      try {
        if (reportReady(host)) return
      } catch {
        /* Handled as a preparation failure below. */
      }
      failed.current = true
      setStatus("error")
    }, 30000)
    check()
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [])
  const save = async () => {
    if (exportingRef.current || !hostRef.current) return
    exportingRef.current = true
    exportControllerRef.current?.abort()
    const controller = new AbortController()
    exportControllerRef.current = controller
    setStatus("exporting")
    try {
      await exportReportPng(
        hostRef.current.querySelector<HTMLElement>("[data-match-report]")!,
        reportFilename(match),
        controller.signal
      )
      if (!controller.signal.aborted) setStatus("ready")
    } catch (error) {
      if (controller.signal.aborted) return
      console.error("Match report export failed", error)
      failed.current = true
      setStatus("error")
    } finally {
      exportingRef.current = false
    }
  }
  return (
    <>
      <div
        ref={viewportRef}
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-background"
      >
        <div
          className="shrink-0"
          style={{
            width: REPORT_WIDTH * scale,
            height: REPORT_HEIGHT * scale,
          }}
        >
          <div
            ref={hostRef}
            style={{
              width: REPORT_WIDTH,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <MatchReport match={match} context={context} />
          </div>
        </div>
      </div>
      <div className="flex h-8 shrink-0 items-center justify-between gap-3">
        <span
          role="status"
          className={`text-xs ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {status === "ready"
            ? t("report.imageSize", {
                width: REPORT_WIDTH * 2,
                height: REPORT_HEIGHT * 2,
              })
            : t(`report.${status}`)}
        </span>
        <Button disabled={status !== "ready"} onClick={() => void save()}>
          {t("report.export")}
        </Button>
      </div>
    </>
  )
}
