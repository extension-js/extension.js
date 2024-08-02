import fs from 'fs-extra'
import path from 'path'
import {exec} from 'child_process'

export const getFixturesPath = (demoDir: string) =>
  path.join(__dirname, 'fixtures', demoDir)

export const assertFileIsEmitted = async (filePath: string) => {
  await fs.access(filePath, fs.constants.F_OK)
}

export const assertFileIsNotEmitted = async (filePath: string) => {
  await fs.access(filePath, fs.constants.F_OK).catch((err) => {
    expect(err).toBeTruthy()
  })
}

export const findStringInFile = async (filePath: string, string: string) => {
  await fs.readFile(filePath, 'utf8').then((data) => {
    expect(data).toContain(string)
  })
}

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
