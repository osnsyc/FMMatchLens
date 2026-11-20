import goalSvg from "../../public/goal.svg?raw"

// Share a self-contained SVG between the dashboard and exported charts.
export const goalIconUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(goalSvg)}`
