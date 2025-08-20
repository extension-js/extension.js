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
  const fixturesPath = getFixturesPath('action-locales')
  const outputPath = path.resolve(fixturesPath, 'dist', 'chrome')
  const tmpTxt = path.join(fixturesPath, '_locales', 'en', 'notes.txt')
  const tmpPng = path.join(fixturesPath, '_locales', 'en', 'logo.png')

  beforeAll(async () => {
    // Create a couple of non-JSON files to ensure they are ignored by the plugin
    await fs.promises.writeFile(tmpTxt, 'temporary note')
    await fs.promises.writeFile(tmpPng, '')
    await extensionBuild(fixturesPath, {
      browser: 'chrome'
    })
  })

  afterAll(() => {
    if (fs.existsSync(outputPath)) {
      fs.rmSync(outputPath, {recursive: true, force: true})
    }
    if (fs.existsSync(tmpTxt)) {
      fs.rmSync(tmpTxt, {force: true})
    }
    if (fs.existsSync(tmpPng)) {
      fs.rmSync(tmpPng, {force: true})
    }
  })

  const enMessages = path.join(outputPath, '_locales', 'en', 'messages.json')
  const ptBRMessages = path.join(
    outputPath,
    '_locales',
    'pt_BR',
    'messages.json'
  )

  it('emits all locale JSON files to the output folder', async () => {
    await assertFileIsEmitted(enMessages)
    await assertFileIsEmitted(ptBRMessages)
  })

  it('skips non-JSON files inside _locales folders', async () => {
    const emittedTxt = path.join(outputPath, '_locales', 'en', 'notes.txt')
    const emittedPng = path.join(outputPath, '_locales', 'en', 'logo.png')
    await assertFileIsNotEmitted(emittedTxt)
    await assertFileIsNotEmitted(emittedPng)
  })
})
