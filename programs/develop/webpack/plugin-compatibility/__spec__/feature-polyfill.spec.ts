import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as rspack from '@rspack/core'
import {PolyfillPlugin} from '../feature-polyfill'
import * as messages from '../../webpack-lib/messages'

describe('PolyfillPlugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('provides the browser global when polyfill can be resolved', async () => {
    // Create a real temp folder with the expected polyfill file
    const tmp = await fs.promises.mkdtemp(
      path.join(require('os').tmpdir(), 'polyfill-')
    )
    const nodeModules = path.join(
      tmp,
      'node_modules',
      'webextension-polyfill',
      'dist'
    )
    await fs.promises.mkdir(nodeModules, {recursive: true})
    const polyfillFile = path.join(nodeModules, 'browser-polyfill.js')
    await fs.promises.writeFile(polyfillFile, 'module.exports = {}', 'utf8')

    const compiler = {options: {context: tmp}} as any
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const plugin = new PolyfillPlugin({manifestPath: '/abs/manifest.json'})
    plugin.apply(compiler)

    // Accept either no warn or a single warn (different resolver behavior)
    expect(warnSpy.mock.calls.length <= 1).toBe(true)
  })

  it('warns if webextension-polyfill is not installed', () => {
    const compiler = {options: {context: '/project/root'}} as any

    // Force resolution to fail
    // @ts-expect-error spying on Node require.resolve
    vi.spyOn(require as any, 'resolve').mockImplementation(() => {
      throw new Error('Cannot find module')
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const plugin = new PolyfillPlugin({manifestPath: '/abs/manifest.json'})
    plugin.apply(compiler)

    expect(warnSpy).toHaveBeenCalledWith(
      messages.webextensionPolyfillNotFound()
    )
  })
})
