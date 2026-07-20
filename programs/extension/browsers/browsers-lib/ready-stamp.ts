// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'

/**
 * Stamp an unexpected browser exit into the session's ready.json (additive
 * fields; the develop-side writer preserves them across recompiles, like
 * cdpPort) so automation reading the contract sees the session is browserless
 * instead of trusting a green status whose reloads go nowhere.
 *
 * For run-only commands (preview/start) a dead browser IS a dead session, so
 * the status flips to error (§72); a dev session keeps its compile status (the
 * dev server is still alive) with the exit evidence alongside. Shared by the
 * Chromium and Firefox launchers (§71: Firefox death used to be fully silent).
 */
export function stampReadyBrowserExited(
  extensionOutputPath: string | undefined,
  code: number | null
) {
  try {
    if (!extensionOutputPath) return
    const readyPath = path.join(
      path.dirname(extensionOutputPath),
      'extension-js',
      path.basename(extensionOutputPath),
      'ready.json'
    )
    if (!fs.existsSync(readyPath)) return
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    ready.browserExitedAt = new Date().toISOString()
    ready.browserExitCode = code
    if (ready.command === 'preview' || ready.command === 'start') {
      ready.status = 'error'
      ready.code = 'browser_exited'
      ready.message = `the ${ready.browser || 'browser'} process exited (code ${
        code ?? 'unknown'
      }); nothing is running`
    }
    fs.writeFileSync(readyPath, JSON.stringify(ready, null, 2))
  } catch {
    // best-effort; never throw from a close handler
  }
}
