import * as path from 'node:path'
import {rspack, type Stats} from '@rspack/core'
import {describe, expect, it, vi} from 'vitest'
import {compileIssues, writeProject} from '../../__spec__/helpers/real-compiler'
import {decodeSourceMap} from '../../__spec__/helpers/sourcemap-decode'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {
  contentScriptRetainsDevServerRuntime,
  stripDevServerStartupFromContentScript
} from '../steps/remove-content-script-dev-server-runtime'
import {StripContentScriptDevServerRuntime} from '../steps/strip-content-script-dev-server-runtime'

const makeTempFolder = trackTempFolders()

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
      getAsset: () => undefined,
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

describe('the dev-server runtime warning', () => {
  it('is not raised for a content script that only names the client', async () => {
    const root = writeProject(makeTempFolder('extjs-strip-warning-'), {
      'content.js': "console.log('see @rspack/dev-server/client for details')\n"
    })
    const {errors, warnings} = await compileIssues(
      root,
      'development',
      {'content_scripts/content-0': 'content.js'},
      [new StripContentScriptDevServerRuntime()]
    )

    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('is not raised once the client start was taken out', async () => {
    const root = writeProject(makeTempFolder('extjs-strip-warning-'), {
      'client.js': "console.log('@rspack/dev-server/client/index.js?x')\n",
      'content.js': "console.log('content')\n"
    })
    const {warnings} = await compileIssues(
      root,
      'development',
      {'content_scripts/content-0': 'content.js'},
      [
        {
          apply(compiler) {
            compiler.options.entry = {
              'content_scripts/content-0': {
                import: [
                  path.join(root, 'client.js'),
                  path.join(root, 'content.js')
                ]
              }
            }
          }
        },
        new StripContentScriptDevServerRuntime()
      ]
    )

    expect(warnings).toEqual([])
  })

  it('names a content script whose client start is still required', () => {
    const source = [
      '123(module) {',
      "  console.log('@rspack/dev-server/client/index.js?test')",
      '}',
      '// startup',
      'var client = __webpack_require__(123);',
      'var __webpack_exports__ = __webpack_require__(999);'
    ].join('\n')

    expect(
      contentScriptRetainsDevServerRuntime(
        stripDevServerStartupFromContentScript(source)
      )
    ).toBe(true)
  })
})

// The devtool wrote the map before this step, so the line it removes must
// leave the map too, or each line below it points one line off.
describe('the source map of a stripped content script', () => {
  async function build(root: string, strip: boolean) {
    const compiler = rspack({
      mode: 'development',
      context: root,
      devtool: 'source-map',
      entry: {
        'content_scripts/content-0': {
          import: [path.join(root, 'client.js'), path.join(root, 'content.js')]
        }
      },
      output: {
        path: path.join(root, strip ? 'dist' : 'plain'),
        publicPath: '/'
      },
      // What a dev session builds with: numeric ids and the hot runtime.
      optimization: {moduleIds: 'deterministic', concatenateModules: false},
      plugins: [
        new rspack.HotModuleReplacementPlugin(),
        ...(strip ? [new StripContentScriptDevServerRuntime()] : [])
      ]
    })
    const stats = await new Promise<Stats>((resolve, reject) =>
      compiler.run((error, result) =>
        error || !result ? reject(error) : resolve(result)
      )
    )
    await new Promise((resolve) => compiler.close(resolve))
    const read = (name: string) =>
      String(stats.compilation.getAsset(name)?.source.source())

    expect(stats.hasErrors()).toBe(false)

    return {
      code: read('content_scripts/content-0.js'),
      map: decodeSourceMap(read('content_scripts/content-0.js.map'))
    }
  }

  it('drops the mapping of the start line it removes', async () => {
    const root = writeProject(makeTempFolder('extjs-strip-map-'), {
      'client.js': "console.log('@rspack/dev-server/client/index.js?x')\n",
      'content.js': "console.log('content')\n"
    })
    const plain = await build(root, false)
    const stripped = await build(root, true)
    const lines = stripped.code.split('\n')
    const removed = plain.code
      .split('\n')
      .findIndex((line, index) => line !== lines[index])

    expect(removed).toBeGreaterThan(0)
    expect(stripped.code.split('\n')).toHaveLength(
      plain.code.split('\n').length - 1
    )

    expect(stripped.map.lines).toEqual(
      plain.map.lines.filter((_, index) => index !== removed)
    )
  })
})
