// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {stripChannelPrefix} from '../../helpers/messaging'
import {writeJsonAtomic} from './write-json-atomic'

// A run-only session loading a source folder keeps its contract under the
// project's dist, a place the loaded directory cannot name, so it claims it.
const ownedReadyPaths = new Map<string, string>()

export function claimReadyPath(
  extensionOutputPath: string | undefined,
  readyPath: string | undefined
) {
  if (!extensionOutputPath || !readyPath) return

  ownedReadyPaths.set(path.resolve(extensionOutputPath), readyPath)
}

export function readyPathFor(extensionOutputPath: string): string {
  return (
    ownedReadyPaths.get(path.resolve(extensionOutputPath)) ??
    path.join(
      path.dirname(extensionOutputPath),
      'extension-js',
      path.basename(extensionOutputPath),
      'ready.json'
    )
  )
}

// The run a stamp belongs to, read once when the browser launches. Every later
// stamp is evidence about THAT browser, so it has to name the run it came from.
export function readReadyRunId(
  extensionOutputPath: string | undefined
): string | undefined {
  try {
    if (!extensionOutputPath) return undefined

    const readyPath = readyPathFor(extensionOutputPath)
    if (!fs.existsSync(readyPath)) return undefined

    const runId = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))?.runId

    return typeof runId === 'string' && runId ? runId : undefined
  } catch {
    return undefined
  }
}

// A browser dying as the session restarts would otherwise stamp its exit onto
// the FRESH run's contract, failing a browser that is on screen.
function isForeignRun(ready: unknown, runId: string | undefined): boolean {
  if (!runId) return false

  const owner = (ready as {runId?: unknown})?.runId

  return typeof owner === 'string' && owner !== '' && owner !== runId
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
    writeJsonAtomic(readyPath, ready)
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
    // The pid we spawned, kept once the browser handed its session to another
    // process. browserPid names the live one, this one says where it came from.
    launcherPid?: number
    extensionId?: string
    // Which binary actually ran, and how it was chosen. This matters MOST for
    // the runs that did not name one: someone who passed --chromium-binary
    // already knows the path, while everyone else gets a browser the resolver
    // picked and has no way to see which. The card stays uniform, so this
    // contract is where that fact lives.
    binary?: string
    binaryProvenance?: 'managed' | 'pinned' | 'system' | 'snapshot'
  },
  runId?: string
) {
  try {
    if (!extensionOutputPath) return

    const readyPath = readyPathFor(extensionOutputPath)
    if (!fs.existsSync(readyPath)) return

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    if (isForeignRun(ready, runId)) return

    const profilePath = String(details?.profilePath || '').trim()
    if (profilePath) ready.profilePath = profilePath

    if (
      typeof details?.browserPid === 'number' &&
      Number.isFinite(details.browserPid)
    ) {
      ready.browserPid = details.browserPid
    }

    if (
      typeof details?.launcherPid === 'number' &&
      Number.isFinite(details.launcherPid)
    ) {
      ready.launcherPid = details.launcherPid
    }

    const extensionId = String(details?.extensionId || '').trim()
    if (extensionId) ready.extensionId = extensionId

    const binary = String(details?.binary || '').trim()
    if (binary) ready.binary = binary

    const provenance = String(details?.binaryProvenance || '').trim()
    if (provenance) ready.binaryProvenance = provenance

    // A browser that is running now outranks an earlier attempt that never
    // spawned one, so that verdict comes off along with its error status.
    if (typeof ready.browserLaunchFailedAt === 'string') {
      delete ready.browserLaunchFailedAt
      delete ready.browserLaunchFailedReason

      if (ready.code === 'browser_launch_failed') {
        ready.status = 'ready'
        delete ready.code
        delete ready.message
      }
    }

    writeJsonAtomic(readyPath, ready)
  } catch {
    // best-effort; never block launch on this
  }
}

// The reason a launch failed, as one plain line: a thrown human frame carries
// its glyph, colors and line breaks, none of which belong in the contract.
export function describeLaunchFailure(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String((error as {message?: unknown} | null)?.message ?? error ?? '')

  return stripChannelPrefix(message).replace(/\s+/g, ' ').trim()
}

// Stamp a launch that never produced a browser process: a spawn refusal, a
// missing binary, a bad pin. Nothing is running whatever the command, so the
// contract flips to error and names why. A more specific verdict already on
// the contract (a locked profile, a refused load) stands.
export function stampReadyBrowserLaunchFailed(
  extensionOutputPath: string | undefined,
  reason: string,
  runId?: string
) {
  try {
    if (!extensionOutputPath) return

    const readyPath = readyPathFor(extensionOutputPath)
    if (!fs.existsSync(readyPath)) return

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    if (isForeignRun(ready, runId)) return

    if (
      ready.status === 'error' &&
      ready.code &&
      ready.code !== 'browser_launch_failed'
    ) {
      return
    }

    const detail =
      String(reason || '').trim() || 'the browser process could not be started'

    ready.status = 'error'
    ready.code = 'browser_launch_failed'
    ready.message = `the ${ready.browser || 'browser'} process could not start (${detail}), nothing is running`
    ready.browserLaunchFailedAt = new Date().toISOString()
    ready.browserLaunchFailedReason = detail

    writeJsonAtomic(readyPath, ready)
  } catch {
    // best-effort, never block launch on this
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
    writeJsonAtomic(readyPath, ready)
  } catch {
    // best-effort; never block launch on this
  }
}

// Stamp a browser-side load refusal into ready.json. Unlike a browser exit this
// always flips to error: the session is running but the guest is not in it, and
// every other surface (stdout, logs) looks identical to a healthy run.
export function stampReadyExtensionLoadRefused(
  extensionOutputPath: string | undefined,
  reason: string,
  runId?: string
) {
  try {
    if (!extensionOutputPath) return

    const readyPath = readyPathFor(extensionOutputPath)
    if (!fs.existsSync(readyPath)) return

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    if (isForeignRun(ready, runId)) return

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

    writeJsonAtomic(readyPath, ready)
  } catch {
    // best-effort; never block launch on this
  }
}

// Stamp a profile another live session already holds. The browser never starts,
// so without this the contract is indistinguishable from a browser that died.
export function stampReadyProfileLocked(
  extensionOutputPath: string | undefined,
  details: {message?: string; owner?: {host: string; pid: number}},
  runId?: string
) {
  try {
    if (!extensionOutputPath) return

    const readyPath = readyPathFor(extensionOutputPath)
    if (!fs.existsSync(readyPath)) return

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    if (isForeignRun(ready, runId)) return

    ready.status = 'error'
    ready.code = 'profile_locked'
    ready.message =
      String(details?.message || '').trim() ||
      'the browser profile is already in use by another session'

    ready.profileLockedAt = new Date().toISOString()
    if (details?.owner) ready.profileLockOwner = details.owner

    writeJsonAtomic(readyPath, ready)
  } catch {
    // best-effort; never block launch on this
  }
}

// Stamp an unexpected browser exit into the session's ready.json so automation
// sees a browserless session. Run-only commands flip to error; dev keeps compile
// status, unless the browser left before the extension ever loaded, in which
// case ready would describe a session that never had anything running.
export function stampReadyBrowserExited(
  extensionOutputPath: string | undefined,
  code: number | null,
  signal: string | null = null,
  runId?: string,
  details: {beforeReady?: boolean} = {}
) {
  try {
    if (!extensionOutputPath) return

    const readyPath = readyPathFor(extensionOutputPath)
    if (!fs.existsSync(readyPath)) return

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    if (isForeignRun(ready, runId)) return

    ready.browserExitedAt = new Date().toISOString()
    ready.browserExitCode = code
    // A crash exits with no code and only a signal, so the signal is the one
    // clue the contract can carry about why the browser went.
    ready.browserExitSignal = signal

    const how =
      code == null && signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`

    if (ready.command === 'preview' || ready.command === 'start') {
      ready.status = 'error'
      ready.code = 'browser_exited'
      ready.message = `the ${ready.browser || 'browser'} process exited (${how}); nothing is running`
    } else if (details.beforeReady) {
      ready.status = 'error'
      ready.code = 'browser_exited'
      ready.message = `the ${ready.browser || 'browser'} process exited (${how}) before the extension loaded, nothing is running`
    }

    writeJsonAtomic(readyPath, ready)
  } catch {
    // best-effort; never throw from a close handler
  }
}
