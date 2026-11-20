import { MatchKitSymbols } from "@/components/PlayerShirt"
import type { MatchKit } from "@/lib/kitRendering"

const kitImages = import.meta.glob<string>("/public/kits/**/*.webp", {
  eager: true,
  query: "?inline",
  import: "default",
})

export function ReportKitSymbols({
  kits,
}: {
  kits: readonly (MatchKit | undefined)[]
}) {
  return (
    <MatchKitSymbols
      kits={kits}
      resourceUrl={(resource) => kitImages[`/public/${resource}`]}
    />
  )
}
