import {type ChildProcess, spawn} from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {connect} from 'node:net'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliRoot = resolve(__dirname, '../..')

function cliBin(): string {
  const cjs = join(cliRoot, 'dist', 'cli.cjs')
  if (existsSync(cjs)) return cjs

  return join(cliRoot, 'dist', 'cli.js')
}

interface ReadyPorts {
  status?: string
  port?: number | null
  controlPort?: number | null
}

interface Session {
  child: ChildProcess
  projectDir: string
  output: () => string
  closed: Promise<void>
}

function createFixture(): string {
  const projectDir = mkdtempSync(join(tmpdir(), 'extjs-debug-ports-'))
  mkdirSync(join(projectDir, 'content'), {recursive: true})
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({name: 'debug-ports', private: true, version: '1.0.0'})
  )

  writeFileSync(
    join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Debug Ports',
      version: '1.0.0',
      content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
    })
  )

  writeFileSync(
    join(projectDir, 'content', 'scripts.js'),
    "console.log('debug ports fixture')\n"
  )

  return projectDir
}

function startDev(debug: boolean): Session {
  const projectDir = createFixture()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    EXTENSION_ENV: 'test',
    EXTENSION_TELEMETRY: '0'
  }

  // An inherited debug switch would decide the run instead of the argument.
  for (const key of [
    'VITEST',
    'VITEST_WORKER_ID',
    'EXTENSION_AUTHOR_MODE',
    'EXTENSION_DEBUG'
  ]) {
    Reflect.deleteProperty(env, key)
  }

  if (debug) env.EXTENSION_DEBUG = '1'

  const child = spawn(
    process.execPath,
    [
      cliBin(),
      'dev',
      projectDir,
      '--no-browser',
      '--browser=chromium',
      '--port',
      '0'
    ],
    {cwd: cliRoot, stdio: 'pipe', env}
  )
  let output = ''
  child.stdout?.on('data', (chunk) => (output += chunk.toString()))
  child.stderr?.on('data', (chunk) => (output += chunk.toString()))

  const closed = new Promise<void>((done) => {
    child.once('close', () => done())
  })

  return {child, projectDir, output: () => output, closed}
}

function readReady(projectDir: string): ReadyPorts | null {
  try {
    return JSON.parse(
      readFileSync(
        join(projectDir, 'dist', 'extension-js', 'chromium', 'ready.json'),
        'utf8'
      )
    ) as ReadyPorts
  } catch {
    // Absent, or caught between the writer's two steps.
    return null
  }
}

function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  label: () => string
): Promise<void> {
  const started = Date.now()

  return new Promise((done, fail) => {
    const tick = () => {
      if (predicate()) return done()

      if (Date.now() - started > timeoutMs) {
        return fail(new Error(`timed out waiting for ${label()}`))
      }

      setTimeout(tick, 100)
    }

    tick()
  })
}

function accepts(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({port, host: '127.0.0.1'})

    socket.once('connect', () => {
      socket.destroy()
      done(true)
    })

    socket.once('error', () => done(false))
  })
}

async function stop(session: Session) {
  session.child.kill('SIGINT')

  const forced = setTimeout(() => session.child.kill('SIGKILL'), 30_000)

  await session.closed
  clearTimeout(forced)
}

async function readySession(debug: boolean, sessions: Session[]) {
  const session = startDev(debug)
  sessions.push(session)

  await waitFor(
    () => readReady(session.projectDir)?.status === 'ready',
    180_000,
    () => `a ready contract, output so far:\n${session.output()}`
  )

  const ready = readReady(session.projectDir)

  return {session, ready}
}

describe('the ports a dev session listens on', () => {
  const sessions: Session[] = []

  afterEach(async () => {
    for (const session of sessions.splice(0)) {
      await stop(session)
      rmSync(session.projectDir, {recursive: true, force: true})
    }
  })

  it('are named in ready.json and repeated on one debug line', async () => {
    const {session, ready} = await readySession(true, sessions)

    expect(typeof ready?.port).toBe('number')
    expect(typeof ready?.controlPort).toBe('number')
    expect(ready?.controlPort).not.toBe(ready?.port)

    const expected = `ports    port=${ready?.port} controlPort=${ready?.controlPort}`

    await waitFor(
      () => session.output().includes(expected),
      30_000,
      () => `"${expected}" in:\n${session.output()}`
    )

    expect(await accepts(Number(ready?.port))).toBe(true)
    expect(await accepts(Number(ready?.controlPort))).toBe(true)
  }, 300_000)

  it('stay out of the default output', async () => {
    const {session, ready} = await readySession(false, sessions)

    expect(typeof ready?.controlPort).toBe('number')

    await waitFor(
      () => session.output().includes('Watching for file changes.'),
      60_000,
      () => `the ready line in:\n${session.output()}`
    )

    expect(session.output()).not.toContain('controlPort=')
  }, 300_000)
})
