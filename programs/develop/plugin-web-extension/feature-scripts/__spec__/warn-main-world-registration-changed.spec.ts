import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {WarnMainWorldRegistrationChanged} from '../steps/warn-main-world-registration-changed'

const roots: string[] = []

afterEach(() => {
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
function session(background: string, mode = 'development') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-main-changed-'))
  roots.push(root)

  const at = (name: string) => path.join(root, name)

  fs.mkdirSync(at('scripts'))
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
