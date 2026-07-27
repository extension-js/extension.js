// ██████╗  ██████╗  ██████╗████████╗ ██████╗ ██████╗
// ██╔══██╗██╔═══██╗██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗
// ██║  ██║██║   ██║██║        ██║   ██║   ██║██████╔╝
// ██║  ██║██║   ██║██║        ██║   ██║   ██║██╔══██╗
// ██████╔╝╚██████╔╝╚██████╗   ██║   ╚██████╔╝██║  ██║
// ╚═════╝  ╚═════╝  ╚═════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import path from 'node:path'
import type {Command} from 'commander'
import {exitAfterDrain} from '../helpers/exit-after-drain'
import {loadExtensionDevelopBridgeModule} from '../helpers/extension-develop-runtime'
import {commandDescriptions} from '../helpers/messages'
import {CODES, ENVELOPE, type ErrorCode} from '../helpers/messaging'

type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip'

export interface DoctorCheckResult {
  check: string
  status: CheckStatus
  detail: string
  remediation?: string
}

interface DoctorOptions {
  browser?: string
  output?: 'pretty' | 'json'
}

const CONNECT_TIMEOUT_MS = 5000
const PROBE_TIMEOUT_MS = 3000
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

/**
 * Walks the control-channel legs in dependency order and reports the first
 * failing one with a remediation, instead of the dead-end errors each verb
 * gives on its own. Checks keep running past a failure wherever the answer
 * is still meaningful (a skip always names the check that blocked it, a
 * skip is NOT a pass).
 */
export async function runDoctor(
  projectPathArg: string | undefined,
  opts: DoctorOptions
): Promise<DoctorCheckResult[]> {
  const projectPath = path.resolve(projectPathArg || process.cwd())
  const browser = opts.browser || 'chromium'
  const results: DoctorCheckResult[] = []
  const skip = (check: string, blockedBy: string) => {
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
  } = await loadExtensionDevelopBridgeModule()

  const ready = readReadyContract(projectPath, browser)
  if (!ready) {
    results.push({
      check: 'ready-contract',
      status: 'fail',
      detail: `no ready contract at dist/extension-js/${browser}/ready.json`,
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
    ]) {
      skip(check, 'ready-contract')
    }
    return results
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
    let alive = true
    try {
      process.kill(ready.pid, 0)
    } catch (err) {
      alive = (err as NodeJS.ErrnoException | undefined)?.code === 'EPERM'
    }
    if (alive) {
      results.push({
        check: 'server-process',
        status: 'pass',
        detail: `dev-server pid ${ready.pid} is alive`
      })
    } else {
      serverAlive = false
      results.push({
        check: 'server-process',
        status: 'fail',
        detail: `dev-server pid ${ready.pid} is dead, ready.json is stale`,
        remediation:
          'A previous dev session died uncleanly; restart it: ' +
          `extension dev --browser=${browser} --allow-control`
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
        detail = 'refused: session was not started with --allow-control'
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
      // executor is alive; only Unavailable/timeout means it is absent.
      try {
        const probe = await controller.command({
          op: 'storage.get',
          target: {context: 'background'},
          args: {area: 'local'},
          timeoutMs: PROBE_TIMEOUT_MS
        })
        if (probe.ok || probe.error?.name !== 'Unavailable') {
          results.push({
            check: 'executor',
            status: 'pass',
            detail: probe.ok
              ? 'executor responded to a storage probe'
              : `executor responded (probe errored in-extension: ${probe.error?.message ?? 'unknown'})`
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
      detail: `browser exited at ${ready.browserExitedAt}${ready.browserExitCode != null ? ` (code ${ready.browserExitCode})` : ''} while the dev server kept running`,
      remediation: 'Restart the dev session to relaunch the browser'
    })
  } else if (ready.cdpPort != null) {
    results.push({
      check: 'browser',
      status: 'pass',
      detail: `browser running (cdpPort ${ready.cdpPort})`
    })
  } else {
    // Absence of exit evidence is not evidence of a live browser: with no cdpPort
    // stamped the leg is unknown, never a green verdict over a possibly-dead browser.
    results.push({
      check: 'browser',
      status: 'skip',
      detail:
        'browser liveness unknown (no cdpPort stamped yet and no exit recorded)',
      remediation:
        'If the browser should be up, wait for launch to finish or restart the dev session'
    })
  }

  return results
}

function printPretty(results: DoctorCheckResult[], browser: string): void {
  const passes = results.filter((r) => r.status === 'pass').length
  const glyph: Record<CheckStatus, string> = {
    pass: '✓',
    fail: '✗',
    warn: '!',
    skip: '–'
  }
  // eslint-disable-next-line no-console
  console.log(`doctor (${browser}), ${passes}/${results.length} checks passed`)
  const width = Math.max(...results.map((r) => r.check.length))
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(`  ${glyph[r.status]} ${r.check.padEnd(width)}  ${r.detail}`)
  }
  const advisory =
    results.find((r) => r.status === 'fail') ??
    results.find((r) => r.status === 'warn')
  if (advisory?.remediation) {
    // eslint-disable-next-line no-console
    console.log(`\n${advisory.check}: ${advisory.remediation}`)
  }
}

// A failing check is the only thing the frame can name, so the first failure
// decides error.code. E_DOCTOR_CHECKS_FAILED covers the rest: a check with no
// dominant cause is still a failed run, not an unmapped one.
const CHECK_CODES: Record<string, ErrorCode> = {
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
    .argument('[project-path]', 'path to the extension project root')
    .option(
      '--browser <chrome | chromium | edge | firefox>',
      'which session to diagnose (default chromium)'
    )
    .option(
      '--output <pretty|json>',
      'result format. Use json for a schema-1 envelope on stdout'
    )
    .description(commandDescriptions.doctor)
    .action(async (projectPathArg: string | undefined, opts: DoctorOptions) => {
      const asJson = opts.output === 'json'
      let results: DoctorCheckResult[]

      try {
        results = await runDoctor(projectPathArg, opts)
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

      const failed = results.filter((r) => r.status === 'fail')

      if (asJson) {
        // The checks list is the payload on both verdicts: an unhealthy report
        // is still a report, so `value` rides along with the error.
        const frame = failed.length
          ? ENVELOPE.fail(
              'doctor',
              'unhealthy',
              {
                code:
                  CHECK_CODES[failed[0].check] || CODES.E_DOCTOR_CHECKS_FAILED,
                message: `${failed.length} of ${results.length} doctor checks failed.`
              },
              {value: results, hint: failed[0].remediation}
            )
          : ENVELOPE.ok('doctor', 'healthy', results)
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(frame))
      } else {
        printPretty(results, opts.browser || 'chromium')
      }

      await exitAfterDrain(failed.length ? 1 : 0)
    })
}
