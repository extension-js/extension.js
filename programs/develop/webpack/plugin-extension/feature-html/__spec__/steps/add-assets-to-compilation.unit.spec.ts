import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {AddAssetsToCompilation} from '../../steps/add-assets-to-compilation'

function makeCompilation() {
  const assets: Record<string, any> = {}
  const compilationObj: any = {
    options: {mode: 'production'},
    getAsset: (name: string) => assets[name],
    assets,
    errors: [],
    warnings: [] as any[],
    hooks: {processAssets: {tap: (_: any, cb: any) => cb()}},
    emitAsset: function (name: string, src: any) {
      assets[name] = {source: {source: () => (src.source ? src.source() : src)}}
    }
  }
  return {
    options: {mode: 'production'},
    getAsset: (name: string) => assets[name],
    assets,
    hooks: {thisCompilation: {tap: (_: any, fn: any) => fn(compilationObj)}}
  }
}

describe('AddAssetsToCompilation', () => {
  it('emits public-root static assets preserving structure', () => {
    const tmp = path.join(__dirname, '.tmp-assets')
    fs.rmSync(tmp, {recursive: true, force: true})
    fs.mkdirSync(tmp, {recursive: true})
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}', 'utf8')
    const publicDir = path.join(tmp, 'public')
    fs.mkdirSync(publicDir, {recursive: true})
    const favicon = path.join(publicDir, 'favicon.png')
    fs.writeFileSync(favicon, 'x')
    const html = path.join(tmp, 'index.html')
    fs.writeFileSync(
      html,
      `<html><head><link rel=\"icon\" href=\"/favicon.png\"></head><body></body></html>`
    )
    const c = makeCompilation()
    ;(c as any).assets[path.basename(html)] = {
      source: {source: () => fs.readFileSync(html).toString()}
    }
    new AddAssetsToCompilation({
      manifestPath,
      includeList: {'feature/index': html}
    } as any).apply(c as any)
    expect((c as any).assets['favicon.png']).toBeUndefined()
  })
})

