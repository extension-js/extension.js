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

// Publish which profile directory and browser process this session launched.
// An ephemeral profile's leaf name is generated, so no path helper can rebuild
// it, and the pid is the only supported handle for reaping the browser.
export function stampReadyBrowserLaunch(
  extensionOutputPath: string | undefined,
  details: {
    profilePath?: string
    browserPid?: number
    extensionId?: string
    // Which binary actually ran, and how it was chosen. This matters MOST for
    // the runs that did not name one: someone who passed --chromium-binary
    // already knows the path, while everyone else gets a browser the resolver
    // picked and has no way to see which. The card stays uniform, so this
    // contract is where that fact lives.
    binary?: string
    binaryProvenance?: 'managed' | 'pinned' | 'system' | 'snapshot'
  }
) {
  try {
    if (!extensionOutputPath) return
    const readyPath = readyPathFor(extensionOutputPath)
    if (!fs.existsSync(readyPath)) return
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    const profilePath = String(details?.profilePath || '').trim()
    if (profilePath) ready.profilePath = profilePath
    if (
      typeof details?.browserPid === 'number' &&
      Number.isFinite(details.browserPid)
    ) {
      ready.browserPid = details.browserPid
    }
    const extensionId = String(details?.extensionId || '').trim()
    if (extensionId) ready.extensionId = extensionId
    const binary = String(details?.binary || '').trim()
    if (binary) ready.binary = binary
    const provenance = String(details?.binaryProvenance || '').trim()
    if (provenance) ready.binaryProvenance = provenance
    fs.writeFileSync(readyPath, JSON.stringify(ready, null, 2))
  } catch {
    // best-effort; never block launch on this
  }
}

// Publish the id the browser serves the extension under. Launch stamps the
// derived id; a later browser confirmation overwrites it when they disagree.
export function stampReadyExtensionId(
  extensionOutputPath: string | undefined,
  extensionId: string | undefined
) {
  try {
    const id = String(extensionId || '').trim()
    if (!extensionOutputPath || !id) return
    const readyPath = readyPathFor(extensionOutputPath)
    if (!fs.existsSync(readyPath)) return
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    if (ready.extensionId === id) return
    ready.extensionId = id
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

// Stamp a profile another live session already holds. The browser never starts,
// so without this the contract is indistinguishable from a browser that died.
export function stampReadyProfileLocked(
  extensionOutputPath: string | undefined,
  details: {message?: string; owner?: {host: string; pid: number}}
) {
  try {
    if (!extensionOutputPath) return
    const readyPath = readyPathFor(extensionOutputPath)
    if (!fs.existsSync(readyPath)) return
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    ready.status = 'error'
    ready.code = 'profile_locked'
    ready.message =
      String(details?.message || '').trim() ||
      'the browser profile is already in use by another session'
    ready.profileLockedAt = new Date().toISOString()
    if (details?.owner) ready.profileLockOwner = details.owner
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
