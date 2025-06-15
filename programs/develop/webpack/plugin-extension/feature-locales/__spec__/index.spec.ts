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

const assertFileIsNotEmitted = async (filePath: string) => {
  await fs.promises.access(filePath, fs.constants.F_OK).catch((err) => {
    expect(err).toBeTruthy()
  })
}

describe('LocalesPlugin', () => {
  describe('default locales', () => {
    const fixturesPath = getFixturesPath('action-locales')
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

    const enMessagesPath = path.join(
      outputPath,
      '_locales',
      'en',
      'messages.json'
    )
    const ptBrMessagesPath = path.join(
      outputPath,
      '_locales',
      'pt_BR',
      'messages.json'
    )

    it('outputs locale files to destination folder', async () => {
      await assertFileIsEmitted(enMessagesPath)
      await assertFileIsEmitted(ptBrMessagesPath)
    })

    it('locale file contains expected content', async () => {
      const enData = await fs.promises.readFile(enMessagesPath, 'utf8')
      const enMessages = JSON.parse(enData)
      expect(enMessages).toHaveProperty('title')
      expect(enMessages.title).toHaveProperty(
        'message',
        'Welcome to your Locale Extension'
      )
      expect(enMessages).toHaveProperty('learnMore')
      expect(enMessages.learnMore).toHaveProperty(
        'message',
        'Learn more about creating cross-browser extensions at '
      )

      const ptBrData = await fs.promises.readFile(ptBrMessagesPath, 'utf8')
      const ptBrMessages = JSON.parse(ptBrData)
      expect(ptBrMessages).toHaveProperty('title')
      expect(ptBrMessages.title).toHaveProperty(
        'message',
        'Bem-vindo à sua extensão de localização'
      )
      expect(ptBrMessages).toHaveProperty('learnMore')
      expect(ptBrMessages.learnMore).toHaveProperty(
        'message',
        'Saiba mais sobre como criar extensões multiplataforma em '
      )
    })
  })

  describe('no locales', () => {
    const fixturesPath = getFixturesPath('action')
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

    it('handles no locales gracefully', async () => {
      const localesDir = path.join(outputPath, '_locales')
      await assertFileIsNotEmitted(localesDir)
    })
  })
})
