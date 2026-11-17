import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {ReloadPlugin} from '../index'
import {idleCompiler, tapsAddedBy, writeProject} from './helpers/real-compiler'

const makeTempFolder = trackTempFolders()

const manifest = {
  manifest_version: 3,
  name: 'gating',
  version: '1.0.0',
  background: {service_worker: 'src/background.js'},
  content_scripts: [{matches: ['<all_urls>'], js: ['src/content.js']}]
}

function project() {
  const root = writeProject(makeTempFolder('extjs-reload-gating-'), {
    'manifest.json': manifest,
    'src/background.js': '',
    'src/content.js': ''
  })

  return {root, manifestPath: path.join(root, 'manifest.json')}
}

function applied(
  mode: 'development' | 'production',
  options: {browser?: string; devSession?: boolean; manifestPath?: string} = {}
) {
  const {root, manifestPath} = project()
  const compiler = idleCompiler(root, mode)
  const taps = tapsAddedBy(compiler, () =>
    new ReloadPlugin({
      manifestPath,
      browser: 'chrome',
      ...options
    } as ConstructorParameters<typeof ReloadPlugin>[0]).apply(compiler)
  )

  return {taps, entry: compiler.options.entry}
}

// The producer and the relay inject nothing without a control port, so a
// port is set for every test and the whole pipeline is visible.
beforeEach(() => {
  vi.stubEnv('EXTENSION_CONTROL_PORT', '8123')
  vi.stubEnv('EXTENSION_NO_RELOAD', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ReloadPlugin on a real development compiler', () => {
  it('taps every dev step, in order, for Chromium', () => {
    expect(applied('development').taps).toEqual({
      done: [
        'SetupDevContentScripts',
        'plugin-reload:prune-stale-hot-updates',
        'plugin-reload:prune-unreachable-chunks'
      ],
      thisCompilation: [
        'StripContentScriptDevServerRuntime',
        'StableContentScriptNames',
        'NoDangerNamePlugin',
        'InjectScriptsReplayShim',
        'SetupDevContentScripts',
        'InjectBridgeProducer',
        'InjectBridgeRelay'
      ],
      compilation: [
        'WebExtensionServiceWorkerEntryPlugin',
        'WebExtensionChuckLoaderRuntimePlugin',
        'WebExtensionPlugin'
      ],
      environment: ['WebExtensionPlugin'],
      entryOption: ['WebExtensionServiceWorkerEntryPlugin']
    })
  })

  it('keeps the manifest content scripts static for Firefox', () => {
    expect(applied('development', {browser: 'firefox'}).taps).toEqual({
      done: [
        'plugin-reload:prune-stale-hot-updates',
        'plugin-reload:prune-unreachable-chunks'
      ],
      thisCompilation: [
        'StripContentScriptDevServerRuntime',
        'StableContentScriptNames',
        'NoDangerNamePlugin',
        'InjectScriptsReplayShim',
        'InjectBridgeProducer',
        'InjectBridgeRelay'
      ],
      compilation: [
        'WebExtensionChuckLoaderRuntimePlugin',
        'WebExtensionPlugin'
      ],
      environment: ['WebExtensionPlugin']
    })
  })

  it('registers the declared service worker as the background entry', () => {
    const {entry} = applied('development')

    expect(Object.keys(entry as object)).toEqual(['background/service_worker'])
  })
})

describe('ReloadPlugin applies nothing', () => {
  it('on a production compiler', () => {
    expect(applied('production')).toEqual({taps: {}, entry: {}})
  })

  // A shippable development build carries no reload client.
  it('on a development compiler outside a dev session', () => {
    expect(applied('development', {devSession: false})).toEqual({
      taps: {},
      entry: {}
    })
  })

  it('when EXTENSION_NO_RELOAD=true (--no-reload)', () => {
    vi.stubEnv('EXTENSION_NO_RELOAD', 'true')

    expect(applied('development')).toEqual({taps: {}, entry: {}})
  })

  it('when the manifest path names no file', () => {
    const {root} = project()

    expect(
      applied('development', {manifestPath: path.join(root, 'missing.json')})
    ).toEqual({taps: {}, entry: {}})
  })

  it('when the manifest path names a folder', () => {
    const {root} = project()
    fs.mkdirSync(path.join(root, 'folder.json'))

    expect(
      applied('development', {manifestPath: path.join(root, 'folder.json')})
    ).toEqual({taps: {}, entry: {}})
  })
})

describe('ReloadPlugin in a dev session', () => {
  it('applies when devSession is true', () => {
    expect(
      applied('development', {devSession: true}).taps.thisCompilation
    ).toContain('StripContentScriptDevServerRuntime')
  })

  it('applies for any other EXTENSION_NO_RELOAD value', () => {
    vi.stubEnv('EXTENSION_NO_RELOAD', 'false')

    expect(applied('development').taps.thisCompilation).toContain(
      'StripContentScriptDevServerRuntime'
    )
  })
})
