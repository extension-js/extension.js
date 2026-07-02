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

    // A concat payload whose file list contains "url" (e.g. clearurls.js,
    // URLHashParams.js) must not flip the whole entry into an asset/resource.
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

    // And plain filenames that merely contain the letters "url" don't match.
    expect(re.test('?raw')).toBe(false)
    expect(re.test('')).toBe(false)
  })
})
