import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {rememberSpecialFoldersConfig} from '../../lib/special-folders/folders-config'
import type {DevOptions} from '../../types'
import {
  callable,
  configure,
  MANIFEST,
  makeProject,
  swcRules
} from './project-fixture'

function project(manifest: Record<string, unknown> = {}) {
  return makeProject({
    'package.json': {},
    'manifest.json': {...MANIFEST, ...manifest}
  })
}

// The content-script layer's path test, asked with a project-relative path.
async function contentScriptLayerInclude(
  root: string,
  browser: DevOptions['browser']
) {
  const include = callable(
    swcRules(await configure(root, {browser})).contentByPath?.include
  )

  return (relative: string) => include(path.join(root, relative))
}

describe('JsFrameworksPlugin content-script layer, browser-prefixed keys', () => {
  it('claims a content script declared under firefox:content_scripts', async () => {
    const root = project({
      'firefox:content_scripts': [{js: ['content/script.js']}]
    })
    const include = await contentScriptLayerInclude(root, 'firefox')

    expect(include('content/script.js')).toBe(true)
  })

  it('claims a chromium:-prefixed content script on any chromium target', async () => {
    const root = project({
      'chromium:content_scripts': [{js: ['content/script.js']}]
    })
    const include = await contentScriptLayerInclude(root, 'edge')

    expect(include('content/script.js')).toBe(true)
  })

  it('leaves a chrome:-prefixed content script out of an edge build', async () => {
    const root = project({
      'chrome:content_scripts': [{js: ['content/script.js']}]
    })
    const include = await contentScriptLayerInclude(root, 'edge')

    expect(include('content/script.js')).toBe(false)
  })

  it('leaves another browser prefix out of this build', async () => {
    const root = project({
      'firefox:content_scripts': [{js: ['content/script.js']}]
    })
    const include = await contentScriptLayerInclude(root, 'chrome')

    expect(include('content/script.js')).toBe(false)
  })

  it('still claims a plain content script', async () => {
    const root = project({content_scripts: [{js: ['content/script.js']}]})
    const include = await contentScriptLayerInclude(root, 'chrome')

    expect(include('content/script.js')).toBe(true)
    expect(include('content/other.js')).toBe(false)
  })

  it('claims a file under scripts/ until the folder is turned off', async () => {
    const root = project()
    const claimed = await contentScriptLayerInclude(root, 'chrome')
    expect(claimed('scripts/inject.js')).toBe(true)

    rememberSpecialFoldersConfig(root, {scripts: false})

    try {
      const plain = await contentScriptLayerInclude(root, 'chrome')
      expect(plain('scripts/inject.js')).toBe(false)
    } finally {
      rememberSpecialFoldersConfig(root, undefined)
    }
  })

  it('follows scripts/ to the folder it was moved to', async () => {
    const root = project()
    rememberSpecialFoldersConfig(root, {scripts: 'src/scripts'})

    try {
      const include = await contentScriptLayerInclude(root, 'chrome')
      expect(include('src/scripts/inject.js')).toBe(true)
      expect(include('scripts/inject.js')).toBe(false)
    } finally {
      rememberSpecialFoldersConfig(root, undefined)
    }
  })
})
