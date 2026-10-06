import {spawn} from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliRoot = resolve(__dirname, '../..')
const cliBin = resolve(cliRoot, 'dist', 'cli.cjs')

interface Frame {
  ok: boolean
  command: string
  status: string
  value: {signal?: string} | null
  error: {code: string; message: string} | null
}

function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    EXTENSION_ENV: 'test',
    EXTENSION_TELEMETRY: '0'
  }
  delete env.VITEST
  delete env.VITEST_WORKER_ID

  return env
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function parseFrames(stdout: string): Frame[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Frame)
}

describe.skipIf(process.platform === 'win32')(
  'a dev session told to stop ends its json stream with one coded frame',
  () => {
    const leftovers: string[] = []

    afterEach(() => {
      for (const dir of leftovers.splice(0)) {
        rmSync(dir, {recursive: true, force: true})
      }
    })

    it.each([
      'SIGINT',
      'SIGTERM'
    ] as const)('%s is the last frame, as stopped with E_INTERRUPTED, and the run exits 0', async (signal) => {
      const work = mkdtempSync(join(tmpdir(), 'extjs-interrupt-frame-'))
      leftovers.push(work)
      const projectDir = join(work, 'project')
      mkdirSync(projectDir, {recursive: true})
      writeFileSync(
        join(projectDir, 'manifest.json'),
        JSON.stringify({
          manifest_version: 3,
          name: 'Interrupt Probe',
          version: '1.0.0'
        })
      )

      const child = spawn(
        process.execPath,
        [
          cliBin,
          'dev',
          projectDir,
          '--browser',
          'chrome',
          '--no-browser',
          '--output',
          'json'
        ],
        {cwd: cliRoot, stdio: 'pipe', env: cliEnv()}
      )
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
      child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
      const closed = new Promise<number | null>((resolvePromise) =>
        child.once('close', (code) => resolvePromise(code))
      )

      const deadline = Date.now() + 60_000

      while (
        Date.now() < deadline &&
        !parseFrames(stdout).some((frame) => frame.status === 'ready')
      ) {
        await sleep(250)
      }

      expect(
        parseFrames(stdout).map((frame) => frame.status),
        stderr
      ).toContain('ready')

      child.kill(signal)
      const exitCode = await Promise.race([
        closed,
        sleep(15_000).then(() => {
          child.kill('SIGKILL')

          return 'timeout' as const
        })
      ])

      expect(exitCode, stderr).toBe(0)

      const frames = parseFrames(stdout)
      const last = frames[frames.length - 1]
      expect(last).toMatchObject({
        ok: false,
        command: 'dev',
        status: 'stopped',
        error: {code: 'E_INTERRUPTED'}
      })

      expect(last.error?.message).toContain(signal)
      expect(last.value?.signal).toBe(signal)
      expect(frames.filter((frame) => frame.status === 'stopped')).toHaveLength(
        1
      )

      const ready = JSON.parse(
        readFileSync(
          join(projectDir, 'dist', 'extension-js', 'chrome', 'ready.json'),
          'utf8'
        )
      ) as {status: string; code: string}
      expect(ready.status).toBe('stopped')
      expect(ready.code).toBe('shutdown')

      const shutdownRows = readFileSync(
        join(projectDir, 'dist', 'extension-js', 'chrome', 'events.ndjson'),
        'utf8'
      )
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as {type: string})
        .filter((row) => row.type === 'shutdown')
      expect(shutdownRows).toHaveLength(1)
    }, 90_000)
  }
)
