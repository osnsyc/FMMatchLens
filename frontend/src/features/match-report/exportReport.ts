import { toBlob } from "html-to-image"
import type { MatchSnapshot } from "@/types/match"
import { reportFontEmbedCSS } from "./reportFonts"

export function reportFilename(match: MatchSnapshot, date = new Date()) {
  const safe = (name: string) =>
    name
      .split("")
      .map((character) =>
        character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character)
          ? "_"
          : character
      )
      .join("")
      .replace(/[. ]+$/g, "")
      .slice(0, 70) || "team"
  // Snapshot has no match date: this is explicitly the local export date.
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  return `FMMatchLens_${safe(match.home.name)}_vs_${safe(match.away.name)}_exported-${day}_match-report.png`
}

export function reportReady(element: HTMLElement) {
  const heatmaps = [
    ...element.querySelectorAll<HTMLElement>("[data-report-heatmap]"),
  ]
  if (heatmaps.some((node) => node.dataset.reportHeatmap === "error"))
    throw new Error("Heatmap capture failed")
  const charts = [...element.querySelectorAll("[data-report-chart]")]
  const resources = [
    ...element.querySelectorAll<HTMLElement>("[data-report-resource]"),
  ]
  if (resources.some((node) => node.dataset.reportResource === "error"))
    throw new Error("Report resource failed")
  return (
    heatmaps.every((node) => node.dataset.reportHeatmap === "ready") &&
    resources.every((node) => node.dataset.reportResource === "ready") &&
    charts.length === 2 &&
    charts.every((node) => node.querySelector("svg.recharts-surface"))
  )
}

function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort)
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort))
  })
}

export async function exportReportPng(
  element: HTMLElement,
  filename: string,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  if (!reportReady(element)) throw new Error("Report is not ready")
  await untilAborted(document.fonts.ready, signal)
  await untilAborted(
    Promise.all(
      [...element.querySelectorAll("img")].map((image) => image.decode())
    ),
    signal
  )
  let frame: number | undefined
  try {
    await untilAborted(
      new Promise<void>((resolve) => {
        frame = requestAnimationFrame(() => resolve())
      }),
      signal
    )
  } finally {
    if (signal?.aborted && frame != null) cancelAnimationFrame(frame)
  }
  signal?.throwIfAborted()
  if (!element.isConnected || !reportReady(element))
    throw new Error("Report changed during export")
  const blob = await toBlob(element, {
    width: element.offsetWidth,
    height: element.offsetHeight,
    pixelRatio: 2,
    cacheBust: false,
    fontEmbedCSS: reportFontEmbedCSS,
    filter: () => {
      signal?.throwIfAborted()
      return true
    },
    fetchRequestInit: { signal },
  })
  signal?.throwIfAborted()
  if (!blob) throw new Error("Image export returned an empty Blob")
  if (!element.isConnected) return
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  let revokeTimer: number | undefined
  const release = () => {
    if (revokeTimer != null) window.clearTimeout(revokeTimer)
    URL.revokeObjectURL(url)
    signal?.removeEventListener("abort", release)
  }
  try {
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    signal?.addEventListener("abort", release, { once: true })
    revokeTimer = window.setTimeout(release, 1000)
  }
}
