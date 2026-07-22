// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

function readyPathFor(extensionOutputPath: string): string {
  return path.join(
    path.dirname(extensionOutputPath),
    'extension-js',
    path.basename(extensionOutputPath),
    'ready.json'
  )
}

// Publish the Gecko RDP debugger-server port next to Chromium's cdpPort so
// downstream tooling can pair protocol clients from the ready contract alone.
export function stampReadyRdpPort(
  extensionOutputPath: string | undefined,
  rdpPort: number
) {
  try {
    if (!extensionOutputPath || !Number.isFinite(rdpPort)) return
    const readyPath = readyPathFor(extensionOutputPath)
    if (!fs.existsSync(readyPath)) return
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    if (ready.rdpPort === rdpPort) return
    ready.rdpPort = rdpPort
    fs.writeFileSync(readyPath, JSON.stringify(ready, null, 2))
  } catch {
    // best-effort; never block launch on this
  }
}

// Stamp an unexpected browser exit into the session's ready.json so automation
// sees a browserless session. Run-only commands flip to error; dev keeps compile status.
export function stampReadyBrowserExited(
  extensionOutputPath: string | undefined,
  code: number | null
) {
  try {
    if (!extensionOutputPath) return
    const readyPath = readyPathFor(extensionOutputPath)
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
