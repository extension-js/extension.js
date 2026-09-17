import {spawn} from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliRoot = resolve(__dirname, '../..')
const cliBin = resolve(cliRoot, 'dist', 'cli.cjs')

// The waiter polls this file while the test rewrites it, so a plain write can
// be read truncated. Rename is atomic, which is what the product's writer does.
function writeContractAtomic(filePath: string, contents: string) {
  const tmpPath = `${filePath}.tmp-${process.pid}`
  writeFileSync(tmpPath, contents)
  renameSync(tmpPath, filePath)
}

// A CI runner spends more of the budget spawning node and loading cli.cjs,
// so each budget carries a modest margin there and nothing more.
const WAIT_BUDGET_MS = process.env.CI ? 10_000 : 5000
const CLI_TIMEOUT_MS = process.env.CI ? 30_000 : 15_000
// The first contract state has to survive at least one 250ms poll before the
// next write lands, or a slow start would skip the transition under test.
const CONTRACT_WRITE_MS = process.env.CI ? 750 : 500

function runCli(args: string[], timeoutMs = CLI_TIMEOUT_MS) {
  return new Promise<{code: number; stdout: string; stderr: string}>(
    (resolvePromise, reject) => {
      const child = spawn(process.execPath, [cliBin, ...args], {
        cwd: cliRoot,
        stdio: 'pipe'
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
      child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`CLI timed out: ${args.join(' ')}`))
      }, timeoutMs)
      child.on('close', (code) => {
        clearTimeout(timer)
        resolvePromise({code: code ?? 1, stdout, stderr})
      })

      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    }
  )
}

describe('start --wait contract', () => {
  it('exits 0 when ready.json becomes ready for start command', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'extjs-start-wait-'))
    const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
    mkdirSync(readyDir, {recursive: true})

    const run = runCli(
      [
        'start',
        projectDir,
        '--wait',
        '--browser=chromium',
        `--wait-timeout=${WAIT_BUDGET_MS}`
      ],
      CLI_TIMEOUT_MS
    )

    setTimeout(() => {
      writeContractAtomic(
        join(readyDir, 'ready.json'),
        JSON.stringify({
          command: 'start',
          status: 'ready',
          distPath: join(projectDir, 'dist'),
          pid: process.pid
        })
      )
    }, CONTRACT_WRITE_MS)

    const result = await run
    expect(result.code).toBe(0)
    rmSync(projectDir, {recursive: true, force: true})
  })

  it('ignores ready payload from dev command and waits for start', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'extjs-start-wait-'))
    const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
    const readyPath = join(readyDir, 'ready.json')
    mkdirSync(readyDir, {recursive: true})

    writeContractAtomic(
      readyPath,
      JSON.stringify({
        command: 'dev',
        status: 'ready',
        distPath: join(projectDir, 'dist'),
        pid: process.pid
      })
    )

    const run = runCli(
      [
        'start',
        projectDir,
        '--wait',
        '--browser=chromium',
        `--wait-timeout=${WAIT_BUDGET_MS}`
      ],
      CLI_TIMEOUT_MS
    )

    setTimeout(() => {
      writeContractAtomic(
        readyPath,
        JSON.stringify({
          command: 'start',
          status: 'ready',
          distPath: join(projectDir, 'dist'),
          pid: process.pid
        })
      )
    }, CONTRACT_WRITE_MS)

    const result = await run
    expect(result.code).toBe(0)
    rmSync(projectDir, {recursive: true, force: true})
  })

  it('supports machine-readable output with --wait-format=json', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'extjs-start-wait-'))
    const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
    mkdirSync(readyDir, {recursive: true})

    const run = runCli(
      [
        'start',
        projectDir,
        '--wait',
        '--browser=chromium',
        `--wait-timeout=${WAIT_BUDGET_MS}`,
        '--wait-format=json'
      ],
      CLI_TIMEOUT_MS
    )

    setTimeout(() => {
      writeContractAtomic(
        join(readyDir, 'ready.json'),
        JSON.stringify({
          command: 'start',
          status: 'ready',
          browser: 'chromium',
          distPath: join(projectDir, 'dist'),
          runId: 'run-123',
          startedAt: new Date().toISOString(),
          pid: process.pid
        })
      )
    }, CONTRACT_WRITE_MS)

    const result = await run
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout.trim()) as {
      schema: number
      ok: boolean
      command: string
      value: {
        mode: string
        results: Array<{status?: string; browser?: string}>
      }
    }
    expect(payload.schema).toBe(1)
    expect(payload.ok).toBe(true)
    expect(payload.command).toBe('start')
    // Wait results moved inside the envelope's value, carried verbatim.
    expect(payload.value.mode).toBe('wait')
    expect(payload.value.results[0]?.status).toBe('ready')
    expect(payload.value.results[0]?.browser).toBe('chromium')
    rmSync(projectDir, {recursive: true, force: true})
  })

  it('accepts fresh start contract even when producer pid is no longer alive', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'extjs-start-wait-'))
    const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
    mkdirSync(readyDir, {recursive: true})

    const run = runCli(
      [
        'start',
        projectDir,
        '--wait',
        '--browser=chromium',
        `--wait-timeout=${WAIT_BUDGET_MS}`
      ],
      CLI_TIMEOUT_MS
    )

    setTimeout(() => {
      writeContractAtomic(
        join(readyDir, 'ready.json'),
        JSON.stringify({
          command: 'start',
          status: 'ready',
          distPath: join(projectDir, 'dist'),
          ts: new Date().toISOString(),
          pid: 999999999
        })
      )
    }, CONTRACT_WRITE_MS)

    const result = await run
    expect(result.code).toBe(0)
    rmSync(projectDir, {recursive: true, force: true})
  })
})
