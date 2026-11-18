import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {
  markManagedEphemeralProfile,
  removeManagedEphemeralProfile
} from '../../browsers-lib/shared-utils'
import {
  __activeFirefoxInstanceCount,
  setupFirefoxProcessHandlers
} from '../../run-firefox/firefox-launch/process-handlers'

const noChild = () => null

const noCleanup = async () => {}

describe('setupFirefoxProcessHandlers lifecycle', () => {
  const events = [
    'SIGINT',
    'SIGTERM',
    'SIGHUP',
    'SIGBREAK',
    'exit',
    'beforeExit',
    'uncaughtException',
    'unhandledRejection'
  ] as const

  it('installs global process listeners only once across multiple instances', () => {
    const before = events.map((e) => process.listenerCount(e))
    const d1 = setupFirefoxProcessHandlers('firefox', noChild, noCleanup)
    const after1 = events.map((e) => process.listenerCount(e))
    const d2 = setupFirefoxProcessHandlers('firefox', noChild, noCleanup)
    const after2 = events.map((e) => process.listenerCount(e))

    // This is the first setup in the file, so it adds exactly one listener
    // per event, and the second setup adds none.
    expect(after1).toEqual(before.map((count) => count + 1))
    expect(after2).toEqual(after1)

    d1()
    d2()
  })

  it('registers and unregisters instances via the returned disposer', () => {
    const base = __activeFirefoxInstanceCount()

    const d1 = setupFirefoxProcessHandlers('firefox', noChild, noCleanup)
    expect(__activeFirefoxInstanceCount()).toBe(base + 1)

    const d2 = setupFirefoxProcessHandlers('firefox', noChild, noCleanup)
    expect(__activeFirefoxInstanceCount()).toBe(base + 2)

    d1()
    expect(__activeFirefoxInstanceCount()).toBe(base + 1)

    d2()
    expect(__activeFirefoxInstanceCount()).toBe(base)
  })
})

// The session exits on a signal before the browser's close event runs, so
// the exit slice is the only place a fresh profile can still be reclaimed.
describe('the exit cleanup of a Firefox session', () => {
  // Only this module's exit listener runs, never the test runner's own.
  const runExit = () => {
    for (const handler of process.listeners('exit')) {
      if (handler.name === 'forceKillAllOnExit') (handler as () => void)()
    }
  }

  // The fakes carry no pid: on Windows the teardown hands it to taskkill,
  // and a made-up number can name a real process.
  it('kills the browser first and then runs the exit cleanup', () => {
    const order: string[] = []
    const child: any = {
      kill: vi.fn((signal: string) => {
        order.push(`kill ${signal}`)

        return true
      })
    }

    const dispose = setupFirefoxProcessHandlers(
      'firefox',
      () => child,
      noCleanup,
      () => null,
      () => order.push('cleanup')
    )

    runExit()
    dispose()

    expect(order).toEqual(['kill SIGKILL', 'cleanup'])
  })

  it('skips the exit cleanup of a session whose browser already closed', () => {
    const cleanupOnExit = vi.fn()

    setupFirefoxProcessHandlers(
      'firefox',
      noChild,
      noCleanup,
      () => null,
      cleanupOnExit
    )()

    runExit()

    expect(cleanupOnExit).not.toHaveBeenCalled()
  })

  it('removes a fresh profile and leaves a kept one where it is', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ff-exit-'))
    const fresh = path.join(root, 'firefox-profile', 'quiet-fox')
    const kept = path.join(root, 'firefox-profile', 'dev')
    const earlier = path.join(root, 'earlier', 'firefox-profile', 'dev')

    for (const dir of [fresh, kept, earlier]) {
      fs.mkdirSync(dir, {recursive: true})
      fs.writeFileSync(path.join(dir, 'cookies.sqlite'), 'x')
    }

    markManagedEphemeralProfile(fresh)

    const disposers = [fresh, kept, earlier].map((profile) =>
      setupFirefoxProcessHandlers(
        'firefox',
        noChild,
        noCleanup,
        () => null,
        () => removeManagedEphemeralProfile(profile)
      )
    )

    runExit()

    for (const dispose of disposers) dispose()

    expect(fs.existsSync(fresh)).toBe(false)
    expect(fs.existsSync(path.join(kept, 'cookies.sqlite'))).toBe(true)
    expect(fs.existsSync(path.join(earlier, 'cookies.sqlite'))).toBe(true)

    fs.rmSync(root, {recursive: true, force: true})
  })
})
