import path from 'path'
import fs from 'fs'
import {vi, describe, it, expect, afterAll, beforeEach, afterEach} from 'vitest'
import {extensionBuild, Manifest} from 'extension-develop'
import {
  ALL_TEMPLATES,
  DEFAULT_TEMPLATE,
  SUPPORTED_BROWSERS
} from '../../examples/data'
import {getDirname} from './dirname'

const __dirname = getDirname(import.meta.url)

async function removeDir(dirPath: string) {
  if (fs.existsSync(dirPath)) {
    await fs.promises.rm(dirPath, {recursive: true})
  }
}

async function removeAllTemplateDistFolders() {
  await Promise.all(
    ALL_TEMPLATES.map(async (template) => {
      const templatePath = path.join(
        __dirname,
        '..',
        '..',
        'examples',
        template.name,
        'dist'
      )

      await removeDir(templatePath)
      return true
    })
  )
}

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
  afterAll(async () => {
    // Clean up any remaining test artifacts
    await removeAllTemplateDistFolders()
    // Clear all timers
    vi.clearAllTimers()
  })

  beforeEach(async () => {
    // Reset timers before each test
    vi.useRealTimers()
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
          'examples',
          template.name
        )

        await extensionBuild(templatePath, {
          browser: SUPPORTED_BROWSERS[0] as 'chrome'
        })

        expect(
          path.join(
            templatePath,
            'dist',
            SUPPORTED_BROWSERS[0],
            'manifest.json'
          )
        ).toBeTruthy()

        const manifestText = fs.readFileSync(
          path.join(
            templatePath,
            'dist',
            SUPPORTED_BROWSERS[0],
            'manifest.json'
          ),
          'utf-8'
        )

        const manifest: Manifest = JSON.parse(manifestText)
        expect(manifest.name).toBeTruthy()
        expect(manifest.version).toBeTruthy()
        expect(manifest.manifest_version).toBeTruthy()

        if (template.name.includes('content')) {
          expect(manifest.content_scripts![0].js![0]).toEqual(
            'content_scripts/content-0.js'
          )

          expect(
            distFileExists(
              template.name,
              SUPPORTED_BROWSERS[0],
              'content_scripts/content-0.js'
            )
          ).toBeTruthy()
        }
      }
    )
  })

  afterEach(async () => {
    vi.clearAllTimers()
    await new Promise((resolve) => setImmediate(resolve))
  })

  describe('using the --browser flag', () => {
    it.each(ALL_TEMPLATES)(
      `builds the "$name" extension template across all supported browsers`,
      async (template) => {
        const templatePath = path.resolve(
          __dirname,
          '..',
          '..',
          'examples',
          template.name
        )

        // Running browsers in parallel by invoking them sequentially
        try {
          await Promise.all(
            SUPPORTED_BROWSERS.filter((browser) => browser !== 'chrome').map(
              async (browser) => {
                await extensionBuild(templatePath, {browser: browser as any})
                expect(
                  path.join(
                    templatePath,
                    SUPPORTED_BROWSERS[0],
                    'manifest.json'
                  )
                ).toBeTruthy()
              }
            )
          )
        } finally {
          // Ensure promises are settled
          await new Promise((resolve) => setImmediate(resolve))
        }
      }
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
      }
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
      }
    )

    it.each([DEFAULT_TEMPLATE])(
      `builds and zips the source files of an extension created via "$name" template`,
      async (template) => {
        const templatePath = path.resolve(
          __dirname,
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
      }
    )

    it.each([DEFAULT_TEMPLATE])(
      `builds and zips the distribution files of an extension created via "$name" template with a custom output name using the --zip-filename flag`,
      async (template) => {
        const templatePath = path.resolve(
          __dirname,
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
      }
    )
  })
})
