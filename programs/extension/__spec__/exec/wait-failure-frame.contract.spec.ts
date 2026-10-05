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

const CLI_TIMEOUT_MS = process.env.CI ? 30_000 : 15_000
const TIMEOUT_BUDGET_MS = process.env.CI ? 2500 : 1200
const ERROR_BUDGET_MS = process.env.CI ? 10_000 : 5000
const CONTRACT_WRITE_MS = process.env.CI ? 750 : 500

function writeContractAtomic(filePath: string, contents: string) {
  const tmpPath = `${filePath}.tmp-${process.pid}`
  writeFileSync(tmpPath, contents)
  renameSync(tmpPath, filePath)
}

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

function createProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'extjs-wait-frame-'))
  const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
  mkdirSync(readyDir, {recursive: true})

  return {projectDir, readyPath: join(readyDir, 'ready.json')}
}

// Node 22 prints an ExperimentalWarning naming the bundle path when cli.cjs
// requires an ES module, so the assertions below read only our own lines.
const NODE_OWN_WARNING =
  /^\(node:\d+\)|^Support for loading ES Module|^\(Use `node --trace-warnings/

function expectNoStackTrace(stderr: string) {
  const own = stderr
    .split('\n')
    .filter((line) => !NODE_OWN_WARNING.test(line))
    .join('\n')

  expect(own).not.toMatch(/^\s*at /m)
  expect(own).not.toMatch(/cli\.cjs:\d+:\d+/)
  expect(own).not.toContain('WaitModeError:')
  expect(own).toContain('⏵⏵⏵')
}

function errorStatusContract(command: 'dev' | 'start') {
  const now = new Date().toISOString()

  return JSON.stringify({
    schemaVersion: 2,
    command,
    status: 'error',
    browser: 'chromium',
    message: 'Module not found: Cannot resolve ./missing in background.js',
    errors: ['Module not found: Cannot resolve ./missing in background.js'],
    pid: process.pid,
    ts: now,
    startedAt: now,
    compiledAt: now
  })
}

describe('the stderr assertion itself', () => {
  const nodeWarning = [
    '(node:12517) ExperimentalWarning: CommonJS module /w/programs/extension/dist/cli.cjs is loading ES Module /w/node_modules/commander/index.js using require().',
    'Support for loading ES Module in require() is an experimental feature and might change at any time',
    '(Use `node --trace-warnings ...` to show where the warning was created)'
  ].join('\n')
  const frame = [
    '⏵⏵⏵ Timed out waiting for ready contract at /tmp/x/ready.json (2500 ms).',
    'Raise --wait-timeout, or read the server output for what kept it from reporting ready.'
  ].join('\n')

  it('passes when Node names the bundle in its own experimental warning', () => {
    expect(() => expectNoStackTrace(`${nodeWarning}\n${frame}`)).not.toThrow()
  })

  it('still fails on a real stack frame carrying bundle offsets', () => {
    const withStack = `${frame}\n    at waitForReadyContract (/w/programs/extension/dist/cli.cjs:11592:19)`
    expect(() => expectNoStackTrace(withStack)).toThrow()
  })
})

describe.each(['dev', 'start'] as const)('%s --wait failure frame', (verb) => {
  it('renders a timeout as one error line and a remedy, never a stack', async () => {
    const {projectDir} = createProject()

    const result = await runCli([
      verb,
      projectDir,
      '--wait',
      '--browser=chromium',
      `--wait-timeout=${TIMEOUT_BUDGET_MS}`
    ])

    expect(result.code).toBe(1)
    expect(result.stdout.trim()).toBe('')
    expectNoStackTrace(result.stderr)
    expect(result.stderr).toContain('Timed out waiting for ready contract')
    expect(result.stderr).toContain('--wait-timeout')
    rmSync(projectDir, {recursive: true, force: true})
  })

  it('renders a remote url refusal as one error line, never a stack', async () => {
    const result = await runCli([
      verb,
      'https://example.com',
      '--wait',
      '--browser=chromium',
      `--wait-timeout=${TIMEOUT_BUDGET_MS}`
    ])

    expect(result.code).toBe(1)
    expectNoStackTrace(result.stderr)
    expect(result.stderr).toContain('--wait requires a local project path')
  })

  it('frames a remote url refusal as E_REMOTE_URL_UNSUPPORTED', async () => {
    const result = await runCli([
      verb,
      'https://example.com',
      '--wait',
      '--browser=chromium',
      `--wait-timeout=${TIMEOUT_BUDGET_MS}`,
      '--output=json'
    ])

    expect(result.code).toBe(1)

    const payload = JSON.parse(result.stdout.trim()) as {
      ok: boolean
      command: string
      status: string
      error: {code: string}
    }

    expect(payload.ok).toBe(false)
    expect(payload.command).toBe(verb)
    expect(payload.status).toBe('usage')
    expect(payload.error.code).toBe('E_REMOTE_URL_UNSUPPORTED')
  })

  it('keeps stderr free of stacks while stdout carries one timeout envelope', async () => {
    const {projectDir} = createProject()

    const result = await runCli([
      verb,
      projectDir,
      '--wait',
      '--browser=chromium',
      `--wait-timeout=${TIMEOUT_BUDGET_MS}`,
      '--output=json'
    ])

    expect(result.code).toBe(1)
    expectNoStackTrace(result.stderr)

    const payload = JSON.parse(result.stdout.trim()) as {
      ok: boolean
      status: string
      error: {code: string}
      hint?: string
    }
    expect(payload.ok).toBe(false)
    expect(payload.status).toBe('timeout')
    expect(payload.error.code).toBe('E_READY_TIMEOUT')
    expect(payload.hint).toContain('--wait-timeout')
    rmSync(projectDir, {recursive: true, force: true})
  })

  // A compile failure in the user's own extension must stay distinguishable
  // from a fault in the CLI, which E_INTERNAL would have collapsed it into.
  it('reports a ready contract error status as E_READY_ERROR_STATUS', async () => {
    const {projectDir, readyPath} = createProject()

    const run = runCli([
      verb,
      projectDir,
      '--wait',
      '--browser=chromium',
      `--wait-timeout=${ERROR_BUDGET_MS}`,
      '--output=json'
    ])

    setTimeout(() => {
      writeContractAtomic(readyPath, errorStatusContract(verb))
    }, CONTRACT_WRITE_MS)

    const result = await run
    expect(result.code).toBe(1)
    expectNoStackTrace(result.stderr)

    const payload = JSON.parse(result.stdout.trim()) as {
      ok: boolean
      status: string
      error: {code: string; message: string}
    }
    expect(payload.ok).toBe(false)
    expect(payload.status).toBe('failed')
    expect(payload.error.code).toBe('E_READY_ERROR_STATUS')
    expect(payload.error.message).toContain('Cannot resolve ./missing')
    rmSync(projectDir, {recursive: true, force: true})
  })
})
