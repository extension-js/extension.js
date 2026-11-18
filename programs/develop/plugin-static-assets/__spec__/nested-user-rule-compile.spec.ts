import * as path from 'node:path'
import type {RuleSetRule} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {StaticAssetsPlugin} from '../index'
import {compileFixture, removeFixtureRoots} from './helpers/compile-harness'
import {PIXEL_PNG, SMALL_SVG} from './helpers/fixtures'

afterAll(() => removeFixtureRoots())

const PIXEL_DATA_URI = `data:image/png;base64,${PIXEL_PNG.toString('base64')}`
const SVG_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(SMALL_SVG).toString('base64')}`
const PNG_FILE_URL = /^\/assets\/small\.[0-9a-f]{8}\.png$/
const SVG_FILE_URL = /^\/assets\/icon\.[0-9a-f]{8}\.svg$/

const CUSTOM_LOADER =
  'module.exports = function () { return \'export default "custom"\' }\n'
// Hands every file on unchanged, bytes included.
const PASS_LOADER =
  'module.exports = function (source) { return source }\nmodule.exports.raw = true\n'

async function compile(
  imports: Record<string, string>,
  userRules: (root: string) => RuleSetRule[]
) {
  const build = await compileFixture({
    plugins: [new StaticAssetsPlugin()],
    files: {
      'icon.svg': SMALL_SVG,
      'small.png': PIXEL_PNG,
      'custom-loader.cjs': CUSTOM_LOADER,
      'pass-loader.cjs': PASS_LOADER,
      'index.js': [
        ...Object.entries(imports).map(
          ([name, request]) => `import ${name} from '${request}'`
        ),
        `self.out = {${Object.keys(imports).join(', ')}}`,
        ''
      ].join('\n')
    },
    config: (root) => ({module: {rules: userRules(root)}})
  })

  expect(build.errors).toEqual([])

  return build.evaluate()
}

describe('a user asset rule nested in oneOf or rules is honored', () => {
  it('a png rule inside oneOf owns every png', async () => {
    const out = await compile(
      {small: './small.png', icon: './icon.svg'},
      () => [{oneOf: [{test: /\.png$/i, type: 'asset/resource'}]}]
    )

    expect(out.small).toMatch(PNG_FILE_URL)
    expect(out.icon).toBe(SVG_DATA_URI)
  })

  it('a png rule inside rules owns every png', async () => {
    const out = await compile(
      {small: './small.png', icon: './icon.svg'},
      () => [{rules: [{test: /\.png$/i, type: 'asset/resource'}]}]
    )

    expect(out.small).toMatch(PNG_FILE_URL)
    expect(out.icon).toBe(SVG_DATA_URI)
  })

  it('an svg test on the parent reaches its oneOf branches', async () => {
    const out = await compile(
      {
        icon: './icon.svg',
        iconReact: './icon.svg?react',
        small: './small.png'
      },
      (root) => [
        {
          test: /\.svg$/i,
          oneOf: [
            {
              resourceQuery: /react/,
              use: [{loader: path.join(root, 'custom-loader.cjs')}]
            },
            {type: 'asset/resource'}
          ]
        }
      ]
    )

    expect(out.icon).toMatch(SVG_FILE_URL)
    expect(out.iconReact).toBe('custom')
    expect(out.small).toBe(PIXEL_DATA_URI)
  })
})

describe('a user loader rule with a function test is honored', () => {
  it('an svg loader rule matched by a function keeps its output', async () => {
    const out = await compile(
      {icon: './icon.svg', small: './small.png'},
      (root) => [
        {
          test: (resourcePath: string) => path.extname(resourcePath) === '.svg',
          use: [{loader: path.join(root, 'custom-loader.cjs')}]
        }
      ]
    )

    expect(out.icon).toBe('custom')
    expect(out.small).toBe(PIXEL_DATA_URI)
  })

  it('a function test that accepts every file is not read as an asset rule', async () => {
    const out = await compile(
      {icon: './icon.svg', small: './small.png'},
      (root) => [
        {
          test: (resourcePath: string) =>
            !resourcePath.includes('node_modules'),
          use: [{loader: path.join(root, 'pass-loader.cjs')}]
        }
      ]
    )

    expect(out.icon).toBe(SVG_DATA_URI)
    expect(out.small).toBe(PIXEL_DATA_URI)
  })
})

describe('a user ?url rule for one type leaves ?url on the others to the default', () => {
  it('an svg-only ?url rule keeps a png ?url a file URL', async () => {
    const out = await compile(
      {iconUrl: './icon.svg?url', smallUrl: './small.png?url'},
      () => [{test: /\.svg$/i, resourceQuery: /url/, type: 'asset/inline'}]
    )

    expect(out.iconUrl).toBe(SVG_DATA_URI)
    expect(out.smallUrl).toMatch(PNG_FILE_URL)
  })

  it('an unscoped ?url rule still owns ?url on every type', async () => {
    const out = await compile(
      {iconUrl: './icon.svg?url', smallUrl: './small.png?url'},
      () => [{resourceQuery: /url/, type: 'asset/inline'}]
    )

    expect(out.iconUrl).toBe(SVG_DATA_URI)
    expect(out.smallUrl).toBe(PIXEL_DATA_URI)
  })
})
