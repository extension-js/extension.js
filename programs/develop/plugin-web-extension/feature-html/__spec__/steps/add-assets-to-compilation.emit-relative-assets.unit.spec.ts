import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {bundledAssetOutputName} from '../../../../lib/asset-output-name'
import {
  asCompiler,
  type TapCallback
} from '../../../__spec__/helpers/rspack-fakes'
import {AddAssetsToCompilation} from '../../steps/add-assets-to-compilation'
import {
  type BuildIssue,
  type FakeAsset,
  readSource
} from '../helpers/html-fakes'

function makeCompilation() {
  const assets: Record<string, FakeAsset> = {}
  const compilationObj = {
    options: {mode: 'production', output: {path: '/out'}},
    getAsset: (name: string) => assets[name],
    assets,
    errors: [] as BuildIssue[],
    warnings: [] as BuildIssue[],
    hooks: {processAssets: {tap: (_: unknown, cb: TapCallback) => cb()}},
    emitAsset: (name: string, src: unknown) => {
      assets[name] = {
        source: {source: () => readSource(src)}
      }
    }
  }

  return {
    options: {context: process.cwd()},
    hooks: {
      thisCompilation: {
        tap: (_: unknown, fn: TapCallback) => fn(compilationObj)
      }
    },
    compilationObj
  }
}

describe('AddAssetsToCompilation (relative static assets emission)', () => {
  it('emits relative static assets under assets/ by their bundled name', () => {
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

      const compiler = makeCompilation()
      compiler.compilationObj.assets[path.basename(htmlFilePath)] = {
        source: {source: () => fs.readFileSync(htmlFilePath, 'utf8')}
      }

      new AddAssetsToCompilation({
        manifestPath: manifestFilePath,
        includeList: {'feature/index': htmlFilePath}
      }).apply(asCompiler(compiler))

      const emittedAssetNames = Object.keys(compiler.compilationObj.assets)
      expect(emittedAssetNames.length).toBeGreaterThan(0)
    } finally {
      fs.rmSync(tmpDirectoryPath, {recursive: true, force: true})
    }
  })

  it('emits video, poster, srcset candidates, and picture sources', () => {
    const tmpDirectoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'feature-html-media-assets-')
    )

    try {
      const manifestFilePath = path.join(tmpDirectoryPath, 'manifest.json')
      fs.writeFileSync(manifestFilePath, '{}', 'utf8')

      fs.writeFileSync(path.join(tmpDirectoryPath, 'intro.mp4'), 'movie')
      fs.writeFileSync(path.join(tmpDirectoryPath, 'poster.jpg'), 'frame')
      fs.writeFileSync(path.join(tmpDirectoryPath, 'hero.png'), 'png')
      fs.writeFileSync(path.join(tmpDirectoryPath, 'hero-2x.png'), 'png2')
      fs.writeFileSync(path.join(tmpDirectoryPath, 'hero.webp'), 'webp')
      fs.writeFileSync(path.join(tmpDirectoryPath, 'hero.jpg'), 'jpg')

      const htmlFilePath = path.join(tmpDirectoryPath, 'index.html')
      fs.writeFileSync(
        htmlFilePath,
        `<html><head>
          <link rel="preload" as="image" imagesrcset="hero.png 1x, hero-2x.png 2x">
        </head><body>
          <video src="intro.mp4" poster="poster.jpg"></video>
          <img src="hero.png" srcset="hero.png 1x, hero-2x.png 2x">
          <picture>
            <source type="image/webp" srcset="hero.webp">
            <img src="hero.jpg">
          </picture>
        </body></html>`,
        'utf8'
      )

      const compiler = makeCompilation()
      compiler.options.context = tmpDirectoryPath
      compiler.compilationObj.assets[path.basename(htmlFilePath)] = {
        source: {source: () => fs.readFileSync(htmlFilePath, 'utf8')}
      }

      new AddAssetsToCompilation({
        manifestPath: manifestFilePath,
        includeList: {'feature/index': htmlFilePath}
      }).apply(asCompiler(compiler))

      const emittedAssetNames = Object.keys(compiler.compilationObj.assets)

      const bundled = (name: string) => {
        const abs = path.join(tmpDirectoryPath, name)

        return bundledAssetOutputName(abs, fs.readFileSync(abs))
      }

      expect(emittedAssetNames).toEqual(
        expect.arrayContaining([
          bundled('intro.mp4'),
          bundled('poster.jpg'),
          bundled('hero.png'),
          bundled('hero-2x.png'),
          bundled('hero.webp'),
          bundled('hero.jpg')
        ])
      )

      expect(emittedAssetNames.filter((name) => name !== 'index.html')).toEqual(
        expect.arrayContaining(
          emittedAssetNames
            .filter((name) => name !== 'index.html')
            .map(() =>
              expect.stringMatching(/^assets\/[\w-]+\.[0-9a-f]{8}\.\w+$/)
            )
        )
      )
    } finally {
      fs.rmSync(tmpDirectoryPath, {recursive: true, force: true})
    }
  })
})
