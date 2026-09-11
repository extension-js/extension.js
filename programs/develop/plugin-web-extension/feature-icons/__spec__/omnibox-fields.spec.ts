import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {omniboxIconFields} from '../omnibox-fields'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, {recursive: true, force: true})
})

function manifestWith(content: Record<string, unknown>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-omnibox-'))
  dirs.push(dir)
  const manifestPath = path.join(dir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(content))
  return {dir, manifestPath}
}

describe('omniboxIconFields', () => {
  it('feeds a plain omnibox icon to the icons emitter', () => {
    const {dir, manifestPath} = manifestWith({
      omnibox: {default_icon: 'icons/omni.png'}
    })
    expect(omniboxIconFields(manifestPath)).toEqual({
      'omnibox/default_icon': path.join(dir, 'icons', 'omni.png')
    })
  })

  it('reads an omnibox declared under a browser prefix', () => {
    const {dir, manifestPath} = manifestWith({
      'chrome:omnibox': {default_icon: 'icons/omni.png'}
    })
    // A chrome: key covers the whole chromium family, edge included.
    expect(omniboxIconFields(manifestPath, 'edge')).toEqual({
      'omnibox/default_icon': path.join(dir, 'icons', 'omni.png')
    })
    // Another browser's prefix stays out of this build.
    expect(omniboxIconFields(manifestPath, 'firefox')).toEqual({})
  })

  it('keeps a sized icon map and resolves each entry', () => {
    const {dir, manifestPath} = manifestWith({
      'firefox:omnibox': {default_icon: {'16': 'icons/16.png'}}
    })
    expect(omniboxIconFields(manifestPath, 'firefox')).toEqual({
      'omnibox/default_icon': {'16': path.join(dir, 'icons', '16.png')}
    })
  })

  it('returns nothing without an omnibox icon', () => {
    const {manifestPath} = manifestWith({name: 'x'})
    expect(omniboxIconFields(manifestPath)).toEqual({})
  })
})
