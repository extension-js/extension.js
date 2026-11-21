import * as fs from 'node:fs'
import type {Compilation, Compiler} from '@rspack/core'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {
  asCompilation,
  asCompiler,
  type TapCallback
} from '../../../__spec__/helpers/rspack-fakes'
import {EmitHtmlFile} from '../../steps/emit-html-file'
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

describe('EmitHtmlFile', () => {
  let plugin: EmitHtmlFile
  let mockCompiler: Compiler
  let mockCompilation: Compilation

  beforeEach(() => {
    plugin = new EmitHtmlFile({
      manifestPath: '/test/project/manifest.json',
      includeList: {
        'action/index': '/test/project/popup.html',
        'pages/main': '/test/project/pages/main.html'
      }
    })

    mockCompilation = asCompilation({
      warnings: [] as BuildIssue[],
      emitAsset: vi.fn(),
      hooks: {
        processAssets: {
          tap: (_opts: unknown, fn: TapCallback) => fn()
        }
      }
    })

    mockCompiler = asCompiler({
      options: {devServer: {browser: 'chrome'}},
      hooks: {
        thisCompilation: {
          tap: vi.fn((_name, callback) => {
            callback(mockCompilation)
          })
        }
      }
    })
  })

  it('warns only for non-entrypoint pages when HTML file is missing', () => {
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('manifest.json')) {
        return Buffer.from('{"name":"X"}')
      }

      return Buffer.from('')
    })

    vi.mocked(fs.existsSync).mockImplementation((_p) => false)
    plugin.apply(mockCompiler)

    const names = (list: Array<{message: string}>) =>
      list.map((finding) => String(finding.message).split('\n')[0])

    expect(names(mockCompilation.warnings)).toEqual([
      expect.stringContaining('pages/main')
    ])

    // The popup is a page the manifest names, so its missing file fails.
    expect(names(mockCompilation.errors)).toEqual([
      expect.stringContaining('default_popup')
    ])
  })
})
