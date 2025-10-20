import {describe, expect, it, vi, beforeEach, afterEach} from 'vitest'
import {ApplyManifestDevDefaults} from '../steps/setup-reload-strategy/apply-manifest-dev-defaults'

function makeCompilation() {
  const assets: Record<string, any> = {
    'manifest.json': {
      source: () => JSON.stringify({manifest_version: 3})
    }
  }
  const hooks: any = {
    processAssets: {tap: (_: any, fn: any) => fn(assets)}
  }
  return {
    assets,
    getAsset: (n: string) => (assets[n] ? {name: n} : undefined),
    updateAsset: (n: string, s: any) =>
      (assets[n] = {source: () => s.source()}),
    hooks
  } as any
}

function makeCompiler() {
  const compilation = makeCompilation()
  const hooks: any = {
    thisCompilation: {tap: (_: any, fn: any) => fn(compilation)}
  }
  return {hooks, rspack: {WebpackError: class extends Error {}}} as any
}

describe('ApplyManifestDevDefaults', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('patches manifest.json with defaults', () => {
    const compiler = makeCompiler()
    const plugin = new ApplyManifestDevDefaults({
      manifestPath: '/abs/manifest.json'
    } as any)
    plugin.apply(compiler)
    const updated = (compiler as any).hooks.thisCompilation // used
    const comp = makeCompilation()
    // Directly call private to simulate processAssets
    ;(plugin as any).generateManifestPatches(comp)
    const text = comp.assets['manifest.json'].source().toString()
    expect(text).toMatch('web_accessible_resources')
  })
})
