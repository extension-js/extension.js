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
  it('reports errors for missing relative files; leading "/" is extension root', () => {
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
        'browser_action/default_icon': 'icons/icon16.png', // relative -> should error
        'browser_action/theme_icons': [
          'icons/icon16-light.png',
          'icons/icon16-dark.png'
        ],
        // Leading slash is treated as extension root (public-root), so a non-existent
        // "/abs/options.html" should be reported as missing.
        'options_ui/page': '/abs/options.html',
        'storage/managed_schema': 'schema.json' // relative -> should error
      }
    } as any)

    const {compiler, compilation} = makeCompiler(manifest)
    plugin.apply(compiler)

    // Should push errors for non-existent relative paths (since existsSync returns false for non-/abs)
    expect(compilation.errors.length).toBeGreaterThan(0)
    // Leading "/" treated as extension root and should error when missing
    const absError = compilation.errors.find((e: any) =>
      /\/abs\/options\.html/.test(String(e?.message || e))
    )
    expect(absError).toBeDefined()

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
      // Exclude list values are matched, so exclude by the same public-root strings
      excludeList: {
        icons: ['/public/icon-maro.png', '/icon-maro.png']
      }
    } as any)

    const {compiler, compilation} = makeCompiler(manifest)
    plugin.apply(compiler)

    // No errors expected when public-root assets are excluded
    expect(compilation.errors.length).toBe(0)
  })
})
