import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))
const projectProperties = readFileSync(new URL("../Directory.Build.props", import.meta.url), "utf8")

function readProjectProperty(name: string) {
  const match = projectProperties.match(new RegExp(`<${name}>([^<]+)</${name}>`))
  if (!match) throw new Error(`Directory.Build.props is missing ${name}`)
  return match[1].trim()
}

const appVersion = readProjectProperty("ProjectVersion")
const apiPort = Number(readProjectProperty("ApiPort"))
const appAuthor = readProjectProperty("Authors")
const authorBlogUrl = readProjectProperty("AuthorBlogUrl")
const githubProjectUrl = readProjectProperty("GitHubProjectUrl")
const koFiUrl = readProjectProperty("KoFiUrl")
const koFiLabel = readProjectProperty("KoFiLabel")
const packageVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string }

if (packageVersion.version !== appVersion) {
  throw new Error(`Version mismatch: Directory.Build.props=${appVersion}, frontend/package.json=${packageVersion.version}`)
}

// https://vite.dev/config/
export default defineConfig({
  // Keep every generated URL relative so the release can be opened from a
  // file:// URL after it has been extracted anywhere on disk.
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __API_PORT__: apiPort,
    __APP_AUTHOR__: JSON.stringify(appAuthor),
    __AUTHOR_BLOG_URL__: JSON.stringify(authorBlogUrl),
    __GITHUB_PROJECT_URL__: JSON.stringify(githubProjectUrl),
    __KOFI_URL__: JSON.stringify(koFiUrl),
    __KOFI_LABEL__: JSON.stringify(koFiLabel),
  },
  envDir: repositoryRoot,
  plugins: [
    react(),
    tailwindcss(),
    {
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
            "<script defer src=",
          )
        },
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        // Browsers block external ES modules loaded from file:// because their
        // origin is opaque. A single IIFE bundle can be loaded as a classic
        // script instead and does not need a local HTTP server.
        format: "iife",
      },
    },
  },
  experimental: {
    renderBuiltUrl() {
      return { relative: true }
    },
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
})
