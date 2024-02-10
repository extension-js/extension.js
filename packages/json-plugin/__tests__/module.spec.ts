import fs from 'fs-extra'
import path from 'path'
import {exec} from 'child_process'
import {
  getFixturesPath,
  assertFileIsEmitted,
  assertFileIsNotEmitted
} from './__utils__'

describe('JsonPlugin', () => {
  describe('dealing with declarative_net_request', () => {
    const fixturesPath = getFixturesPath('declarative_net_request')
    const webpackConfigPath = path.join(fixturesPath, 'webpack.config.js')
    const outputPath = path.resolve(fixturesPath, 'dist')

    beforeAll((done) => {
      exec(
        `npx webpack --config ${webpackConfigPath}`,
        {cwd: fixturesPath},
        (error, stdout, stderr) => {
          if (error) {
            console.error(`exec error: ${error}`)
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

    const rulesetJson = path.join(
      outputPath,
      'declarative_net_request',
      'ruleset_1.json'
    )
    const publicRulesetJson = path.join(
      outputPath,
      'public',
      'public_ruleset.json'
    )

    it('outputs json file to destination folder', async () => {
      await assertFileIsEmitted(rulesetJson)
    })

    it('should not output file if file is in EXCLUDE list', async () => {
      await assertFileIsNotEmitted(publicRulesetJson)
    })
  })

  describe('dealing with storage', () => {
    const fixturesPath = getFixturesPath('storage')
    const webpackConfigPath = path.join(fixturesPath, 'webpack.config.js')
    const outputPath = path.resolve(fixturesPath, 'dist')

    beforeAll((done) => {
      exec(
        `npx webpack --config ${webpackConfigPath}`,
        {cwd: fixturesPath},
        (error, stdout, stderr) => {
          if (error) {
            console.error(`exec error: ${error}`)
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

    const rulesetJson = path.join(outputPath, 'storage', 'managed_schema.json')
    const publicRulesetJson = path.join(
      outputPath,
      'public',
      'public_storage.json'
    )

    it('outputs json file to destination folder', async () => {
      await assertFileIsEmitted(rulesetJson)
    })

    it('should not output file if file is in EXCLUDE list', async () => {
      await assertFileIsNotEmitted(publicRulesetJson)
    })
  })
})
