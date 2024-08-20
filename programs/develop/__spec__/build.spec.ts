import path from 'path'
import fs from 'fs'
import {
  ALL_TEMPLATES,
  DEFAULT_TEMPLATE,
  SUPPORTED_BROWSERS
} from '../../../examples/data'
import {removeAllTemplateDistFolders} from './helpers'
import {extensionBuild} from '../dist/module'

function distFileExists(
  templateName: string,
  browser: string,
  filePath?: string,
  ext?: string
): boolean {
  const templatePath = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'examples',
    templateName,
    'dist',
    browser
  )

  if (filePath) {
    return fs.existsSync(path.join(templatePath, filePath))
  } else {
    // Check if any HTML file exists in the directory
    const files = fs.readdirSync(templatePath)
    return files.some((file) => file.endsWith(ext || '.html'))
  }
}

describe('extension build', () => {
  beforeAll(() => {
    // Run yarn in all top-level folders of the examples directory
    // runYarnInTopLevelFolders(path.join(__dirname, '..', '..', '..', 'examples'))
  })

  beforeEach(async () => {
    await removeAllTemplateDistFolders()
  }, 30000)

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

        await extensionBuild(templatePath, {
          browser: SUPPORTED_BROWSERS[0] as 'chrome'
        })

        expect.assertions(1)

        expect(
          path.join(templatePath, SUPPORTED_BROWSERS[0], 'manifest.json')
        ).toBeTruthy()
      },
      80000
    )
  })

  describe('using the --browser flag', () => {
    it.each(ALL_TEMPLATES)(
      `builds the "$name" extension template across all supported browsers`,
      async (template) => {
        const templatePath = path.resolve(
          __dirname,
          '..',
          '..',
          '..',
          'examples',
          template.name
        )

        // Running browsers in parallel by invoking them sequentially
        await Promise.all(
          SUPPORTED_BROWSERS.filter(browser => browser !== 'chrome').map(async (browser) => {
            await extensionBuild(templatePath, {browser: browser as any})
            expect(
              path.join(templatePath, SUPPORTED_BROWSERS[0], 'manifest.json')
            ).toBeTruthy()
          })
        )
      },
      80000
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

        await extensionBuild(templatePath, {
          browser: SUPPORTED_BROWSERS[0] as 'chrome',
          polyfill: true
        })

        expect(
          path.join(templatePath, SUPPORTED_BROWSERS[0], 'manifest.json')
        ).toBeTruthy()
      },
      80000
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

        await extensionBuild(templatePath, {
          browser: SUPPORTED_BROWSERS[0] as 'chrome',
          zip: true
        })

        expect(
          fs.existsSync(
            path.join(
              templatePath,
              'dist',
              SUPPORTED_BROWSERS[0],
              `${template.name}-0.0.1.zip`
            )
          )
        ).toBeTruthy()
      },
      80000
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

        await extensionBuild(templatePath, {
          zip: true,
          browser: SUPPORTED_BROWSERS[0] as 'chrome',
          zipSource: true
        })

        expect(
          fs.existsSync(
            path.join(templatePath, 'dist', `${template.name}-0.0.1-source.zip`)
          )
        ).toBeTruthy()
      },
      80000
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
          browser: SUPPORTED_BROWSERS[0] as 'chrome',
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
      80000
    )
  })
})
