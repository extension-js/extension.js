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
const BUN_BIN = process.env.BUN_BIN || 'bun'
const BROWSER = 'chromium'
const BUILD_TIMEOUT_MS = 180000
const READY_TIMEOUT_MS = 180000

function fail(message) {
  console.error(`\n[bun-runtime] FAILED: ${message}`)
  process.exit(1)
}

function writeFixture(projectDir) {
  writeFileSync(
    join(projectDir, 'manifest.json'),
    `${JSON.stringify(
      {
        manifest_version: 3,
        name: 'bun-runtime-smoke',
        version: '1.0',
        background: {service_worker: 'background.js'},
        action: {default_popup: 'popup.html'}
      },
      null,
      2
    )}\n`
  )

  // A dynamic import forces a real split chunk, so the run exercises more than
  // a single entry going through the bundler.
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

function assertBunIsPresent() {
  const probe = spawnSync(BUN_BIN, ['--version'], {encoding: 'utf-8'})

  if (probe.error || probe.status !== 0) {
    fail(
      `cannot run '${BUN_BIN} --version'. Install Bun, or point BUN_BIN at a ` +
        `binary. ${probe.error?.message || probe.stderr || ''}`.trim()
    )
  }

  const version = String(probe.stdout).trim()
  console.log(`[bun-runtime] bun ${version}`)

  return version
}

// Proves the CLI is executing on Bun and not handed back to Node by a shebang,
// which is the confusion this lane exists to rule out.
function assertRuntimeIsBun() {
  const probe = spawnSync(
    BUN_BIN,
    ['-e', 'process.stdout.write(process.versions.bun || "none")'],
    {encoding: 'utf-8'}
  )
  const reported = String(probe.stdout).trim()

  if (!reported || reported === 'none') {
    fail('the bun binary does not report process.versions.bun')
  }

  console.log(`[bun-runtime] process.versions.bun = ${reported}`)
}

function runBuild(projectDir) {
  console.log('[bun-runtime] extension build')

  const result = spawnSync(BUN_BIN, [CLI_PATH, 'build', '.'], {
    cwd: projectDir,
    encoding: 'utf-8',
    timeout: BUILD_TIMEOUT_MS
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`

  if (result.status !== 0) {
    fail(`build exited ${result.status} on Bun.\n${output}`)
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

  console.log('[bun-runtime] build emitted a manifest and a background bundle')
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
          `[bun-runtime] dev reported ready on port ${ready.port} ` +
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
  console.log('[bun-runtime] extension dev --no-browser')

  const startedAtMs = Date.now()
  const output = {value: ''}
  const child = spawn(
    BUN_BIN,
    [CLI_PATH, 'dev', '.', '--no-browser', '--port', '0'],
    {cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe']}
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
    child.kill('SIGTERM')
    await new Promise((resolve) => {
      const escalate = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 5000)
      child.on('exit', () => {
        clearTimeout(escalate)
        resolve()
      })
    })
  }
}

async function main() {
  if (!existsSync(CLI_PATH)) {
    fail(
      `${CLI_PATH} is missing. Run \`pnpm --filter extension-develop compile\` ` +
        `and \`pnpm --filter extension compile\` first.`
    )
  }

  assertBunIsPresent()
  assertRuntimeIsBun()

  const projectDir = mkdtempSync(join(tmpdir(), 'extjs-bun-runtime-'))

  try {
    writeFixture(projectDir)
    runBuild(projectDir)
    await runDev(projectDir)
    console.log('\n[bun-runtime] build and dev both pass on Bun')
  } finally {
    rmSync(projectDir, {recursive: true, force: true})
  }
}

main().catch((error) => {
  fail(error?.message || String(error))
})
