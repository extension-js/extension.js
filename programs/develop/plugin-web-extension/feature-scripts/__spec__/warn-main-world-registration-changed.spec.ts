import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {devServerRestarting} from '../../../dev-server/messages'
import {
  bindDevSessionRestart,
  type DevSessionRestartRequest,
  DevSessionRestartScheduler,
  unbindDevSessionRestart
} from '../../../dev-server/session-restart'
import {WarnMainWorldRegistrationChanged} from '../steps/warn-main-world-registration-changed'

const roots: string[] = []

afterEach(() => {
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

  new WarnMainWorldRegistrationChanged({
    manifestPath: at('manifest.json'),
    includeList: {
      'background/service_worker': at('background.js'),
      'scripts/hook': at('scripts/hook.js')
    }
  }).apply({
    options: {mode, context: root},
    hooks: {
      thisCompilation: {
        tap: (_name: string, callback: typeof compile) => {
          compile = callback
        }
      }
    }
  } as any)

  return {
    root,
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

describe('a MAIN world registration that changes in a session that can restart', () => {
  it('restarts once for a new registration, naming the file and its source, without a warning', async () => {
    const requests = restartable()
    const dev = session(IDLE)

    dev.write(`${IDLE}${REGISTRATION}`)

    expect(dev.rebuild()).toEqual([])
    expect(dev.rebuild()).toEqual([])
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 20))

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
    await vi.waitFor(() => expect(requests).toHaveLength(1))

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
    await vi.waitFor(() => expect(requests).toHaveLength(1))

    dev.write(`${IDLE}// taken back\n`)
    expect(dev.rebuild()).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(requests).toHaveLength(1)

    dev.write(`${IDLE}${REGISTRATION}`)
    expect(dev.rebuild()).toEqual([])
    await vi.waitFor(() => expect(requests).toHaveLength(2))
  })

  it('warns instead of restarting again when the restart did not take the set', async () => {
    const requests = restartable()
    const before = session(IDLE)

    before.write(`${IDLE}${REGISTRATION}`)
    before.rebuild()
    await vi.waitFor(() => expect(requests).toHaveLength(1))

    // The next compiler was made without the call and then finds it too.
    const after = session(IDLE, 'development', before.root)

    after.write(`${IDLE}${REGISTRATION}`)

    const warnings = after.rebuild()

    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('Restart the dev server')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(requests).toHaveLength(1)
  })

  it('restarts again from a compiler the last restart put in line', async () => {
    const requests = restartable()
    const before = session(IDLE)

    before.write(`${IDLE}${REGISTRATION}`)
    before.rebuild()
    await vi.waitFor(() => expect(requests).toHaveLength(1))

    const after = session(`${IDLE}${REGISTRATION}`, 'development', before.root)

    expect(after.rebuild()).toEqual([])

    after.write(`${IDLE}// removed\n`)
    expect(after.rebuild()).toEqual([])
    await vi.waitFor(() => expect(requests).toHaveLength(2))

    const last = session(`${IDLE}// removed\n`, 'development', before.root)

    last.write(`${IDLE}${REGISTRATION}`)
    expect(last.rebuild()).toEqual([])
    await vi.waitFor(() => expect(requests).toHaveLength(3))
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
