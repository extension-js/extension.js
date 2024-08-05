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

const assertFileIsEmitted = async (filePath: string) => {
  const fileIsEmitted = await fs.promises.access(filePath, fs.constants.F_OK)
  return expect(fileIsEmitted).toBeUndefined()
}

const assertFileIsNotEmitted = async (filePath: string) => {
  await fs.promises.access(filePath, fs.constants.F_OK).catch((err) => {
    expect(err).toBeTruthy()
  })
}

describe('IconsPlugin', () => {
  describe.each([['action'], ['icons']])('dealing with %s', (directory) => {
    const fixturesPath = getFixturesPath(directory)
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
    }, 40000)

    // afterAll(() => {
    //   if (fs.existsSync(outputPath)) {
    //     fs.rmSync(outputPath, {recursive: true, force: true})
    //   }
    // })

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
