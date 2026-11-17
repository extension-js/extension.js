import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {connect} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {type CliSession, startCli} from '../helpers/run-cli'

interface ReadyPorts {
  status?: string
  port?: number | null
  controlPort?: number | null
}

interface Session {
  cli: CliSession
  projectDir: string
  output: () => string
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

// The helper's env names no debug switch, so the argument decides the run.
function startDev(debug: boolean): Session {
  const projectDir = createFixture()
  const cli = startCli(
    ['dev', projectDir, '--no-browser', '--browser=chromium', '--port', '0'],
    {env: debug ? {EXTENSION_DEBUG: '1'} : {}}
  )

  return {cli, projectDir, output: () => cli.read().output}
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
  await session.cli.stop('SIGINT', 30_000)
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
