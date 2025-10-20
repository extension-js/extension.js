import {describe, it, expect, vi, beforeEach} from 'vitest'
import {Compiler, Compilation} from '@rspack/core'
import * as fs from 'fs'
import {EmitHtmlFile} from './emit-html-file'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn()
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}))

describe('EmitHtmlFile', () => {
  let plugin: EmitHtmlFile
  let mockCompiler: Compiler
  let mockCompilation: Compilation

  beforeEach(() => {
    plugin = new EmitHtmlFile({
      manifestPath: '/test/project/manifest.json',
      includeList: {
        // entrypoint (manifest-defined): should not warn here
        'action/default_popup': '/test/project/popup.html',
        // non-entrypoint (pages/*): should warn here
        'pages/main': '/test/project/pages/main.html'
      } as any
    })

    mockCompilation = {
      warnings: [],
      emitAsset: vi.fn(),
      hooks: {
        processAssets: {
          tap: (_opts: any, fn: any) => fn()
        }
      }
    } as any

    mockCompiler = {
      options: {devServer: {browser: 'chrome'}} as any,
      hooks: {
        thisCompilation: {
          tap: vi.fn((name, callback) => {
            callback(mockCompilation)
          })
        }
      }
    } as any
  })

  it('warns only for non-entrypoint pages when HTML file is missing', () => {
    // Simulate JSON manifest so EmitHtmlFile can parse it without error
    vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
      if (String(p).endsWith('manifest.json'))
        return Buffer.from('{"name":"X"}')
      return Buffer.from('')
    })
    vi.mocked(fs.existsSync).mockImplementation((_p: any) => false)
    plugin.apply(mockCompiler)

    // Should push exactly one warning for pages/* and not for manifest entrypoints
    expect((mockCompilation as any).warnings.length).toBe(1)
  })
})
