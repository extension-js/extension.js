import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {isContentScriptEntry} from '../../css-lib/is-content-script'

const roots: string[] = []

function makeProject(manifest: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cs-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify(manifest),
    'utf8'
  )
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('isContentScriptEntry with browser-prefixed keys', () => {
  it('claims a content script declared under firefox:content_scripts', () => {
    const root = makeProject({
      'firefox:content_scripts': [{js: ['content.js']}]
    })
    expect(
      isContentScriptEntry(
        path.join(root, 'content.js'),
        path.join(root, 'manifest.json'),
        root,
        'firefox'
      )
    ).toBe(true)
  })

  it('claims a chrome:-prefixed content script on any chromium target', () => {
    const root = makeProject({'chrome:content_scripts': [{js: ['content.js']}]})
    expect(
      isContentScriptEntry(
        path.join(root, 'content.js'),
        path.join(root, 'manifest.json'),
        root,
        'edge'
      )
    ).toBe(true)
  })

  it('leaves another browser prefix out of this build', () => {
    const root = makeProject({
      'firefox:content_scripts': [{js: ['content.js']}]
    })
    expect(
      isContentScriptEntry(
        path.join(root, 'content.js'),
        path.join(root, 'manifest.json'),
        root,
        'chrome'
      )
    ).toBe(false)
  })

  it('lets a prefixed key win over the plain key for its own target', () => {
    const root = makeProject({
      content_scripts: [{js: ['shared.js']}],
      'firefox:content_scripts': [{js: ['gecko-only.js']}]
    })
    const manifestPath = path.join(root, 'manifest.json')
    expect(
      isContentScriptEntry(
        path.join(root, 'gecko-only.js'),
        manifestPath,
        root,
        'firefox'
      )
    ).toBe(true)
    expect(
      isContentScriptEntry(
        path.join(root, 'shared.js'),
        manifestPath,
        root,
        'firefox'
      )
    ).toBe(false)
  })

  // Same manifest, same project, two targets in one process: the cached index
  // must not answer for the browser it was not built for.
  it('does not serve one browser a cached answer built for another', () => {
    const root = makeProject({
      'chrome:content_scripts': [{js: ['chromium.js']}],
      'firefox:content_scripts': [{js: ['gecko.js']}]
    })
    const manifestPath = path.join(root, 'manifest.json')

    expect(
      isContentScriptEntry(
        path.join(root, 'chromium.js'),
        manifestPath,
        root,
        'chrome'
      )
    ).toBe(true)
    expect(
      isContentScriptEntry(
        path.join(root, 'gecko.js'),
        manifestPath,
        root,
        'firefox'
      )
    ).toBe(true)
    expect(
      isContentScriptEntry(
        path.join(root, 'gecko.js'),
        manifestPath,
        root,
        'chrome'
      )
    ).toBe(false)
    expect(
      isContentScriptEntry(
        path.join(root, 'chromium.js'),
        manifestPath,
        root,
        'firefox'
      )
    ).toBe(false)
  })

  it('still claims a plain content script with no browser given', () => {
    const root = makeProject({content_scripts: [{js: ['content.js']}]})
    expect(
      isContentScriptEntry(
        path.join(root, 'content.js'),
        path.join(root, 'manifest.json'),
        root
      )
    ).toBe(true)
  })
})
