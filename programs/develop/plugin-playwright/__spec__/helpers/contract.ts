import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {
  createPlaywrightMetadataWriter,
  type PlaywrightPlugin
} from '../../index'

export type WriterOptions = Parameters<typeof createPlaywrightMetadataWriter>[0]
export type Contract = Record<string, unknown>

// A dev writer for chromium under projectDir, the shape most specs start from.
export function makeWriter(
  projectDir: string,
  overrides: Partial<WriterOptions> = {}
) {
  const browser = overrides.browser ?? 'chromium'

  return createPlaywrightMetadataWriter({
    packageJsonDir: projectDir,
    browser,
    command: 'dev',
    distPath: path.join(projectDir, 'dist', browser),
    manifestPath: path.join(projectDir, 'src', 'manifest.json'),
    ...overrides
  })
}

export function contractPath(projectDir: string, browser = 'chromium') {
  return path.join(projectDir, 'dist', 'extension-js', browser, 'ready.json')
}

export function readContract(readyPath: string): Contract {
  return JSON.parse(fs.readFileSync(readyPath, 'utf-8')) as Contract
}

// A hand edit that no launcher stamp makes: another run's id, a live pid.
export function patchContract(readyPath: string, patch: Contract) {
  fs.writeFileSync(
    readyPath,
    JSON.stringify({...readContract(readyPath), ...patch})
  )
}

export function readEvents(eventsPath: string): Contract[] {
  return fs
    .readFileSync(eventsPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Contract)
}

export function writeManifest(dir: string, manifest: Contract) {
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
}

type Tap = (arg?: unknown) => void
export type CompilerTaps = Record<
  'compile' | 'done' | 'failed' | 'watchClose',
  Tap
>

// The four hooks the plugin taps, captured so a spec can fire them by hand.
export function applyToFakeCompiler(plugin: PlaywrightPlugin): CompilerTaps {
  const taps: Partial<CompilerTaps> = {}
  const hook = (name: keyof CompilerTaps) => ({
    tap: (_pluginName: string, fn: Tap) => {
      taps[name] = fn
    }
  })

  plugin.apply({
    hooks: {
      compile: hook('compile'),
      done: hook('done'),
      failed: hook('failed'),
      watchClose: hook('watchClose')
    }
  } as unknown as Compiler)

  return taps as CompilerTaps
}

// What the done hook reads off rspack's stats, and nothing more.
export function doneStats(errors: Array<{message: string}> = []) {
  return {
    compilation: {startTime: 0, endTime: 25},
    hasErrors: () => errors.length > 0,
    toJson: () => ({errors})
  }
}

// Stand-ins for the stamps of the same name in
// programs/extension/browsers/browsers-lib/ready-stamp.ts. None releases a held
// contract the way the real port and fault stamps do.

// Start times are passed in: the real stamp asks the
// process table, and only for a pid it has not stamped before.
export function stampReadyBrowserLaunch(
  readyPath: string,
  fields: {
    profilePath?: string
    profileReused?: boolean
    browserPid?: number
    browserStartedAt?: string
    launcherPid?: number
    launcherStartedAt?: string
    binary?: string
    binaryProvenance?: 'managed' | 'pinned' | 'system' | 'snapshot'
    binaryPinnedBy?: string
  }
) {
  patchContract(readyPath, fields)
}

export function stampReadyCdpPort(readyPath: string, cdpPort: number) {
  patchContract(readyPath, {cdpPort})
}

export function stampReadyRdpPort(readyPath: string, rdpPort: number) {
  patchContract(readyPath, {rdpPort})
}

export function stampReadyRdpPortError(
  readyPath: string,
  rdpPortError: string
) {
  patchContract(readyPath, {rdpPortError})
}

export function stampReadyCdpFault(
  readyPath: string,
  cdpFaultCode: string,
  cdpFaultMessage?: string
) {
  patchContract(readyPath, {
    cdpFaultCode,
    ...(cdpFaultMessage ? {cdpFaultMessage} : {})
  })
}

export function stampReadyWebDriver(
  readyPath: string,
  fields: {
    webdriverPort?: number
    webdriverSessionId?: string
    webdriverUnavailableReason?: string
    webdriverRequestPath?: string
  }
) {
  patchContract(readyPath, fields)
}

export function stampReadyStartingUrl(
  readyPath: string,
  fields: {
    startingUrl: string
    startingUrlOpened: boolean
    startingUrlUnopenedReason?: string
  }
) {
  patchContract(readyPath, fields)
}

export function stampReadyBrowserUpNotAttached(
  readyPath: string,
  fields: {
    browserUpNotAttachedAt: string
    browserUpNotAttachedWaitMs?: number
    browserUpNotAttachedHint?: string
  }
) {
  patchContract(readyPath, fields)
}

// status, code and message are what the stamp flips.
export function stampReadyBrowserLaunchFailed(
  readyPath: string,
  fields: {
    status?: 'error'
    code?: 'browser_launch_failed'
    message?: string
    browserLaunchFailedAt?: string
    browserLaunchFailedReason?: string
    browserLaunchFailedCode?: string
  }
) {
  patchContract(readyPath, fields)
}

// status, code and message flip only before ready or
// under preview and start.
export function stampReadyBrowserExited(
  readyPath: string,
  fields: {
    status?: 'error'
    code?: 'browser_exited'
    message?: string
    browserExitedAt: string
    browserExitCode: number | null
    browserExitSignal: string | null
  }
) {
  patchContract(readyPath, fields)
}

export function stampReadyExtensionId(readyPath: string, extensionId: string) {
  patchContract(readyPath, {extensionId, extensionIdSource: 'browser'})
}

// Like the real stamp, a forecast id comes off with it.
export function stampReadyExtensionLoadRefused(
  readyPath: string,
  fields: {
    status?: 'error'
    code?: 'extension_load_refused'
    message?: string
    extensionLoadRefusedAt: string
    extensionLoadRefusedReason?: string
    extensionLoadRefusedCause?: string
  }
) {
  const contract: Contract = {...readContract(readyPath), ...fields}

  if (contract.extensionIdSource !== 'browser') {
    delete contract.extensionId
    delete contract.extensionIdSource
  }

  fs.writeFileSync(readyPath, JSON.stringify(contract))
}

type DevAdditionEntry = {
  kind: string
  value: string
  applied?: boolean
  reason?: string
}

function appendDevAddition(readyPath: string, entry: DevAdditionEntry) {
  const earlier = readContract(readyPath).devAdditions
  patchContract(readyPath, {
    devAdditions: [...(Array.isArray(earlier) ? earlier : []), entry]
  })
}

export function stampReadyDevBrowserFlag(
  readyPath: string,
  entry: DevAdditionEntry
) {
  appendDevAddition(readyPath, {...entry, kind: 'browser_flag'})
}

export function stampReadyDevBrowserPreference(
  readyPath: string,
  entry: DevAdditionEntry
) {
  appendDevAddition(readyPath, {...entry, kind: 'browser_preference'})
}
