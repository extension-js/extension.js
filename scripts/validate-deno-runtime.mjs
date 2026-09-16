// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawn, spawnSync} from 'node:child_process'
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {
  describeReadyFailure,
  isFreshContract,
  readReadyContract
} from './lib/session-contract.mjs'

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url))
const CLI_PATH = join(ROOT_DIR, 'programs', 'extension', 'dist', 'cli.cjs')
// Node's spawn does no PATHEXT lookup, so a bare `deno` misses
// deno.exe on Windows. An explicit DENO_BIN still wins.
const DENO_BIN =
  process.env.DENO_BIN || (process.platform === 'win32' ? 'deno.exe' : 'deno')
const BROWSER = 'chromium'
const BUILD_TIMEOUT_MS = 180000
const READY_TIMEOUT_MS = 180000
const LAUNCH_TIMEOUT_MS = 240000

// Unset by default so a local run stays headless and fast. The nightly sets
// these, because a real browser launch is too flaky for a merge gate.
const LAUNCH_BROWSER = process.env.RUNTIME_SMOKE_BROWSER || ''
const LAUNCH_BINARY = process.env.RUNTIME_SMOKE_BROWSER_BINARY || ''

function fail(message) {
  console.error(`\n[deno-runtime] FAILED: ${message}`)
  process.exit(1)
}

function writeFixture(projectDir) {
  writeFileSync(
    join(projectDir, 'manifest.json'),
    `${JSON.stringify(
      {
        manifest_version: 3,
        name: 'deno-runtime-smoke',
        version: '1.0',
        background: {service_worker: 'background.js'},
        action: {default_popup: 'popup.html'}
      },
      null,
      2
    )}\n`
  )

  // A dynamic import forces a real split chunk, which is what surfaced the bare
  // `path` specifier that Deno refused before 4.1.20.
  writeFileSync(
    join(projectDir, 'background.js'),
    'import("./shared.js").then((mod) => console.log(mod.label))\n'
  )

  writeFileSync(join(projectDir, 'shared.js'), 'export const label = "ok"\n')
  writeFileSync(
    join(projectDir, 'popup.html'),
    '<!doctype html><html><body><script src="popup.js"></script></body></html>\n'
  )

  writeFileSync(join(projectDir, 'popup.js'), 'document.title = "ok"\n')
}

function assertDenoIsPresent() {
  const probe = spawnSync(DENO_BIN, ['--version'], {
    encoding: 'utf-8',
    windowsHide: true
  })

  if (probe.error || probe.status !== 0) {
    fail(
      `cannot run '${DENO_BIN} --version'. Install Deno, or point DENO_BIN at ` +
        `a binary. ${probe.error?.message || probe.stderr || ''}`.trim()
    )
  }

  const version = String(probe.stdout).split('\n')[0]
  console.log(`[deno-runtime] ${version}`)

  return version
}

// Proves the CLI is executing on Deno and not shelling back out to Node, which
// is exactly the confusion this lane exists to rule out.
function assertRuntimeIsDeno() {
  const probe = spawnSync(
    DENO_BIN,
    ['eval', 'console.log(process.versions.deno || "none")'],
    {encoding: 'utf-8', windowsHide: true}
  )
  const reported = String(probe.stdout).trim()

  if (!reported || reported === 'none') {
    fail('the deno binary does not report process.versions.deno')
  }

  console.log(`[deno-runtime] process.versions.deno = ${reported}`)
}

function runBuild(projectDir) {
  console.log('[deno-runtime] extension build')

  const result = spawnSync(DENO_BIN, ['run', '-A', CLI_PATH, 'build', '.'], {
    cwd: projectDir,
    encoding: 'utf-8',
    timeout: BUILD_TIMEOUT_MS,
    windowsHide: true
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`

  if (result.status !== 0) {
    fail(`build exited ${result.status} on Deno.\n${output}`)
  }

  const builtManifest = join(projectDir, 'dist', BROWSER, 'manifest.json')

  if (!existsSync(builtManifest)) {
    fail(`build reported success but wrote no ${builtManifest}.\n${output}`)
  }

  const builtWorker = join(
    projectDir,
    'dist',
    BROWSER,
    'background',
    'service_worker.js'
  )

  if (!existsSync(builtWorker)) {
    fail(`build wrote no background bundle at ${builtWorker}.\n${output}`)
  }

  console.log('[deno-runtime] build emitted a manifest and a background bundle')
}

// SIGTERM leaves the dev server's children running on Windows, so the job
// would hang on an orphan. taskkill takes the whole tree.
function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return

  return new Promise((resolve) => {
    const done = setTimeout(resolve, 8000)
    child.on('exit', () => {
      clearTimeout(done)
      resolve()
    })

    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      })

      return
    }

    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), 5000)
  })
}

function waitForReady(child, projectDir, startedAtMs, output) {
  return new Promise((resolve, reject) => {
    let settled = false

    const finish = (error) => {
      if (settled) return

      settled = true
      clearInterval(poll)
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }

    const timer = setTimeout(() => {
      finish(
        new Error(
          `ready.json never reached "ready" within ${READY_TIMEOUT_MS}ms.\n` +
            output.value.slice(-4000)
        )
      )
    }, READY_TIMEOUT_MS)

    const poll = setInterval(() => {
      const ready = readReadyContract(projectDir, BROWSER)
      if (!ready || !isFreshContract(ready, startedAtMs)) return

      if (ready.status === 'error') {
        finish(new Error(describeReadyFailure(ready)))

        return
      }

      if (ready.status === 'ready') {
        console.log(
          `[deno-runtime] dev reported ready on port ${ready.port} ` +
            `(toolchain ${ready.toolchainVersion})`
        )

        finish()
      }
    }, 500)

    child.on('exit', (code) => {
      finish(
        new Error(
          `dev exited early with code ${code}.\n${output.value.slice(-4000)}`
        )
      )
    })
  })
}

async function runDev(projectDir) {
  console.log('[deno-runtime] extension dev --no-browser')

  const startedAtMs = Date.now()
  const output = {value: ''}
  const child = spawn(
    DENO_BIN,
    ['run', '-A', CLI_PATH, 'dev', '.', '--no-browser', '--port', '0'],
    {cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true}
  )

  child.stdout.on('data', (chunk) => {
    output.value += chunk
  })

  child.stderr.on('data', (chunk) => {
    output.value += chunk
  })

  try {
    await waitForReady(child, projectDir, startedAtMs, output)
  } finally {
    await terminateChild(child)
  }
}

// A launch is a different proof from `--no-browser`: it exercises the browser
// spawn, the profile, and the extension actually loading into the target.
function launchFixture(projectDir, browser) {
  const gecko = browser === 'firefox' || browser.includes('gecko')
  const background = gecko
    ? {scripts: ['background.js']}
    : {service_worker: 'background.js'}

  writeFileSync(
    join(projectDir, 'manifest.json'),
    `${JSON.stringify(
      {
        manifest_version: 3,
        name: 'deno-runtime-launch',
        version: '1.0',
        background
      },
      null,
      2
    )}\n`
  )

  writeFileSync(join(projectDir, 'background.js'), 'console.log("ok")\n')
}

async function runLaunch(browser, binary) {
  console.log(`[deno-runtime] extension dev --browser ${browser}`)

  const projectDir = mkdtempSync(join(tmpdir(), 'extjs-deno-runtime-launch-'))
  launchFixture(projectDir, browser)

  const args = ['run', '-A', CLI_PATH, 'dev', '.', '--browser', browser]

  if (binary) {
    args.push(browser === 'firefox' ? '--gecko-binary' : '--chromium-binary')
    args.push(binary)
  }

  args.push('--profile', 'false', '--no-open', '--port', '0')

  const startedAtMs = Date.now()
  const output = {value: ''}
  const child = spawn(DENO_BIN, args, {
    cwd: projectDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {...process.env, EXTENSION_HEADLESS: '1'}
  })

  child.stdout.on('data', (chunk) => {
    output.value += chunk
  })

  child.stderr.on('data', (chunk) => {
    output.value += chunk
  })

  try {
    const ready = await waitForLaunch(
      child,
      projectDir,
      browser,
      startedAtMs,
      output
    )

    console.log(
      `[deno-runtime] ${browser} launched, pid ${ready.browserPid}, extension ` +
        `${ready.extensionId || 'unknown'}`
    )
  } finally {
    await terminateChild(child)
    rmSync(projectDir, {recursive: true, force: true})
  }
}

function waitForLaunch(child, projectDir, browser, startedAtMs, output) {
  return new Promise((resolve, reject) => {
    let settled = false

    const finish = (error, value) => {
      if (settled) return

      settled = true
      clearInterval(poll)
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }

    const timer = setTimeout(() => {
      finish(
        new Error(
          `${browser} never reached "ready" with a browserPid within ` +
            `${LAUNCH_TIMEOUT_MS}ms, so no browser was spawned.\n` +
            output.value.slice(-4000)
        )
      )
    }, LAUNCH_TIMEOUT_MS)

    const poll = setInterval(() => {
      const ready = readReadyContract(projectDir, browser)
      if (!ready || !isFreshContract(ready, startedAtMs)) return

      if (ready.status === 'error') {
        finish(new Error(describeReadyFailure(ready)))

        return
      }

      // The contract is written at compile-ready and stamped with browserPid
      // only once the browser attaches, so a ready without a pid is early.
      if (ready.status === 'ready' && ready.browserPid) finish(null, ready)
    }, 500)

    child.on('exit', (code) => {
      finish(
        new Error(
          `dev exited early with code ${code}.\n${output.value.slice(-4000)}`
        )
      )
    })
  })
}

async function main() {
  if (!existsSync(CLI_PATH)) {
    fail(
      `${CLI_PATH} is missing. Run \`pnpm --filter extension-develop compile\` ` +
        `and \`pnpm --filter extension compile\` first.`
    )
  }

  assertDenoIsPresent()
  assertRuntimeIsDeno()

  const projectDir = mkdtempSync(join(tmpdir(), 'extjs-deno-runtime-'))

  try {
    writeFixture(projectDir)
    runBuild(projectDir)
    await runDev(projectDir)

    if (LAUNCH_BROWSER) {
      await runLaunch(LAUNCH_BROWSER, LAUNCH_BINARY)
      console.log(
        `\n[deno-runtime] build, dev and a real ${LAUNCH_BROWSER} launch pass on Deno`
      )

      return
    }

    console.log('\n[deno-runtime] build and dev both pass on Deno')
  } finally {
    rmSync(projectDir, {recursive: true, force: true})
  }
}

main().catch((error) => {
  fail(error?.message || String(error))
})
