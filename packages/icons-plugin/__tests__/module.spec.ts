import fs from 'fs-extra'
import path from 'path'
import {exec} from 'child_process'
import {
  getFixturesPath,
  assertFileIsEmitted,
  assertFileIsNotEmitted
} from './__utils__'

describe('IconsPlugin', () => {
  describe.each([
    ['action'],
    ['browser_action'],
    ['browser_action.theme-icons'],
    ['icons'],
    ['page_action'],
    ['sidebar_action']
  ])('dealing with %s', (directory) => {
    const fixturesPath = getFixturesPath(directory)
    const webpackConfigPath = path.join(fixturesPath, 'webpack.config.js')
    const outputPath = path.resolve(fixturesPath, 'dist')

    beforeAll((done) => {
      exec(
        `npx webpack --config ${webpackConfigPath}`,
        {cwd: fixturesPath},
        (error, stdout, stderr) => {
          if (error) {
            console.error(`exec error: ${error.message}`)
            return done(error)
          }
          done()
        }
      )
    }, 40000)

    afterAll(() => {
      if (fs.existsSync(outputPath)) {
        fs.removeSync(outputPath)
      }
    })

    const dir =
      directory === 'browser_action.theme-icons' ? 'browser_action' : directory
    const assetsPng = path.join(outputPath, dir, 'test_16.png')
    const excludedPng = path.join(outputPath, 'public', 'icon.png')

    it('outputs icon file to destination folder', async () => {
      await assertFileIsEmitted(assetsPng)
    })

    it('should not output file if file is in EXCLUDE list', async () => {
      await assertFileIsNotEmitted(excludedPng)
    })
  })
})
