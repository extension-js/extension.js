import * as fs from 'node:fs'
import type {Compiler} from '@rspack/core'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {
  asCompiler,
  type TapCallback
} from '../../../__spec__/helpers/rspack-fakes'
import {AddAssetsToCompilation} from '../../steps/add-assets-to-compilation'
import type {BuildIssue} from '../helpers/html-fakes'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()

  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readFileSync: vi.fn()
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn()
  }
})

describe('HTML hint behavior', () => {
  let plugin: AddAssetsToCompilation
  let compiler: Compiler
  let compilation: {errors: BuildIssue[]; warnings: BuildIssue[]}

  beforeEach(() => {
    plugin = new AddAssetsToCompilation({
      manifestPath: '/proj/manifest.json',
      includeList: {feature: '/proj/pages/main.html'}
    })

    const fakeCompilation = {
      errors: [] as BuildIssue[],
      warnings: [] as BuildIssue[],
      getAsset: vi.fn(() => ({
        source: {
          source: () =>
            '<html><img src="/missing.png"><img src="img/miss.png"></html>'
        }
      })),
      hooks: {processAssets: {tap: (_: unknown, fn: TapCallback) => fn()}},
      options: {output: {path: '/proj/dist'}}
    }
    compilation = fakeCompilation

    compiler = asCompiler({
      hooks: {
        thisCompilation: {
          tap: (_: string, cb: TapCallback) => cb(fakeCompilation)
        }
      },
      options: {context: '/proj'}
    })

    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from(''))
  })

  it('shows public-root hint only for extension-root absolute (leading /) paths', () => {
    plugin.apply(compiler)
    const warnings = String(compilation.warnings.map(String).join('\n'))
    expect(warnings).toMatch(/resolves from the extension root/i)
    const rel = compilation.warnings
      .map(String)
      .find((w: string) => w.includes('img/miss.png'))
    expect(rel || '').not.toMatch(/resolves from the extension root/i)
  })
})
