import { useTranslation } from "react-i18next"
import { FootIcon } from "@/components/FootIcon"
import { IconHint } from "@/components/ui/icon-hint"
import type { MatchPlayer } from "@/types/match"

export function FootAbilityIcon({
  mirrored = false,
  className,
  compact = false,
}: {
  mirrored?: boolean
  className: string
  compact?: boolean
}) {
  return (
    <FootIcon
      aria-hidden="true"
      focusable="false"
      {...(compact ? { viewBox: "19 9 43 62" } : {})}
      className={`h-7 w-7 shrink-0 ${className}`}
      style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
    />
  )
}

/** Same raw 0..100 attribute scale and tiers as the player profile. Missing feet stay unknown. */
export function FootAbilityPair({
  attributes,
}: {
  attributes?: MatchPlayer["attributes"]
}) {
  const { t } = useTranslation()
  return (
    <span className="formation-foot-ability" data-foot-ability>
      {(["Left Foot", "Right Foot"] as const).map((foot, index) => {
        const raw = attributes?.technical[foot]
        const tier =
          raw != null && Number.isFinite(raw) && raw > 0
            ? footAbilityTier(displayAttributeValue(raw))
            : undefined
        const label = t("teamTactics.describedValue", {
          label: t(`playerProfile.${index ? "rightFoot" : "leftFoot"}`),
          value: tier
            ? t(`playerProfile.footStrength.${tier.description}`)
            : t("teamTactics.notRead"),
        })
        return (
          <IconHint key={foot} label={label}>
            <FootAbilityIcon
              compact
              mirrored={!index}
              className={tier?.className ?? "text-muted-foreground/35"}
            />
          </IconHint>
        )
      })}
    </span>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- Shared attribute helpers intentionally live with their display components.
export function displayAttributeValue(rawValue: number) {
  if (!Number.isFinite(rawValue) || rawValue <= 0) return 0
  return Math.min(20, Math.max(1, Math.round(rawValue / 5)))
}

// eslint-disable-next-line react-refresh/only-export-components -- Shared attribute helpers intentionally live with their display components.
export function footAbilityTier(value: number) {
  if (value >= 18)
    return { description: "veryStrong", className: "text-status-positive" }
  if (value >= 15)
    return { description: "strong", className: "text-status-positive/75" }
  if (value >= 12)
    return { description: "fairlyStrong", className: "text-status-warning" }
  if (value >= 9)
    return { description: "reasonable", className: "text-foreground" }
  if (value >= 5)
    return { description: "weak", className: "text-status-negative/75" }
  return { description: "veryWeak", className: "text-status-negative" }
}
