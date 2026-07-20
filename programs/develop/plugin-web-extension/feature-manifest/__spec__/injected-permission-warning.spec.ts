import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {findInjectedOnlyPermissionUses} from '../steps/apply-dev-defaults'

describe('findInjectedOnlyPermissionUses (§64)', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'injected-perm-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const write = (rel: string, content: string) => {
    const abs = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
    return abs
  }

  const compilationWith = (resources: string[]) =>
    ({
      modules: resources.map((resource) => ({resource}))
    }) as unknown as Parameters<typeof findInjectedOnlyPermissionUses>[0]

  it('flags user source using an injected-only permission', () => {
    const sw = write('sw.js', 'chrome.storage.local.set({a: 1})\n')
    const hits = findInjectedOnlyPermissionUses(
      compilationWith([sw]),
      new Set(),
      ['storage', 'scripting', 'management']
    )
    expect(hits.get('storage')).toBe(sw)
    expect(hits.has('scripting')).toBe(false)
  })

  it('stays silent when the manifest declares the permission', () => {
    const sw = write('sw.js', 'browser.storage.sync.get("k")\n')
    const hits = findInjectedOnlyPermissionUses(
      compilationWith([sw]),
      new Set(['storage']),
      ['storage']
    )
    expect(hits.size).toBe(0)
  })

  it('ignores node_modules and non-script resources', () => {
    const dep = write(
      path.join('node_modules', 'lib', 'index.js'),
      'chrome.management.getAll()\n'
    )
    const css = write('style.css', 'chrome.storage {}\n')
    const hits = findInjectedOnlyPermissionUses(
      compilationWith([dep, css]),
      new Set(),
      ['storage', 'management']
    )
    expect(hits.size).toBe(0)
  })
})
