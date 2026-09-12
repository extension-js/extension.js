import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../../plugin-web-extension/feature-scripts/contracts'
import {HtmlPlugin} from '../index'

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

// Scratch projects live under the OS temp dir, so a crashed run leaves no
// litter in the source tree.
const tmpRoots: string[] = []
function makeTmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  tmpRoots.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, {recursive: true, force: true})
})

describe('HtmlPlugin', () => {
  it('adds dev-mode loaders for HMR and logger', () => {
    const tmp = makeTmp('extjs-html-plugin')
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
    const tmp = makeTmp('extjs-html-plugin-fs2')
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
    compiler.options.context = path.dirname(path.dirname(manifestPath))
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
    // A top-level pages/ folder sits under the project root, so the root is
    // inside the injection scope beside the manifest folder.
    expect(pageHmrRule?.include).toContain(path.dirname(manifestPath))
    expect(pageHmrRule?.include).toContain(compiler.options.context)
    expect(
      pageHmrRule?.exclude?.some(
        (entry: unknown) => typeof entry === 'function'
      )
    ).toBe(true)
  })

  it('scopes the page HMR loader away from browser-prefixed content entries', () => {
    const cases: Array<[string, string, boolean]> = [
      ['firefox:content_scripts', 'firefox', true],
      ['chrome:content_scripts', 'edge', true],
      ['firefox:content_scripts', 'chrome', false]
    ]

    for (const [key, browser, excluded] of cases) {
      const tmp = makeTmp(`extjs-html-plugin-${browser}-${excluded}`)
      const manifestPath = path.join(tmp, 'manifest.json')
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({name: 'x', [key]: [{js: ['content.ts']}]}),
        'utf8'
      )
      const compiler = makeCompiler('development')
      compiler.options.context = path.dirname(path.dirname(manifestPath))
      new HtmlPlugin({manifestPath, browser, includeList: {}} as any).apply(
        compiler as any
      )

      const pageHmrRule = compiler.options.module.rules.find((rule: any) =>
        Array.isArray(rule?.use)
          ? rule.use.some((entry: any) =>
              String(entry?.loader || '').includes('ensure-hmr-for-scripts')
            )
          : false
      )
      const excludeFn = pageHmrRule?.exclude?.find(
        (entry: unknown) => typeof entry === 'function'
      ) as (resourcePath: string) => boolean

      expect(excludeFn(path.join(tmp, 'content.ts'))).toBe(excluded)
      fs.rmSync(tmp, {recursive: true, force: true})
    }
  })
})
