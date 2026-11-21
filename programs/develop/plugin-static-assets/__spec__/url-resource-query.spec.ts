import type {Compiler} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {bundledAssetOutputName} from '../../lib/asset-output-name'
import {StaticAssetsPlugin} from '../index'
import {compileFixture, removeFixtureRoots} from './helpers/compile-harness'
import {SMALL_SVG} from './helpers/fixtures'

afterAll(() => removeFixtureRoots())

// The fields of a rule these specs read.
interface QueryRule {
  type?: string
  resourceQuery?: unknown
}

// A compiler with only the rules and the hooks the plugin touches.
function compilerWith(rules: QueryRule[]) {
  return {
    options: {module: {rules}},
    hooks: {
      afterEmit: {tap() {}},
      compilation: {tap() {}},
      done: {tap() {}}
    }
  } as unknown as Compiler
}

function applyPlugin() {
  const compiler = compilerWith([])
  new StaticAssetsPlugin().apply(compiler)

  return compiler.options.module.rules as unknown as QueryRule[]
}

describe('StaticAssetsPlugin url resourceQuery rule', () => {
  it('matches the standalone ?url import query', () => {
    const rules = applyPlugin()
    const urlRule = rules.find(
      (r) => r?.type === 'asset/resource' && r?.resourceQuery instanceof RegExp
    )
    expect(urlRule).toBeTruthy()
    const re = (urlRule as QueryRule).resourceQuery as RegExp
    expect(re.test('?url')).toBe(true)
    expect(re.test('?url=1')).toBe(true)
    expect(re.test('?foo&url')).toBe(true)
  })

  it('does NOT match "url" embedded in the classic-concat payload (G10 regression)', () => {
    const rules = applyPlugin()
    const urlRule = rules.find(
      (r) => r?.type === 'asset/resource' && r?.resourceQuery instanceof RegExp
    )
    const re = (urlRule as QueryRule).resourceQuery as RegExp

    const concatQuery =
      '?__extensionjs_classic_concat__=' +
      encodeURIComponent(
        JSON.stringify({
          feature: 'background/scripts',
          js: ['/p/clearurls.js', '/p/core_js/utils/URLHashParams.js'],
          css: []
        })
      )
    expect(re.test(concatQuery)).toBe(false)

    expect(re.test('?raw')).toBe(false)
    expect(re.test('')).toBe(false)
  })

  it('emits the ?url rule AFTER every typed rule so last-wins keeps asset/resource', () => {
    const rules = applyPlugin()
    const urlRuleIndex = rules.findIndex(
      (r) => r?.type === 'asset/resource' && r?.resourceQuery instanceof RegExp
    )
    expect(urlRuleIndex).toBeGreaterThan(-1)

    const typedRuleIndexes = rules
      .map((r, i) => (r?.type === 'asset' ? i : -1))
      .filter((i) => i !== -1)
    expect(typedRuleIndexes.length).toBeGreaterThan(0)

    for (const typedIndex of typedRuleIndexes) {
      expect(urlRuleIndex).toBeGreaterThan(typedIndex)
    }
  })

  it('makes a small svg?url a file URL in a real compile, not a data URI', async () => {
    const build = await compileFixture({
      plugins: [new StaticAssetsPlugin()],
      files: {
        'icon.svg': SMALL_SVG,
        'index.js':
          "import icon from './icon.svg'\nimport iconUrl from './icon.svg?url'\nself.out = {icon, iconUrl}\n"
      }
    })
    expect(build.errors).toEqual([])

    const out = await build.evaluate()
    const name = bundledAssetOutputName('/p/icon.svg', Buffer.from(SMALL_SVG))

    expect(out.iconUrl).toBe(`/${name}`)
    expect(out.icon).toBe(
      `data:image/svg+xml;base64,${Buffer.from(SMALL_SVG).toString('base64')}`
    )
  })
})

describe('StaticAssetsPlugin raw resourceQuery rule', () => {
  const rawRule = (rules: QueryRule[]) =>
    rules.find(
      (r) => r?.type === 'asset/source' && r?.resourceQuery instanceof RegExp
    )

  it('matches the standalone ?raw import query and nothing else', () => {
    const re = (rawRule(applyPlugin()) as QueryRule).resourceQuery as RegExp
    expect(re.test('?raw')).toBe(true)
    expect(re.test('?raw=1')).toBe(true)
    expect(re.test('?foo&raw')).toBe(true)
    expect(re.test('?url')).toBe(false)
    expect(re.test('?rawr')).toBe(false)
    expect(re.test('?__extensionjs_classic_concat__=raw')).toBe(false)
  })

  it('gives a ?raw import of a typed asset its text in a real compile', async () => {
    const notes = '# notes\n\nplain text\n'
    const build = await compileFixture({
      plugins: [new StaticAssetsPlugin()],
      files: {
        'notes.md': notes,
        'index.js':
          "import raw from './notes.md?raw'\nimport asset from './notes.md'\nself.out = {raw, asset}\n"
      }
    })
    expect(build.errors).toEqual([])

    const out = await build.evaluate()

    expect(out.raw).toBe(notes)
    expect(out.asset).toBe(
      `data:text/markdown;base64,${Buffer.from(notes).toString('base64')}`
    )
  })

  it('leaves a user ?raw rule alone', () => {
    const mine = {resourceQuery: /raw/, type: 'asset/resource'}
    const compiler = compilerWith([mine])
    new StaticAssetsPlugin().apply(compiler)
    const rawRules = (
      compiler.options.module.rules as unknown as QueryRule[]
    ).filter(
      (r) => r?.resourceQuery instanceof RegExp && r.resourceQuery.test('?raw')
    )
    expect(rawRules).toEqual([mine])
  })
})
