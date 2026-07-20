// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

// Dev-only helper for HTML pages: sets the rspack/webpack dev-server hot=false
// URL guards so UI pages fall back to full reload; content scripts stay hot-only.
const safeLocation =
  typeof globalThis !== 'undefined'
    ? (
        globalThis as {
          location?: {protocol?: unknown; search?: unknown; href?: unknown}
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

try {
  if (
    typeof safeLocation === 'object' &&
    safeLocation &&
    String(safeLocation.protocol || '').includes('-extension:')
  ) {
    const q = String(safeLocation.search || '').toLowerCase()
    const alreadySet =
      q.includes('rspack-dev-server-hot=false') &&
      q.includes('webpack-dev-server-hot=false')

    if (
      !alreadySet &&
      typeof URL === 'function' &&
      typeof safeHistory === 'object' &&
      safeHistory &&
      typeof safeHistory.replaceState === 'function'
    ) {
      const u = new URL(String(safeLocation.href))

      u.searchParams.set('rspack-dev-server-hot', 'false')
      u.searchParams.set('webpack-dev-server-hot', 'false')
      safeHistory.replaceState(null, '', u.toString())
    }
  }
} catch {
  // Ignore
}

export {}
