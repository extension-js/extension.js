import {describe, it, expect} from 'vitest'
import {HtmlPlugin} from '../index'
import * as fs from 'fs'
import * as path from 'path'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../../plugin-web-extension/feature-scripts/contracts'

function makeCompiler(mode: 'development' | 'production') {
  const rules: any[] = []
  const dummyCompilation: any = {
    hooks: {
      processAssets: {tap: (_: any, cb: any) => cb()},
      afterSeal: {tapPromise: (_: any, cb: any) => cb()}
    },
    warnings: [],
    errors: []
  }
  return {
    options: {mode, module: {rules}},
    hooks: {
      thisCompilation: {tap: (_: any, fn: any) => fn(dummyCompilation)},
      compilation: {tap: (_: any, fn: any) => fn(dummyCompilation)},
      make: {tapAsync: (_: any, fn: any) => fn(dummyCompilation, () => {})},
      watchRun: {
        tapAsync: (_: any, fn: any) => fn({modifiedFiles: new Set()}, () => {})
      }
    }
  } as any
}

describe('HtmlPlugin', () => {
  it('adds dev-mode loaders for HMR and logger', () => {
    const tmp = path.join(__dirname, '.tmp-html-plugin')
    fs.rmSync(tmp, {recursive: true, force: true})
    fs.mkdirSync(tmp, {recursive: true})
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{"name":"x"}', 'utf8')
    const compiler = makeCompiler('development')
    new HtmlPlugin({
      manifestPath,
      includeList: {}
    } as any).apply(compiler as any)
    expect(compiler.options.module.rules.length).toBeGreaterThanOrEqual(1)
  })

  it('scopes the page HMR loader away from feature-scripts2 content entries', () => {
    const tmp = path.join(__dirname, '.tmp-html-plugin-fs2')
    fs.rmSync(tmp, {recursive: true, force: true})
    fs.mkdirSync(tmp, {recursive: true})
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        name: 'x',
        content_scripts: [{js: ['content.ts']}]
      }),
      'utf8'
    )
    const compiler = makeCompiler('development')
    new HtmlPlugin({
      manifestPath,
      includeList: {}
    } as any).apply(compiler as any)

    const pageHmrRule = compiler.options.module.rules.find((rule: any) =>
      Array.isArray(rule?.use)
        ? rule.use.some((entry: any) =>
            String(entry?.loader || '').includes('ensure-hmr-for-scripts')
          )
        : false
    )

    expect(pageHmrRule?.issuerLayer).toEqual({
      not: EXTENSIONJS_CONTENT_SCRIPT_LAYER
    })
    expect(
      pageHmrRule?.exclude?.some(
        (entry: unknown) => typeof entry === 'function'
      )
    ).toBe(true)
  })
})
