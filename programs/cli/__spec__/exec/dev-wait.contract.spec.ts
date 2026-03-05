import {spawn} from 'node:child_process'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliRoot = resolve(__dirname, '../..')
const cliBin = resolve(cliRoot, 'dist', 'cli.cjs')

function runCli(args: string[], timeoutMs = 30000) {
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

describe('dev --wait contract', () => {
  it('supports producer/consumer flow from starting to ready', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'extjs-dev-wait-'))
    const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
    mkdirSync(readyDir, {recursive: true})

    const run = runCli(
      [
        'dev',
        projectDir,
        '--wait',
        '--browser=chromium',
        '--wait-timeout=5000'
      ],
      15000
    )

    setTimeout(() => {
      writeFileSync(
        join(readyDir, 'ready.json'),
        JSON.stringify({
          command: 'dev',
          status: 'starting',
          distPath: join(projectDir, 'dist'),
          pid: process.pid
        })
      )
    }, 150)

    setTimeout(() => {
      writeFileSync(
        join(readyDir, 'ready.json'),
        JSON.stringify({
          command: 'dev',
          status: 'ready',
          distPath: join(projectDir, 'dist'),
          pid: process.pid
        })
      )
    }, 300)

    const result = await run
    expect(result.code).toBe(0)
    rmSync(projectDir, {recursive: true, force: true})
  })

  it('exits 1 when ready.json reports error', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'extjs-dev-wait-'))
    const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
    mkdirSync(readyDir, {recursive: true})

    const run = runCli(
      [
        'dev',
        projectDir,
        '--wait',
        '--browser=chromium',
        '--wait-timeout=5000'
      ],
      15000
    )

    setTimeout(() => {
      writeFileSync(
        join(readyDir, 'ready.json'),
        JSON.stringify({
          command: 'dev',
          status: 'error',
          message: 'Compilation failed',
          errors: ['errors: 1'],
          pid: process.pid
        })
      )
    }, 300)

    const result = await run
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Compilation failed')
    rmSync(projectDir, {recursive: true, force: true})
  })

  it('supports machine-readable output with --wait-format=json', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'extjs-dev-wait-'))
    const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
    mkdirSync(readyDir, {recursive: true})

    const run = runCli(
      [
        'dev',
        projectDir,
        '--wait',
        '--browser=chromium',
        '--wait-timeout=5000',
        '--wait-format=json'
      ],
      15000
    )

    setTimeout(() => {
      writeFileSync(
        join(readyDir, 'ready.json'),
        JSON.stringify({
          command: 'dev',
          status: 'ready',
          browser: 'chromium',
          distPath: join(projectDir, 'dist'),
          runId: 'run-123',
          startedAt: new Date().toISOString(),
          pid: process.pid
        })
      )
    }, 300)

    const result = await run
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout.trim()) as {
      ok: boolean
      mode: string
      results: Array<{status?: string; browser?: string}>
    }
    expect(payload.ok).toBe(true)
    expect(payload.mode).toBe('wait')
    expect(payload.results[0]?.status).toBe('ready')
    expect(payload.results[0]?.browser).toBe('chromium')
    rmSync(projectDir, {recursive: true, force: true})
  })

  it('ignores stale ready.json from dead producer pid', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'extjs-dev-wait-'))
    const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
    const readyPath = join(readyDir, 'ready.json')
    mkdirSync(readyDir, {recursive: true})

    writeFileSync(
      readyPath,
      JSON.stringify({
        command: 'dev',
        status: 'ready',
        browser: 'chromium',
        distPath: join(projectDir, 'dist'),
        pid: 999999999
      })
    )

    const run = runCli(
      [
        'dev',
        projectDir,
        '--wait',
        '--browser=chromium',
        '--wait-timeout=5000'
      ],
      15000
    )

    setTimeout(() => {
      writeFileSync(
        readyPath,
        JSON.stringify({
          command: 'dev',
          status: 'ready',
          browser: 'chromium',
          distPath: join(projectDir, 'dist'),
          pid: process.pid
        })
      )
    }, 500)

    const result = await run
    expect(result.code).toBe(0)
    rmSync(projectDir, {recursive: true, force: true})
  })

})
