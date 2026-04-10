import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
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
    const assets: Record<string, any> = {'feature/index.html': {}}
    const innerCompilation: any = {
      hooks: {processAssets: {tap: (_: any, cb: any) => cb()}},
      updateAsset: function (name: string, src: any) {
        assets[name] = {
          source: {source: () => (src.source ? src.source() : src)}
        }
      },
      errors: [] as any[]
    }
    const c: any = {
      options: {mode: 'production'},
      assets,
      hooks: {
        thisCompilation: {tap: (_: any, fn: any) => fn(innerCompilation)}
      }
    }
    new UpdateHtmlFile({
      manifestPath,
      includeList: {'feature/index': html}
    } as any).apply(c as any)
    expect(assets['feature/index.html']).toBeTruthy()
  })
})
