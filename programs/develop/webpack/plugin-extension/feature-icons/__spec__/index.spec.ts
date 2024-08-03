import fs from 'fs'
import path from 'path'
import {exec} from 'child_process'

const getFixturesPath = (demoDir: string) =>
  path.join(__dirname, 'fixtures', demoDir)

const assertFileIsEmitted = async (filePath: string) => {
  await fs.promises.access(filePath, fs.constants.F_OK)
}

const assertFileIsNotEmitted = async (filePath: string) => {
  await fs.promises.access(filePath, fs.constants.F_OK).catch((err) => {
    expect(err).toBeTruthy()
  })
}

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
        (error, _stdout, _stderr) => {
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
        fs.rmSync(outputPath, {recursive: true, force: true})
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
