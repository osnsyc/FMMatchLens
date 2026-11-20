import { useEffect, useState, type ReactNode } from "react"

export function ReportImage({
  src,
  alt,
  className,
  children,
}: {
  src?: string
  alt: string
  className: string
  children: ReactNode
}) {
  const [image, setImage] = useState<{
    source?: string
    url?: string
    ready: boolean
  }>({ ready: !src })
  useEffect(() => {
    if (!src) return
    let disposed = false
    let reader: FileReader | undefined
    let decoded: HTMLImageElement | undefined
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    void (async () => {
      try {
        let url = src
        if (!src.startsWith("data:")) {
          const response = await fetch(src, { signal: controller.signal })
          if (disposed) return
          if (!response.ok) throw new Error("Image unavailable")
          const blob = await response.blob()
          if (disposed) return
          url = await new Promise<string>((resolve, reject) => {
            const activeReader = new FileReader()
            reader = activeReader
            activeReader.onload = () => resolve(String(activeReader.result))
            activeReader.onerror = reject
            activeReader.onabort = () =>
              reject(new DOMException("Aborted", "AbortError"))
            activeReader.readAsDataURL(blob)
          })
        }
        if (disposed) return
        decoded = new Image()
        decoded.src = url
        await decoded.decode()
        if (!disposed) setImage({ source: src, url, ready: true })
      } catch {
        if (!disposed) setImage({ source: src, ready: true })
      } finally {
        window.clearTimeout(timeout)
      }
    })()
    return () => {
      disposed = true
      window.clearTimeout(timeout)
      controller.abort()
      reader?.abort()
      decoded?.removeAttribute("src")
    }
  }, [src])
  const ready = !src || (image.source === src && image.ready)
  return (
    <span
      className={`flex items-center justify-center ${className}`}
      data-report-resource={ready ? "ready" : "loading"}
    >
      {image.source === src && image.url ? (
        <img src={image.url} alt={alt} className="size-full object-contain" />
      ) : (
        children
      )}
    </span>
  )
}
