import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as fs from 'fs'
import {AddAssetsToCompilation} from '../../steps/add-assets-to-compilation'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn()
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}))

describe('HTML hint behavior', () => {
  let plugin: AddAssetsToCompilation
  let compiler: any
  let compilation: any

  beforeEach(() => {
    plugin = new AddAssetsToCompilation({
      manifestPath: '/proj/manifest.json',
      includeList: {feature: '/proj/pages/main.html'} as any
    })

    compilation = {
      errors: [],
      warnings: [],
      getAsset: vi.fn(() => ({
        source: {
          source: () =>
            '<html><img src="/missing.png"><img src="img/miss.png"></html>'
        }
      })),
      hooks: {processAssets: {tap: (_: any, fn: any) => fn()}},
      options: {output: {path: '/proj/dist'}}
    }

    compiler = {
      hooks: {
        thisCompilation: {tap: (_: string, cb: Function) => cb(compilation)}
      },
      options: {context: '/proj'}
    }
    ;(fs.existsSync as any).mockReturnValue(false)
    ;(fs.readFileSync as any).mockReturnValue(Buffer.from(''))
  })

  it('shows public-root hint only for extension-root absolute (leading /) paths', () => {
    plugin.apply(compiler)
    const warnings = String(compilation.warnings.map(String).join('\n'))
    expect(warnings).toMatch(/resolved from the extension output root/i)
    const rel = compilation.warnings
      .map(String)
      .find((w: string) => w.includes('img/miss.png'))
    expect(rel || '').not.toMatch(/resolved from the extension output root/i)
  })
})

