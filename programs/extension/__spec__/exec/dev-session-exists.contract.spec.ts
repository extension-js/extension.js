import {type ChildProcess, spawn} from 'node:child_process'
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
  value: Record<string, unknown> | null
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
  delete env.EXTENSION_INSTANCE_ID
  delete env.EXTENSION_DEV_INSTANCE_ID
  delete env.EXTJS_INSTANCE_ID

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

function runDev(
  projectDir: string,
  extraArgs: string[],
  env: Record<string, string> = {}
) {
  const child = spawn(
    process.execPath,
    [
      cliBin,
      'dev',
      projectDir,
      '--browser',
      'chrome',
      '--no-browser',
      '--allow-eval',
      '--output',
      'json',
      ...extraArgs
    ],
    {cwd: cliRoot, stdio: 'pipe', env: {...cliEnv(), ...env}}
  )
  const out = {stdout: '', stderr: ''}
  child.stdout.on('data', (chunk) => (out.stdout += chunk.toString()))
  child.stderr.on('data', (chunk) => (out.stderr += chunk.toString()))
  const closed = new Promise<number | null>((resolvePromise) =>
    child.once('close', (code) => resolvePromise(code))
  )

  return {child, out, closed}
}

async function stop(child: ChildProcess, closed: Promise<number | null>) {
  if (child.exitCode !== null) return

  child.kill('SIGTERM')
  await Promise.race([closed, sleep(15_000).then(() => child.kill('SIGKILL'))])
}

describe.skipIf(process.platform === 'win32')(
  'a second dev session over a live one is refused before it touches the session files',
  () => {
    const leftovers: string[] = []
    const children: Array<{
      child: ChildProcess
      closed: Promise<number | null>
    }> = []

    afterEach(async () => {
      for (const running of children.splice(0)) {
        await stop(running.child, running.closed)
      }

      for (const dir of leftovers.splice(0)) {
        rmSync(dir, {recursive: true, force: true})
      }
    })

    it('ends with one E_SESSION_EXISTS frame naming the first pid and port, and the first eval token survives', async () => {
      const work = mkdtempSync(join(tmpdir(), 'extjs-session-exists-'))
      leftovers.push(work)
      const projectDir = join(work, 'project')
      mkdirSync(projectDir, {recursive: true})
      writeFileSync(
        join(projectDir, 'manifest.json'),
        JSON.stringify({
          manifest_version: 3,
          name: 'Session Exists Probe',
          version: '1.0.0'
        })
      )

      const first = runDev(projectDir, ['--port', '8931'])
      children.push(first)

      const deadline = Date.now() + 60_000

      while (
        Date.now() < deadline &&
        !parseFrames(first.out.stdout).some((frame) => frame.status === 'ready')
      ) {
        await sleep(250)
      }

      const readyFrame = parseFrames(first.out.stdout).find(
        (frame) => frame.status === 'ready'
      )
      expect(readyFrame, first.out.stderr).toBeDefined()

      const readyPath = join(
        projectDir,
        'dist',
        'extension-js',
        'chrome',
        'ready.json'
      )
      const tokenPath = join(
        projectDir,
        '.extension-js',
        'control-token-chrome'
      )
      const firstReady = JSON.parse(readFileSync(readyPath, 'utf8')) as {
        pid: number
        port: number
      }
      const firstToken = readFileSync(tokenPath, 'utf8')
      expect(firstReady.pid).toBe(first.child.pid)
      expect(firstReady.port).toBe(8931)

      const second = runDev(projectDir, ['--port', '8932'])
      children.push(second)
      const exitCode = await Promise.race([
        second.closed,
        sleep(60_000).then(() => 'timeout' as const)
      ])

      expect(exitCode, second.out.stderr).toBe(1)

      const frames = parseFrames(second.out.stdout)
      expect(frames).toHaveLength(1)
      expect(frames[0]).toMatchObject({
        ok: false,
        command: 'dev',
        status: 'failed',
        error: {code: 'E_SESSION_EXISTS'}
      })

      expect(frames[0].error?.message).toContain(`PID ${firstReady.pid}`)
      expect(frames[0].error?.message).toContain('port 8931')

      expect(readFileSync(tokenPath, 'utf8')).toBe(firstToken)
      expect(
        (JSON.parse(readFileSync(readyPath, 'utf8')) as {pid: number}).pid
      ).toBe(first.child.pid)
    }, 150_000)

    it('refuses a second session that asked for a distinct instance id, the first ready.json survives', async () => {
      const work = mkdtempSync(join(tmpdir(), 'extjs-session-exists-ids-'))
      leftovers.push(work)
      const projectDir = join(work, 'project')
      mkdirSync(projectDir, {recursive: true})
      writeFileSync(
        join(projectDir, 'manifest.json'),
        JSON.stringify({
          manifest_version: 3,
          name: 'Session Exists Ids Probe',
          version: '1.0.0'
        })
      )

      const first = runDev(projectDir, ['--port', '8933'], {
        EXTENSION_INSTANCE_ID: 'ids-probe-a'
      })
      children.push(first)

      const deadline = Date.now() + 60_000

      while (
        Date.now() < deadline &&
        !parseFrames(first.out.stdout).some((frame) => frame.status === 'ready')
      ) {
        await sleep(250)
      }

      expect(
        parseFrames(first.out.stdout).find((frame) => frame.status === 'ready'),
        first.out.stderr
      ).toBeDefined()

      const readyPath = join(
        projectDir,
        'dist',
        'extension-js',
        'chrome',
        'ready.json'
      )
      const firstReady = JSON.parse(readFileSync(readyPath, 'utf8')) as {
        pid: number
        instanceId: string
      }
      expect(firstReady.pid).toBe(first.child.pid)
      expect(firstReady.instanceId).toBe('ids-probe-a')

      const second = runDev(projectDir, ['--port', '8934'], {
        EXTENSION_INSTANCE_ID: 'ids-probe-b'
      })
      children.push(second)
      const exitCode = await Promise.race([
        second.closed,
        sleep(60_000).then(() => 'timeout' as const)
      ])

      expect(exitCode, second.out.stderr).toBe(1)

      const frames = parseFrames(second.out.stdout)
      expect(frames).toHaveLength(1)
      expect(frames[0]).toMatchObject({
        ok: false,
        command: 'dev',
        status: 'failed',
        error: {code: 'E_SESSION_EXISTS'}
      })

      expect(frames[0].error?.message).toContain('dev session per browser')

      const afterReady = JSON.parse(readFileSync(readyPath, 'utf8')) as {
        pid: number
        instanceId: string
      }
      expect(afterReady.pid).toBe(first.child.pid)
      expect(afterReady.instanceId).toBe('ids-probe-a')
    }, 150_000)
  }
)
