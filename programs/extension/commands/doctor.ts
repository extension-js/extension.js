// ██████╗  ██████╗  ██████╗████████╗ ██████╗ ██████╗
// ██╔══██╗██╔═══██╗██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗
// ██║  ██║██║   ██║██║        ██║   ██║   ██║██████╔╝
// ██║  ██║██║   ██║██║        ██║   ██║   ██║██╔══██╗
// ██████╔╝╚██████╔╝╚██████╗   ██║   ╚██████╔╝██║  ██║
// ╚═════╝  ╚═════╝  ╚═════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import path from 'path'
import type {Command} from 'commander'
import {loadExtensionDevelopBridgeModule} from '../helpers/extension-develop-runtime'

type CheckStatus = 'pass' | 'fail' | 'skip'

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

/**
 * Walks the control-channel legs in dependency order and reports the first
 * failing one with a remediation, instead of the dead-end errors each verb
 * gives on its own. Checks keep running past a failure wherever the answer
 * is still meaningful (a skip always names the check that blocked it — a
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
  }: any = await loadExtensionDevelopBridgeModule()

  // 1. ready-contract
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
      detail: `status ready — controlPort ${ready.controlPort}, instanceId ${ready.instanceId}${ready.ts ? `, written ${ready.ts}` : ''}`
    })
  } else {
    results.push({
      check: 'ready-contract',
      status: 'fail',
      detail: `contract status is '${ready.status ?? 'unknown'}', not 'ready'`,
      remediation:
        'The session is still starting or errored — wait for it ' +
        '(extension dev --wait) or check the dev-server output'
    })
  }

  // 2. server-process
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
    } catch (err: any) {
      alive = err?.code === 'EPERM'
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
        detail: `dev-server pid ${ready.pid} is dead — ready.json is stale`,
        remediation:
          'A previous dev session died uncleanly; restart it: ' +
          `extension dev --browser=${browser} --allow-control`
      })
    }
  }

  // 3. port-agreement — still meaningful when the server is dead: a mismatch
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

  // 4-6. control-channel, eval-token, executor
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

    let readyFrame: any = null
    try {
      readyFrame = await controller.connect()
      results.push({
        check: 'control-channel',
        status: 'pass',
        detail: `connected — capabilities: ${JSON.stringify(readyFrame.capabilities ?? {})}`
      })
    } catch (err: any) {
      const message = String(err?.message || err)
      const code = /code (\d+)/.exec(message)?.[1]
      let detail = message
      let remediation =
        'The control server did not answer on the contract port — the ' +
        'session may have died or the port was taken; restart the dev session'
      if (code === '4001') {
        detail = 'refused: ready.json instanceId no longer matches the live server'
        remediation =
          'A newer session overwrote the contract, or this dist belongs to ' +
          'another session — re-read ready.json or restart the dev session'
      } else if (code === '4003') {
        detail = 'refused: session was not started with --allow-control'
        remediation = `Restart with control enabled: extension dev --browser=${browser} --allow-control`
      }
      results.push({check: 'control-channel', status: 'fail', detail, remediation})
      skip('eval-token', 'control-channel')
      skip('executor', 'control-channel')
    }

    if (readyFrame) {
      // 5. eval-token
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
          detail: 'eval disabled (--allow-eval not set) — nothing to verify'
        })
      }

      // 6. executor — any ROUTED result (even an in-SW error) proves the
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
      } catch (err: any) {
        results.push({
          check: 'executor',
          status: 'fail',
          detail: `probe did not complete: ${String(err?.message || err)}`,
          remediation:
            'Retry shortly; if it persists reload the extension or restart the dev session'
        })
      }
    }

    controller.close()
  }

  // 7. browser — needs only the contract, runs even when 4-6 were skipped.
  if (ready.browserExitedAt) {
    results.push({
      check: 'browser',
      status: 'fail',
      detail: `browser exited at ${ready.browserExitedAt}${ready.browserExitCode != null ? ` (code ${ready.browserExitCode})` : ''} while the dev server kept running`,
      remediation: 'Restart the dev session to relaunch the browser'
    })
  } else {
    results.push({
      check: 'browser',
      status: 'pass',
      detail:
        ready.cdpPort != null
          ? `browser running (cdpPort ${ready.cdpPort})`
          : 'no browser exit recorded (cdpPort not yet stamped)'
    })
  }

  return results
}

function printPretty(results: DoctorCheckResult[], browser: string): void {
  const passes = results.filter((r) => r.status === 'pass').length
  const glyph: Record<CheckStatus, string> = {
    pass: '✓',
    fail: '✗',
    skip: '–'
  }
  // eslint-disable-next-line no-console
  console.log(`doctor (${browser}) — ${passes}/${results.length} checks passed`)
  const width = Math.max(...results.map((r) => r.check.length))
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(`  ${glyph[r.status]} ${r.check.padEnd(width)}  ${r.detail}`)
  }
  const firstFail = results.find((r) => r.status === 'fail')
  if (firstFail?.remediation) {
    // eslint-disable-next-line no-console
    console.log(`\n${firstFail.check}: ${firstFail.remediation}`)
  }
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .argument('[project-path]', 'path to the extension project root')
    .option(
      '--browser <chrome | chromium | edge | firefox>',
      'which session to diagnose (default chromium)'
    )
    .option('--output <pretty|json>', 'output format (default pretty)')
    .description(
      'Diagnoses a dev session: ready contract, control channel, token, executor, browser'
    )
    .action(async (projectPathArg: string | undefined, opts: DoctorOptions) => {
      let results: DoctorCheckResult[]
      try {
        results = await runDoctor(projectPathArg, opts)
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error(String(err?.message || err))
        process.exit(1)
      }

      if (opts.output === 'json') {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(results))
      } else {
        printPretty(results, opts.browser || 'chromium')
      }
      process.exit(results.some((r) => r.status === 'fail') ? 1 : 0)
    })
}
