import * as fs from 'fs'
import * as path from 'path'
import {describe, expect, it, beforeAll, afterAll, vi} from 'vitest'
import {extensionBuild} from '../../../../../../programs/develop/dist/module.js'

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    existsSync: actual.existsSync
      ? vi.fn(actual.existsSync)
      : vi.fn(() => false),
    rmSync: actual.rmSync ? vi.fn(actual.rmSync) : vi.fn(),
    promises: {
      ...actual.promises,
      access: actual.promises?.access ? vi.fn(actual.promises.access) : vi.fn()
    }
  }
})

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

describe('SpecialFoldersPlugin', () => {
  describe('pages folder', () => {
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

    it('copies HTML pages from pages folder to output', async () => {
      const pagePath = path.join(outputPath, 'pages', 'main.html')
      await assertFileIsEmitted(pagePath)
    })

    it('copies static files from public folder to output', async () => {
      const publicFile = path.join(outputPath, 'logo.svg')
      await assertFileIsEmitted(publicFile)
    })
  })

  describe('scripts folder', () => {
    const fixturesPath = getFixturesPath('special-folders-scripts')
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

    it('copies script files from scripts folder to output', async () => {
      const scriptPath = path.join(outputPath, 'scripts', 'content-script.js')
      await assertFileIsEmitted(scriptPath)
    })

    it('copies user scripts to output', async () => {
      const userScript = path.join(outputPath, 'user_scripts', 'api_script.js')
      await assertFileIsEmitted(userScript)
    })

    it('copies static files from public folder to output', async () => {
      const publicFile = path.join(outputPath, 'logo.svg')
      await assertFileIsEmitted(publicFile)
    })
  })
})
