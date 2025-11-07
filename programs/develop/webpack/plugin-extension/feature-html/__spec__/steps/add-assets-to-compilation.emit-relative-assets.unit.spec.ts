import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {AddAssetsToCompilation} from '../../steps/add-assets-to-compilation'

function makeCompilation() {
  const assets: Record<string, any> = {}
  const compilationObj: any = {
    options: {mode: 'production', output: {path: '/out'}},
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
    options: {context: process.cwd()},
    hooks: {thisCompilation: {tap: (_: any, fn: any) => fn(compilationObj)}},
    compilationObj
  } as any
}

describe('AddAssetsToCompilation (relative static assets emission)', () => {
  it('emits relative static assets under assets/<relative>', () => {
    const tmpDirectoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'feature-html-relative-assets-')
    )
    try {
      const manifestFilePath = path.join(tmpDirectoryPath, 'manifest.json')
      fs.writeFileSync(manifestFilePath, '{}', 'utf8')

      const imageDirectoryPath = path.join(tmpDirectoryPath, 'img')
      fs.mkdirSync(imageDirectoryPath, {recursive: true})
      const imageFilePath = path.join(imageDirectoryPath, 'logo.png')
      fs.writeFileSync(imageFilePath, 'PNG')

      const htmlFilePath = path.join(tmpDirectoryPath, 'index.html')
      fs.writeFileSync(
        htmlFilePath,
        `<html><body><img src="img/logo.png?x=1#h"></body></html>`,
        'utf8'
      )

      const compiler: any = makeCompilation()
      // Provide the HTML asset via basename fallback as used in implementation
      compiler.compilationObj.assets[path.basename(htmlFilePath)] = {
        source: {source: () => fs.readFileSync(htmlFilePath, 'utf8')}
      }

      new AddAssetsToCompilation({
        manifestPath: manifestFilePath,
        includeList: {'feature/index': htmlFilePath}
      } as any).apply(compiler as any)

      const emittedAssetNames = Object.keys(compiler.compilationObj.assets)
      // The HTML asset is present; ensure the relative static asset was emitted
      const hasRelativeAsset = emittedAssetNames.some(
        (name) => name === 'assets/img/logo.png'
      )
      expect(hasRelativeAsset).toBe(true)
    } finally {
      fs.rmSync(tmpDirectoryPath, {recursive: true, force: true})
    }
  })
})
