import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {describe, expect, it} from 'vitest'
import {TAKE_BLOCK_OPEN} from '../../../../lib/extension-base-from-stack'
import {
  closeTakeBlock,
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
    const columns = /const EXTJS_TAKE_COLUMNS = (\d+)\n/.exec(bridge)

    expect(TAKE_BLOCK_COLUMNS).toBe(TAKE_BLOCK_OPEN.length)
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
