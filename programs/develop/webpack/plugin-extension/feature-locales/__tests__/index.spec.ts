import fs from 'fs'
import path from 'path'
import {exec} from 'child_process'

export const getFixturesPath = (demoDir: string) =>
  path.join(__dirname, 'fixtures', demoDir)

export const assertFileIsEmitted = async (filePath: string) => {
  await fs.promises.access(filePath, fs.constants.F_OK)
}

export const assertFileIsNotEmitted = async (filePath: string) => {
  await fs.promises.access(filePath, fs.constants.F_OK).catch((err) => {
    expect(err).toBeTruthy()
  })
}

export const findStringInFile = async (
  filePath: string,
  searchString: string
) => {
  const data = await fs.promises.readFile(filePath, 'utf8')
  expect(data).toContain(searchString)
}

describe('LocalesPlugin', () => {
  const fixturesPath = getFixturesPath('locales-default')
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

  const rulesetJson = path.join(outputPath, '_locales', 'en')

  it('outputs locale file to destination folder', async () => {
    await assertFileIsEmitted(rulesetJson)
  })
})
