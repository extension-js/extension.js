import {describe, expect, it, vi} from 'vitest'
import {StripContentScriptDevServerRuntime} from '../steps/strip-content-script-dev-server-runtime'
import {stripDevServerStartupFromContentScript} from '../steps/remove-content-script-dev-server-runtime'

describe('content script dev-server runtime stripping', () => {
  it('removes dev-server startup requires from content script bundles', () => {
    const source = [
      '123(module) {',
      "  console.log('@rspack/dev-server/client/index.js?test')",
      '}',
      '456(module) {',
      "  console.log('keep me')",
      '}',
      '// startup',
      '__webpack_require__(123);',
      '__webpack_require__(456);',
      'var __webpack_exports__ = __webpack_require__(999);'
    ].join('\n')

    const stripped = stripDevServerStartupFromContentScript(source)

    expect(stripped).not.toContain('__webpack_require__(123);')
    expect(stripped).toContain('__webpack_require__(456);')
    expect(stripped).toContain(
      'var __webpack_exports__ = __webpack_require__(999);'
    )
  })

  it('updates only canonical content script assets during processAssets', () => {
    let thisCompilationTap: ((compilation: any) => void) | undefined
    let processAssetsTap: (() => void) | undefined
    const updateAsset = vi.fn()

    const compiler = {
      hooks: {
        thisCompilation: {
          tap(_name: string, fn: (compilation: any) => void) {
            thisCompilationTap = fn
          }
        }
      }
    }

    new StripContentScriptDevServerRuntime().apply(compiler as any)

    thisCompilationTap?.({
      hooks: {
        processAssets: {
          tap(_options: unknown, fn: () => void) {
            processAssetsTap = fn
          }
        }
      },
      getAssets() {
        return [
          {
            name: 'content_scripts/content-0.js',
            source: {
              source: () =>
                [
                  '123(module) {',
                  "  console.log('@rspack/dev-server/client/index.js?test')",
                  '}',
                  '// startup',
                  '__webpack_require__(123);',
                  'var __webpack_exports__ = __webpack_require__(999);'
                ].join('\n')
            }
          },
          {
            name: 'background/script.js',
            source: {
              source: () => "console.log('background untouched')"
            }
          }
        ]
      },
      updateAsset
    })

    processAssetsTap?.()

    expect(updateAsset).toHaveBeenCalledTimes(1)
    expect(updateAsset).toHaveBeenCalledWith(
      'content_scripts/content-0.js',
      expect.anything()
    )
  })
})
