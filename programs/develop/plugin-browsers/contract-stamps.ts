// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {cdpFaultWarningCode, stripChannelPrefix} from '../lib/messaging'
import {renameSyncWithRetry} from '../lib/rename-with-retry'
import {readyContractPathBesideBuild} from '../lib/session-contract'

type ReadyRecord = Record<string, unknown>

// The plugin stamps only what its launcher cannot: a fault it saw after the
// launcher came back. Every stamp leaves a contract another process owns.
function updateContract(
  outputPath: string,
  update: (ready: ReadyRecord) => boolean
): void {
  try {
    if (!outputPath) return

    const readyPath = readyContractPathBesideBuild(path.resolve(outputPath))
    if (!fs.existsSync(readyPath)) return

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8')) as ReadyRecord
    if (typeof ready.pid === 'number' && ready.pid !== process.pid) return

    if (!update(ready)) return

    const tmpPath = `${readyPath}.tmp-${process.pid}`

    try {
      fs.writeFileSync(tmpPath, `${JSON.stringify(ready, null, 2)}\n`, 'utf-8')
      renameSyncWithRetry(tmpPath, readyPath)
    } catch {
      fs.rmSync(tmpPath, {force: true})
    }
  } catch {
    // Best-effort: a contract write never breaks the compile loop.
  }
}

// One plain line, the way the contract carries every reason.
export function contractReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')

  return stripChannelPrefix(message).replace(/\s+/g, ' ').trim()
}

// Nothing runs the extension, so the contract flips to the error a launcher
// writes for a browser that never started. A more specific verdict stands.
export function stampLaunchFailed(outputPath: string, error: unknown) {
  const code = (error as {code?: unknown} | null)?.code

  updateContract(outputPath, (ready) => {
    if (
      ready.status === 'error' &&
      ready.code &&
      ready.code !== 'browser_launch_failed'
    ) {
      return false
    }

    const detail =
      contractReason(error) || 'the browser process could not be started'

    ready.status = 'error'
    ready.code = 'browser_launch_failed'
    ready.ts = new Date().toISOString()
    ready.message = `the ${ready.browser || 'browser'} process could not start (${detail}), nothing is running`
    ready.browserLaunchFailedAt = ready.ts
    ready.browserLaunchFailedReason = detail

    if (typeof code === 'string' && code.startsWith('E_')) {
      ready.browserLaunchFailedCode = code
    } else {
      delete ready.browserLaunchFailedCode
    }

    return true
  })
}

// A launch the plugin stopped waiting for came up after all, so the failure
// it stamped comes off. A verdict the launcher wrote stays.
export function clearLaunchFailed(outputPath: string, code: string) {
  updateContract(outputPath, (ready) => {
    if (
      ready.code !== 'browser_launch_failed' ||
      ready.browserLaunchFailedCode !== code
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

// The browser runs and the session stays ready, so the fault reads under a
// warning name beside the status, the same field a CDP fault after launch uses.
export function stampLogCaptureFault(outputPath: string, error: unknown) {
  const code = (error as {code?: unknown} | null)?.code

  updateContract(outputPath, (ready) => {
    ready.cdpFaultCode = cdpFaultWarningCode(
      typeof code === 'string' ? code : ''
    )

    ready.cdpFaultMessage = `browser log capture failed: ${
      contractReason(error) || 'no reason given'
    }`

    return true
  })
}
