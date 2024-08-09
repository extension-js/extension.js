import fs from 'fs'
import path from 'path'
import {exec} from 'child_process'

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
  const fixturesPath = getFixturesPath('locales')
  const outputPath = path.resolve(fixturesPath, 'dist', 'chrome')

  beforeAll((done) => {
    exec(
      `npx -y extension@latest build ${fixturesPath}`,
      {cwd: __dirname},
      (error, _stdout, _stderr) => {
        if (error) {
          console.error(`exec error: ${error.message}`)
          return done(error)
        }
        done()
      }
    )
  }, 60000)

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
