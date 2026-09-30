const backendUrlStorageKey = "fmmatchlens.backendUrl"

export const defaultBackendUrl = `http://127.0.0.1:${__API_PORT__}`

export function normalizeBackendUrl(value: string): string {
  const candidate = value.trim()
  if (!candidate) return defaultBackendUrl

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate)
    ? candidate
    : `http://${candidate}`
  const url = new URL(withProtocol)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("unsupported backend protocol")
  }
  if (url.username || url.password) throw new Error("credentials are not allowed")
  url.hash = ""
  url.search = ""
  url.pathname = url.pathname.replace(/\/+$/, "")
  return url.toString().replace(/\/$/, "")
}

export function loadBackendUrl(): string {
  if (typeof window === "undefined") return defaultBackendUrl
  const saved = window.localStorage.getItem(backendUrlStorageKey)
  if (!saved) return defaultBackendUrl
  try {
    return normalizeBackendUrl(saved)
  } catch {
    window.localStorage.removeItem(backendUrlStorageKey)
    return defaultBackendUrl
  }
}

export function saveBackendUrl(value: string): string {
  const normalized = normalizeBackendUrl(value)
  if (typeof window !== "undefined") {
    if (normalized === defaultBackendUrl) {
      window.localStorage.removeItem(backendUrlStorageKey)
    } else {
      window.localStorage.setItem(backendUrlStorageKey, normalized)
    }
  }
  return normalized
}

export function backendWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ws`
  return url.toString()
}
