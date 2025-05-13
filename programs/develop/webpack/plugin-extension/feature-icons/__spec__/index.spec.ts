import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {extensionBuild} from 'extension-develop'

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

describe('IconsPlugin', () => {
  describe.each(['action'])('dealing with %s', (directory) => {
    const fixturesPath = getFixturesPath(directory)
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

    const assetsPng = path.join(outputPath, 'icons', 'extension_16.png')
    const assetsPng2 = path.join(outputPath, 'icons', 'extension_48.png')

    it('outputs icon file to destination folder', async () => {
      await assertFileIsEmitted(assetsPng)
      await assertFileIsEmitted(assetsPng2)
    })
  })
})
