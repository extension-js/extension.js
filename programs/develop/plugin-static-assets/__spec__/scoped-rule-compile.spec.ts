import * as path from 'node:path'
import type {RuleSetRule} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {StaticAssetsPlugin} from '../index'
import {compileFixture, removeFixtureRoots} from './helpers/compile-harness'
import {PIXEL_PNG} from './helpers/fixtures'

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
