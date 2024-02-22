import fs from 'fs-extra'
import path from 'path'
import {exec} from 'child_process'
import {getFixturesPath, assertFileIsEmitted} from './__utils__'

describe('LocalesPlugin', () => {
  const fixturesPath = getFixturesPath('locales-default')
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

  const rulesetJson = path.join(outputPath, '_locales', 'en')

  it('outputs locale file to destination folder', async () => {
    await assertFileIsEmitted(rulesetJson)
  })
})
