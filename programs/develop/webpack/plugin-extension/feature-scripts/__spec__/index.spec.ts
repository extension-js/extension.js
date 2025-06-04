import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {extensionBuild} from '../../../../../../programs/develop/dist/module.js'

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

describe('ScriptsPlugin (default behavior)', () => {
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

  const includeJs = path.join(outputPath, 'scripts', 'content-script.js')

  describe('js', () => {
    it('should output JS files for HTML paths defined in INCLUDE option', async () => {
      await assertFileIsEmitted(includeJs)
    })

    // it('should not output JS files if JS file is in EXCLUDE list', async () => {
    //   await assertFileIsNotEmitted(excludedJs)
    // })
  })
})

// describe('ScriptsPlugin (edge cases)', () => {
//   const fixturesPath = getFixturesPath('scripting-nojs')
//   const webpackConfigPath = path.join(fixturesPath, 'webpack.config.js')
//   const outputPath = path.resolve(fixturesPath, 'dist')

//   beforeAll((done) => {
//     exec(
//       `npx webpack --config ${webpackConfigPath}`,
//       {cwd: fixturesPath},
//       (error, _stdout, _stderr) => {
//         if (error) {
//           console.error(`exec error: ${error.message}`)
//           return done(error)
//         }
//         done()
//       }
//     )
//   })

//   afterAll(() => {
//     if (fs.existsSync(outputPath)) {
//       fs.rmSync(outputPath, {recursive: true, force: true})
//     }
//   })

//   it('during DEVELOPMENT, output a default JS file for CSS-only content.scripts', async () => {
//     const defaultJs = path.join(outputPath, 'content_scripts', 'content-0.js')
//     await assertFileIsEmitted(defaultJs)
//   })
// })
