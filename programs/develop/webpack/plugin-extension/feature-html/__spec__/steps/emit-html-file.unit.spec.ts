import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {EmitHtmlFile} from '../../steps/emit-html-file'

function makeCompilation() {
  const state: any = {warnings: []}
  const assets: Record<string, any> = {}
  const innerCompilation: any = {
    hooks: {processAssets: {tap: (_: any, cb: any) => cb()}},
    warnings: state.warnings,
    emitAsset: function (name: string, src: any) {
      assets[name] = src
    }
  }
  return {
    state,
    assets,
    options: {mode: 'production'},
    hooks: {thisCompilation: {tap: (_: any, fn: any) => fn(innerCompilation)}}
  } as any
}

describe('EmitHtmlFile', () => {
  it('emits html source for include entries with both absolute-root and relative paths', () => {
    const tmp = path.join(__dirname, '.tmp-emit')
    fs.rmSync(tmp, {recursive: true, force: true})
    fs.mkdirSync(tmp, {recursive: true})
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{"name":"X"}', 'utf8')
    const page = path.join(tmp, 'index.html')
    fs.writeFileSync(page, '<html></html>', 'utf8')
    const c = makeCompilation()
    new EmitHtmlFile({
      manifestPath,
      includeList: {'feature/index': '/index.html', 'feature/rel': 'index.html'}
    } as any).apply(c as any)
    const keys = Object.keys(c.assets)
    expect(keys.length).toBeGreaterThanOrEqual(1)
    expect(keys.some((k) => k.endsWith('.html'))).toBe(true)
  })

  it('warns for missing pages/* include entries', () => {
    const tmp = path.join(__dirname, '.tmp-emit2')
    fs.rmSync(tmp, {recursive: true, force: true})
    fs.mkdirSync(tmp, {recursive: true})
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{"name":"X"}', 'utf8')
    const c = makeCompilation()
    new EmitHtmlFile({
      manifestPath,
      includeList: {'pages/missing': '/missing.html'}
    } as any).apply(c as any)
    expect(c.state.warnings.length).toBeGreaterThanOrEqual(1)
  })
})

