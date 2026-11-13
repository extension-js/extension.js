import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {devServerRestarting} from '../../../dev-server/messages'
import {
  bindDevSessionRestart,
  type DevSessionRestartRequest,
  DevSessionRestartScheduler,
  unbindDevSessionRestart
} from '../../../dev-server/session-restart'
import {
  isAwaitingMainWorldRestart,
  MAIN_WORLD_SETTLE_MS,
  WarnMainWorldRegistrationChanged
} from '../steps/warn-main-world-registration-changed'

const roots: string[] = []

afterEach(() => {
  vi.useRealTimers()
  unbindDevSessionRestart()

  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, {recursive: true, force: true})
  }
})

const REGISTRATION =
  'chrome.scripting.registerContentScripts([{id: "hook", js: ["scripts/hook.js"], ' +
  'world: "MAIN", matches: ["<all_urls>"]}])\n'
const IDLE = 'console.log("nothing registered")\n'

// A dev session over a background and one scripts/ file, with the hook the
// step taps so a test can stand in for each rebuild.
function session(background: string, mode = 'development', inRoot?: string) {
  const root =
    inRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-main-changed-'))
  if (!inRoot) roots.push(root)

  const at = (name: string) => path.join(root, name)

  fs.mkdirSync(at('scripts'), {recursive: true})
  fs.writeFileSync(at('manifest.json'), '{}')
  fs.writeFileSync(at('scripts/hook.js'), 'window.__PAGE_HOOK__ = 1\n')
  fs.writeFileSync(at('register.js'), background)
  fs.writeFileSync(at('background.js'), 'import "./register.js"\n')

  let compile: ((compilation: {warnings: Error[]}) => void) | undefined
  let close: (() => void) | undefined

  const compiler = {
    options: {mode, context: root},
    hooks: {
      thisCompilation: {
        tap: (_name: string, callback: typeof compile) => {
          compile = callback
        }
      },
      watchClose: {
        tap: (_name: string, callback: typeof close) => {
          close = callback
        }
      }
    }
  }

  new WarnMainWorldRegistrationChanged({
    manifestPath: at('manifest.json'),
    includeList: {
      'background/service_worker': at('background.js'),
      'scripts/hook': at('scripts/hook.js')
    }
  }).apply(compiler as any)

  return {
    root,
    compiler,
    close: () => close?.(),
    tapped: () => compile !== undefined,
    write: (contents: string) => fs.writeFileSync(at('register.js'), contents),
    rebuild: () => {
      const compilation = {warnings: [] as Array<Error & {file?: string}>}
      compile?.(compilation)

      return compilation.warnings
    }
  }
}

describe('a MAIN world registration that changes during a dev session', () => {
  it('says nothing while the registrations are the ones the session started with', () => {
    expect(session(IDLE).rebuild()).toEqual([])
    expect(session(REGISTRATION).rebuild()).toEqual([])
  })

  it('names the script and the file that now registers it, and asks for a restart', () => {
    const dev = session(IDLE)

    dev.write(`${IDLE}${REGISTRATION}`)

    const warnings = dev.rebuild()

    expect(warnings).toHaveLength(1)
    expect(warnings[0].file).toBe('register.js')
    expect(warnings[0].message).toContain(
      'register.js now registers scripts/hook.js into the MAIN world'
    )

    expect(warnings[0].message).toContain('Restart the dev server')
  })

  it('keeps warning on each rebuild until the call is taken back', () => {
    const dev = session(IDLE)

    dev.write(`${IDLE}${REGISTRATION}`)

    expect(dev.rebuild()).toHaveLength(1)
    expect(dev.rebuild()).toHaveLength(1)

    dev.write(`${IDLE}// taken back\n`)

    expect(dev.rebuild()).toEqual([])
  })

  it('names a script whose registration was removed', () => {
    const dev = session(REGISTRATION)

    dev.write(`${IDLE}// removed\n`)

    const warnings = dev.rebuild()

    expect(warnings).toHaveLength(1)
    expect(warnings[0].file).toBe('scripts/hook.js')
    expect(warnings[0].message).toContain(
      'Nothing registers scripts/hook.js into the MAIN world anymore'
    )

    expect(warnings[0].message).toContain('Restart the dev server')
  })

  it('stays out of a production build, which compiles once', () => {
    expect(session(IDLE, 'production').tapped()).toBe(false)
  })
})

const ANSI = /\u001b\[[0-9;]*m/g

// A session that can restart itself, with the requests it was handed.
function restartable() {
  const requests: DevSessionRestartRequest[] = []
  const scheduler = new DevSessionRestartScheduler(0)

  scheduler.setHandler((request) => {
    requests.push(request)
  })

  bindDevSessionRestart(scheduler)

  return requests
}

// Past the window a changed set has to hold for, with every timer run.
const settle = () => vi.advanceTimersByTimeAsync(MAIN_WORLD_SETTLE_MS + 1)

describe('a MAIN world registration that changes in a session that can restart', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('restarts once for a new registration, naming the file and its source, without a warning', async () => {
    const requests = restartable()
    const dev = session(IDLE)

    dev.write(`${IDLE}${REGISTRATION}`)

    expect(dev.rebuild()).toEqual([])
    expect(dev.rebuild()).toEqual([])
    await settle()
    expect(requests).toHaveLength(1)
    await settle()

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      reason: 'main-world',
      pathChanged: path.join(dev.root, 'scripts/hook.js'),
      registeredBy: path.join(dev.root, 'register.js')
    })
  })

  it('restarts for a registration that was removed', async () => {
    const requests = restartable()
    const dev = session(REGISTRATION)

    dev.write(`${IDLE}// removed\n`)

    expect(dev.rebuild()).toEqual([])
    await settle()
    expect(requests).toHaveLength(1)

    expect(requests[0]).toMatchObject({
      reason: 'main-world',
      pathChanged: path.join(dev.root, 'scripts/hook.js')
    })

    expect(requests[0].registeredBy).toBeUndefined()
  })

  it('asks again only after the set went back to the one the session started with', async () => {
    const requests = restartable()
    const dev = session(IDLE)

    dev.write(`${IDLE}${REGISTRATION}`)
    dev.rebuild()
    await settle()
    expect(requests).toHaveLength(1)

    dev.write(`${IDLE}// taken back\n`)
    expect(dev.rebuild()).toEqual([])
    await settle()
    expect(requests).toHaveLength(1)

    dev.write(`${IDLE}${REGISTRATION}`)
    expect(dev.rebuild()).toEqual([])
    await settle()
    expect(requests).toHaveLength(2)
  })

  it('warns instead of restarting again when the restart did not take the set', async () => {
    const requests = restartable()
    const before = session(IDLE)

    before.write(`${IDLE}${REGISTRATION}`)
    before.rebuild()
    await settle()
    expect(requests).toHaveLength(1)

    // The next compiler was made without the call and then finds it too.
    const after = session(IDLE, 'development', before.root)

    after.write(`${IDLE}${REGISTRATION}`)

    const warnings = after.rebuild()

    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('Restart the dev server')
    await settle()
    expect(requests).toHaveLength(1)
  })

  it('restarts again from a compiler the last restart put in line', async () => {
    const requests = restartable()
    const before = session(IDLE)

    before.write(`${IDLE}${REGISTRATION}`)
    before.rebuild()
    await settle()
    expect(requests).toHaveLength(1)

    const after = session(`${IDLE}${REGISTRATION}`, 'development', before.root)

    expect(after.rebuild()).toEqual([])

    after.write(`${IDLE}// removed\n`)
    expect(after.rebuild()).toEqual([])
    await settle()
    expect(requests).toHaveLength(2)

    const last = session(`${IDLE}// removed\n`, 'development', before.root)

    last.write(`${IDLE}${REGISTRATION}`)
    expect(last.rebuild()).toEqual([])
    await settle()
    expect(requests).toHaveLength(3)
  })

  // The request went out on the first rebuild, and nothing took it back, so
  // a call written and removed in two quick saves restarted the session.
  it('does not restart for a call written and taken back before it settled', async () => {
    const requests = restartable()
    const dev = session(IDLE)

    dev.write(`${IDLE}${REGISTRATION}`)
    expect(dev.rebuild()).toEqual([])
    expect(isAwaitingMainWorldRestart(dev.compiler)).toBe(true)

    await vi.advanceTimersByTimeAsync(MAIN_WORLD_SETTLE_MS - 1)
    expect(requests).toHaveLength(0)

    dev.write(`${IDLE}// taken back\n`)
    expect(dev.rebuild()).toEqual([])
    expect(isAwaitingMainWorldRestart(dev.compiler)).toBe(false)

    await settle()
    await settle()
    expect(requests).toHaveLength(0)
  })

  it('does not restart for a registration removed and put back before it settled', async () => {
    const requests = restartable()
    const dev = session(REGISTRATION)

    dev.write(`${IDLE}// removed\n`)
    expect(dev.rebuild()).toEqual([])
    dev.write(REGISTRATION)
    expect(dev.rebuild()).toEqual([])

    await settle()
    expect(requests).toHaveLength(0)
    expect(isAwaitingMainWorldRestart(dev.compiler)).toBe(false)
  })

  it('reads the file again as the window ends, ahead of a rebuild still to come', async () => {
    const requests = restartable()
    const dev = session(IDLE)

    dev.write(`${IDLE}${REGISTRATION}`)
    dev.rebuild()
    dev.write(`${IDLE}// taken back, not compiled yet\n`)

    await settle()
    expect(requests).toHaveLength(0)
    expect(isAwaitingMainWorldRestart(dev.compiler)).toBe(false)
  })

  it('restarts once for a set that keeps changing, a window after its last change', async () => {
    const requests = restartable()
    const dev = session(IDLE)

    dev.write(`${IDLE}${REGISTRATION}`)
    dev.rebuild()
    await vi.advanceTimersByTimeAsync(MAIN_WORLD_SETTLE_MS - 1)
    dev.write(`${IDLE}// taken back\n`)
    dev.rebuild()
    dev.write(`${IDLE}${REGISTRATION}`)
    dev.rebuild()

    await vi.advanceTimersByTimeAsync(MAIN_WORLD_SETTLE_MS - 1)
    expect(requests).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(2)
    expect(requests).toHaveLength(1)

    await settle()
    expect(requests).toHaveLength(1)
  })

  // Its build is the one the restart replaces, so the reload that follows a
  // build is held back from the first rebuild until the next compiler.
  it('marks its compiler as waiting on the restart until the set is taken back', async () => {
    restartable()
    const dev = session(IDLE)

    expect(isAwaitingMainWorldRestart(dev.compiler)).toBe(false)
    expect(isAwaitingMainWorldRestart(undefined)).toBe(false)

    dev.write(`${IDLE}${REGISTRATION}`)
    dev.rebuild()
    expect(isAwaitingMainWorldRestart(dev.compiler)).toBe(true)

    await settle()
    dev.rebuild()
    expect(isAwaitingMainWorldRestart(dev.compiler)).toBe(true)

    dev.write(`${IDLE}// taken back\n`)
    dev.rebuild()
    expect(isAwaitingMainWorldRestart(dev.compiler)).toBe(false)
  })

  it('leaves a compiler that only warns free to reload', async () => {
    const dev = session(IDLE)

    dev.write(`${IDLE}${REGISTRATION}`)

    expect(dev.rebuild()).toHaveLength(1)
    expect(isAwaitingMainWorldRestart(dev.compiler)).toBe(false)

    await settle()
    expect(dev.rebuild()).toHaveLength(1)
  })

  it('asks for nothing from a compiler that was closed while the set settled', async () => {
    const requests = restartable()
    const dev = session(IDLE)

    dev.write(`${IDLE}${REGISTRATION}`)
    dev.rebuild()
    dev.close()

    await settle()
    expect(requests).toHaveLength(0)
  })
})

describe('the restart notice for a MAIN world registration change', () => {
  const cwd = process.cwd()
  const hook = path.join(cwd, 'scripts/hook.js')

  it('names the file and the source that registers it on one line', () => {
    const line = devServerRestarting({
      reason: 'main-world',
      pathChanged: hook,
      registeredBy: path.join(cwd, 'background.js')
    }).replace(ANSI, '')

    expect(line).not.toContain('\n')
    expect(line).toContain(
      `Restarting the dev server to build ${path.join('scripts', 'hook.js')} for the MAIN world, where background.js now registers it…`
    )
  })

  it('says the file goes back to a content script once nothing registers it', () => {
    const line = devServerRestarting({
      reason: 'main-world',
      pathChanged: hook,
      alsoChanged: 2
    }).replace(ANSI, '')

    expect(line).not.toContain('\n')
    expect(line).toContain(
      `Restarting the dev server to build ${path.join('scripts', 'hook.js')} and 2 more as a content script, now that nothing registers it into the MAIN world…`
    )
  })
})
