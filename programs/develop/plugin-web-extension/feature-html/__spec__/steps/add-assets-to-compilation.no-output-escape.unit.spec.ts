import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, expect, it} from 'vitest'
import {joinEmittedAssetName} from '../../html-lib/utils'
import {AddAssetsToCompilation} from '../../steps/add-assets-to-compilation'

function makeCompilation(contextDir: string = process.cwd()) {
  const assets: Record<string, any> = {}
  const compilationObj: any = {
    options: {mode: 'production', output: {path: '/out'}},
    getAsset: (name: string) => assets[name],
    assets,
    errors: [],
    warnings: [] as any[],
    hooks: {processAssets: {tap: (_: any, cb: any) => cb()}},
    emitAsset: (name: string, src: any) => {
      assets[name] = {
        source: {source: () => (src.source ? src.source() : src)}
      }
    }
  }
  return {
    options: {context: contextDir},
    hooks: {
      thisCompilation: {tap: (_: any, fn: any) => fn(compilationObj)}
    },
    compilationObj
  } as any
}

describe('joinEmittedAssetName (URL-clamped asset names)', () => {
  it('keeps assets below the html dir under assets/<relative>', () => {
    expect(joinEmittedAssetName('assets', 'img/logo.png')).toBe(
      'assets/img/logo.png'
    )
  })

  it('clamps leading .. the way chrome resolves the matching URL', () => {
    // one level up eats the assets/ prefix, like /assets/../x -> /x
    expect(joinEmittedAssetName('assets', '../img/logo.png')).toBe(
      'img/logo.png'
    )
    // deeper walks clamp at the root instead of escaping the output dir
    expect(joinEmittedAssetName('assets', '../../../assets/icon16.png')).toBe(
      'assets/icon16.png'
    )
  })

  it('never produces a name with a .. segment', () => {
    for (const rel of ['../../a.png', '../../../../b/c.png', '../d.png']) {
      const name = joinEmittedAssetName('assets', rel)
      expect(name.split('/')).not.toContain('..')
    }
  })

  it('clamps even with an empty prefix', () => {
    expect(joinEmittedAssetName('', '../logo.png')).toBe('logo.png')
  })
})

describe('AddAssetsToCompilation (no output-dir escape)', () => {
  it('a nested page referencing ../../../assets/<icon> emits INSIDE the output dir', () => {
    // The wild-corpus Sappgulf storm: popup.html at adapters/chrome/popup/
    // references ../../../assets/icon16.png. The emitted asset name used to be
    // ../../assets/icon16.png, the dev middleware wrote it OVER the source
    // file, and the watcher recompiled on its own emit once per second.
    const tmpDirectoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'feature-html-no-escape-')
    )
    try {
      const manifestFilePath = path.join(tmpDirectoryPath, 'manifest.json')
      fs.writeFileSync(manifestFilePath, '{}', 'utf8')

      const assetsDirectoryPath = path.join(tmpDirectoryPath, 'assets')
      fs.mkdirSync(assetsDirectoryPath, {recursive: true})
      fs.writeFileSync(path.join(assetsDirectoryPath, 'icon16.png'), 'PNG')

      const popupDirectoryPath = path.join(
        tmpDirectoryPath,
        'adapters/chrome/popup'
      )
      fs.mkdirSync(popupDirectoryPath, {recursive: true})
      const htmlFilePath = path.join(popupDirectoryPath, 'popup.html')
      fs.writeFileSync(
        htmlFilePath,
        `<html><body><img src="../../../assets/icon16.png"></body></html>`,
        'utf8'
      )

      const compiler: any = makeCompilation(tmpDirectoryPath)
      compiler.compilationObj.assets[path.basename(htmlFilePath)] = {
        source: {source: () => fs.readFileSync(htmlFilePath, 'utf8')}
      }

      new AddAssetsToCompilation({
        manifestPath: manifestFilePath,
        includeList: {'action/index': htmlFilePath}
      } as any).apply(compiler as any)

      const emittedAssetNames = Object.keys(compiler.compilationObj.assets)
      for (const name of emittedAssetNames) {
        expect(name.split('/')).not.toContain('..')
      }
      expect(emittedAssetNames).toContain('assets/icon16.png')
    } finally {
      fs.rmSync(tmpDirectoryPath, {recursive: true, force: true})
    }
  })
})
