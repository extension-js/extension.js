import fs from 'node:fs'
import * as path from 'node:path'
import type {RspackDevServer} from '@rspack/dev-server'
import {afterEach, describe, expect, it} from 'vitest'
import {createLifecycleStream, stripAnsi} from '../lifecycle-stream'
import {
  bindDevSessionRestart,
  DevSessionRestartScheduler,
  endCompilerRestart,
  isCompilerRestarting,
  requestDevSessionRestart,
  unbindDevSessionRestart
} from '../session-restart'
import {createSessionRestartHandler} from '../session-restart-handler'
import {createRestartFailure} from '../start-bundler'
import {
  bootLoopback,
  createFixture,
  type LoopbackSession,
  waitFor
} from './helpers/loopback-dev-server'

// The stock dev server on loopback, with a restart whose next bundle cannot
// be built, wired as the session wires it.
const roots: string[] = []
const sessions: LoopbackSession[] = []

afterEach(async () => {
  unbindDevSessionRestart()

  for (const session of sessions.splice(0)) await session.server.stop()

  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('a restart whose next bundle cannot be built', () => {
  it('leaves the running server answering and says what failed', async () => {
    const root = createFixture('extjs-restart-failure-')
    roots.push(root)
    const session = await bootLoopback({root})
    sessions.push(session)
    await session.firstCompile

    const printed: string[] = []
    let current: RspackDevServer | null = session.server
    const failure = createRestartFailure({
      metadata: {writeError: () => {}},
      lifecycle: createLifecycleStream({
        command: 'dev',
        browser: 'chromium',
        distPath: session.distPath,
        write: () => {}
      }),
      keepServing: () => endCompilerRestart(session.compiler),
      release: async () => {},
      print: (line) => printed.push(stripAnsi(line)),
      exit: () => {
        throw new Error('a failed bundle must not end the process')
      }
    })
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setFailureHandler(failure.unexpected)
    scheduler.setHandler(
      createSessionRestartHandler<RspackDevServer>({
        announce: () => {},
        createBundle: async () => {
          throw new Error('config hook broke')
        },
        currentServer: () => current,
        setCurrentServer: (server) => {
          current = server
        },
        holdPort: () => {},
        endPortHold: () => {},
        startBundler: async () => {},
        onBundleFailure: failure.bundle,
        onStopFailure: failure.stop,
        onStartFailure: failure.start,
        isShuttingDown: () => false,
        fullReloadsDelivered: () => 0,
        reloadAfterRestart: async () => {}
      })
    )

    bindDevSessionRestart(scheduler)

    expect(
      requestDevSessionRestart(session.compiler, {
        reason: 'scripts',
        pathAfter: 'scripts/new.js'
      })
    ).toBe(true)

    expect(isCompilerRestarting(session.compiler)).toBe(true)
    expect(await waitFor(() => printed.length > 0, 5000)).toBe(true)

    expect(printed).toHaveLength(1)
    expect(printed[0]).toContain('The dev server could not restart.')
    expect(printed[0]).toContain('config hook broke')
    expect(printed[0]).toContain('The previous build keeps serving.')
    expect(current).toBe(session.server)
    // The compiler that keeps serving reports its own diagnostics again.
    expect(isCompilerRestarting(session.compiler)).toBe(false)

    const response = await fetch(
      `http://127.0.0.1:${session.port}/manifest.json`
    )
    expect(response.status).toBe(200)

    // It still rebuilds on a save, so the session is live and not only bound.
    const before = session.compiles()
    fs.writeFileSync(path.join(root, 'src', 'index.js'), 'export const a = 2\n')
    expect(await waitFor(() => session.compiles() > before, 20000)).toBe(true)
  }, 60_000)
})
