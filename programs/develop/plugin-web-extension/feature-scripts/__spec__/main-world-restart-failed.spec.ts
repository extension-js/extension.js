import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  bindDevSessionRestart,
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

  let nextBundle: () => Compiler = () => {
    throw new Error('The next bundle could not be built')
  }

  const announced: DevSessionRestartRequest[] = []
  const frames: Array<{code: string; message: string}> = []
  const lines: string[] = []
  const scheduler = new DevSessionRestartScheduler(0)
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
      announce: (request) => announced.push(request),
      createBundle: () =>
        buildRestartBundle({
          build: async () => {
            active = nextBundle()

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
    announced,
    frames,
    lines,
    active: () => active,
    buildsNext: (build: () => Compiler) => {
      nextBundle = build
    }
  }
}

// Past the window a changed set has to hold for, with the restart it asked
// for run to its end.
const settle = () => vi.advanceTimersByTimeAsync(MAIN_WORLD_SETTLE_MS + 1)

describe('a MAIN world restart that could not build its next bundle', () => {
  it('leaves every later save held, with no new restart, on the build that kept serving', async () => {
    const files = project(IDLE)
    const compiler = compilerIn(files)
    const session = devSession(compiler)

    expect((await save(compiler)).held).toBe(false)

    files.write(`${IDLE}${REGISTRATION}`)
    expect((await save(compiler)).held).toBe(true)
    await settle()

    expect(session.announced).toHaveLength(1)
    expect(session.frames).toHaveLength(1)
    expect(session.lines.join('\n')).toContain(
      'save the changed file again to retry'
    )

    expect(session.active()).toBe(compiler)
    expect(isCompilerRestarting(compiler)).toBe(false)

    // The hint says a save retries. The step still waits on the restart
    // that already failed, so the save is held and nothing is asked for.
    for (let saves = 0; saves < 3; saves++) {
      const saved = await save(compiler)

      expect(saved.held).toBe(true)
      expect(saved.warnings).toEqual([])
      await settle()
    }

    expect(session.announced).toHaveLength(1)
    expect(isAwaitingMainWorldRestart(compiler)).toBe(true)
  })

  it('reloads again once the registration is taken back', async () => {
    const files = project(IDLE)
    const compiler = compilerIn(files)
    const session = devSession(compiler)

    files.write(`${IDLE}${REGISTRATION}`)
    expect((await save(compiler)).held).toBe(true)
    await settle()
    expect(session.frames).toHaveLength(1)

    files.write(`${IDLE}// taken back\n`)

    const saved = await save(compiler)

    expect(saved.held).toBe(false)
    expect(isAwaitingMainWorldRestart(compiler)).toBe(false)
    await settle()
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
    await settle()
    expect(session.announced).toHaveLength(1)
  })
})
