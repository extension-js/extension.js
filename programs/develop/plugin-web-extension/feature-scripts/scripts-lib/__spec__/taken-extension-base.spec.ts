import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {describe, expect, it} from 'vitest'
import {
  EXTENSION_BASE_ATTRIBUTE,
  extensionBaseAttribute,
  extensionBaseGlobal,
  TAKE_BLOCK_OPEN,
  takeBlockOpen
} from '../../../../lib/extension-base-from-stack'
import {
  closeTakeBlock,
  extensionBaseAttributeFor,
  extensionBaseGlobalFor,
  isEntryFile,
  TAKE_BLOCK_COLUMNS,
  takesExtensionBase
} from '../taken-extension-base'

const BASE = 'moz-extension://0f0f0f0f-aaaa-bbbb-cccc-121212121212/'

describe('the block a Gecko MAIN world file is closed in', () => {
  it('opens on the read and closes at the end of the file', () => {
    const {open, closed} = closeTakeBlock('window.ran = __extjsTakenBase')

    expect(open).toBe(TAKE_BLOCK_OPEN)
    expect(closed).toBe('window.ran = __extjsTakenBase\n}')
    expect(takesExtensionBase(`${open}${closed}`)).toBe(true)
    expect(takesExtensionBase(closed)).toBe(false)

    const window: Record<string, unknown> = {}
    vm.runInNewContext(`${open}${closed}`, {
      window,
      __EXTJS_EXTENSION_BASE__: BASE
    })

    expect(window.ran).toBe(BASE)
  })

  it('closes ahead of the source map comment, which stays last', () => {
    const {open, closed} = closeTakeBlock(
      'window.ran = 1\n//# sourceMappingURL=main.js.map\n'
    )

    expect(closed).toBe('window.ran = 1\n}\n//# sourceMappingURL=main.js.map\n')
    expect(() => new vm.Script(`${open}${closed}`)).not.toThrow()
  })

  it('leaves a source map comment in the middle of the file where it is', () => {
    const {closed} = closeTakeBlock(
      'one()\n//# sourceMappingURL=one.js.map\ntwo()'
    )

    expect(closed).toBe('one()\n//# sourceMappingURL=one.js.map\ntwo()\n}')
  })

  it('keeps the value the file completes with', () => {
    const {open, closed} = closeTakeBlock('var kept = 41\nkept + 1')

    expect(vm.runInNewContext(`${open}${closed}`)).toBe(42)
  })

  it('fills the columns the bridge answers, on line one', () => {
    const bridge = fs.readFileSync(
      path.join(
        __dirname,
        '..',
        '..',
        'steps',
        'add-content-script-wrapper',
        'main-world-bridge.js'
      ),
      'utf-8'
    )
    const columns = /const EXTJS_TAKE_COLUMNS = (\d+)\r?\n/.exec(bridge)

    expect(TAKE_BLOCK_COLUMNS).toBe(
      takeBlockOpen(extensionBaseGlobal('any extension')).length
    )

    expect(TAKE_BLOCK_COLUMNS).toBeGreaterThan(TAKE_BLOCK_OPEN.length)
    expect(Number(columns?.[1])).toBe(TAKE_BLOCK_COLUMNS)
  })
})

describe('isEntryFile', () => {
  it('names the file a production build and a dev build emit for an entry', () => {
    const entry = 'content_scripts/content-0'

    expect(isEntryFile('content_scripts/content-0.js', entry)).toBe(true)
    expect(isEntryFile('content_scripts/content-0.1a2b3c4d.js', entry)).toBe(
      true
    )
  })

  it('names no other entry, chunk, map or sheet', () => {
    const entry = 'content_scripts/content-0'

    for (const other of [
      'content_scripts/content-01.js',
      'content_scripts/content-0.js.map',
      'content_scripts/content-0.css',
      'content_scripts/content-0.lazy.js',
      'content_scripts/content-0.1a2b3c4.js',
      'content_scripts/content-0.1A2B3C4D.js',
      'content_scripts/content-0.1a2b3c4d.hot-update.js',
      'content_scripts/content-1.js',
      'other/content_scripts/content-0.js'
    ]) {
      expect(isEntryFile(other, entry), other).toBe(false)
    }
  })

  it('reads an entry name as text, a dot or a bracket in it included', () => {
    expect(isEntryFile('scripts/a.b[c].js', 'scripts/a.b[c]')).toBe(true)
    expect(isEntryFile('scripts/aXb[c].js', 'scripts/a.b[c]')).toBe(false)
  })
})

describe('extensionBaseGlobalFor', () => {
  const written = (manifest: Record<string, unknown>) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-base-global-'))
    const file = path.join(root, 'manifest.json')

    fs.writeFileSync(file, JSON.stringify(manifest))

    return {file, done: () => fs.rmSync(root, {recursive: true, force: true})}
  }

  it('names a global from the id, name and description of the manifest', () => {
    const first = written({
      name: 'First',
      description: 'One',
      browser_specific_settings: {gecko: {id: 'first@example.com'}}
    })
    const second = written({name: 'Second'})
    const twin = written({
      name: 'First',
      description: 'One',
      'firefox:browser_specific_settings': {gecko: {id: 'first@example.com'}}
    })

    try {
      const global = extensionBaseGlobalFor(first.file, 'firefox')

      expect(global).toBe(extensionBaseGlobal('first@example.com\nFirst\nOne'))
      // No id names this one, so its whole manifest does.
      expect(extensionBaseGlobalFor(second.file, 'firefox')).toBe(
        extensionBaseGlobal('\nSecond\n\n{"name":"Second"}')
      )

      expect(extensionBaseGlobalFor(second.file, 'firefox')).not.toBe(global)
      expect(extensionBaseGlobalFor(twin.file, 'firefox')).toBe(global)
      expect(closeTakeBlock('body()', global).open).toBe(takeBlockOpen(global))
      expect(takesExtensionBase(`${takeBlockOpen(global)}body()\n}`)).toBe(true)
    } finally {
      first.done()
      second.done()
      twin.done()
    }
  })

  it('keeps one name for a session, whatever the manifest says later', () => {
    const {file, done} = written({name: 'Before'})

    try {
      const global = extensionBaseGlobalFor(file, 'firefox')

      fs.writeFileSync(file, JSON.stringify({name: 'After'}))

      expect(extensionBaseGlobalFor(file, 'firefox')).toBe(global)
    } finally {
      done()
    }
  })

  it('keys the attribute on every engine, one name per manifest', () => {
    const first = written({name: 'Keyed first'})
    const second = written({name: 'Keyed second'})

    try {
      const attribute = extensionBaseAttributeFor(first.file, 'firefox')

      expect(attribute).toBe(
        extensionBaseAttribute(extensionBaseGlobalFor(first.file, 'firefox'))
      )

      expect(attribute).toMatch(/^data-extjs-extension-base-[0-9a-f]{8}$/)
      expect(extensionBaseAttributeFor(second.file, 'firefox')).not.toBe(
        attribute
      )

      for (const browser of ['chrome', 'edge', 'chromium', 'safari'] as const) {
        const keyed = extensionBaseAttributeFor(first.file, browser)

        expect(keyed).toMatch(/^data-extjs-extension-base-[0-9a-f]{8}$/)
        expect(extensionBaseAttributeFor(second.file, browser)).toMatch(
          /^data-extjs-extension-base-[0-9a-f]{8}$/
        )

        expect(extensionBaseAttributeFor(second.file, browser)).not.toBe(keyed)
      }

      expect(extensionBaseAttributeFor(undefined, 'firefox')).toBe(
        EXTENSION_BASE_ATTRIBUTE
      )
    } finally {
      first.done()
      second.done()
    }
  })

  it('tells two extensions apart when a localized name is all they carry', () => {
    const shared = {name: '__MSG_extName__', description: '__MSG_extDesc__'}
    const first = written({...shared, version: '1.0.0'})
    const second = written({...shared, version: '2.0.0'})

    try {
      for (const browser of ['chrome', 'firefox', 'safari'] as const) {
        expect(extensionBaseAttributeFor(first.file, browser)).not.toBe(
          extensionBaseAttributeFor(second.file, browser)
        )
      }
    } finally {
      first.done()
      second.done()
    }
  })

  it('keys a manifest nobody can read by where it is, never the shared name', () => {
    const missing = (name: string) =>
      path.join(os.tmpdir(), name, 'manifest.json')

    for (const browser of ['chrome', 'firefox', 'safari'] as const) {
      const global = extensionBaseGlobalFor(missing('extjs-no-such-a'), browser)

      expect(global).toMatch(/^__EXTJS_EXTENSION_BASE_[0-9a-f]{8}__$/)
      expect(
        extensionBaseGlobalFor(missing('extjs-no-such-b'), browser)
      ).not.toBe(global)

      expect(
        extensionBaseAttributeFor(missing('extjs-no-such-a'), browser)
      ).toMatch(/^data-extjs-extension-base-[0-9a-f]{8}$/)
    }
  })
})
