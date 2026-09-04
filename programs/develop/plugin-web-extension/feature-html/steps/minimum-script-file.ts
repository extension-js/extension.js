// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

// Dev-only minimum script for HTML pages: HMR needs at least one JS file per
// entry. Older sessions wrote hot=false URL guards; scrub them so HMR applies.
//
// It also owns the one refresh HMR cannot do. Scripts and styles hot-swap, but
// an edit to the page's own HTML produces a hot update with nothing in it for
// this page, and the dev-server client then applies nothing and moves on. The
// hot=false guard used to make that client fall back to a full reload, so
// scrubbing it (4.1.10) left HTML edits invisible until a manual refresh. The
// client posts a `webpackHotUpdate<hash>` message on every new hash; on each
// one this page fetches its own document and reloads only when the markup on
// disk no longer matches what it loaded. A script or style edit leaves the
// markup as it was and keeps its HMR path.
const safeLocation =
  typeof globalThis !== 'undefined'
    ? (
        globalThis as {
          location?: {
            protocol?: unknown
            search?: unknown
            href?: unknown
            reload?: () => void
          }
        }
      ).location
    : undefined
const safeHistory =
  typeof globalThis !== 'undefined'
    ? (
        globalThis as {
          history?: {
            replaceState?: (data: unknown, unused: string, url?: string) => void
          }
        }
      ).history
    : undefined

const isExtensionPage =
  typeof safeLocation === 'object' &&
  !!safeLocation &&
  String(safeLocation.protocol || '').includes('-extension:')

try {
  if (isExtensionPage && safeLocation) {
    const q = String(safeLocation.search || '').toLowerCase()
    const hasStaleGuards =
      q.includes('rspack-dev-server-hot=false') ||
      q.includes('webpack-dev-server-hot=false')

    if (
      hasStaleGuards &&
      typeof URL === 'function' &&
      typeof safeHistory === 'object' &&
      safeHistory &&
      typeof safeHistory.replaceState === 'function'
    ) {
      const u = new URL(String(safeLocation.href))

      u.searchParams.delete('rspack-dev-server-hot')
      u.searchParams.delete('webpack-dev-server-hot')
      safeHistory.replaceState(null, '', u.toString())
    }
  }
} catch {
  // Ignore
}

// The document this page loaded, as served. Read once at startup and again on
// every hash so the two can be compared; null when the page cannot be fetched.
async function ownMarkup(): Promise<string | null> {
  try {
    const href = String(safeLocation?.href || '').split('#')[0]
    if (!href) return null
    const response = await fetch(href, {cache: 'no-store'})
    return response.ok ? await response.text() : null
  } catch {
    return null
  }
}

try {
  const scope = globalThis as {
    addEventListener?: (
      type: string,
      listener: (event: {data?: unknown}) => void
    ) => void
  }

  if (
    isExtensionPage &&
    safeLocation &&
    typeof fetch === 'function' &&
    typeof scope.addEventListener === 'function'
  ) {
    let loadedMarkup: string | null = null
    let comparing = false

    void ownMarkup().then((markup) => {
      loadedMarkup = markup
    })

    scope.addEventListener('message', (event) => {
      const data = event?.data
      if (typeof data !== 'string' || !data.startsWith('webpackHotUpdate')) {
        return
      }
      if (comparing || loadedMarkup == null) return
      comparing = true

      // The message follows the compile, and the HTML asset is on disk by then
      // (writeToDisk runs at emit), but the second look covers a slow write.
      const compare = async (attempt: number) => {
        const markup = await ownMarkup()
        if (markup != null && markup !== loadedMarkup) {
          comparing = false
          if (typeof safeLocation.reload === 'function') safeLocation.reload()
          return
        }
        if (attempt < 1) {
          setTimeout(() => void compare(attempt + 1), 500)
          return
        }
        comparing = false
      }
      void compare(0)
    })
  }
} catch {
  // Ignore
}

export {}
