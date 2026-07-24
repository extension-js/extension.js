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

// Stamp a browser-side load refusal into ready.json. Unlike a browser exit this
// always flips to error: the session is running but the guest is not in it, and
// every other surface (stdout, logs) looks identical to a healthy run.
export function stampReadyExtensionLoadRefused(
  extensionOutputPath: string | undefined,
  reason: string
) {
  try {
    if (!extensionOutputPath) return
    const readyPath = readyPathFor(extensionOutputPath)
    if (!fs.existsSync(readyPath)) return
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    ready.status = 'error'
    ready.code = 'extension_load_refused'
    const browserLabel = String(ready.browser || 'the browser')
    ready.message = `${
      browserLabel.charAt(0).toUpperCase() + browserLabel.slice(1)
    } refused to load the extension at ${extensionOutputPath}${
      reason ? `: ${reason}` : ''
    }`
    ready.extensionLoadRefusedAt = new Date().toISOString()
    if (reason) ready.extensionLoadRefusedReason = reason
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
