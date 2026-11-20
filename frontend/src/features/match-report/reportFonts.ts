import interCss from "@fontsource-variable/inter?raw"
import headingCss from "@fontsource-variable/big-shoulders-text?raw"
import monoRegularCss from "@fontsource/ibm-plex-mono/latin-400.css?raw"
import monoSemiboldCss from "@fontsource/ibm-plex-mono/latin-600.css?raw"

// Bundle the same font faces used by index.css as data URLs. Reading file://
// fonts with fetch during DOM capture is blocked even when the page loaded them.
const fonts = {
  ...import.meta.glob<string>(
    [
      "/node_modules/@fontsource-variable/inter/files/*-wght-normal.woff2",
      "/node_modules/@fontsource-variable/big-shoulders-text/files/*-wght-normal.woff2",
      "/node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-{400,600}-normal.woff{,2}",
    ],
    { eager: true, query: "?inline", import: "default" }
  ),
  ...import.meta.glob<string>("/public/fonts/*.{otf,woff}", {
    eager: true,
    query: "?inline",
    import: "default",
  }),
}

const urls = new Map(
  Object.entries(fonts).map(([path, dataUrl]) => [
    path.split("/").at(-1),
    dataUrl,
  ])
)

export const reportFontEmbedCSS = [
  interCss,
  headingCss,
  monoRegularCss,
  monoSemiboldCss,
  `@font-face { font-family: "ABCSocial"; src: url("${urls.get("ABCSocial-Bold.woff")}") format("woff"); font-weight: 700; font-style: normal; font-display: swap; }`,
  `@font-face { font-family: "FMUniverse"; src: url("${urls.get("FMUniverse-Regular.otf")}") format("opentype"); font-weight: 400; font-style: normal; font-display: swap; }`,
]
  .join("\n")
  .replace(/url\(\.\/files\/([^)]*)\)/g, (_match, filename: string) => {
    const url = urls.get(filename)
    if (!url) throw new Error(`Missing bundled report font: ${filename}`)
    return `url("${url}")`
  })
