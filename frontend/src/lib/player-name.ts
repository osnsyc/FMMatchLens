export function shortPlayerName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return name

  const surname = parts.at(-1)!
  const initials = parts
    .slice(0, -1)
    .map((part) => `${part[0].toUpperCase()}.`)
    .join(" ")

  return `${initials} ${surname}`
}
