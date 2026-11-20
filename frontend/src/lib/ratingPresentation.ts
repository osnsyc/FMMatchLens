export function ratingBadgeClass(rating?: number) {
  if (rating == null) return "bg-muted text-muted-foreground"
  if (rating >= 7.5) return "bg-status-positive text-background"
  if (rating < 6.5) return "bg-status-negative text-background"
  return "bg-foreground text-background"
}
