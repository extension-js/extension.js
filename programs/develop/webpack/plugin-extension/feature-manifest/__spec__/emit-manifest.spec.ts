import {describe, it, expect, vi} from 'vitest'

vi.mock('@rspack/core', async (orig) => {
  const actual: any = await orig()
  return {
    ...actual,
    sources: {
      RawSource: function (data: any) {
        return {source: () => data}
      }
    }
  }
})

const readFileSync = vi
  .spyOn(require('fs'), 'readFileSync')
  .mockImplementation(() => '{"name":"x","$schema":"ignore"}')

import {EmitManifest} from '../steps/emit-manifest'

describe('EmitManifest', () => {
  it('emits manifest.json and handles read/parse errors', () => {
    const errors: any[] = []
    let tapRan = false

    const compilation: any = {
      errors,
      hooks: {
        processAssets: {
          tap: (_opts: any, fn: any) => {
            tapRan = true
            fn()
          }
        }
      },
      emitAsset: () => {}
    }

    const compiler: any = {
      hooks: {
        thisCompilation: {tap: (_name: string, fn: any) => fn(compilation)}
      }
    }

    const plugin = new EmitManifest({manifestPath: '/m/manifest.json'} as any)
    plugin.apply(compiler)

    expect(tapRan).toBe(true)

    // Now simulate read error
    readFileSync.mockImplementationOnce(() => {
      throw new Error('boom')
    })

    plugin.apply(compiler)

    expect(errors.length).toBeGreaterThan(0)
  })
})

