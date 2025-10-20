import {describe, it, expect, vi} from 'vitest'

vi.mock('fs', () => ({
  readFileSync: () => '{"name":"App"}',
  existsSync: (p: string) => p.includes('exists')
}))

vi.mock('../../webpack-lib/utils', () => ({
  filterKeysForThisBrowser: (m: any) => m
}))

const WebpackError = class extends Error {}

import {CheckManifestFiles} from '../steps/check-manifest-files'

describe('CheckManifestFiles', () => {
  it('pushes errors for missing files', () => {
    const plugin = new CheckManifestFiles({
      manifestPath: '/abs/manifest.json',
      includeList: {
        icons: ['exists.png', 'missing.png']
      },
      excludeList: {}
    } as any)

    const compilation: any = {
      errors: [],
      hooks: {processAssets: {tap: (_: any, cb: any) => cb()}}
    }

    const compiler: any = {
      hooks: {
        compilation: {
          tap: (_: string, fn: any) => fn(compilation)
        }
      }
    }

    // Patch WebpackError type resolution path inside handleErrors signature
    ;(plugin as any).apply({hooks: compiler.hooks, options: {}} as any)

    // Simulate internal call to handleErrors
    ;(plugin as any).handleErrors(compilation, WebpackError as any)

    expect(compilation.errors.length).toBeGreaterThan(0)
  })
})
