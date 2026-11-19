import * as path from 'node:path'
import type {RuleSetRule} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {StaticAssetsPlugin} from '../index'
import {compileFixture, removeFixtureRoots} from './helpers/compile-harness'
import {NOTES_TXT, PIXEL_PNG, SMALL_SVG} from './helpers/fixtures'

afterAll(() => removeFixtureRoots())

const PIXEL_DATA_URI = `data:image/png;base64,${PIXEL_PNG.toString('base64')}`

async function compile(userRule: (root: string) => RuleSetRule) {
  const build = await compileFixture({
    plugins: [new StaticAssetsPlugin()],
    files: {
      'icons/badge.png': PIXEL_PNG,
      'pages/hero.png': PIXEL_PNG,
      'index.js': [
        "import badge from './icons/badge.png'",
        "import hero from './pages/hero.png'",
        'self.out = {badge, hero}',
        ''
      ].join('\n')
    },
    config: (root) => ({module: {rules: [userRule(root)]}})
  })

  expect(build.errors).toEqual([])

  return build.evaluate()
}

describe('a scoped user asset rule claims only its scope', () => {
  it('an include-scoped png rule leaves files outside the include to the default', async () => {
    const assets = await compile((root) => ({
      test: /\.png$/i,
      include: path.join(root, 'icons'),
      type: 'asset/resource'
    }))

    expect(assets.badge).toMatch(/^\/assets\/badge\.[0-9a-f]{8}\.png$/)
    expect(assets.hero).toBe(PIXEL_DATA_URI)
  })

  it('an exclude-scoped png rule leaves the excluded files to the default', async () => {
    const assets = await compile((root) => ({
      test: /\.png$/i,
      exclude: path.join(root, 'pages'),
      type: 'asset/resource'
    }))

    expect(assets.badge).toMatch(/^\/assets\/badge\.[0-9a-f]{8}\.png$/)
    expect(assets.hero).toBe(PIXEL_DATA_URI)
  })

  it('a string test is a path prefix and wins inside it', async () => {
    const assets = await compile((root) => ({
      test: path.join(root, 'icons'),
      type: 'asset/resource'
    }))

    expect(assets.badge).toMatch(/^\/assets\/badge\.[0-9a-f]{8}\.png$/)
    expect(assets.hero).toBe(PIXEL_DATA_URI)
  })

  it('an unscoped png rule still owns every png', async () => {
    const assets = await compile(() => ({
      test: /\.png$/i,
      type: 'asset/resource'
    }))

    expect(assets.badge).toMatch(/^\/assets\/badge\.[0-9a-f]{8}\.png$/)
    expect(assets.hero).toMatch(/^\/assets\/hero\.[0-9a-f]{8}\.png$/)
  })
})

describe('a query-scoped user rule claims its query for its own extension only', () => {
  it('an SVG ?react loader rule leaves ?react on a png, a font and a text file to the default', async () => {
    const build = await compileFixture({
      plugins: [new StaticAssetsPlugin()],
      files: {
        'icon.svg': SMALL_SVG,
        'small.png': PIXEL_PNG,
        'font.woff2': Buffer.alloc(3000, 0x42),
        'notes.txt': NOTES_TXT,
        'custom-loader.cjs':
          'module.exports = function () { return \'export default "custom"\' }\n',
        'index.js': [
          "import icon from './icon.svg'",
          "import iconReact from './icon.svg?react'",
          "import pngReact from './small.png?react'",
          "import fontReact from './font.woff2?react'",
          "import notesReact from './notes.txt?react'",
          'self.out = {icon, iconReact, pngReact, fontReact, notesReact}',
          ''
        ].join('\n')
      },
      config: (root) => ({
        module: {
          rules: [
            {
              test: /\.svg$/i,
              resourceQuery: /react/,
              use: [{loader: path.join(root, 'custom-loader.cjs')}]
            }
          ]
        }
      })
    })

    expect(build.errors).toEqual([])
    expect(await build.evaluate()).toEqual({
      icon: `data:image/svg+xml;base64,${Buffer.from(SMALL_SVG).toString('base64')}`,
      iconReact: 'custom',
      pngReact: PIXEL_DATA_URI,
      fontReact: expect.stringMatching(/^\/assets\/font\.[0-9a-f]{8}\.woff2$/),
      notesReact: `data:text/plain;base64,${Buffer.from(NOTES_TXT).toString('base64')}`
    })
  })
})
