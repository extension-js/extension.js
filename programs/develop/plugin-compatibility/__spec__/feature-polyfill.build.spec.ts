import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Configuration, rspack} from '@rspack/core'
import {beforeAll, describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {EXTENSIONJS_MAIN_WORLD_IMPORT_LAYER} from '../../plugin-web-extension/feature-scripts/contracts'
import {PolyfillPlugin} from '../feature-polyfill'
import {CompatibilityPlugin} from '../index'

const makeTempFolder = trackTempFolders()

// The first statement of the polyfill, which only its own module carries.
const POLYFILL_MARK = 'This script should only be loaded in a browser extension'
// How the bundler binds the free `browser` of a module to the polyfill.
const PROVIDED = /var browser = __webpack_require__\(/

const SOURCES: Record<string, string> = {
  'background.js': 'browser.runtime.onInstalled.addListener(() => {})\n',
  'guarded.js':
    "if (typeof browser !== 'undefined') console.log('has the namespace')\n",
  'plain.js': "console.log('no extension API here')\n",
  'main-world.js': "browser.runtime.sendMessage('from the page')\n"
}

type Plugin = NonNullable<Configuration['plugins']>[number]

async function build(
  entry: Configuration['entry'],
  plugins: Plugin[]
): Promise<{files: Record<string, string>; layers: string[]}> {
  const root = makeTempFolder('extjs-polyfill-build-')
  const output = path.join(root, 'dist')

  for (const [name, source] of Object.entries(SOURCES)) {
    fs.writeFileSync(path.join(root, name), source)
  }

  const compiler = rspack({
    context: root,
    mode: 'production',
    devtool: false,
    target: 'web',
    entry,
    output: {path: output, filename: '[name].js', clean: true},
    optimization: {minimize: false, splitChunks: false},
    plugins
  })

  const stats = await new Promise<
    NonNullable<Parameters<Parameters<typeof compiler.run>[0]>[1]>
  >((resolve, reject) => {
    compiler.run((error, result) => {
      compiler.close(() => {
        if (error || !result) reject(error || new Error('no stats'))
        else resolve(result)
      })
    })
  })

  expect(stats.toJson({all: false, errors: true}).errors).toEqual([])

  const files: Record<string, string> = {}

  for (const name of fs.readdirSync(output)) {
    files[name] = fs.readFileSync(path.join(output, name), 'utf8')
  }

  // Every layer the build made a copy of the polyfill module in.
  const layers = (stats.toJson({all: false, modules: true}).modules || [])
    .filter((module) => /browser-polyfill\.js$/.test(module.name || ''))
    .map((module) => module.layer || '')
    .sort()

  return {files, layers}
}

describe('the polyfill in a real build', () => {
  let withPolyfill: Record<string, string>
  let polyfillLayers: string[]

  beforeAll(async () => {
    const built = await build(
      {
        background: './background.js',
        guarded: './guarded.js',
        plain: './plain.js',
        'main-world': {
          import: './main-world.js',
          layer: EXTENSIONJS_MAIN_WORLD_IMPORT_LAYER
        }
      },
      [new PolyfillPlugin({browser: 'chrome'})]
    )

    withPolyfill = built.files
    polyfillLayers = built.layers
  })

  it('bundles the polyfill into a background that reads browser.runtime', () => {
    expect(withPolyfill['background.js']).toContain(POLYFILL_MARK)
    expect(withPolyfill['background.js']).toMatch(PROVIDED)
  })

  it('leaves the polyfill out of an entry that never names browser', () => {
    expect(withPolyfill['plain.js']).toContain('no extension API here')
    expect(withPolyfill['plain.js']).not.toContain(POLYFILL_MARK)
    expect(withPolyfill['plain.js']).not.toMatch(PROVIDED)
  })

  // Pins today's behavior. Ledger 1401 D1.
  it('bundles the polyfill into an entry that only asks typeof browser', () => {
    expect(withPolyfill['guarded.js']).toContain(POLYFILL_MARK)
    expect(withPolyfill['guarded.js']).toMatch(PROVIDED)
  })

  // Pins today's behavior. Ledger 1401 D1.
  it('bundles the polyfill into an entry on the MAIN world import layer', () => {
    expect(withPolyfill['main-world.js']).toContain(POLYFILL_MARK)
    expect(withPolyfill['main-world.js']).toMatch(PROVIDED)
    expect(polyfillLayers).toEqual(['', EXTENSIONJS_MAIN_WORLD_IMPORT_LAYER])
  })

  it('bundles it through CompatibilityPlugin only when polyfill is on', async () => {
    const options = {manifestPath: '/unused/manifest.json', browser: 'chrome'}
    const {files: on} = await build({background: './background.js'}, [
      new CompatibilityPlugin({...options, polyfill: true} as never)
    ])
    const {files: off} = await build({background: './background.js'}, [
      new CompatibilityPlugin({...options, polyfill: false} as never)
    ])

    expect(on['background.js']).toContain(POLYFILL_MARK)
    expect(on['background.js']).toMatch(PROVIDED)
    expect(off['background.js']).toContain('browser.runtime.onInstalled')
    expect(off['background.js']).not.toContain(POLYFILL_MARK)
    expect(off['background.js']).not.toMatch(PROVIDED)
  })

  it('leaves the polyfill out for Firefox even with polyfill on', async () => {
    const {files} = await build({background: './background.js'}, [
      new CompatibilityPlugin({
        manifestPath: '/unused/manifest.json',
        browser: 'firefox',
        polyfill: true
      })
    ])

    expect(files['background.js']).toContain('browser.runtime.onInstalled')
    expect(files['background.js']).not.toContain(POLYFILL_MARK)
  })
})
