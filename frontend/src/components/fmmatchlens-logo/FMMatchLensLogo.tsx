import { useEffect, useRef, type SVGProps } from "react"
import { bladePath, blades, frameAt, pentagon, ROTATION } from "./geometry"

export interface FMMatchLensLogoProps extends Omit<
  SVGProps<SVGSVGElement>,
  "color" | "children"
> {
  /** Fixed outer diameter. Defaults to 160. */
  size?: number | string
  /** Full animation loop duration in seconds. Defaults to 2.4. */
  duration?: number
  color?: string
  paused?: boolean
  respectReducedMotion?: boolean
  pauseWhenOffscreen?: boolean
}

const templateBlade = blades[0]
const initialPath = bladePath(templateBlade, 0)

export function FMMatchLensLogo({
  size = 160,
  duration = 3.0,
  color = "#7c3aed",
  paused = false,
  respectReducedMotion = true,
  pauseWhenOffscreen = true,
  className = "",
  style,
  ...props
}: FMMatchLensLogoProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const phaseRef = useRef(0)
  const cycle = Number.isFinite(duration) && duration > 0 ? duration : 2.4

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const shutter = svg.querySelector<SVGGElement>("[data-fm-shutter]")
    const center = svg.querySelector<SVGPathElement>("[data-fm-center]")
    const paths = Array.from(
      svg.querySelectorAll<SVGPathElement>("[data-fm-blade]")
    )
    if (!shutter || !center || paths.length !== blades.length) return

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    let request: number | undefined
    let last: number | undefined
    let inViewport = true
    let previousAmount: number | undefined
    let previousOpacity: number | undefined
    let disposed = false

    const paint = (phase: number) => {
      const { amount, opacity } = frameAt(phase)
      if (amount !== previousAmount) {
        shutter.setAttribute(
          "transform",
          `rotate(${ROTATION * amount} 256 256)`
        )
        const pathData = bladePath(templateBlade, amount)
        paths.forEach((path) => path.setAttribute("d", pathData))
        previousAmount = amount
      }
      if (opacity !== previousOpacity) {
        center.setAttribute("opacity", String(opacity))
        previousOpacity = opacity
      }
    }

    const tick = (now: number) => {
      if (disposed) return
      if (last !== undefined) {
        phaseRef.current =
          (phaseRef.current + (now - last) / (cycle * 1000)) % 1
      }
      last = now
      paint(phaseRef.current)
      request = requestAnimationFrame(tick)
    }

    const restart = () => {
      if (disposed) return
      if (request !== undefined) cancelAnimationFrame(request)
      request = undefined
      last = undefined
      const reduced = respectReducedMotion && motion.matches
      paint(reduced ? 0 : phaseRef.current)
      if (!reduced && !paused && !document.hidden && inViewport) {
        request = requestAnimationFrame(tick)
      }
    }

    const observer =
      pauseWhenOffscreen && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => {
            inViewport = entry.isIntersecting
            restart()
          })
        : undefined

    observer?.observe(svg)
    motion.addEventListener("change", restart)
    document.addEventListener("visibilitychange", restart)
    restart()

    return () => {
      disposed = true
      if (request !== undefined) cancelAnimationFrame(request)
      observer?.disconnect()
      motion.removeEventListener("change", restart)
      document.removeEventListener("visibilitychange", restart)
    }
  }, [cycle, paused, pauseWhenOffscreen, respectReducedMotion])

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      fill={color}
      role="img"
      aria-label="FMMatchLens"
      {...props}
      ref={svgRef}
      className={`fm-logo ${className}`.trim()}
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        overflow: "hidden",
        ...style,
      }}
    >
      <g data-fm-shutter="">
        {blades.map((_, index) => (
          <path
            key={index}
            data-fm-blade=""
            d={initialPath}
            transform={`rotate(${-60 * index} 256 256)`}
          />
        ))}
      </g>
      <path data-fm-center="" d={pentagon} />
    </svg>
  )
}
