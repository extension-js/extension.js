import * as fs from 'fs'
import * as path from 'path'
import {describe, expect, it, beforeAll, afterAll, vi} from 'vitest'
import {extensionBuild} from '../../../../../../programs/develop/dist/module.js'

const getFixturesPath = (fixture: string) => {
  return path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    'examples',
    fixture
  )
}

const assertFileIsEmitted = async (filePath: string) => {
  const fileIsEmitted = await fs.promises.access(filePath, fs.constants.F_OK)
  return expect(fileIsEmitted).toBeUndefined()
}

describe.skip('CopyPublicFolder', () => {
  describe('in production mode', () => {
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

    it('copies static files from public folder to output', async () => {
      const publicFile = path.join(outputPath, 'extension.png')
      await assertFileIsEmitted(publicFile)
    })
  })

  describe('in development mode', () => {
    const fixturesPath = getFixturesPath('special-folders-pages')
    const outputPath = path.resolve(fixturesPath, 'dist', 'chrome')
    const publicDir = path.join(fixturesPath, 'public')
    const testFile = path.join(publicDir, 'extension.png')

    beforeAll(async () => {
      // Ensure public directory exists
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, {recursive: true})
      }

      await extensionBuild(fixturesPath, {
        browser: 'chrome'
      })
    })

    afterAll(() => {
      if (fs.existsSync(outputPath)) {
        fs.rmSync(outputPath, {recursive: true, force: true})
      }
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile)
      }
    })

    it('copies static files from public folder to output', async () => {
      const publicFile = path.join(outputPath, 'extension.png')
      await assertFileIsEmitted(publicFile)
    })

    it('watches for new files in public folder', async () => {
      // Create a new file in public folder
      fs.writeFileSync(testFile, 'test content')

      // Wait for file to be copied
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const copiedFile = path.join(outputPath, 'extension.png')
      await assertFileIsEmitted(copiedFile)
    })

    it('watches for file changes in public folder', async () => {
      // Update the test file
      fs.writeFileSync(testFile, 'updated content')

      // Wait for file to be copied
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const copiedFile = path.join(outputPath, 'extension.png')
      const content = fs.readFileSync(copiedFile, 'utf8')
      expect(content).toContain('PNG')
    })

    it('watches for file deletions in public folder', async () => {
      // Delete the test file
      fs.unlinkSync(testFile)

      // Wait for file to be removed
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const copiedFile = path.join(outputPath, 'extension.png')
      const exists = await fs.promises
        .access(copiedFile)
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(false)
    })
  })
})
