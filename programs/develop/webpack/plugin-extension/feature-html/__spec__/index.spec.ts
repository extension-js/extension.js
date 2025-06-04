import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {extensionBuild} from '../../../../../../programs/develop/dist/module.js'

const getFixturesPath = (demoDir: string) => {
  return path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    'examples',
    demoDir
  )
}

const assertFileIsEmitted = async (filePath: string) => {
  const fileIsEmitted = await fs.promises.access(filePath, fs.constants.F_OK)
  return expect(fileIsEmitted).toBeUndefined()
}

const assertFileIsNotEmitted = async (filePath: string) => {
  await fs.promises.access(filePath, fs.constants.F_OK).catch((err) => {
    expect(err).toBeTruthy()
  })
}

const findStringInFile = async (filePath: string, searchString: string) => {
  const data = await fs.promises.readFile(filePath, 'utf8')
  expect(data).toContain(searchString)
}

describe('HtmlPlugin (default behavior)', () => {
  const fixturesPath = getFixturesPath('special-folders-pages')
  const outputPath = path.resolve(fixturesPath, 'dist', 'chrome')

  beforeAll(async () => {
    await extensionBuild(fixturesPath, {
      browser: 'chrome'
    })
  })

  afterAll(() => {
    if (fs.existsSync(outputPath)) {
      fs.rmSync(outputPath, {recursive: true, force: true})
    }
  })

  const sandboxHtml = path.join(outputPath, 'sandbox', 'page-0.html')
  const pagesHtml = path.join(outputPath, 'pages', 'main.html')
  const excludedHtml = path.join(outputPath, '/', 'html', 'file.html')

  describe('html', () => {
    it('should output HTML files for HTML paths defined in MANIFEST.JSON', async () => {
      await assertFileIsEmitted(sandboxHtml)
    })

    it('should output HTML files for HTML paths defined in INCLUDE option', async () => {
      await assertFileIsEmitted(pagesHtml)
    })

    it('should not output HTML files if HTML file is in EXCLUDE list', async () => {
      await assertFileIsNotEmitted(excludedHtml)
    })

    it('should resolve paths of HTML files for HTML paths defined in MANIFEST.JSON', async () => {
      await findStringInFile(pagesHtml, '/sandbox/page-0.html')
    })

    it('should resolve paths of HTML files for HTML paths defined in INCLUDE option', async () => {
      await findStringInFile(sandboxHtml, '/pages/custom.html')
    })

    it('should resolve paths of HTML files for HTML paths defined in EXCLUDE option', async () => {
      await findStringInFile(pagesHtml, '/html/file.html')
    })
  })

  describe('css', () => {
    const sandboxCss = path.join(outputPath, 'sandbox', 'page-0.css')
    const pagesCss = path.join(outputPath, 'pages', 'main.css')
    const excludedCss = path.join(outputPath, '/', 'css', 'file.css')

    it('should output CSS files for HTML paths defined in MANIFEST.JSON', async () => {
      await assertFileIsEmitted(sandboxCss)
    })

    it('should output CSS files for HTML paths defined in INCLUDE option', async () => {
      await assertFileIsEmitted(pagesCss)
    })

    it('should not output CSS files if CSS file is in EXCLUDE list', async () => {
      await assertFileIsNotEmitted(excludedCss)
    })

    it('should resolve paths of CSS files for HTML paths defined in MANIFEST.JSON', async () => {
      await assertFileIsNotEmitted(sandboxCss)
    })

    it('should resolve paths of CSS files for HTML paths defined in INCLUDE option', async () => {
      await assertFileIsNotEmitted(pagesCss)
    })

    it('should resolve paths of CSS files for HTML paths defined in EXCLUDE option', async () => {
      await findStringInFile(sandboxHtml, '/css/file.css')
    })
  })

  describe('js', () => {
    const sandboxJs = path.join(outputPath, 'sandbox', 'page-0.js')
    const pagesJs = path.join(outputPath, 'pages', 'main.js')
    const excludedJs = path.join(outputPath, '/', 'js', 'file.js')

    it('should output JS files for HTML paths defined in MANIFEST.JSON', async () => {
      await assertFileIsEmitted(sandboxJs)
    })

    it('should output JS files for HTML paths defined in INCLUDE option', async () => {
      await assertFileIsEmitted(pagesJs)
    })

    it('should not output JS files if JS file is in EXCLUDE list', async () => {
      await assertFileIsNotEmitted(excludedJs)
    })

    it('should resolve paths of JS files for HTML paths defined in MANIFEST.JSON', async () => {
      await findStringInFile(sandboxHtml, '/sandbox/page-0.js')
    })

    it('should resolve paths of JS files for HTML paths defined in INCLUDE option', async () => {
      await findStringInFile(pagesHtml, '/pages/main.js')
    })

    it('should resolve paths of JS files for HTML paths defined in EXCLUDE option', async () => {
      await findStringInFile(sandboxHtml, '/js/file.js')
    })
  })

  describe('static assets', () => {
    // const assetsPng = path.join(outputPath, 'assets', 'extension_48.png')
    // const pageAssetsPng = path.join(outputPath, 'assets', 'notpublic-file.png')
    const excludedPng = path.join(outputPath, '/', 'img', 'icon.png')

    // it('should output PNG files for HTML paths defined in MANIFEST.JSON', async () => {
    //   await assertFileIsEmitted(assetsPng)
    // })

    // it('should output PNG files for HTML paths defined in INCLUDE option', async () => {
    //   await assertFileIsEmitted(pageAssetsPng)
    // })

    it('should not output PNG files if PNG file is in EXCLUDE list', async () => {
      await assertFileIsNotEmitted(excludedPng)
    })
  })

  // describe('HtmlPlugin (edge cases)', () => {
  //   const fixturesPath = getFixturesPath('sandbox-nojs')
  //   const webpackConfigPath = path.join(fixturesPath, 'webpack.config.js')
  //   const outputPath = path.resolve(fixturesPath, 'dist', 'chrome')

  //   beforeAll((done) => {
  //     exec(
  //       `npx webpack --config ${webpackConfigPath}`,
  //       {cwd: fixturesPath},
  //       (error, _stdout, _stderr) => {
  //         if (error) {
  //           console.error(`exec error: ${error.message}`)
  //           return done(error)
  //         }
  //         done()
  //       }
  //     )
  //   })

  //   afterAll(() => {
  //     if (fs.existsSync(outputPath)) {
  //       fs.rmSync(outputPath, {recursive: true, force: true})
  //     }
  //   })

  //   it('during DEVELOPMENT, output a default JS file for HTML paths defined in MANIFEST.JSON that doesnt have it', async () => {
  //     const defaultJs = path.join(outputPath, 'sandbox', 'page-0.js')
  //     await assertFileIsEmitted(defaultJs)
  //   })

  //   it('during DEVELOPMENT, output a default JS file for HTML paths defined in INCLUDE that doesnt have it', async () => {
  //     const defaultJs = path.join(outputPath, 'pages', 'main.js')
  //     await assertFileIsEmitted(defaultJs)
  //   })
  // })
})
