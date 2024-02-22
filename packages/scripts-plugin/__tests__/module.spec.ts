import path from 'path'
import {exec} from 'child_process'
import fs from 'fs-extra'

const getFixturesPath = (demoDir: string) =>
  path.join(__dirname, 'fixtures', demoDir)

const assertFileIsEmitted = async (filePath: string) => {
  await fs.access(filePath, fs.constants.F_OK);
}

const assertFileIsNotEmitted = async (filePath: string) => {
  await fs.access(filePath, fs.constants.F_OK).catch((err) => {
    expect(err).toBeTruthy()
  });
}

describe('ScriptsPlugin (default behavior)', () => {
  const fixturesPath = getFixturesPath('scripting')
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

  describe('js', () => {
    const includeJs = path.join(outputPath, 'scripts', 'content-script.js')
    const excludedJs = path.join(outputPath, 'public', 'js', 'file.js')

    it('should output JS files for HTML paths defined in INCLUDE option', async () => {
      await assertFileIsEmitted(includeJs)
    })

    it('should not output JS files if JS file is in EXCLUDE list', async () => {
      await assertFileIsNotEmitted(excludedJs)
    })
  })
})

describe('ScriptsPlugin (edge cases)', () => {
  const fixturesPath = getFixturesPath('scripting-nojs')
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

  it('during DEVELOPMENT, output a default JS file for CSS-only content.scripts', async () => {
    const defaultJs = path.join(outputPath, 'content_scripts', 'content-0.js')
    await assertFileIsEmitted(defaultJs)
  })
})
