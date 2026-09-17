import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))
const projectProperties = readFileSync(
  new URL("../Directory.Build.props", import.meta.url),
  "utf8"
)

function readProjectProperty(
  name: string,
  resolving = new Set<string>()
): string {
  if (resolving.has(name)) {
    throw new Error(
      `Directory.Build.props contains a circular reference at ${name}`
    )
  }
  const match = projectProperties.match(
    new RegExp(`<${name}>([^<]+)</${name}>`)
  )
  if (!match) throw new Error(`Directory.Build.props is missing ${name}`)
  const nextResolving = new Set(resolving).add(name)
  return match[1]
    .trim()
    .replace(/\$\(([^)]+)\)/g, (_reference, referencedName: string) =>
      readProjectProperty(referencedName, nextResolving)
    )
}

const appVersion = readProjectProperty("ProjectVersion")
const apiPort = Number(readProjectProperty("ApiPort"))
const appAuthor = readProjectProperty("Authors")
const authorBlogUrl = readProjectProperty("AuthorBlogUrl")
const githubProjectUrl = readProjectProperty("GitHubProjectUrl")
const demoArchiveUrl = readProjectProperty("DemoArchiveUrl")
const koFiUrl = readProjectProperty("KoFiUrl")
const koFiLabel = readProjectProperty("KoFiLabel")
const packageVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string }

if (packageVersion.version !== appVersion) {
  throw new Error(
    `Version mismatch: Directory.Build.props=${appVersion}, frontend/package.json=${packageVersion.version}`
  )
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isPagesBuild = mode === "pages"

  return {
    // The desktop release must work over file://, while Pages benefits from
    // root-relative URLs and native ES modules.
    base: isPagesBuild ? "/" : "./",
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __API_PORT__: apiPort,
      __APP_AUTHOR__: JSON.stringify(appAuthor),
      __AUTHOR_BLOG_URL__: JSON.stringify(authorBlogUrl),
      __GITHUB_PROJECT_URL__: JSON.stringify(githubProjectUrl),
      __DEMO_ARCHIVE_URL__: JSON.stringify(demoArchiveUrl),
      __ONLINE_DEMO_ENABLED__: isPagesBuild,
      __KOFI_URL__: JSON.stringify(koFiUrl),
      __KOFI_LABEL__: JSON.stringify(koFiLabel),
    },
    envDir: repositoryRoot,
    plugins: [
      react(),
      tailwindcss(),
      !isPagesBuild && {
        name: "classic-script-for-file-protocol",
        enforce: "post",
        // Vite always emits an ES-module script tag for application builds. The
        // bundle below is deliberately an IIFE, so make the generated tag a
        // deferred classic script that is also permitted on file:// pages.
        transformIndexHtml: {
          order: "post",
          handler(html, context) {
            if (!context.bundle) return html
            return html.replace(
              /<script type="module" crossorigin src=/g,
              "<script defer src="
            )
          },
        },
      },
      isPagesBuild && {
        name: "cloudflare-pages-cache-headers",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "_headers",
            source:
              "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n",
          })
        },
      },
    ],
    build: {
      // The desktop release intentionally ships as one classic-script bundle.
      // Pages instead splits stable libraries into content-hashed cacheable files.
      chunkSizeWarningLimit: isPagesBuild ? 700 : 2200,
      rolldownOptions: isPagesBuild
        ? {
            output: {
              codeSplitting: true,
            },
          }
        : {
            checks: {
              // Pixi and Vite contain guarded import.meta fallbacks. Rolldown replaces
              // them with an empty object for IIFE output, which is expected here.
              emptyImportMeta: false,
            },
            output: {
              // Browsers block external ES modules loaded from file:// because their
              // origin is opaque. A single IIFE bundle can be loaded as a classic
              // script instead and does not need a local HTTP server.
              format: "iife",
              codeSplitting: false,
            },
          },
    },
    experimental: isPagesBuild
      ? undefined
      : {
          renderBuiltUrl() {
            return { relative: true }
          },
        },
    resolve: {
      alias: {
        "@": new URL("./src", import.meta.url).pathname,
      },
    },
  }
})
