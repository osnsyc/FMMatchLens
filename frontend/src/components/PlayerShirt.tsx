import { useId } from "react"
import { kitColourMatrix, type MatchKit } from "@/lib/kitRendering"
import { cn } from "@/lib/utils"

export function PlayerShirt({ kit, number, shirtName, className, numberClassName }: { kit: MatchKit; number?: number; shirtName?: string; className?: string; numberClassName?: string }) {
  const namePathId = useId()
  const name = shirtName?.trim()
  // The arc is about 25 SVG units long; keep every glyph within its ends.
  const nameWidth = name ? Math.min(24, Array.from(name).length * 4) : 0
  return (
    <span aria-hidden="true" className={cn("relative inline-block size-10 shrink-0", className)}>
      <svg viewBox="0 0 64 64" className="size-full">
        <use href={`#${kit.id}`} />
        {name && (
          <>
            <defs><path id={namePathId} d="M 20 18 Q 32 12 44 18" /></defs>
            <text fill={kit.numberColor} stroke={kit.numberOutlineColor} strokeWidth="0.2"
              paintOrder="stroke fill" strokeLinejoin="round" fontSize="6" fontWeight="300"
              textAnchor="middle" textLength={nameWidth} lengthAdjust="spacingAndGlyphs">
              <textPath href={`#${namePathId}`} startOffset="50%">{name}</textPath>
            </text>
          </>
        )}
      </svg>
      <span className={cn("absolute inset-x-[28%] top-[36%] text-center text-[13px] font-extrabold leading-none tabular-nums", numberClassName)}
        style={{ color: kit.numberColor, WebkitTextStroke: `0.6px ${kit.numberOutlineColor}`, paintOrder: "stroke fill" }}>
        {number ?? ""}
      </span>
    </span>
  )
}

export function MatchKitSymbols({ kits }: { kits: readonly (MatchKit | undefined)[] }) {
  return (
    <svg aria-hidden="true" width="0" height="0" className="absolute overflow-hidden">
      <defs>
        <filter id="fmlens-shirt-outline" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feMorphology in="SourceAlpha" operator="dilate" radius="1" result="expanded" />
          <feFlood floodColor="var(--border-subtle)" result="outlineColour" />
          <feComposite in="outlineColour" in2="expanded" operator="in" result="outline" />
          <feMerge><feMergeNode in="outline" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {kits.map((kit) => kit && (
          <g key={kit.id}>
            <filter id={`${kit.id}-colour`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values={kitColourMatrix(kit.colours).join(" ")} />
            </filter>
            <symbol id={kit.id} viewBox="0 0 64 64">
              <g filter={`url(#${kit.id}-colour)`}>
                <image href={`${import.meta.env.BASE_URL}${kit.resource}`} width="64" height="64" />
                {kit.squareResource && <image href={`${import.meta.env.BASE_URL}${kit.squareResource}`} width="64" height="64" />}
              </g>
            </symbol>
          </g>
        ))}
      </defs>
    </svg>
  )
}
