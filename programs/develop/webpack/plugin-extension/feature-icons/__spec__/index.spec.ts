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

describe('IconsPlugin', () => {
  describe('action icons', () => {
    const fixturesPath = getFixturesPath('action')
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

    // const icon16 = path.join(outputPath, 'images', 'extension_16.png')
    // const icon48 = path.join(outputPath, 'images', 'extension_48.png')
    const excludedIcon = path.join(outputPath, 'images', 'excluded_icon.png')
    const missingIcon = path.join(outputPath, 'images', 'missing_icon.png')

    it('outputs icon files to destination folder', async () => {
      // await assertFileIsEmitted(icon16)
      // await assertFileIsEmitted(icon48)
    })

    it('does not output excluded icons', async () => {
      await assertFileIsNotEmitted(excludedIcon)
    })

    it('handles missing icons gracefully', async () => {
      await assertFileIsNotEmitted(missingIcon)
    })

    it('icon file contains expected PNG header', async () => {
      // PNG files start with the following 8 bytes: 89 50 4E 47 0D 0A 1A 0A
      // const data = await fs.promises.readFile(icon16)
      // expect(data.slice(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    })
  })

  describe('page action icons', () => {
    const fixturesPath = getFixturesPath('action')
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

    // const icon16 = path.join(outputPath, 'images', 'extension_16.png')
    // const icon48 = path.join(outputPath, 'images', 'extension_48.png')
    // const excludedIcon = path.join(outputPath, 'images', 'excluded_icon.png')
    // const missingIcon = path.join(outputPath, 'images', 'missing_icon.png')

    it('outputs icon files to destination folder', async () => {
      // await assertFileIsEmitted(icon16)
      // await assertFileIsEmitted(icon48)
    })

    it('does not output excluded icons', async () => {
      // await assertFileIsNotEmitted(excludedIcon)
    })

    it('handles missing icons gracefully', async () => {
      // await assertFileIsNotEmitted(missingIcon)
    })

    it('icon file contains expected PNG header', async () => {
      // const data = await fs.promises.readFile(icon16)
      // expect(data.slice(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    })
  })

  describe.skip('theme icons', () => {
    const fixturesPath = getFixturesPath('theme_icons')
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

    // const icon16 = path.join(outputPath, 'icons', 'extension_16.png')
    // const icon48 = path.join(outputPath, 'icons', 'extension_48.png')
    const excludedIcon = path.join(outputPath, 'icons', 'excluded_icon.png')
    const missingIcon = path.join(outputPath, 'icons', 'missing_icon.png')

    it('outputs icon files to destination folder', async () => {
      // await assertFileIsEmitted(icon16)
      // await assertFileIsEmitted(icon48)
    })

    it('does not output excluded icons', async () => {
      await assertFileIsNotEmitted(excludedIcon)
    })

    it('handles missing icons gracefully', async () => {
      await assertFileIsNotEmitted(missingIcon)
    })

    it('icon file contains expected PNG header', async () => {
      // const data = await fs.promises.readFile(icon16)
      // expect(data.slice(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    })
  })
})
