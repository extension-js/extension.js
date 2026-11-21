// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {CODES, stripChannelPrefix} from '../lib/messaging'
import {patchReadyRecord, type ReadyRecord} from '../lib/ready-contract-writer'
import {readyContractPathBesideBuild} from '../lib/session-contract'

const TIMEOUT_CODE = CODES.E_BROWSER_START_TIMEOUT

// Launchers stamp their own failures. A launch the done hook stopped waiting
// for never came back to stamp one, so that verdict alone is written here.
function updateContract(
  outputPath: string,
  update: (ready: ReadyRecord) => boolean
): void {
  try {
    if (!outputPath) return

    patchReadyRecord(
      readyContractPathBesideBuild(path.resolve(outputPath)),
      (ready) => {
        if (typeof ready.pid === 'number' && ready.pid !== process.pid) {
          return false
        }

        return update(ready)
      }
    )
  } catch {
    // Best-effort: a contract write never breaks the compile loop.
  }
}

// The same fields a launcher writes for a browser that never started, so a
// reader cannot tell the two writers apart. A more specific verdict stands.
export function stampLaunchTimedOut(outputPath: string, reason: string) {
  updateContract(outputPath, (ready) => {
    if (
      ready.status === 'error' &&
      ready.code &&
      ready.code !== 'browser_launch_failed'
    ) {
      return false
    }

    const detail = stripChannelPrefix(reason).replace(/\s+/g, ' ').trim()

    ready.status = 'error'
    ready.code = 'browser_launch_failed'
    ready.ts = new Date().toISOString()
    ready.message = `the ${ready.browser || 'browser'} process could not start (${detail}), nothing is running`
    ready.browserLaunchFailedAt = ready.ts
    ready.browserLaunchFailedReason = detail
    ready.browserLaunchFailedCode = TIMEOUT_CODE

    return true
  })
}

// The launch came up after all, so the timeout verdict comes off. A verdict a
// launcher wrote in the meantime stays.
export function clearLaunchTimedOut(outputPath: string) {
  updateContract(outputPath, (ready) => {
    if (
      ready.code !== 'browser_launch_failed' ||
      ready.browserLaunchFailedCode !== TIMEOUT_CODE
    ) {
      return false
    }

    ready.status = 'ready'
    ready.ts = new Date().toISOString()
    delete ready.code
    delete ready.message
    delete ready.browserLaunchFailedAt
    delete ready.browserLaunchFailedReason
    delete ready.browserLaunchFailedCode

    return true
  })
}

// The same fields the launcher writes for a capture that threw. The browser
// runs with the extension, so the status stays as it is.
export function stampLogCaptureTimedOut(outputPath: string, reason: string) {
  updateContract(outputPath, (ready) => {
    const detail = stripChannelPrefix(reason).replace(/\s+/g, ' ').trim()

    ready.cdpFaultCode = CODES.W_CDP_TIMEOUT
    ready.cdpFaultMessage = `browser log capture failed: ${detail}`

    return true
  })
}
