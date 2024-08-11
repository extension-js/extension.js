import path from 'path'
import fs from 'fs'
import {
  ALL_TEMPLATES,
  DEFAULT_TEMPLATE,
  SUPPORTED_BROWSERS
} from '../../../examples/data'
import {distFileExists, removeAllTemplateDistFolders} from './helpers'
import {extensionBuild} from '../dist/module'

describe('extension build', () => {
  beforeEach(async () => {
    await removeAllTemplateDistFolders()
  })

  describe('running built-in templates', () => {
    it.each(ALL_TEMPLATES)(
      `builds an extension created via "$name" template`,
      async (template) => {
        const templatePath = path.resolve(
          __dirname,
          '..',
          '..',
          '..',
          'examples',
          template.name
        )

        await extensionBuild(templatePath)

        expect(
          distFileExists(template.name, SUPPORTED_BROWSERS[0], 'manifest.json')
        ).toBeTruthy()

        // TODO: cezaraugusto test ui context files output
        // if (template.name !== 'init') {
        //   expect(
        //     distFileExists(
        //       template.name,
        //       SUPPORTED_BROWSERS[0],
        //       `icons/icon_16.png`
        //     )
        //   ).toBeTruthy()
        //   expect(
        //     distFileExists(
        //       template.name,
        //       SUPPORTED_BROWSERS[0],
        //       `icons/icon_48.png`
        //     )
        //   ).toBeTruthy()
        // }
      },
      80000 * ALL_TEMPLATES.length
    )
  })

  describe('using the --browser flag', () => {
    it.each(ALL_TEMPLATES)(
      `builds the "$name" extension template across all SUPPORTED_browsers`,
      async (template) => {
        const templatePath = path.resolve(
          __dirname,
          '..',
          '..',
          '..',
          'examples',
          template.name
        )

        // Firefox is skippeed because it can't handle service workers.
        const [chrome, edge, firefox] = SUPPORTED_BROWSERS

        await extensionBuild(templatePath, {browser: 'chrome'})
        expect(distFileExists(template.name, chrome)).toBeTruthy()
        await extensionBuild(templatePath, {browser: 'edge'})
        expect(distFileExists(template.name, edge)).toBeTruthy()
        await extensionBuild(templatePath, {browser: 'firefox'})
        expect(distFileExists(template.name, firefox)).toBeTruthy()
      },
      50000
    )
  })

  describe('using the --polyfill flag', () => {
    it.each(ALL_TEMPLATES)(
      `builds an extension created via "$name" template with the polyfill code`,
      async (template) => {
        const templatePath = path.resolve(
          __dirname,
          '..',
          '..',
          '..',
          'examples',
          template.name
        )

        await extensionBuild(templatePath, {polyfill: true})
      },
      50000
    )
  })

  describe('using the --zip flag', () => {
    it.each([DEFAULT_TEMPLATE])(
      `builds and zips the distribution files of an extension created via "$name" template`,
      async (template) => {
        const templatePath = path.resolve(
          __dirname,
          '..',
          '..',
          '..',
          'examples',
          template.name
        )

        await extensionBuild(templatePath, {zip: true})

        expect(distFileExists(template.name, 'chrome')).toBeTruthy()
      },
      50000
    )

    it.each([DEFAULT_TEMPLATE])(
      `builds and zips the source files of an extension created via "$name" template`,
      async (template) => {
        const templatePath = path.resolve(
          __dirname,
          '..',
          '..',
          '..',
          'examples',
          template.name
        )
        const outputPath = path.join(
          __dirname,
          '..',
          '..',
          '..',
          'examples',
          template.name,
          'dist'
        )

        await extensionBuild(templatePath, {zip: true, zipSource: true})

        expect(
          fs.existsSync(
            path.join(outputPath, `${template.name}-0.0.1-source.zip`)
          )
        ).toBeTruthy()
      },
      50000
    )

    it.each([DEFAULT_TEMPLATE])(
      `builds and zips the distribution files of an extension created via "$name" template with a custom output name using the --zip-filename flag`,
      async (template) => {
        const templatePath = path.resolve(
          __dirname,
          '..',
          '..',
          '..',
          'examples',
          template.name
        )

        await extensionBuild(templatePath, {
          zip: true,
          zipFilename: `${template.name}-nice`
        })

        expect(
          distFileExists(
            template.name,
            SUPPORTED_BROWSERS[0],
            `${template.name}-nice.zip`
          )
        ).toBeTruthy()
      },
      50000
    )
  })
})
