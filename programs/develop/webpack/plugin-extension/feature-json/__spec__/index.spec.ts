import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {extensionBuild} from 'extension-develop'
import {getDirname} from '../../../../dirname'

// @ts-ignore - TypeScript will complain because 
// this file is in the excluded list.
// This file is in the excluded list because we
// need to import data from the examples folder
// which is not included in the baseDir defined
// in the tsconfig.json file.
const __dirname = getDirname(import.meta.url)

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

describe('JsonPlugin', () => {
  describe('dealing with declarative_net_request', () => {
    const fixturesPath = getFixturesPath('declarative_net_request')
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

    const rulesetJson = path.join(outputPath, 'storage', 'managed_schema.json')

    it('outputs json file to destination folder', async () => {
      await assertFileIsEmitted(rulesetJson)
    })
  })
})
