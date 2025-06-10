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

describe.skip('WarnUponFolderChanges', () => {
  describe('pages folder', () => {
    const fixturesPath = getFixturesPath('special-folders-pages')
    const pagesDir = path.join(fixturesPath, 'pages')
    const testFile = path.join(pagesDir, 'test.html')

    beforeAll(async () => {
      // Ensure pages directory exists
      if (!fs.existsSync(pagesDir)) {
        fs.mkdirSync(pagesDir, {recursive: true})
      }

      // Mock console.warn and console.error
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await extensionBuild(fixturesPath, {
        browser: 'chrome'
      })
    })

    afterAll(() => {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile)
      }
      vi.restoreAllMocks()
    })

    it('warns when adding a new HTML file', async () => {
      // Create a new HTML file
      fs.writeFileSync(testFile, '<html><body>Test</body></html>')

      // Wait for watcher to detect the change
      await new Promise((resolve) => setTimeout(resolve, 1000))

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Adding HTML pages')
      )
    })

    it('errors when removing an HTML file', async () => {
      // Delete the HTML file
      fs.unlinkSync(testFile)

      // Wait for watcher to detect the change
      await new Promise((resolve) => setTimeout(resolve, 1000))

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Removing HTML pages')
      )
    })
  })

  describe('scripts folder', () => {
    const fixturesPath = getFixturesPath('special-folders-scripts')
    const scriptsDir = path.join(fixturesPath, 'scripts')
    const testFile = path.join(scriptsDir, 'test.js')

    beforeAll(async () => {
      // Ensure scripts directory exists
      if (!fs.existsSync(scriptsDir)) {
        fs.mkdirSync(scriptsDir, {recursive: true})
      }

      // Mock console.warn and console.error
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await extensionBuild(fixturesPath, {
        browser: 'chrome'
      })
    })

    afterAll(() => {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile)
      }
      vi.restoreAllMocks()
    })

    it('warns when adding a new script file', async () => {
      // Create a new script file
      fs.writeFileSync(testFile, 'console.log("test")')

      // Wait for watcher to detect the change
      await new Promise((resolve) => setTimeout(resolve, 1000))

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Adding script files')
      )
    })

    it('errors when removing a script file', async () => {
      // Delete the script file
      fs.unlinkSync(testFile)

      // Wait for watcher to detect the change
      await new Promise((resolve) => setTimeout(resolve, 1000))

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Removing script files')
      )
    })
  })
})
