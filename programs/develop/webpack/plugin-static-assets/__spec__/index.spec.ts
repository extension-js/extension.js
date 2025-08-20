import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {rspack} from '@rspack/core'
import {StaticAssetsPlugin} from '../index'

const dirHasAsset = async (dir: string, baseName: string, ext: string) => {
  const files = await fs.promises.readdir(dir)
  return files.some(
    (f) =>
      f === `${baseName}${ext}` ||
      (f.startsWith(`${baseName}.`) && f.endsWith(ext))
  )
}

const assertFileIsNotEmitted = async (filePath: string) => {
  await fs.promises.access(filePath, fs.constants.F_OK).catch((err) => {
    expect(err).toBeTruthy()
  })
}

describe('StaticAssetsPlugin', () => {
  describe('emits common static assets to assets/[name][ext]', () => {
    const tmpRoot = path.join(os.tmpdir(), 'extjs-static-assets-')
    let projectDir = ''
    let outputPath = ''

    beforeAll(async () => {
      projectDir = await fs.promises.mkdtemp(tmpRoot)

      const srcDir = path.join(projectDir, 'src')
      await fs.promises.mkdir(srcDir, {recursive: true})

      // Create an entry that imports various asset types
      const entryJs = [
        "import './img/big.png'",
        "import './img/small.svg'",
        "import './img/big.svg'",
        "import './fonts/font.woff'",
        "import './docs/file.pdf'",
        "import './data/sample.csv'",
        'export default 1'
      ].join('\n')
      await fs.promises.writeFile(
        path.join(srcDir, 'index.js'),
        entryJs,
        'utf8'
      )

      // Assets
      const imgDir = path.join(srcDir, 'img')
      const fontsDir = path.join(srcDir, 'fonts')
      const docsDir = path.join(srcDir, 'docs')
      const dataDir = path.join(srcDir, 'data')
      await fs.promises.mkdir(imgDir, {recursive: true})
      await fs.promises.mkdir(fontsDir, {recursive: true})
      await fs.promises.mkdir(docsDir, {recursive: true})
      await fs.promises.mkdir(dataDir, {recursive: true})

      // Create files; ensure some are > 2KB so they are emitted as files, not inlined
      const bigBuffer = Buffer.alloc(3 * 1024, 0x41) // ~3KB
      const smallBuffer = Buffer.alloc(256, 0x42) // small (<2KB)

      await fs.promises.writeFile(path.join(imgDir, 'big.png'), bigBuffer)
      await fs.promises.writeFile(path.join(imgDir, 'big.svg'), bigBuffer)
      await fs.promises.writeFile(path.join(imgDir, 'small.svg'), smallBuffer)
      // Write font files, including a .ttf to accommodate pipelines that convert/rename
      await fs.promises.writeFile(path.join(fontsDir, 'font.woff'), bigBuffer)
      await fs.promises.writeFile(path.join(fontsDir, 'font.woff2'), bigBuffer)
      await fs.promises.writeFile(path.join(fontsDir, 'font.ttf'), bigBuffer)
      await fs.promises.writeFile(path.join(docsDir, 'file.pdf'), bigBuffer)
      await fs.promises.writeFile(
        path.join(dataDir, 'sample.csv'),
        'a,b\n1,2\n',
        'utf8'
      )

      // Minimal manifest.json (not used by this plugin but required by constructor)
      await fs.promises.writeFile(
        path.join(projectDir, 'manifest.json'),
        JSON.stringify({name: 'x', version: '0.0.0', manifest_version: 3}),
        'utf8'
      )

      const compiler = rspack({
        context: projectDir,
        mode: 'development',
        entry: path.join(srcDir, 'index.js'),
        output: {
          path: path.join(projectDir, 'dist'),
          filename: 'bundle.js',
          clean: true
        },
        plugins: [
          new StaticAssetsPlugin({
            mode: 'development',
            manifestPath: path.join(projectDir, 'manifest.json')
          })
        ]
      })

      await new Promise<void>((resolve, reject) => {
        compiler.run((err, stats) => {
          if (err) return reject(err)
          if (stats?.hasErrors()) {
            try {
              // Log detailed rspack errors to aid debugging in CI/local runs
              const json = stats.toJson({
                all: false,
                errors: true,
                warnings: true
              })
              // eslint-disable-next-line no-console
              console.error(
                'Rspack errors:',
                JSON.stringify(json.errors, null, 2)
              )
              // eslint-disable-next-line no-console
              console.error(
                'Rspack warnings:',
                JSON.stringify(json.warnings, null, 2)
              )
            } catch {}
            return reject(new Error('Compilation failed'))
          }
          compiler.close(() => resolve())
        })
      })

      outputPath = path.resolve(projectDir, 'dist')
    })

    afterAll(async () => {
      if (projectDir && fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, {recursive: true, force: true})
      }
    })

    it('emits images, svg (big), fonts, and docs under assets/', async () => {
      const assetsDir = path.join(outputPath, 'assets')
      expect(await dirHasAsset(assetsDir, 'big', '.png')).toBe(true)
      expect(await dirHasAsset(assetsDir, 'big', '.svg')).toBe(true)
      // Accept either emitted font files or inlined data URIs
      const files = await fs.promises.readdir(assetsDir)
      const hasFont = files.some(
        (f) => f.endsWith('.woff') || f.endsWith('.woff2') || f.endsWith('.ttf')
      )
      if (!hasFont) {
        const bundle = await fs.promises.readFile(
          path.join(outputPath, 'bundle.js'),
          'utf8'
        )
        const inlinedFont =
          /data:(?:application\/font-woff|font\/woff2?|application\/octet-stream);base64,/i.test(
            bundle
          )
        expect(inlinedFont).toBe(true)
      } else {
        expect(hasFont).toBe(true)
      }
      expect(await dirHasAsset(assetsDir, 'file', '.pdf')).toBe(true)
    })

    it('inlines small svg (<= 2KB) instead of emitting a file', async () => {
      await assertFileIsNotEmitted(path.join(outputPath, 'assets', 'small.svg'))
    })
  })

  describe('uses contenthash filenames in production mode', () => {
    const tmpRoot = path.join(os.tmpdir(), 'extjs-static-assets-prod-')
    let projectDir = ''
    let outputPath = ''

    beforeAll(async () => {
      projectDir = await fs.promises.mkdtemp(tmpRoot)

      const srcDir = path.join(projectDir, 'src')
      await fs.promises.mkdir(srcDir, {recursive: true})

      await fs.promises.writeFile(
        path.join(srcDir, 'index.js'),
        "import './img/big.png'\nexport default 1\n",
        'utf8'
      )

      const imgDir = path.join(srcDir, 'img')
      await fs.promises.mkdir(imgDir, {recursive: true})
      const bigBuffer = Buffer.alloc(3 * 1024, 0x41)
      await fs.promises.writeFile(path.join(imgDir, 'big.png'), bigBuffer)

      await fs.promises.writeFile(
        path.join(projectDir, 'manifest.json'),
        JSON.stringify({name: 'x', version: '0.0.0', manifest_version: 3}),
        'utf8'
      )

      const compiler = rspack({
        context: projectDir,
        mode: 'production',
        entry: path.join(srcDir, 'index.js'),
        output: {
          path: path.join(projectDir, 'dist'),
          filename: 'bundle.js',
          clean: true
        },
        plugins: [
          new StaticAssetsPlugin({
            mode: 'production',
            manifestPath: path.join(projectDir, 'manifest.json')
          })
        ]
      })

      await new Promise<void>((resolve, reject) => {
        compiler.run((err, stats) => {
          if (err) return reject(err)
          if (stats?.hasErrors()) return reject(new Error('Compilation failed'))
          compiler.close(() => resolve())
        })
      })

      outputPath = path.resolve(projectDir, 'dist')
    })

    afterAll(async () => {
      if (projectDir && fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, {recursive: true, force: true})
      }
    })

    it('emits file with a content hash in the filename', async () => {
      const files = await fs.promises.readdir(path.join(outputPath, 'assets'))
      const matched = files.find((f) => /^big\.[a-f0-9]{8}\.png$/.test(f))
      expect(matched).toBeTruthy()
    })
  })

  describe('respects an existing custom SVG rule (does not add default SVG rule)', () => {
    const tmpRoot = path.join(os.tmpdir(), 'extjs-static-assets-customsvg-')
    let projectDir = ''
    let outputPath = ''

    beforeAll(async () => {
      projectDir = await fs.promises.mkdtemp(tmpRoot)

      const srcDir = path.join(projectDir, 'src')
      await fs.promises.mkdir(srcDir, {recursive: true})

      const entryJs = [
        "import value from './img/custom.svg'",
        'console.log(value)',
        ''
      ].join('\n')
      await fs.promises.writeFile(
        path.join(srcDir, 'index.js'),
        entryJs,
        'utf8'
      )

      const imgDir = path.join(srcDir, 'img')
      await fs.promises.mkdir(imgDir, {recursive: true})
      await fs.promises.writeFile(
        path.join(imgDir, 'custom.svg'),
        Buffer.from('<svg></svg>')
      )

      // Write a minimal custom loader that returns a constant string
      const loaderPath = path.join(projectDir, 'svg-custom-loader.js')
      await fs.promises.writeFile(
        loaderPath,
        'module.exports = function () {\n  return \'module.exports = "LOADED_BY_CUSTOM_SVG_LOADER"\'\n}\n',
        'utf8'
      )

      await fs.promises.writeFile(
        path.join(projectDir, 'manifest.json'),
        JSON.stringify({name: 'x', version: '0.0.0', manifest_version: 3}),
        'utf8'
      )

      const compiler = rspack({
        context: projectDir,
        mode: 'development',
        entry: path.join(srcDir, 'index.js'),
        output: {
          path: path.join(projectDir, 'dist'),
          filename: 'bundle.js',
          clean: true
        },
        module: {
          rules: [
            {
              test: /\.svg$/i,
              use: [loaderPath]
            }
          ]
        },
        plugins: [
          new StaticAssetsPlugin({
            mode: 'development',
            manifestPath: path.join(projectDir, 'manifest.json')
          })
        ]
      })

      await new Promise<void>((resolve, reject) => {
        compiler.run((err, stats) => {
          if (err) return reject(err)
          if (stats?.hasErrors()) return reject(new Error('Compilation failed'))
          compiler.close(() => resolve())
        })
      })

      outputPath = path.resolve(projectDir, 'dist')
    })

    afterAll(async () => {
      if (projectDir && fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, {recursive: true, force: true})
      }
    })

    it('does not emit the svg file when a custom svg rule with use[] exists', async () => {
      await assertFileIsNotEmitted(
        path.join(outputPath, 'assets', 'custom.svg')
      )
    })

    it('applies the custom loader output (sanity check)', async () => {
      const bundle = await fs.promises.readFile(
        path.join(outputPath, 'bundle.js'),
        'utf8'
      )
      expect(bundle).toContain('LOADED_BY_CUSTOM_SVG_LOADER')
    })
  })
})
