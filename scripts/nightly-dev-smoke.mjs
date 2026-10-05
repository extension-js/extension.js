// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawn} from 'node:child_process'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {
  devLaunchVerdict,
  isFreshContract,
  readReadyContract
} from './lib/session-contract.mjs'

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url))
const CLI_PATH =
  process.env.NIGHTLY_SMOKE_CLI ||
  resolve(ROOT_DIR, 'programs', 'extension', 'dist', 'cli.cjs')
const LOAD_TIMEOUT_MS = Number(process.env.NIGHTLY_SMOKE_TIMEOUT_MS) || 180000
// A browser that dies right after the attach would still read loaded, so the
// verdict has to hold for a moment before the lane calls it a pass.
const HOLD_MS = Number(process.env.NIGHTLY_SMOKE_HOLD_MS ?? 3000)
const POLL_MS = 250

function parseArgs(argv) {
  const [project, ...rest] = argv
  const at = rest.indexOf('--browser')
  const browser = at === -1 ? '' : rest[at + 1]

  if (!project || !browser) {
    console.error(
      'usage: node scripts/nightly-dev-smoke.mjs <project> --browser <name> [dev args]'
    )

    process.exit(2)
  }

  return {project: resolve(project), browser, devArgs: rest}
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve()
  }

  return new Promise((done) => {
    const force = setTimeout(() => child.kill('SIGKILL'), 15000)
    child.once('exit', () => {
      clearTimeout(force)
      done()
    })

    child.kill('SIGTERM')
  })
}

// A dev process that exits 0 proves nothing, the browser can die before the
// load. Only the ready contract showing the extension attached is a pass.
async function main() {
  const {project, browser, devArgs} = parseArgs(process.argv.slice(2))
  const startedAtMs = Date.now()
  const env = {...process.env}

  // The smoke ends the session itself once the load is proven. An idle exit
  // could end it first and leave the verdict unread.
  delete env.EXTENSION_AUTO_EXIT_MS

  console.log(`[dev-smoke] extension dev ${project} ${devArgs.join(' ')}`)

  const child = spawn(
    process.execPath,
    [CLI_PATH, 'dev', project, ...devArgs],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
      env
    }
  )

  const outcome = await new Promise((resolveOutcome) => {
    let settled = false
    let loadedSince = 0

    const finish = (value) => {
      if (settled) return

      settled = true
      clearInterval(poll)
      clearTimeout(timer)
      resolveOutcome(value)
    }

    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          reason: `no proof the extension loaded within ${LOAD_TIMEOUT_MS} ms`
        }),
      LOAD_TIMEOUT_MS
    )

    const poll = setInterval(() => {
      const ready = readReadyContract(project, browser)
      if (!ready || !isFreshContract(ready, startedAtMs)) return

      const verdict = devLaunchVerdict(ready)

      if (verdict.state === 'failed') {
        finish({ok: false, reason: verdict.reason})

        return
      }

      if (verdict.state !== 'loaded' || !isAlive(ready.browserPid)) {
        loadedSince = 0

        return
      }

      loadedSince ||= Date.now()
      if (Date.now() - loadedSince >= HOLD_MS) finish({ok: true, ready})
    }, POLL_MS)

    child.once('exit', (code, signal) => {
      finish({
        ok: false,
        reason: `extension dev exited (code ${code}, signal ${signal}) before the extension loaded`
      })
    })
  })

  await stopChild(child)

  if (!outcome.ok) {
    console.error(`\n[dev-smoke] FAILED for ${browser}: ${outcome.reason}`)
    process.exit(1)
  }

  const {ready} = outcome
  console.log(
    `\n[dev-smoke] ${browser} loaded the extension: browser pid ${ready.browserPid}, ` +
      `extension ${ready.extensionId || 'unknown'}, attached at ${ready.executorAttachedAt}`
  )
}

main().catch((error) => {
  console.error(`\n[dev-smoke] FAILED: ${error?.stack || error}`)
  process.exit(1)
})
