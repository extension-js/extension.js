import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  EmitHtmlFile,
  manifestFieldForHtmlFeature
} from '../../steps/emit-html-file'

function makeCompilation() {
  const state: any = {warnings: []}
  const assets: Record<string, any> = {}
  const innerCompilation: any = {
    hooks: {processAssets: {tap: (_: any, cb: any) => cb()}},
    warnings: state.warnings,
    emitAsset: (name: string, src: any) => {
      assets[name] = src
    }
  }
  return {
    state,
    assets,
    options: {mode: 'production'},
    hooks: {
      thisCompilation: {tap: (_: any, fn: any) => fn(innerCompilation)}
    }
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
      includeList: {
        'feature/index': '/index.html',
        'feature/rel': 'index.html'
      }
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

describe('manifestFieldForHtmlFeature', () => {
  it('labels the options slot from the keys the target browser reads', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-emit-label-'))
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        name: 'X',
        options_page: 'legacy.html',
        'firefox:options_ui': {page: 'modern.html'}
      })
    )
    // Chrome never reads the firefox: key, so its missing file is the legacy one.
    expect(
      manifestFieldForHtmlFeature('options/index', manifestPath, 'chrome')
    ).toBe('options_page')
    expect(
      manifestFieldForHtmlFeature('options/index', manifestPath, 'firefox')
    ).toBe('options_ui.page')
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('labels a prefixed popup key only on the browser that reads it', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-emit-label-'))
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        name: 'X',
        'chromium:action': {default_popup: 'popup.html'},
        'firefox:browser_action': {default_popup: 'popup.html'}
      })
    )
    expect(
      manifestFieldForHtmlFeature('action/index', manifestPath, 'edge')
    ).toBe('action.default_popup')
    expect(
      manifestFieldForHtmlFeature('action/index', manifestPath, 'firefox')
    ).toBe('browser_action.default_popup')
    fs.rmSync(tmp, {recursive: true, force: true})
  })
})
