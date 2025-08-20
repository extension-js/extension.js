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

describe('SpecialFoldersPlugin', () => {
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

  describe('public folder copy', () => {
    it('copies files from public/ to the output directory root preserving structure', async () => {
      // A few representative assets that should be copied by CopyPublicFolder
      const css = path.join(outputPath, 'css', 'file.css')
      const html = path.join(outputPath, 'html', 'file.html')
      const img = path.join(outputPath, 'img', 'icon.png')
      const logo = path.join(outputPath, 'logo.svg')

      await assertFileIsEmitted(css)
      await assertFileIsEmitted(html)
      await assertFileIsEmitted(img)
      await assertFileIsEmitted(logo)
    })
  })
})
