import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {extensionBuild} from 'extension-develop'
import {getDirname} from '../../../../dirname'

// @ts-ignore - TypeScript will complain because 
// this file is in the excluded list.
// This file is in the excluded list because we
// need to import data from the examples folder
// which is not included in the baseDir defined
// in the tsconfig.json file.
const __dirname = getDirname(import.meta.url)

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
