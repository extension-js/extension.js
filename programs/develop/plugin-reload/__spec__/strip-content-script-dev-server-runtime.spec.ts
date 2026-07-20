import {describe, expect, it, vi} from 'vitest'
import {stripDevServerStartupFromContentScript} from '../steps/remove-content-script-dev-server-runtime'
import {StripContentScriptDevServerRuntime} from '../steps/strip-content-script-dev-server-runtime'

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

  it('keeps every non-dev-server startup require when several remain (react-refresh entry + wrapped user script)', () => {
    // Regression: with react projects the startup sequence is
    //   refresh-entry; hmr-client; user-wrapper; exports = css
    // The old positional sweep kept only the FIRST leftover require and
    // deleted the user's content script, shipping a no-op bundle.
    const source = [
      '870(module) {',
      '  $ReactRefreshRuntime$.injectIntoGlobalHook(safeThis)',
      '}',
      '814(module) {',
      "  log('[HMR] Waiting for update signal from WDS...');",
      "  log('[HMR] Cannot find update. Need to do a full reload!');",
      '  module.hot.check()',
      '}',
      '353(module) {',
      "  console.log('user content script, keep me')",
      '}',
      '// startup',
      '__webpack_require__(870);',
      '__webpack_require__(814);',
      '__webpack_require__(353);',
      'var __webpack_exports__ = __webpack_require__(735);'
    ].join('\n')

    const stripped = stripDevServerStartupFromContentScript(source)

    expect(stripped).not.toContain('__webpack_require__(814);')
    expect(stripped).toContain('__webpack_require__(870);')
    expect(stripped).toContain('__webpack_require__(353);')
    expect(stripped).toContain(
      'var __webpack_exports__ = __webpack_require__(735);'
    )
  })

  it('does not strip user modules that carry a lone module.hot.check()', () => {
    const source = [
      '42(module) {',
      '  if (module.hot) { module.hot.check() } // ported webpack code',
      "  console.log('user logic')",
      '}',
      '// startup',
      '__webpack_require__(42);',
      'var __webpack_exports__ = __webpack_require__(999);'
    ].join('\n')

    const stripped = stripDevServerStartupFromContentScript(source)

    expect(stripped).toContain('__webpack_require__(42);')
  })

  it('does not strip user modules that merely define a WebSocketClient', () => {
    const source = [
      '43(module) {',
      '  class WebSocketClient { connect() {} }',
      '  new WebSocketClient().connect()',
      '}',
      '// startup',
      '__webpack_require__(43);',
      'var __webpack_exports__ = __webpack_require__(999);'
    ].join('\n')

    const stripped = stripDevServerStartupFromContentScript(source)

    expect(stripped).toContain('__webpack_require__(43);')
  })

  it('strips the renamed-module HMR client (WDS marker with __webpack_module__.hot.check())', () => {
    const source = [
      '814(__webpack_module__, __unused_rspack___webpack_exports__, __webpack_require__) {',
      "  log('info', '[HMR] Waiting for update signal from WDS...');",
      '  __webpack_module__.hot.check()',
      '}',
      '// startup',
      '__webpack_require__(814);',
      'var __webpack_exports__ = __webpack_require__(999);'
    ].join('\n')

    const stripped = stripDevServerStartupFromContentScript(source)

    expect(stripped).not.toContain('__webpack_require__(814);')
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
