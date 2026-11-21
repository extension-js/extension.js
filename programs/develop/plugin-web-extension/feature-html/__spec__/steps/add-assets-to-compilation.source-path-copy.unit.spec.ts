import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
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

function makeCompilation(contextDirectory: string) {
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
    options: {context: contextDirectory},
    hooks: {
      thisCompilation: {
        tap: (_: unknown, fn: TapCallback) => fn(compilationObj)
      }
    },
    compilationObj
  }
}

describe('AddAssetsToCompilation (source-path copies)', () => {
  it('emits a relative static asset once, under its bundled name', () => {
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

      const compiler = makeCompilation(tmpDirectoryPath)
      compiler.compilationObj.assets[path.basename(htmlFilePath)] = {
        source: {source: () => fs.readFileSync(htmlFilePath, 'utf8')}
      }

      new AddAssetsToCompilation({
        manifestPath: manifestFilePath,
        includeList: {'feature/index': htmlFilePath}
      }).apply(asCompiler(compiler))

      const emittedAssetNames = Object.keys(compiler.compilationObj.assets)
      const bundled = emittedAssetNames.find((name) =>
        /^assets\/logo\.[0-9a-f]{8}\.png$/.test(name)
      )

      expect(bundled).toBeDefined()
      expect(emittedAssetNames).not.toContain('assets/img/logo.png')
      expect(emittedAssetNames).not.toContain('img/logo.png')
      expect(
        compiler.compilationObj.assets[String(bundled)].source
          .source()
          .toString()
      ).toBe('PNG')
    } finally {
      fs.rmSync(tmpDirectoryPath, {recursive: true, force: true})
    }
  })

  it('ships a root URL target at its source path, the one the page asks for', () => {
    const tmpDirectoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'feature-html-root-url-copy-')
    )

    try {
      const manifestFilePath = path.join(tmpDirectoryPath, 'manifest.json')
      fs.writeFileSync(manifestFilePath, '{}', 'utf8')

      const imageDirectoryPath = path.join(tmpDirectoryPath, 'img')
      fs.mkdirSync(imageDirectoryPath, {recursive: true})
      fs.writeFileSync(path.join(imageDirectoryPath, 'logo.png'), 'PNG')

      const htmlFilePath = path.join(tmpDirectoryPath, 'index.html')
      fs.writeFileSync(
        htmlFilePath,
        `<html><body><img src="/img/logo.png"></body></html>`,
        'utf8'
      )

      const compiler = makeCompilation(tmpDirectoryPath)
      compiler.compilationObj.assets[path.basename(htmlFilePath)] = {
        source: {source: () => fs.readFileSync(htmlFilePath, 'utf8')}
      }

      new AddAssetsToCompilation({
        manifestPath: manifestFilePath,
        includeList: {'feature/index': htmlFilePath}
      }).apply(asCompiler(compiler))

      const emittedAssetNames = Object.keys(compiler.compilationObj.assets)

      expect(emittedAssetNames).toContain('img/logo.png')
      expect(emittedAssetNames.filter((name) => name.endsWith('.png'))).toEqual(
        ['img/logo.png']
      )
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

      const compiler = makeCompilation(tmpDirectoryPath)
      compiler.compilationObj.assets[path.basename(htmlFilePath)] = {
        source: {source: () => fs.readFileSync(htmlFilePath, 'utf8')}
      }

      new AddAssetsToCompilation({
        manifestPath: manifestFilePath,
        includeList: {'feature/index': htmlFilePath}
      }).apply(asCompiler(compiler))

      const emittedAssetNames = Object.keys(compiler.compilationObj.assets)
      expect(emittedAssetNames).not.toContain('public/pic.png')
      expect(emittedAssetNames).not.toContain('assets/pic.png')
    } finally {
      fs.rmSync(tmpDirectoryPath, {recursive: true, force: true})
    }
  })

  it('names a folder reference as the author typed it', () => {
    const tmpDirectoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'feature-html-folder-ref-')
    )

    try {
      const manifestFilePath = path.join(tmpDirectoryPath, 'manifest.json')
      fs.writeFileSync(manifestFilePath, '{}', 'utf8')
      fs.mkdirSync(path.join(tmpDirectoryPath, 'docs'), {recursive: true})

      const htmlFilePath = path.join(tmpDirectoryPath, 'index.html')
      fs.writeFileSync(
        htmlFilePath,
        `<html><body><img src=""><iframe src="./docs/"></iframe></body></html>`,
        'utf8'
      )

      const compiler = makeCompilation(tmpDirectoryPath)
      compiler.compilationObj.assets[path.basename(htmlFilePath)] = {
        source: {source: () => fs.readFileSync(htmlFilePath, 'utf8')}
      }

      new AddAssetsToCompilation({
        manifestPath: manifestFilePath,
        includeList: {'feature/index': htmlFilePath}
      }).apply(asCompiler(compiler))

      const folderWarnings = compiler.compilationObj.warnings
        .map((warning) => String(warning.message))
        .filter((message: string) => message.includes('references a folder'))

      expect(folderWarnings).toHaveLength(1)
      expect(folderWarnings[0]).toMatch(/Update the \S*\.\/docs\/\S* reference/)
      expect(folderWarnings[0]).not.toMatch(
        new RegExp(
          `Update the \\S*${tmpDirectoryPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
        )
      )
    } finally {
      fs.rmSync(tmpDirectoryPath, {recursive: true, force: true})
    }
  })
})
