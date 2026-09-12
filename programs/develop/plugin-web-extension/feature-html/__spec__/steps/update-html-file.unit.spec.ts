import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {patchHtml} from '../../html-lib/patch-html'
import {UpdateHtmlFile} from '../../steps/update-html-file'

vi.mock('../../html-lib/patch-html', async () => {
  return {
    patchHtml: vi.fn(() => '<html><body>UPDATED</body></html>')
  }
})

describe('UpdateHtmlFile', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('updates html asset using patchHtml', async () => {
    const tmp = path.join(__dirname, '.tmp-update')
    fs.rmSync(tmp, {recursive: true, force: true})
    fs.mkdirSync(tmp, {recursive: true})
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}', 'utf8')
    const html = path.join(tmp, 'index.html')
    fs.writeFileSync(html, '<html></html>')
    // The asset already differs from the file on disk, as it does once the
    // env step has templated it. The step must patch the asset, not the file.
    const templated = '<html><head><title>envBar</title></head></html>'
    const assets: Record<string, any> = {
      'feature/index.html': {source: () => templated}
    }
    // The compilation owns the assets, so the step can find and replace them.
    const innerCompilation: any = {
      hooks: {processAssets: {tap: (_: any, cb: any) => cb()}},
      assets,
      updateAsset: (name: string, src: any) => {
        assets[name] = {
          source: {source: () => (src.source ? src.source() : src)}
        }
      },
      errors: [] as any[]
    }
    const c: any = {
      options: {mode: 'production'},
      hooks: {
        thisCompilation: {tap: (_: any, fn: any) => fn(innerCompilation)}
      }
    }
    new UpdateHtmlFile({
      manifestPath,
      includeList: {'feature/index': html}
    } as any).apply(c as any)
    expect(assets['feature/index.html']).toBeTruthy()
    expect(assets['feature/index.html'].source.source()).toBe(
      '<html><body>UPDATED</body></html>'
    )
    const call = vi.mocked(patchHtml).mock.calls[0]
    expect(call[2]).toBe(html)
    expect(call[6]).toBe(templated)
  })

  it('passes the asset record content when the compilation exposes getAsset', async () => {
    const tmp = path.join(__dirname, '.tmp-update-get-asset')
    fs.rmSync(tmp, {recursive: true, force: true})
    fs.mkdirSync(tmp, {recursive: true})
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}', 'utf8')
    const html = path.join(tmp, 'index.html')
    fs.writeFileSync(html, '<html></html>')
    const templated = Buffer.from('<html><body>from-asset</body></html>')
    const innerCompilation: any = {
      hooks: {processAssets: {tap: (_: any, cb: any) => cb()}},
      getAsset: (name: string) =>
        name === 'feature/index.html'
          ? {name, source: {source: () => templated}, info: {}}
          : undefined,
      updateAsset: vi.fn(),
      errors: [] as any[]
    }
    const c: any = {
      options: {mode: 'production'},
      hooks: {
        thisCompilation: {tap: (_: any, fn: any) => fn(innerCompilation)}
      }
    }
    new UpdateHtmlFile({
      manifestPath,
      includeList: {'feature/index': html}
    } as any).apply(c as any)
    const call = vi.mocked(patchHtml).mock.calls.at(-1) as any[]
    expect(call[6]).toBe(templated.toString('utf8'))
    expect(innerCompilation.updateAsset).toHaveBeenCalledTimes(1)
  })
})
