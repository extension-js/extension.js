import {describe, it, expect, vi} from 'vitest'
import {Compilation} from '@rspack/core'
import {CheckManifestFiles} from '../steps/check-manifest-files'
import * as path from 'path'

const makeCompiler = (manifest: any) => {
  const compilation: any = {
    hooks: {processAssets: {tap: (_: any, cb: Function) => cb()}},
    errors: [] as Error[]
  }
  const compiler: any = {
    hooks: {compilation: {tap: (_: string, cb: Function) => cb(compilation)}}
  }
  const fs = require('fs') as typeof import('fs')
  // Relative paths should be considered missing; absolute paths exist
  vi.spyOn(fs, 'existsSync').mockImplementation((p: any) =>
    typeof p === 'string' ? path.isAbsolute(p) : false
  )
  return {compiler, compilation}
}

describe('CheckManifestFiles', () => {
  it('reports errors for missing relative files and ignores absolute paths', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const manifest = {
      name: 'x',
      icons: {'16': 'icons/icon16.png'},
      browser_action: {
        default_icon: 'icons/icon16.png',
        theme_icons: [
          {light: 'icons/icon16-light.png', dark: 'icons/icon16-dark.png'}
        ]
      },
      options_ui: {page: 'options.html'},
      storage: {managed_schema: 'schema.json'}
    }

    const plugin = new CheckManifestFiles({
      manifestPath: path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        '..',
        'examples',
        'content',
        'manifest.json'
      ),
      includeList: {
        'icons/icon16.png': 'icons/icon16.png', // relative -> should error
        // public/ assets should be considered excluded from validation
        'public/icon-maro.png': '/abs/public/icon-maro.png',
        'browser_action/default_icon': 'icons/icon16.png', // relative -> should error
        'browser_action/theme_icons': [
          'icons/icon16-light.png',
          'icons/icon16-dark.png'
        ],
        'options_ui/page': '/abs/options.html', // absolute -> ok
        'storage/managed_schema': 'schema.json' // relative -> should error
      }
    } as any)

    const {compiler, compilation} = makeCompiler(manifest)
    plugin.apply(compiler)

    // Should push errors for non-existent relative paths (since existsSync returns false for non-/abs)
    expect(compilation.errors.length).toBeGreaterThan(0)
    // Absolute path should not add an error
    const absError = compilation.errors.find((e: any) =>
      /\/abs\/options\.html/.test(String(e?.message || e))
    )
    expect(absError).toBeUndefined()

    // Should print at least one helpful stdout error before browser launch
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('treats /public/foo and /foo as public-root assets and does not error when excluded', () => {
    const manifestPath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      '..',
      'examples',
      'content',
      'manifest.json'
    )
    const manifest = {name: 'x'}
    const plugin = new CheckManifestFiles({
      manifestPath,
      includeList: {
        icons: ['/public/icon-maro.png', '/icon-maro.png']
      },
      excludeList: {
        '/public/icon-maro.png': '/abs/project/public/icon-maro.png',
        '/icon-maro.png': '/abs/project/public/icon-maro.png'
      }
    } as any)

    const {compiler, compilation} = makeCompiler(manifest)
    plugin.apply(compiler)

    // Our makeCompiler declares existsSync true for absolute paths, so no errors are expected
    expect(compilation.errors.length).toBe(0)
  })
})
