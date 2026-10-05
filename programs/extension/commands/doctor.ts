// ██████╗  ██████╗  ██████╗████████╗ ██████╗ ██████╗
// ██╔══██╗██╔═══██╗██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗
// ██║  ██║██║   ██║██║        ██║   ██║   ██║██████╔╝
// ██║  ██║██║   ██║██║        ██║   ██║   ██║██╔══██╗
// ██████╔╝╚██████╔╝╚██████╗   ██║   ╚██████╔╝██║  ██║
// ╚═════╝  ╚═════╝  ╚═════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import path from 'node:path'
import type {Command} from 'commander'
import colors from 'pintor'
import {
  isPidAlive,
  pidStartedAtMs
} from '../browsers/browsers-lib/resolve-live-pid'
import {emulatorSessionRefusal} from '../helpers/emulator-session'
import {exitAfterDrain} from '../helpers/exit-after-drain'
import {loadExtensionDevelopBridgeModule} from '../helpers/extension-develop-runtime'
import {
  commandDescriptions,
  doctorHeader,
  doctorRemedy
} from '../helpers/messages'
import {CODES, ENVELOPE, type ErrorCode} from '../helpers/messaging'
import {isJsonOutput} from '../helpers/output-flag'
import {
  describeRspackPeerConflicts,
  describeUnreadableDependencies,
  engineRspackVersion,
  remedyRspackPeerConflicts,
  scanRspackPeers
} from '../helpers/rspack-peer-check'
import {
  resolveSessionProjectPath,
  sessionReadyPath
} from '../helpers/session-project-path'
import {SESSION_BROWSER_TARGETS_HELP} from '../helpers/vendors'

type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip'

// Which browser binary this session launched, and how it was chosen. doctor is
// the command whose job is answering "why did this behave unexpectedly", and
// "a different browser than you assumed" is a common answer. The identity card
// deliberately does not print this (it would differ machine to machine for
// reasons the reader cannot act on), so the contract is the source and doctor
// is where a human reads it back. Sessions started before these fields existed
// simply have nothing to append.
function binaryDetailSuffix(ready: {
  binary?: unknown
  binaryProvenance?: unknown
}): string {
  const binary = String(ready?.binary || '').trim()
  if (!binary) return ''

  const home = os.homedir()
  const shown =
    home && binary.startsWith(home + path.sep)
      ? `~${binary.slice(home.length)}`
      : binary
  const provenance = String(ready?.binaryProvenance || '').trim()

  return provenance ? `, ${shown} (${provenance})` : `, ${shown}`
}

/* @invariant Every check id doctor can emit is named here, once. The code
   table, contract/codes.json and the contract spec all read this list, so a
   check added without a documented error code fails the build, not a host. */
export const DOCTOR_CHECKS = [
  'session-resolution',
  'engine',
  'peer-rspack',
  'ready-contract',
  'server-process',
  'port-agreement',
  'control-channel',
  'eval-token',
  'executor',
  'browser'
] as const

export type DoctorCheck = (typeof DOCTOR_CHECKS)[number]

export interface DoctorCheckResult {
  check: DoctorCheck
  status: CheckStatus
  detail: string
  remediation?: string
}

// The session actually diagnosed, so the header, the rows and the json frame
// all name one browser.
export interface DoctorReport {
  browser: string
  checks: DoctorCheckResult[]
}

interface DoctorOptions {
  browser?: string
  output?: 'pretty' | 'json'
}

const CONNECT_TIMEOUT_MS = 5000
const PROBE_TIMEOUT_MS = 3000
const BROWSER_PROBE_TIMEOUT_MS = 1000
// A pid is not an identity: the number is recycled, so a contract that outlived
// its session names a pid some unrelated process holds by now.
const SERVER_IDENTITY_SKEW_MS = 60_000
// Right after a clean compile the SW has not connected yet; report warn during
// the grace window and only fail once it elapses with no attachment.
const EXECUTOR_ATTACH_GRACE_MS = 10_000

// True when the executor is merely still attaching after a fresh compile:
// within the grace window, no evidence the browser gave up.
function isExecutorAttachGrace(
  ready:
    | {
        executorAttachedAt?: unknown
        runtime?: unknown
        browserExitedAt?: unknown
        compiledAt?: unknown
        ts?: unknown
      }
    | null
    | undefined
): boolean {
  // Once the SW has attached, absence is a real regression, never a grace warn.
  if (ready?.executorAttachedAt || ready?.runtime === 'attached') return false
  // A browser that exited under a live server is a real failure, not launching.
  if (ready?.browserExitedAt) return false

  const stamp = ready?.compiledAt || ready?.ts
  if (typeof stamp !== 'string') return false

  const compiledMs = Date.parse(stamp)
  if (Number.isNaN(compiledMs)) return false

  return Date.now() - compiledMs < EXECUTOR_ATTACH_GRACE_MS
}

function readReadyDocument(readyPath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

// ready.json doubles as the receipt of a one-shot build, start or preview run,
// and a receipt names no server to dial: only a dev contract is a session.
function isDevSessionDocument(document: Record<string, unknown>): boolean {
  return document.command === 'dev'
}

function scanReadyContracts(projectPath: string): {
  sessions: string[]
  receipts: string[]
} {
  const sessionsRoot = path.join(projectPath, 'dist', 'extension-js')
  const sessions: string[] = []
  const receipts: string[] = []

  try {
    const browsers = fs
      .readdirSync(sessionsRoot, {withFileTypes: true})
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    for (const browser of browsers) {
      const document = readReadyDocument(
        path.join(sessionsRoot, browser, 'ready.json')
      )

      if (!document) continue

      if (isDevSessionDocument(document)) {
        sessions.push(browser)
      } else {
        receipts.push(browser)
      }
    }
  } catch {
    // Ignore
  }

  return {sessions, receipts}
}

function pickBrowser(candidates: string[]): string | undefined {
  if (candidates.includes('chromium')) return 'chromium'

  return candidates[0]
}

/* @invariant A bare `doctor` diagnoses the session that exists, not a
   hardcoded default: the dev contracts under dist/extension-js/ name the
   live browsers, a single contract wins outright, a build receipt never
   counts as a session, and chromium is only the fallback when nothing (or
   an ambiguous set) is found. */
export function resolveDoctorBrowser(
  projectPath: string | undefined,
  optsBrowser: string | undefined
): {browser: string; sessionBrowsers: string[]} {
  if (optsBrowser) return {browser: optsBrowser, sessionBrowsers: []}

  const {sessions, receipts} = scanReadyContracts(
    path.resolve(projectPath || process.cwd())
  )

  if (sessions.length === 1) {
    return {browser: sessions[0], sessionBrowsers: sessions}
  }

  return {
    browser: pickBrowser(sessions) ?? pickBrowser(receipts) ?? 'chromium',
    sessionBrowsers: sessions
  }
}

function peerRspackCheck(projectPath: string): DoctorCheckResult {
  const engine = engineRspackVersion(projectPath)

  if (!engine) {
    return {
      check: 'peer-rspack',
      status: 'skip',
      detail: `skipped: could not read the engine's @rspack/core version from ${projectPath}`
    }
  }

  const {conflicts, unreadable} = scanRspackPeers(projectPath, engine)
  const unverified = unreadable.length
    ? describeUnreadableDependencies(unreadable)
    : ''

  if (conflicts.length > 0) {
    return {
      check: 'peer-rspack',
      status: 'fail',
      detail:
        describeRspackPeerConflicts(conflicts, engine) +
        (unverified ? `. ${unverified}` : ''),
      remediation: remedyRspackPeerConflicts(conflicts, engine)
    }
  }

  if (unreadable.length > 0) {
    return {
      check: 'peer-rspack',
      status: 'warn',
      detail: unverified,
      remediation:
        'Install the project dependencies so their @rspack/core peer ' +
        'ranges can be read, then run doctor again'
    }
  }

  return {
    check: 'peer-rspack',
    status: 'pass',
    detail: `every direct dependency with an @rspack/core peer range accepts the engine's ${engine}`
  }
}

// Why the live pid cannot be this session's dev server, or null when it can.
function reusedPidEvidence(ready: {
  pid?: number
  startedAt?: string
}): string | null {
  const writtenAt = Date.parse(String(ready.startedAt ?? ''))
  if (Number.isNaN(writtenAt)) return null

  const startedAt = pidStartedAtMs(ready.pid)
  if (startedAt == null) return null

  return startedAt - writtenAt > SERVER_IDENTITY_SKEW_MS
    ? `it started ${new Date(startedAt).toISOString()}, after the contract's ${ready.startedAt}`
    : null
}

// Chromium stamps cdpPort, Gecko stamps rdpPort. A leg that reads only the
// first calls every Firefox session's browser unknown.
function debuggerPort(ready: {
  cdpPort?: number
  rdpPort?: number
}): {name: string; port: number} | undefined {
  if (typeof ready.cdpPort === 'number') {
    return {name: 'cdpPort', port: ready.cdpPort}
  }

  if (typeof ready.rdpPort === 'number') {
    return {name: 'rdpPort', port: ready.rdpPort}
  }

  return undefined
}

// Only a connection proves a debugger port is still served: the stamped number
// outlives the browser that opened it, including one the OS killed outright.
function probeDebuggerPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({host: '127.0.0.1', port})

    const answer = (answered: boolean) => {
      socket.destroy()
      resolve(answered)
    }

    socket.setTimeout(BROWSER_PROBE_TIMEOUT_MS)
    socket.once('connect', () => answer(true))
    socket.once('timeout', () => answer(false))
    socket.once('error', () => answer(false))
  })
}

// The browser leg's verdict: a live pid or an answering debugger port, never
// the mere presence of a stamped port.
async function browserCheck(ready: {
  browserPid?: number
  cdpPort?: number
  rdpPort?: number
  binary?: unknown
  binaryProvenance?: unknown
}): Promise<DoctorCheckResult> {
  const pid =
    typeof ready.browserPid === 'number' ? ready.browserPid : undefined
  const port = debuggerPort(ready)
  const label = port ? `${port.name} ${port.port}` : ''

  if (pid != null && isPidAlive(pid)) {
    return {
      check: 'browser',
      status: 'pass',
      detail: `browser running (pid ${pid}${port ? `, ${label}` : ''})${binaryDetailSuffix(ready)}`
    }
  }

  if (port && (await probeDebuggerPort(port.port))) {
    return {
      check: 'browser',
      status: 'pass',
      detail: `browser running (${label} answers)${binaryDetailSuffix(ready)}`
    }
  }

  if (pid != null || port) {
    return {
      check: 'browser',
      status: 'fail',
      detail:
        `no live browser: ${pid != null ? `pid ${pid} is gone` : 'no browserPid stamped'}` +
        `${port ? ` and nothing answers ${label}` : ' and no debugger port stamped'}` +
        binaryDetailSuffix(ready),
      remediation: 'Restart the dev session to relaunch the browser'
    }
  }

  // Absence of exit evidence is not evidence of a live browser: with nothing to
  // probe the leg is unknown, never a green verdict over a possibly-dead browser.
  return {
    check: 'browser',
    status: 'skip',
    detail: `browser liveness unknown (no browserPid or debugger port stamped yet and no exit recorded)${binaryDetailSuffix(ready)}`,
    remediation:
      'If the browser should be up, wait for launch to finish or restart the dev session'
  }
}

export async function runDoctor(
  projectPathArg: string | undefined,
  opts: DoctorOptions
): Promise<DoctorReport> {
  const bridge = await loadExtensionDevelopBridgeModule()
  const projectPath = resolveSessionProjectPath(bridge, projectPathArg)
  const {browser, sessionBrowsers} = resolveDoctorBrowser(
    projectPath,
    opts.browser
  )
  const results: DoctorCheckResult[] = []

  if (sessionBrowsers.length > 1) {
    results.push({
      check: 'session-resolution',
      status: 'warn',
      detail: `multiple live sessions found (${sessionBrowsers.join(', ')}), diagnosing ${browser}`,
      remediation: 'Pass --browser=<name> to diagnose a specific session'
    })
  }

  const emulatorRefusal = emulatorSessionRefusal(
    bridge,
    projectPath,
    browser,
    'doctor'
  )

  if (emulatorRefusal) {
    results.push({check: 'engine', status: 'fail', detail: emulatorRefusal})

    return {browser, checks: results}
  }

  // 0. peer-rspack needs only the project, so it runs before the session legs.
  // A dependency whose @rspack/core peer range misses the engine is why
  // `npm install` fails with ERESOLVE next to Extension.js.
  results.push(peerRspackCheck(projectPath))

  const skip = (check: DoctorCheck, blockedBy: string) => {
    results.push({
      check,
      status: 'skip',
      detail: `skipped: blocked by ${blockedBy}`
    })
  }

  const {
    BridgeController,
    readReadyContract,
    readControlToken,
    readPersistedControlPort,
    controlPortFilePath
  } = bridge

  const readyPath = sessionReadyPath(bridge, projectPath, browser)
  const document = readReadyDocument(readyPath)
  const receipt = document && !isDevSessionDocument(document)
  const ready = receipt ? null : readReadyContract(projectPath, browser)

  if (!ready) {
    results.push({
      check: 'ready-contract',
      status: 'fail',
      detail: receipt
        ? `no dev session for ${browser}: ${readyPath} is the receipt of an ` +
          `extension ${String(document?.command ?? 'build')} run, not a session contract`
        : `no ready contract at ${readyPath}`,
      remediation:
        `Start a dev session first: extension dev --browser=${browser} ` +
        `--allow-control (add --allow-eval for the eval verb)`
    })

    for (const check of [
      'server-process',
      'port-agreement',
      'control-channel',
      'eval-token',
      'executor',
      'browser'
    ] as const) {
      skip(check, 'ready-contract')
    }

    return {browser, checks: results}
  }

  if (ready.status === 'ready') {
    results.push({
      check: 'ready-contract',
      status: 'pass',
      detail: `status ready, controlPort ${ready.controlPort}, instanceId ${ready.instanceId}${ready.ts ? `, written ${ready.ts}` : ''}`
    })
  } else {
    results.push({
      check: 'ready-contract',
      status: 'fail',
      detail: `contract status is '${ready.status ?? 'unknown'}', not 'ready'`,
      remediation:
        'The session is still starting or errored, wait for it ' +
        '(extension dev --wait) or check the dev-server output'
    })
  }

  let serverAlive = true

  if (ready.pid == null) {
    results.push({
      check: 'server-process',
      status: 'skip',
      detail:
        'skipped: contract has no pid (session started by an older extension-develop)'
    })
  } else {
    // A live pid is only half the evidence: the other half is that it is still
    // the process the contract was written by.
    const stale = isPidAlive(ready.pid)
      ? reusedPidEvidence(ready)
      : 'the process is gone'

    if (stale) {
      serverAlive = false
      results.push({
        check: 'server-process',
        status: 'fail',
        detail: `dev-server pid ${ready.pid} is stale (${stale}), ready.json no longer names a live session`,
        remediation:
          'A previous dev session died uncleanly; restart it: ' +
          `extension dev --browser=${browser} --allow-control`
      })
    } else {
      results.push({
        check: 'server-process',
        status: 'pass',
        detail: `dev-server pid ${ready.pid} is alive`
      })
    }
  }

  // 3. port-agreement, still meaningful when the server is dead: a mismatch
  // predicts the next restart's stale-SW strand (#484 precondition).
  if (
    typeof readPersistedControlPort !== 'function' ||
    typeof controlPortFilePath !== 'function'
  ) {
    results.push({
      check: 'port-agreement',
      status: 'skip',
      detail:
        'skipped: installed extension-develop does not expose the persisted control port'
    })
  } else {
    const persisted = readPersistedControlPort(
      controlPortFilePath(projectPath, browser)
    )

    if (persisted == null) {
      results.push({
        check: 'port-agreement',
        status: 'pass',
        detail:
          'no persisted control-port file (first session for this project+browser)'
      })
    } else if (persisted === ready.controlPort) {
      results.push({
        check: 'port-agreement',
        status: 'pass',
        detail: `persisted port ${persisted} matches the live contract`
      })
    } else {
      results.push({
        check: 'port-agreement',
        status: 'fail',
        detail: `persisted port ${persisted} != contract port ${ready.controlPort}`,
        remediation:
          "A profile's cached service worker may dial the old port and never " +
          'connect; restart the dev session (it prefers the persisted port)'
      })
    }
  }

  const token = readControlToken(projectPath, browser) ?? undefined

  if (!serverAlive) {
    skip('control-channel', 'server-process')
    skip('eval-token', 'control-channel')
    skip('executor', 'control-channel')
  } else {
    const controller = new BridgeController({
      controlPort: ready.controlPort,
      instanceId: ready.instanceId,
      token,
      connectTimeoutMs: CONNECT_TIMEOUT_MS
    })

    let readyFrame: {capabilities?: {eval?: unknown}} | null = null

    try {
      readyFrame = await controller.connect()
      results.push({
        check: 'control-channel',
        status: 'pass',
        detail: `connected, capabilities: ${JSON.stringify(readyFrame?.capabilities ?? {})}`
      })
    } catch (err) {
      const message = String((err as Error | undefined)?.message || err)
      const code = /code (\d+)/.exec(message)?.[1]
      let detail = message
      let remediation =
        'The control server did not answer on the contract port, the ' +
        'session may have died or the port was taken; restart the dev session'

      if (code === '4001') {
        detail =
          'refused: ready.json instanceId no longer matches the live server'

        remediation =
          'A newer session overwrote the contract, or this dist belongs to ' +
          'another session, re-read ready.json or restart the dev session'
      } else if (code === '4003') {
        // The instanceId matched, so this is the session itself with control
        // off, not a stale server answering the port.
        detail = 'refused: control is off in the session that answered'
        remediation = `Restart with control enabled: extension dev --browser=${browser} --allow-control`
      }

      results.push({
        check: 'control-channel',
        status: 'fail',
        detail,
        remediation
      })

      skip('eval-token', 'control-channel')
      skip('executor', 'control-channel')
    }

    if (readyFrame) {
      if (readyFrame.capabilities?.eval) {
        if (token) {
          results.push({
            check: 'eval-token',
            status: 'pass',
            detail: 'eval enabled and the session token is readable'
          })
        } else {
          results.push({
            check: 'eval-token',
            status: 'fail',
            detail:
              'eval is enabled but no session token could be read under .extension-js/',
            remediation:
              'Run from the same project root the dev session was started ' +
              'in, or restart the session with --allow-eval to rewrite the token'
          })
        }
      } else {
        results.push({
          check: 'eval-token',
          status: 'pass',
          detail: 'eval disabled (--allow-eval not set), nothing to verify'
        })
      }

      // 6. executor, any ROUTED result (even an in-SW error) proves the
      // executor is alive; Unavailable (absent) and Timeout (silent) do not.
      try {
        const probe = await controller.command({
          op: 'storage.get',
          target: {context: 'background'},
          args: {area: 'local'},
          timeoutMs: PROBE_TIMEOUT_MS
        })

        const unanswered =
          !probe.ok &&
          (probe.error?.name === 'Unavailable' ||
            probe.error?.name === 'Timeout')

        if (!unanswered) {
          results.push({
            check: 'executor',
            status: 'pass',
            detail: probe.ok
              ? 'executor responded to a storage probe'
              : `executor responded (probe errored in-extension: ${probe.error?.message ?? 'unknown'})`
          })
        } else if (probe.error?.name === 'Timeout') {
          results.push({
            check: 'executor',
            status: 'fail',
            detail:
              'executor did not answer a storage probe within ' +
              `${PROBE_TIMEOUT_MS / 1000}s; the service worker is connected ` +
              'but not responding',
            remediation:
              'Reload the extension, or restart the dev session if it stays silent'
          })
        } else if (isExecutorAttachGrace(ready)) {
          results.push({
            check: 'executor',
            status: 'warn',
            detail:
              'no executor connected yet. The browser is still launching ' +
              `(within ${EXECUTOR_ATTACH_GRACE_MS / 1000}s of compile); the ` +
              'service worker has not attached',
            remediation:
              'Give it a moment: wait for ready.json to gain ' +
              '`runtime: "attached"` before acting, or re-run doctor shortly'
          })
        } else {
          results.push({
            check: 'executor',
            status: 'fail',
            detail: probe.error?.message ?? 'no executor connected',
            remediation:
              'The message above names the likely cause; retry shortly, ' +
              'then reload the extension or restart the dev session'
          })
        }
      } catch (err) {
        if (isExecutorAttachGrace(ready)) {
          results.push({
            check: 'executor',
            status: 'warn',
            detail:
              'executor probe did not complete yet. The browser is still ' +
              `launching (within ${EXECUTOR_ATTACH_GRACE_MS / 1000}s of compile)`,
            remediation:
              'Give it a moment: wait for ready.json to gain ' +
              '`runtime: "attached"` before acting, or re-run doctor shortly'
          })
        } else {
          results.push({
            check: 'executor',
            status: 'fail',
            detail: `probe did not complete: ${String((err as Error | undefined)?.message || err)}`,
            remediation:
              'Retry shortly; if it persists reload the extension or restart the dev session'
          })
        }
      }
    }

    controller.close()
  }

  // 7. browser, needs only the contract, runs even when 4-6 were skipped.
  if (ready.browserExitedAt) {
    results.push({
      check: 'browser',
      status: 'fail',
      detail: `browser exited at ${ready.browserExitedAt}${ready.browserExitCode != null ? ` (code ${ready.browserExitCode})` : ''} while the dev server kept running${binaryDetailSuffix(ready)}`,
      remediation: 'Restart the dev session to relaunch the browser'
    })
  } else {
    results.push(await browserCheck(ready))
  }

  return {browser, checks: results}
}

function checkGlyph(status: CheckStatus): string {
  if (status === 'pass') return colors.green('✓')
  if (status === 'fail') return colors.red('✗')
  if (status === 'warn') return colors.brightYellow('!')

  return colors.gray('–')
}

// The header names the session the rows describe, so it reads the report's own
// browser rather than resolving the raw argument a second time.
function printPretty({browser, checks: results}: DoctorReport): void {
  const passes = results.filter((r) => r.status === 'pass').length
  // eslint-disable-next-line no-console
  console.log(doctorHeader(browser, passes, results.length))
  const width = Math.max(...results.map((r) => r.check.length))

  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(
      `  ${checkGlyph(r.status)} ${r.check.padEnd(width)}  ${r.detail}`
    )
  }

  const advisory =
    results.find((r) => r.status === 'fail') ??
    results.find((r) => r.status === 'warn')

  if (advisory?.remediation) {
    // eslint-disable-next-line no-console
    console.log(doctorRemedy(advisory.check, advisory.remediation))
  }
}

// A failing check is the only thing the frame can name, so the first failure
// decides error.code. E_DOCTOR_CHECKS_FAILED covers the rest: a check with no
// dominant cause is still a failed run, not an unmapped one.
export const DOCTOR_CHECK_CODES: Record<DoctorCheck, ErrorCode> = {
  'session-resolution': CODES.E_INSTANCE_AMBIGUOUS,
  engine: CODES.E_COMMAND_UNSUPPORTED_FOR_TARGET,
  'peer-rspack': CODES.E_DEPENDENCY_INSTALL,
  'ready-contract': CODES.E_SESSION_NOT_FOUND,
  'server-process': CODES.E_SESSION_NOT_FOUND,
  'port-agreement': CODES.E_CONTROL_UNAVAILABLE,
  'control-channel': CODES.E_CONTROL_UNAVAILABLE,
  'eval-token': CODES.E_TOKEN_MISSING,
  executor: CODES.E_CONTROL_UNAVAILABLE,
  browser: CODES.E_BROWSER_LAUNCH
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .argument(
      '[project-path]',
      'path to the extension project root or the folder holding its manifest'
    )
    .option(
      `--browser <${SESSION_BROWSER_TARGETS_HELP}>`,
      'which session to diagnose (defaults to the single live session, else chromium)'
    )
    .option(
      '--output <pretty|json>',
      'result format. Use json for a schema-1 envelope on stdout'
    )
    .description(commandDescriptions.doctor)
    .action(async (projectPathArg: string | undefined, opts: DoctorOptions) => {
      const asJson = isJsonOutput(opts)
      let report: DoctorReport

      try {
        report = await runDoctor(projectPathArg, opts)
      } catch (err) {
        const message = String((err as Error | undefined)?.message || err)

        if (asJson) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify(
              ENVELOPE.fail('doctor', 'failed', {
                code: CODES.E_INTERNAL,
                message
              })
            )
          )
        } else {
          // eslint-disable-next-line no-console
          console.error(message)
        }

        await exitAfterDrain(1)

        return
      }

      const failed = report.checks.filter((r) => r.status === 'fail')

      if (asJson) {
        // The checks list is the payload on both verdicts: an unhealthy report
        // is still a report, so `value` rides along with the error. The
        // diagnosed session rides beside it, never inside the list a host maps.
        const frame = failed.length
          ? ENVELOPE.fail(
              'doctor',
              'unhealthy',
              {
                code:
                  DOCTOR_CHECK_CODES[failed[0].check] ||
                  CODES.E_DOCTOR_CHECKS_FAILED,
                message: `${failed.length} of ${report.checks.length} doctor checks failed.`
              },
              {
                value: report.checks,
                hint: failed[0].remediation,
                browser: report.browser
              }
            )
          : ENVELOPE.ok('doctor', 'healthy', report.checks, {
              browser: report.browser
            })
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(frame))
      } else {
        printPretty(report)
      }

      await exitAfterDrain(failed.length ? 1 : 0)
    })
}
