import {describe, it, expect, vi} from 'vitest'
import {Compilation, Compiler, sources} from '@rspack/core'

import {ApplyManifestDevDefaults} from '../../../../steps/setup-reload-strategy/apply-manifest-dev-defaults/index'

function makeCompilerWithManifest(manifest: any) {
  const compilation: any = {
    assets: {
      'manifest.json': new sources.RawSource(JSON.stringify(manifest))
    },
    getAsset(name: string) {
      return this.assets[name]
    },
    updateAsset(name: string, source: any) {
      this.assets[name] = source
    },
    hooks: {
      processAssets: {tap: (_opts: any, fn: any) => fn({})}
    }
  }
  const hooks: any = {
    thisCompilation: {tap: (_name: string, fn: any) => fn(compilation)}
  }
  const compiler: any = {
    hooks,
    rspack: {WebpackError: class WebpackError extends Error {}}
  }
  return {
    compiler: compiler as Compiler,
    compilation: compilation as Compilation
  }
}

describe('ApplyManifestDevDefaults integration', () => {
  it('patches V3 manifest with dev defaults', () => {
    const manifest = {
      manifest_version: 3,
      name: 'Test',
      version: '1.0.0',
      background: {}
    }
    const {compiler, compilation} = makeCompilerWithManifest(manifest)
    new ApplyManifestDevDefaults({
      manifestPath: '/x/manifest.json',
      browser: 'chrome'
    } as any).apply(compiler)

    const patched = JSON.parse(
      (compilation.assets['manifest.json'] as any).source().toString()
    )

    expect(patched.content_security_policy).toBeDefined()
    expect(patched.web_accessible_resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({matches: ['<all_urls>']}),
        expect.objectContaining({resources: expect.arrayContaining(['/*.js'])})
      ])
    )
    // Background should be preserved/augmented, not removed
    expect(patched.background).toBeDefined()
  })

  it('patches V2 manifest with dev defaults', () => {
    const manifest = {
      manifest_version: 2,
      name: 'Test',
      version: '1.0.0',
      background: {}
    }
    const {compiler, compilation} = makeCompilerWithManifest(manifest)
    new ApplyManifestDevDefaults({
      manifestPath: '/x/manifest.json',
      browser: 'chrome'
    } as any).apply(compiler)

    const patched = JSON.parse(
      (compilation.assets['manifest.json'] as any).source().toString()
    )
    expect(typeof patched.content_security_policy).toBe('string')
    expect(Array.isArray(patched.web_accessible_resources)).toBe(true)
    expect(patched.web_accessible_resources).toEqual(
      expect.arrayContaining(['/*.js'])
    )
  })
})
