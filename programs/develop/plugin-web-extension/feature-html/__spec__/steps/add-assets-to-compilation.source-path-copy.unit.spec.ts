import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {AddAssetsToCompilation} from '../../steps/add-assets-to-compilation'

function makeCompilation(contextDirectory: string) {
  const assets: Record<string, any> = {}
  const compilationObj: any = {
    options: {mode: 'production', output: {path: '/out'}},
    getAsset: (name: string) => assets[name],
    assets,
    errors: [],
    warnings: [] as any[],
    hooks: {processAssets: {tap: (_: any, cb: any) => cb()}},
    emitAsset: function (name: string, src: any) {
      assets[name] = {
        source: {source: () => (src.source ? src.source() : src)}
      }
    }
  }
  return {
    // The compiler context is the PROJECT root in production; asset
    // containment checks key off it, so the temp project must be it here.
    options: {context: contextDirectory},
    hooks: {
      thisCompilation: {tap: (_: any, fn: any) => fn(compilationObj)}
    },
    compilationObj
  } as any
}

describe('AddAssetsToCompilation (source-path copies)', () => {
  it('also emits static assets at their manifest-relative source path', () => {
    // Chrome serves every packed file at its source path, so
    // chrome.runtime.getURL('img/logo.png') must keep resolving in the
    // built extension even though the HTML rewrite points at assets/.
    const tmpDirectoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'feature-html-source-path-copy-')
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
        `<html><body><img src="img/logo.png"></body></html>`,
        'utf8'
      )

      const compiler: any = makeCompilation(tmpDirectoryPath)
      compiler.compilationObj.assets[path.basename(htmlFilePath)] = {
        source: {source: () => fs.readFileSync(htmlFilePath, 'utf8')}
      }

      new AddAssetsToCompilation({
        manifestPath: manifestFilePath,
        includeList: {'feature/index': htmlFilePath}
      } as any).apply(compiler as any)

      const emittedAssetNames = Object.keys(compiler.compilationObj.assets)
      // The assets/ contract copy AND the Chrome source-path copy.
      expect(emittedAssetNames).toContain('assets/img/logo.png')
      expect(emittedAssetNames).toContain('img/logo.png')
      expect(
        compiler.compilationObj.assets['img/logo.png'].source
          .source()
          .toString()
      ).toBe('PNG')
    } finally {
      fs.rmSync(tmpDirectoryPath, {recursive: true, force: true})
    }
  })

  it('does not duplicate public/ assets or escape the extension root', () => {
    const tmpDirectoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'feature-html-source-path-guards-')
    )
    try {
      const manifestFilePath = path.join(tmpDirectoryPath, 'manifest.json')
      fs.writeFileSync(manifestFilePath, '{}', 'utf8')

      const publicDirectoryPath = path.join(tmpDirectoryPath, 'public')
      fs.mkdirSync(publicDirectoryPath, {recursive: true})
      fs.writeFileSync(path.join(publicDirectoryPath, 'pic.png'), 'PNG')

      const htmlFilePath = path.join(tmpDirectoryPath, 'index.html')
      fs.writeFileSync(
        htmlFilePath,
        `<html><body><img src="/pic.png"></body></html>`,
        'utf8'
      )

      const compiler: any = makeCompilation(tmpDirectoryPath)
      compiler.compilationObj.assets[path.basename(htmlFilePath)] = {
        source: {source: () => fs.readFileSync(htmlFilePath, 'utf8')}
      }

      new AddAssetsToCompilation({
        manifestPath: manifestFilePath,
        includeList: {'feature/index': htmlFilePath}
      } as any).apply(compiler as any)

      const emittedAssetNames = Object.keys(compiler.compilationObj.assets)
      // public/ files are copied by the public pipeline, not re-emitted here.
      expect(emittedAssetNames).not.toContain('public/pic.png')
      expect(emittedAssetNames).not.toContain('assets/pic.png')
    } finally {
      fs.rmSync(tmpDirectoryPath, {recursive: true, force: true})
    }
  })
})
