import { useId, useMemo } from "react"
import { describeKit, type KitDescriptor, type MatchKit } from "@/lib/kitRendering"
import type { TeamColorSource } from "@/lib/teamColors"

export function useMatchKits(home: TeamColorSource | undefined, away: TeamColorSource | undefined): (MatchKit | undefined)[] {
  const prefix = useId()
  const signature = JSON.stringify([
    describeKit(home, false), describeKit(home, true), describeKit(away, false), describeKit(away, true),
  ])
  // Four reusable symbols, refreshed only when their style/palette changes.
  // Includes exact primitive fields, not the changing live metadata identity.
  return useMemo(() => (JSON.parse(signature) as (KitDescriptor | null)[])
    .map((kit, index) => kit ? { ...kit, id: `${prefix}-kit-${index}` } : undefined), [prefix, signature])
}
