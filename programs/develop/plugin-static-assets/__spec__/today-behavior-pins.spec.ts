import * as path from 'node:path'
import type {RuleSetRule} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {diagnosticCode, diagnosticName} from '../../lib/diagnostic-code'
import {StaticAssetsPlugin} from '../index'
import {bundledAssetOutputName} from '../static-assets-lib/asset-output-name'
import {
  compileFixture,
  ORIGIN,
  removeFixtureRoots
} from './helpers/compile-harness'
import {NOTES_TXT, PIXEL_PNG, pngOfSize, SMALL_SVG} from './helpers/fixtures'

afterAll(() => removeFixtureRoots())

const PIXEL_DATA_URI = `data:image/png;base64,${PIXEL_PNG.toString('base64')}`

// A loader that turns any file into a module whose default is "custom".
const CUSTOM_LOADER =
  'module.exports = function () { return \'export default "custom"\' }\n'

async function smallPngWith(rule: (root: string) => RuleSetRule) {
  const build = await compileFixture({
    plugins: [new StaticAssetsPlugin()],
    files: {
      'small.png': PIXEL_PNG,
      'icon.svg': SMALL_SVG,
      'custom-loader.cjs': CUSTOM_LOADER,
      'index.js':
        "import small from './small.png'\nimport smallUrl from './small.png?url'\nself.out = {small, smallUrl}\n"
    },
    config: (root) => ({module: {rules: [rule(root)]}})
  })
  expect(build.errors).toEqual([])

  return build.evaluate()
}

const customLoader = (root: string) => [
  {loader: path.join(root, 'custom-loader.cjs')}
]

describe('user rules the default rules do not see', () => {
  it('an SVG-only rule scoped to ?url turns the global ?url rule off for a png', async () => {
    // Pins today's behavior. Ledger 1386 D1.
    const out = await smallPngWith(() => ({
      test: /\.svg$/i,
      resourceQuery: /url/,
      type: 'asset'
    }))

    expect(out.smallUrl).toBe(PIXEL_DATA_URI)
  })

  it('a png rule nested in oneOf loses to the default image rule', async () => {
    // Pins today's behavior. Ledger 1386 D2.
    const out = await smallPngWith(() => ({
      oneOf: [{test: /\.png$/i, type: 'asset/resource'}]
    }))

    expect(out.small).toBe(PIXEL_DATA_URI)
  })

  it('a png rule nested in rules loses to the default image rule', async () => {
    // Pins today's behavior. Ledger 1386 D2.
    const out = await smallPngWith(() => ({
      rules: [{test: /\.png$/i, type: 'asset/resource'}]
    }))

    expect(out.small).toBe(PIXEL_DATA_URI)
  })

  it('a loader rule with a function test has its output inlined as the asset', async () => {
    // Pins today's behavior. Ledger 1386 D2.
    const out = await smallPngWith((root) => ({
      test: (resource: string) => resource.endsWith('.png'),
      use: customLoader(root)
    }))

    expect(out.small).toBe(
      `data:image/png;base64,${Buffer.from('export default "custom"').toString('base64')}`
    )
  })

  it('the same loader rule with a RegExp test wins', async () => {
    const out = await smallPngWith((root) => ({
      test: /\.png$/i,
      use: customLoader(root)
    }))

    expect(out.small).toBe('custom')
  })

  it('an asset rule with an array test wins', async () => {
    const out = await smallPngWith(() => ({
      test: [/\.png$/i],
      type: 'asset/resource'
    }))

    expect(out.small).toMatch(/^\/assets\/small\.[0-9a-f]{8}\.png$/)
  })
})

describe('a namespace import of an asset', () => {
  const files = (use: string) => ({
    'notes.txt': NOTES_TXT,
    'index.js': `import * as t from './notes.txt'\nself.out = {value: ${use}}\n`
  })

  it('read as a value is exactly one build error, which carries no code', async () => {
    const build = await compileFixture({
      plugins: [new StaticAssetsPlugin()],
      files: files('String(t)')
    })

    expect(build.errors).toEqual([
      "  × import * as t from './notes.txt' is a module object, not the file's value.\n" +
        '  │ READS AS [object Module]\n' +
        "  │ The value is the default export. Write import t from './notes.txt' instead.\n"
    ])

    expect(build.rawErrors).toHaveLength(1)
    expect(diagnosticName(build.rawErrors[0])).toBe(
      'NamespaceImportReadAsValue'
    )

    // Pins today's behavior. Ledger 1386 D5.
    expect(diagnosticCode(build.rawErrors[0])).toBeUndefined()
  })

  it('read through .default builds with no error', async () => {
    const build = await compileFixture({
      plugins: [new StaticAssetsPlugin()],
      files: files('t.default')
    })

    expect(build.errors).toEqual([])
    expect((await build.evaluate()).value).toBe(
      `data:text/plain;base64,${Buffer.from(NOTES_TXT).toString('base64')}`
    )
  })
})

describe('bundledAssetOutputName against a user assetModuleFilename', () => {
  it('matches a file the default rules claim and misses one they do not', async () => {
    // Pins today's behavior. Ledger 1386 D6.
    const large = pngOfSize(5000)
    const clip = Buffer.alloc(5000, 0x43)
    const build = await compileFixture({
      plugins: [new StaticAssetsPlugin()],
      files: {
        'large.png': large,
        'clip.mp4': clip,
        'index.js':
          "import large from './large.png'\nconst clip = new URL('./clip.mp4', import.meta.url).href\nself.out = {large, clip}\n"
      },
      config: () => ({output: {assetModuleFilename: 'media/[name][ext]'}})
    })
    expect(build.errors).toEqual([])

    const pngName = bundledAssetOutputName('/p/large.png', large)
    const clipName = bundledAssetOutputName('/p/clip.mp4', clip)

    expect(Object.keys(build.emitted).sort()).toEqual(
      [pngName, 'main.js', 'media/clip.mp4'].sort()
    )

    expect(clipName).toMatch(/^assets\/clip\.[0-9a-f]{8}\.mp4$/)
    expect(await build.evaluate()).toEqual({
      large: `/${pngName}`,
      clip: `${ORIGIN}media/clip.mp4`
    })
  })
})
