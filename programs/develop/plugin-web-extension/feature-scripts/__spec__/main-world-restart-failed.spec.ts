import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  assignCompilerToDevSession,
  bindDevSessionRestart,
  DEV_SESSION_RESTART_DEBOUNCE_MS,
  type DevSessionRestartRequest,
  DevSessionRestartScheduler,
  endCompilerRestart,
  isCompilerRestarting,
  requestDevSessionRestart,
  unbindDevSessionRestart
} from '../../../dev-server/session-restart'
import {
  buildRestartBundle,
  createSessionRestartHandler
} from '../../../dev-server/session-restart-handler'
import {createRestartFailure} from '../../../dev-server/start-bundler'
import {
  isAwaitingMainWorldRestart,
  MAIN_WORLD_SETTLE_MS,
  WarnMainWorldRegistrationChanged
} from '../steps/warn-main-world-registration-changed'

const roots: string[] = []
const compilers: Compiler[] = []

const REGISTRATION =
  'chrome.scripting.registerContentScripts([{id: "hook", js: ["scripts/hook.js"], ' +
  'world: "MAIN", matches: ["<all_urls>"]}])\n'
const OTHER_REGISTRATION =
  'chrome.scripting.registerContentScripts([{id: "other", js: ["scripts/other.js"], ' +
  'world: "MAIN", matches: ["<all_urls>"]}])\n'
const IDLE = 'console.log("nothing registered")\n'
const ANSI = /\u001b\[[0-9;]*m/g

beforeEach(() => {
  // Only the timers the step and the scheduler wait on, so rspack runs live.
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
})

afterEach(async () => {
  vi.useRealTimers()
  unbindDevSessionRestart()

  for (const compiler of compilers.splice(0)) {
    await new Promise<void>((resolve) => compiler.close(() => resolve()))
  }

  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

function project(background: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-main-restart-'))
  roots.push(root)

  const at = (name: string) => path.join(root, name)

  fs.mkdirSync(at('scripts'), {recursive: true})
  fs.writeFileSync(at('manifest.json'), '{}')
  fs.writeFileSync(at('scripts/hook.js'), 'window.__PAGE_HOOK__ = 1\n')
  fs.writeFileSync(at('scripts/other.js'), 'window.__OTHER_HOOK__ = 1\n')
  fs.writeFileSync(at('register.js'), background)
  fs.writeFileSync(at('background.js'), 'import "./register.js"\n')

  return {
    root,
    at,
    write: (contents: string) => fs.writeFileSync(at('register.js'), contents)
  }
}

// A real compiler with the step applied as the scripts feature applies it.
function compilerIn(files: ReturnType<typeof project>) {
  const compiler = rspack({
    mode: 'development',
    context: files.root,
    entry: {background: files.at('background.js')},
    output: {path: files.at('dist/chrome')},
    stats: 'none',
    infrastructureLogging: {level: 'none'}
  })
  compilers.push(compiler)

  new WarnMainWorldRegistrationChanged({
    manifestPath: files.at('manifest.json'),
    includeList: {
      'background/service_worker': files.at('background.js'),
      'scripts/hook': files.at('scripts/hook.js'),
      'scripts/other': files.at('scripts/other.js')
    }
  }).apply(compiler)

  return compiler
}

// One build, as a save makes one, with what the reload readers are handed.
function save(compiler: Compiler) {
  return new Promise<{held: boolean; warnings: string[]}>((resolve, reject) => {
    compiler.run((error, stats) => {
      if (error || !stats) {
        reject(error ?? new Error('The build ended without stats'))

        return
      }

      const {compilation} = stats as Stats

      resolve({
        held: isAwaitingMainWorldRestart(compiler, compilation),
        warnings: compilation.warnings.map((warning) => warning.message)
      })
    })
  })
}

// The restart wiring of a dev session, with the bundle step under the test's
// control and everything else the functions the dev server runs.
function devSession(serving: Compiler) {
  let active: Compiler | null = serving

  let nextBundle: () => Compiler | Promise<Compiler> = () => {
    throw new Error('The next bundle could not be built')
  }

  const announced: DevSessionRestartRequest[] = []
  const frames: Array<{code: string; message: string}> = []
  const lines: string[] = []
  const scheduler = new DevSessionRestartScheduler()
  const failure = createRestartFailure({
    metadata: {writeError: () => {}},
    lifecycle: {
      failed: () => {},
      restartFailed: (frame) => frames.push(frame)
    },
    keepServing: () => endCompilerRestart(active ?? undefined),
    release: async () => {},
    print: (line) => lines.push(line.replace(ANSI, '')),
    exit: () => {},
    exitOnError: false
  })

  scheduler.setFailureHandler(failure.unexpected)
  scheduler.setHandler(
    createSessionRestartHandler<{stop?: () => Promise<void>}>({
      isShuttingDown: () => false,
      announce: (request) => announced.push(request),
      createBundle: () =>
        buildRestartBundle({
          build: async () => {
            active = await nextBundle()

            return {server: {}, firstCompile: Promise.resolve(null)}
          },
          activeCompiler: () => active,
          setActiveCompiler: (compiler) => {
            active = compiler
          },
          takeUnfinishedRelease: () => null
        }),
      currentServer: () => null,
      setCurrentServer: () => {},
      holdPort: () => {},
      endPortHold: () => {},
      startBundler: async () => {},
      onBundleFailure: failure.bundle,
      onStopFailure: failure.stop,
      onStartFailure: failure.start,
      fullReloadsDelivered: () => 0,
      reloadAfterRestart: async () => {}
    })
  )

  bindDevSessionRestart(scheduler)

  return {
    scheduler,
    announced,
    frames,
    lines,
    active: () => active,
    buildsNext: (build: () => Compiler | Promise<Compiler>) => {
      nextBundle = build
    }
  }
}

// Past the window a changed set has to hold for and the wait the scheduler
// adds, with the restart that was asked for run to its end.
const settle = () =>
  vi.advanceTimersByTimeAsync(
    MAIN_WORLD_SETTLE_MS + DEV_SESSION_RESTART_DEBOUNCE_MS + 2
  )

// A session whose first MAIN world restart has just failed.
async function afterFailedRestart(registration = REGISTRATION) {
  const files = project(IDLE)
  const compiler = compilerIn(files)
  const session = devSession(compiler)

  expect((await save(compiler)).held).toBe(false)

  files.write(`${IDLE}${registration}`)
  expect((await save(compiler)).held).toBe(true)
  await settle()

  expect(session.announced).toHaveLength(1)
  expect(session.frames).toHaveLength(1)
  expect(session.active()).toBe(compiler)
  expect(isCompilerRestarting(compiler)).toBe(false)

  return {files, compiler, session}
}

describe('a MAIN world restart that could not build its next bundle', () => {
  it('asks for the restart again on the next save, as its hint says', async () => {
    const {files, compiler, session} = await afterFailedRestart()

    expect(session.lines.join('\n')).toContain(
      'save the changed file again to retry'
    )

    const saved = await save(compiler)

    expect(saved.held).toBe(true)
    expect(saved.warnings).toEqual([])
    await settle()

    expect(session.announced).toHaveLength(2)
    expect(session.announced[1]).toMatchObject({
      reason: 'main-world',
      pathChanged: files.at('scripts/hook.js'),
      registeredBy: files.at('register.js')
    })
  })

  it('asks once for each save while the restart keeps failing, never on its own', async () => {
    const {compiler, session} = await afterFailedRestart()

    for (let saves = 1; saves <= 3; saves++) {
      expect((await save(compiler)).held).toBe(true)
      await settle()
      expect(session.announced).toHaveLength(1 + saves)
      expect(session.frames).toHaveLength(1 + saves)

      // No save, so nothing asks: the step does not rebuild by itself.
      await settle()
      await settle()
      expect(session.announced).toHaveLength(1 + saves)
    }
  })

  it('moves to the next compiler once a retry builds, and that one reloads', async () => {
    const {files, compiler, session} = await afterFailedRestart()
    let next: Compiler | undefined

    session.buildsNext(() => {
      next = compilerIn(files)

      return next
    })

    expect((await save(compiler)).held).toBe(true)
    await settle()

    expect(session.announced).toHaveLength(2)
    expect(session.frames).toHaveLength(1)
    expect(session.active()).toBe(next)

    const saved = await save(next!)

    expect(saved.held).toBe(false)
    expect(saved.warnings).toEqual([])
    await settle()
    expect(session.announced).toHaveLength(2)
  })

  it('reloads again once the registration is taken back, and asks for nothing', async () => {
    const {files, compiler, session} = await afterFailedRestart()

    files.write(`${IDLE}// taken back\n`)

    for (let saves = 0; saves < 2; saves++) {
      const saved = await save(compiler)

      expect(saved.held).toBe(false)
      expect(saved.warnings).toEqual([])
      expect(isAwaitingMainWorldRestart(compiler)).toBe(false)
      await settle()
    }

    expect(session.announced).toHaveLength(1)
  })

  it('asks for a different registration written after the failure', async () => {
    const {files, compiler, session} = await afterFailedRestart()

    files.write(`${IDLE}${OTHER_REGISTRATION}`)
    expect((await save(compiler)).held).toBe(true)
    await settle()

    expect(session.announced).toHaveLength(2)
    expect(session.announced[1].pathChanged).toContain('other.js')
  })

  it('keeps waiting on a second change still in line when the first restart fails', async () => {
    const files = project(IDLE)
    const compiler = compilerIn(files)
    const session = devSession(compiler)
    const failures: Array<() => void> = []

    // Each restart stays at its bundle step until the test fails it.
    session.buildsNext(
      () =>
        new Promise<Compiler>((_resolve, reject) => {
          failures.push(() => reject(new Error('The next bundle broke')))
        })
    )

    files.write(`${IDLE}${REGISTRATION}`)
    expect((await save(compiler)).held).toBe(true)
    await settle()
    expect(failures).toHaveLength(1)

    files.write(`${IDLE}${OTHER_REGISTRATION}`)
    expect((await save(compiler)).held).toBe(true)
    await settle()
    expect(session.announced).toHaveLength(1)

    failures[0]()
    await vi.advanceTimersByTimeAsync(0)
    expect(session.frames).toHaveLength(1)
    expect(isCompilerRestarting(compiler)).toBe(false)

    // A save lands before the restart in line starts. That restart is still
    // coming, so the save waits on it and asks for no third one.
    expect((await save(compiler)).held).toBe(true)
    await settle()
    expect(session.announced).toHaveLength(2)
    expect(session.announced[1].pathChanged).toContain('other.js')

    failures[1]()
    await settle()
    expect(session.frames).toHaveLength(2)
    expect(session.announced).toHaveLength(2)

    // Now nothing is in line, so this save is the retry.
    expect((await save(compiler)).held).toBe(true)
    await settle()
    expect(session.announced).toHaveLength(3)
  })

  it('does not push the restart back for a build made while the set settles', async () => {
    const files = project(IDLE)
    const compiler = compilerIn(files)
    const session = devSession(compiler)

    files.write(`${IDLE}${REGISTRATION}`)
    expect((await save(compiler)).held).toBe(true)
    await vi.advanceTimersByTimeAsync(MAIN_WORLD_SETTLE_MS - 1)
    expect((await save(compiler)).held).toBe(true)

    await vi.advanceTimersByTimeAsync(DEV_SESSION_RESTART_DEBOUNCE_MS + 2)
    expect(session.announced).toHaveLength(1)
  })

  it('leaves the step alone when the restart another source asked for fails', async () => {
    const files = project(IDLE)
    const compiler = compilerIn(files)
    const session = devSession(compiler)

    await save(compiler)
    requestDevSessionRestart(compiler, {reason: 'env'})
    await settle()
    expect(session.frames).toHaveLength(1)

    const saved = await save(compiler)

    expect(saved.held).toBe(false)
    expect(saved.warnings).toEqual([])
    expect(isAwaitingMainWorldRestart(compiler)).toBe(false)
    await settle()
    expect(session.announced).toHaveLength(1)
  })

  it('warns and reloads once the session can no longer restart itself', async () => {
    const {compiler, session} = await afterFailedRestart()

    unbindDevSessionRestart()

    const saved = await save(compiler)

    expect(saved.held).toBe(false)
    expect(saved.warnings).toHaveLength(1)
    expect(saved.warnings[0]).toContain('Restart the dev server')
    await settle()
    expect(session.announced).toHaveLength(1)
  })
})

// A library host can run two dev sessions. Each compiler must be answered by
// the session it was built for, never by the newest one.
describe('a MAIN world change in one of two live sessions', () => {
  // A second session bound after the first, whose own restart never ends.
  function otherSession() {
    const scheduler = new DevSessionRestartScheduler()
    const asked: DevSessionRestartRequest[] = []

    scheduler.setHandler((request) => {
      asked.push(request)

      return new Promise<void>(() => {})
    })

    bindDevSessionRestart(scheduler)

    return {scheduler, asked}
  }

  it('is not held back by a restart still running in the other session', async () => {
    const files = project(IDLE)
    const compiler = compilerIn(files)
    const session = devSession(compiler)

    assignCompilerToDevSession(compiler, session.scheduler)

    const other = otherSession()

    other.scheduler.request({reason: 'env'})
    await vi.advanceTimersByTimeAsync(DEV_SESSION_RESTART_DEBOUNCE_MS + 2)
    expect(other.scheduler.isPending()).toBe(true)

    expect((await save(compiler)).held).toBe(false)
    files.write(`${IDLE}${REGISTRATION}`)
    expect((await save(compiler)).held).toBe(true)
    await settle()
    expect(session.frames).toHaveLength(1)

    // Its own session has nothing in line, so this save is the retry.
    expect((await save(compiler)).held).toBe(true)
    await settle()
    expect(session.announced).toHaveLength(2)
    expect(other.asked).toHaveLength(1)
  })

  it('warns once its own session ended, though the other one is live', async () => {
    const files = project(IDLE)
    const compiler = compilerIn(files)
    const session = devSession(compiler)

    assignCompilerToDevSession(compiler, session.scheduler)

    const other = otherSession()

    expect((await save(compiler)).held).toBe(false)
    unbindDevSessionRestart(session.scheduler)

    files.write(`${IDLE}${REGISTRATION}`)

    const saved = await save(compiler)

    expect(saved.held).toBe(false)
    expect(saved.warnings).toHaveLength(1)
    expect(saved.warnings[0]).toContain('Restart the dev server')
    await settle()
    expect(session.announced).toEqual([])
    expect(other.asked).toEqual([])
  })
})
