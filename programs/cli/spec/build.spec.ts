//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

import path from 'path'
import fs from 'fs'
import {ALL_TEMPLATES, DEFAULT_TEMPLATE, BROWSERS} from './fixtures/constants'
import {
  extensionProgram,
  distFileExists,
  removeAllTemplateFolders
} from './fixtures/helpers'

describe('extension build', () => {
  beforeEach(async () => {
    await removeAllTemplateFolders()
  })

  describe('running built-in templates', () => {
    it.each(ALL_TEMPLATES)(
      `builds an extension created via "$name" template`,
      async (template) => {
        const extensionPath = path.join(__dirname, 'fixtures', template.name)
        await extensionProgram(`build ${extensionPath}`)

        // Expect manifest file to exist
        expect(
          distFileExists(template.name, BROWSERS[0], 'manifest.json')
        ).toBeTruthy()

        // TODO: cezaraugusto test ui context files output

        if (template.name !== 'init') {
          expect(
            distFileExists(template.name, BROWSERS[0], 'icons/icon_16.png')
          ).toBeTruthy()
          expect(
            distFileExists(template.name, BROWSERS[0], 'icons/icon_48.png')
          ).toBeTruthy()
        }
      },
      80000
    )
  })

  describe('using the --browser flag', () => {
    it.each(ALL_TEMPLATES)(
      `builds the "$name" extension template across all browsers`,
      async (template) => {
        const extensionPath = path.join(__dirname, 'fixtures', template.name)
        // Firefox is skippeed because it can't handle service workers.
        const [chrome, edge /*, firefox */] = BROWSERS

        await extensionProgram(`build ${extensionPath} --browser=chrome,edge`)

        expect(distFileExists(template.name, chrome)).toBeTruthy()
        expect(distFileExists(template.name, edge)).toBeTruthy()
      },
      50000
    )
  })

  describe.skip('using the --polyfill flag', () => {
    it.skip.each(ALL_TEMPLATES)(
      `builds an extension created via "$name" template with the polyfill code`,
      async (template) => {
        const extensionPath = path.join(__dirname, 'fixtures', template.name)

        await extensionProgram(`build ${extensionPath} --polyfill`)

        // TODO cezaraugusto test this
      },
      50000
    )
  })

  describe('using the --zip flag', () => {
    it.each([DEFAULT_TEMPLATE])(
      `builds and zips the distribution files of an extension created via "$name" template`,
      async (template) => {
        const extensionPath = path.join(__dirname, 'fixtures', template.name)

        await extensionProgram(`build ${extensionPath} --zip`)

        expect(distFileExists(template.name, 'chrome')).toBeTruthy()
      },
      50000
    )

    it.each([DEFAULT_TEMPLATE])(
      `builds and zips the source files of an extension created via "$name" template`,
      async (template) => {
        const extensionPath = path.join(__dirname, 'fixtures', template.name)
        const outputPath = path.join(
          __dirname,
          'fixtures',
          template.name,
          'dist'
        )

        await extensionProgram(`build ${extensionPath} --zip-source`)

        expect(
          fs.existsSync(
            path.join(outputPath, `${template.name}-1.0-source.zip`)
          )
        ).toBeTruthy()
      },
      50000
    )

    it.each([DEFAULT_TEMPLATE])(
      `builds and zips the distribution files of an extension created via "$name" template with a custom output name using the --zip-filename flag`,
      async (template) => {
        const extensionPath = path.join(__dirname, 'fixtures', template.name)

        await extensionProgram(
          `build ${extensionPath} --zip --zip-filename ${template.name}-nice`
        )

        expect(
          distFileExists(
            template.name,
            BROWSERS[0],
            `${template.name}-nice.zip`
          )
        ).toBeTruthy()
      },
      50000
    )
  })
})
