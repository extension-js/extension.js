// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

// Dev-only minimum script for HTML pages: HMR needs at least one JS file per
// entry. Older sessions wrote hot=false URL guards; scrub them so HMR applies.
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

export {}
