// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

/**
 * Dev-only helper included in all HTML-based extension pages during development.
 *
 * Why this exists:
 * - We run the dev-server in `hot: "only"` mode globally to avoid hard-reload loops
 *   in content scripts when HMR fails (common after syntax errors).
 * - Some extension UI pages (sidebar/options/popup) historically relied on reload-based
 *   recovery after syntax errors.
 *
 * Rspack dev-server client (v2.x) checks `location.search` for: rspack-dev-server-hot=false
 * If present, it will NOT attempt HMR and will fall back to liveReload (full
 * reload). The same param was named `webpack-dev-server-hot=false` in
 * @rspack/dev-server 1.x; v2.0 renamed both the hot and live-reload guards to
 * the rspack-prefixed forms, so we set both names for forward/back compat.
 * We set that flag only for extension pages (`*-extension:` protocols) so UI pages
 * keep their previous "reload to recover" behavior, while content scripts remain protected.
 */
const safeLocation =
  typeof globalThis !== 'undefined' ? (globalThis as any).location : undefined
const safeHistory =
  typeof globalThis !== 'undefined' ? (globalThis as any).history : undefined

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
  // ignore
}

export {}
