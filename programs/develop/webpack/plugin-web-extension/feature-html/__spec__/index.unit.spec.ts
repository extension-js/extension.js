import {describe, it, expect} from 'vitest'
import {HtmlPlugin} from '../index'
import * as fs from 'fs'
import * as path from 'path'

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
})
