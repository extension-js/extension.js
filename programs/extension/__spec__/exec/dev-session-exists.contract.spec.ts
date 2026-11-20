import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {type CliSession, everyLineAsFrame, startCli} from '../helpers/run-cli'

interface Frame {
  ok: boolean
  command: string
  status: string
  value: Record<string, unknown> | null
  error: {code: string; message: string} | null
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function freePort(): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer()
    server.once('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolvePromise(port))
    })
  })
}

function parseFrames(stdout: string): Frame[] {
  return everyLineAsFrame<Frame>(stdout)
}

// The helper's env carries no instance id, so each case names its own.
function runDev(
  projectDir: string,
  extraArgs: string[],
  env: Record<string, string> = {}
) {
  const session = startCli(
    [
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
    {env}
  )

  return {
    session,
    child: session.child,
    out: {
      get stdout() {
        return session.read().stdout
      },
      get stderr() {
        return session.read().stderr
      }
    },
    closed: session.closed.then((exit) => exit.status)
  }
}

describe('a second dev session over a live one is refused before it touches the session files', () => {
  const leftovers: string[] = []
  const children: Array<{session: CliSession}> = []

  afterEach(async () => {
    for (const running of children.splice(0)) {
      await running.session.stop('SIGTERM', 15_000)
    }

    for (const dir of leftovers.splice(0)) {
      rmSync(dir, {recursive: true, force: true, maxRetries: 5})
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

    const firstPort = await freePort()
    const first = runDev(projectDir, ['--port', String(firstPort)])
    children.push(first)

    await first.session.waitFor(
      () => first.out.stdout.includes('"status":"ready"'),
      60_000,
      'the ready frame of the first session'
    )

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
    const tokenPath = join(projectDir, '.extension-js', 'control-token-chrome')
    const firstReady = JSON.parse(readFileSync(readyPath, 'utf8')) as {
      pid: number
      port: number
    }
    const firstToken = readFileSync(tokenPath, 'utf8')
    expect(firstReady.pid).toBe(first.child.pid)
    expect(firstReady.port).toBe(firstPort)

    const second = runDev(projectDir, ['--port', String(await freePort())])
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
    expect(frames[0].error?.message).toContain(`port ${firstPort}`)

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

    const first = runDev(projectDir, ['--port', String(await freePort())], {
      EXTENSION_INSTANCE_ID: 'ids-probe-a'
    })
    children.push(first)

    await first.session.waitFor(
      () => first.out.stdout.includes('"status":"ready"'),
      60_000,
      'the ready frame of the first session'
    )

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

    const second = runDev(projectDir, ['--port', String(await freePort())], {
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
})
