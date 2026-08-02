import {describe, expect, it} from 'vitest'
import {StaticAssetsPlugin} from '../index'

function applyPlugin(mode: 'development' | 'production' = 'production') {
  const compiler: any = {
    options: {module: {rules: []}},
    hooks: {afterEmit: {tap() {}}}
  }
  new StaticAssetsPlugin({mode} as any).apply(compiler)
  return compiler.options.module.rules as any[]
}

describe('StaticAssetsPlugin url resourceQuery rule', () => {
  it('matches the standalone ?url import query', () => {
    const rules = applyPlugin()
    const urlRule = rules.find(
      (r) => r?.type === 'asset/resource' && r?.resourceQuery instanceof RegExp
    )
    expect(urlRule).toBeTruthy()
    const re: RegExp = urlRule.resourceQuery
    expect(re.test('?url')).toBe(true)
    expect(re.test('?url=1')).toBe(true)
    expect(re.test('?foo&url')).toBe(true)
  })

  it('does NOT match "url" embedded in the classic-concat payload (G10 regression)', () => {
    const rules = applyPlugin()
    const urlRule = rules.find(
      (r) => r?.type === 'asset/resource' && r?.resourceQuery instanceof RegExp
    )
    const re: RegExp = urlRule.resourceQuery

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

  it('resolves a small svg?url to asset/resource under last-wins rule merging', () => {
    const rules = applyPlugin()

    // Mirror rspack's effective-type resolution: every matching rule applies
    // in order and the last matching rule's type wins.
    const matching = rules.filter((r) => {
      const testOk = r?.test instanceof RegExp ? r.test.test('icon.svg') : true
      const queryOk =
        r?.resourceQuery instanceof RegExp ? r.resourceQuery.test('?url') : true
      return Boolean(r) && testOk && queryOk
    })
    const effectiveType = matching.reduce(
      (acc: string | undefined, r) => r?.type ?? acc,
      undefined
    )
    expect(effectiveType).toBe('asset/resource')
  })
})
