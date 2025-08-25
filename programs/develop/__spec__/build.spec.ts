import * as path from 'path'
import * as fs from 'fs'
import {vi, describe, it, expect, afterAll, beforeEach, afterEach} from 'vitest'
import slugify from 'slugify'
import {execFile} from 'child_process'
import {promisify} from 'util'

const execFileAsync = promisify(execFile)
// Prefer importing source entry to match other e2e specs style
import {extensionBuild, type Manifest} from '../dist/module.js'
import {
  ALL_TEMPLATES,
  DEFAULT_TEMPLATE,
  SUPPORTED_BROWSERS
} from '../../../examples/data'

const repoRoot = path.resolve(__dirname, '..', '..', '..')

async function removeDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) return
  const maxAttempts = 10
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await fs.promises.rm(dirPath, {recursive: true, force: true})
      return
    } catch (err: any) {
      const code = err?.code
      if (
        code === 'ENOTEMPTY' ||
        code === 'EBUSY' ||
        code === 'EPERM' ||
        code === 'EACCES'
      ) {
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1)))
        continue
      }
      throw err
    }
  }
}

async function removeAllTemplateDistFolders() {
  await Promise.all(
    ALL_TEMPLATES.map(async (template) => {
      const templatePath = path.join(
        repoRoot,
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
    repoRoot,
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
    // Extra wait to ensure FS settles before other suites run
    await new Promise((r) => setTimeout(r, 50))
    // Clear all timers
    vi.clearAllTimers()
  })

  beforeEach(async () => {
    // Reset timers before each test
    vi.useRealTimers()
  })

  describe('running built-in templates', () => {
    it.each([
      ...ALL_TEMPLATES.filter(
        (t) => !t.name.includes('tailwind') && !t.name.includes('custom-font')
      )
    ])(
      `builds an extension created via "$name" template`,
      async (template) => {
        const templatePath = path.resolve(repoRoot, 'examples', template.name)

        // Ensure a clean dist before building this template in case of prior runs
        await removeDir(path.join(templatePath, 'dist'))
        await extensionBuild(templatePath, {
          browser: SUPPORTED_BROWSERS[0] as 'chrome'
        })

        {
          const manifestPath = path.join(
            templatePath,
            'dist',
            SUPPORTED_BROWSERS[0],
            'manifest.json'
          )
          // Retry for up to ~10s in case of slow FS writes
          let exists = fs.existsSync(manifestPath)
          if (!exists) {
            const start = Date.now()
            while (!exists && Date.now() - start < 10000) {
              await new Promise((r) => setTimeout(r, 50))
              exists = fs.existsSync(manifestPath)
            }
          }
          expect(exists).toBeTruthy()
        }

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

        // Validate expected HTML entry points when declared in manifest
        const distDir = path.join(templatePath, 'dist', SUPPORTED_BROWSERS[0])
        const ensureFile = (relPath: string | undefined) => {
          if (!relPath) return
          const absPath = path.join(distDir, relPath)
          expect(fs.existsSync(absPath)).toBeTruthy()
        }
        // action popup
        ensureFile((manifest as any).action?.default_popup)
        // options ui (v3) / options page (v2)
        ensureFile((manifest as any).options_ui?.page)
        ensureFile((manifest as any).options_page)
        // devtools
        ensureFile((manifest as any).devtools_page)
        // chrome_url_overrides
        const overrides = (manifest as any).chrome_url_overrides
        if (overrides) {
          ensureFile(overrides.newtab)
          ensureFile(overrides.history)
          ensureFile(overrides.bookmarks)
        }
        // sandbox pages
        const sandboxPages: string[] | undefined = (manifest as any).sandbox
          ?.pages
        if (Array.isArray(sandboxPages) && sandboxPages.length > 0) {
          ensureFile(sandboxPages[0])
        }

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

        // Basic asset sanity: icons and optional assets folder when present
        expect(fs.existsSync(path.join(distDir, 'icons'))).toBeTruthy()
        // When assets exist, ensure at least one file is emitted
        const assetsDir = path.join(distDir, 'assets')
        if (fs.existsSync(assetsDir)) {
          const assets = fs.readdirSync(assetsDir)
          expect(Array.isArray(assets)).toBe(true)
          expect(assets.length).toBeGreaterThan(0)
        }
      },
      30000
    )
  })

  afterEach(async () => {
    vi.clearAllTimers()
    await new Promise((resolve) => setImmediate(resolve))
  })

  describe('using the --browser flag', () => {
    it.each([
      ...ALL_TEMPLATES.filter(
        (t) => !t.name.includes('tailwind') && !t.name.includes('custom-font')
      )
    ])(
      `builds the "$name" extension template across all supported browsers`,
      async (template) => {
        const templatePath = path.resolve(repoRoot, 'examples', template.name)

        // Running browsers in parallel by invoking them sequentially
        try {
          await Promise.all(
            SUPPORTED_BROWSERS.filter((browser) => browser !== 'chrome').map(
              async (browser) => {
                await extensionBuild(templatePath, {browser: browser as any})
                expect(
                  fs.existsSync(
                    path.join(templatePath, 'dist', browser, 'manifest.json')
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
    it.each([...(ALL_TEMPLATES as any[])])(
      `builds an extension created via "$name" template with the polyfill code`,
      async (template) => {
        const templatePath = path.resolve(repoRoot, 'examples', template.name)

        await extensionBuild(templatePath, {
          browser: SUPPORTED_BROWSERS[0] as 'chrome',
          polyfill: true
        })

        expect(
          fs.existsSync(
            path.join(
              templatePath,
              'dist',
              SUPPORTED_BROWSERS[0],
              'manifest.json'
            )
          )
        ).toBeTruthy()
      }
    )
  })

  describe('using the --zip flag', () => {
    it.each([DEFAULT_TEMPLATE])(
      `builds and zips the distribution files of an extension created via "$name" template`,
      async (template) => {
        const templatePath = path.resolve(repoRoot, 'examples', template.name)

        await extensionBuild(templatePath, {
          browser: SUPPORTED_BROWSERS[0] as 'chrome',
          zip: true,
          // ensure deterministic name even if manifest.name varies
          zipFilename: template.name
        })

        const distManifestPath = path.join(
          templatePath,
          'dist',
          SUPPORTED_BROWSERS[0],
          'manifest.json'
        )
        const {version} = JSON.parse(
          fs.readFileSync(distManifestPath, 'utf-8')
        ) as {name: string; version: string}
        const zipBase = `${slugify(template.name, {
          replacement: '-',
          remove: /[^a-zA-Z0-9 ]/g,
          lower: true
        })}-${version}`

        expect(
          fs.existsSync(
            path.join(
              templatePath,
              'dist',
              SUPPORTED_BROWSERS[0],
              `${template.name}.zip`
            )
          )
        ).toBeTruthy()
      }
    )

    it.each([DEFAULT_TEMPLATE])(
      `builds and zips the source files of an extension created via "$name" template`,
      async (template) => {
        const templatePath = path.resolve(repoRoot, 'examples', template.name)

        await extensionBuild(templatePath, {
          zip: true,
          browser: SUPPORTED_BROWSERS[0] as 'chrome',
          zipSource: true,
          zipFilename: template.name
        })

        const rootManifestPath = path.join(templatePath, 'manifest.json')
        const {version} = JSON.parse(
          fs.readFileSync(rootManifestPath, 'utf-8')
        ) as {name: string; version: string}
        const zipBase = `${slugify(template.name, {
          replacement: '-',
          remove: /[^a-zA-Z0-9 ]/g,
          lower: true
        })}-${version}`

        expect(
          fs.existsSync(
            path.join(templatePath, 'dist', `${template.name}-source.zip`)
          )
        ).toBeTruthy()
      }
    )

    it.each([DEFAULT_TEMPLATE])(
      `builds and zips the distribution files of an extension created via "$name" template with a custom output name using the --zip-filename flag`,
      async (template) => {
        const templatePath = path.resolve(repoRoot, 'examples', template.name)

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

    it.each([DEFAULT_TEMPLATE])(
      `produces .xpi for firefox and .zip for chrome`,
      async (template) => {
        const templatePath = path.resolve(repoRoot, 'examples', template.name)

        // chrome
        await extensionBuild(templatePath, {
          browser: 'chrome',
          zip: true,
          zipFilename: template.name
        })
        const distManifestChrome = path.join(
          templatePath,
          'dist',
          'chrome',
          'manifest.json'
        )
        const {version} = JSON.parse(
          fs.readFileSync(distManifestChrome, 'utf-8')
        ) as {name: string; version: string}
        const zipChrome = `${template.name}.zip`
        expect(
          fs.existsSync(path.join(templatePath, 'dist', 'chrome', zipChrome))
        ).toBeTruthy()

        // firefox
        await extensionBuild(templatePath, {
          browser: 'firefox',
          zip: true,
          zipFilename: template.name
        })
        const distManifestFirefox = path.join(
          templatePath,
          'dist',
          'firefox',
          'manifest.json'
        )
        const {version: ffVersion} = JSON.parse(
          fs.readFileSync(distManifestFirefox, 'utf-8')
        ) as {name: string; version: string}
        const zipFirefox = `${template.name}.xpi`
        expect(
          fs.existsSync(path.join(templatePath, 'dist', 'firefox', zipFirefox))
        ).toBeTruthy()
      }
    )
  })

  describe('user flow via pnpm extension build', () => {
    it.each([DEFAULT_TEMPLATE])(
      `builds the "$name" template via CLI (pnpm extension)`,
      async (template) => {
        const templatePath = path.resolve(repoRoot, 'examples', template.name)
        const env = {
          ...process.env,
          EXTENSION_ENV: 'development'
        } as unknown as NodeJS.ProcessEnv
        const {stdout} = await execFileAsync(
          'pnpm',
          [
            'extension',
            'build',
            templatePath,
            '--browser',
            SUPPORTED_BROWSERS[0],
            '--silent',
            'true'
          ],
          {cwd: repoRoot, env}
        )
        expect(typeof stdout).toBe('string')
        expect(
          fs.existsSync(
            path.join(
              templatePath,
              'dist',
              SUPPORTED_BROWSERS[0],
              'manifest.json'
            )
          )
        ).toBeTruthy()
      },
      90000
    )
  })

  describe('negative cases and error messages', () => {
    it('handles unsupported browser flag without throwing', async () => {
      const templatePath = path.resolve(
        repoRoot,
        'examples',
        DEFAULT_TEMPLATE.name
      )
      let err: any
      try {
        const cli = path.join(repoRoot, 'programs', 'cli', 'dist', 'cli.js')
        await execFileAsync(
          process.execPath,
          [
            cli,
            'build',
            templatePath,
            '--browser',
            'unknown',
            '--silent',
            'true'
          ],
          {cwd: repoRoot}
        )
      } catch (e: any) {
        err = e
      }
      // Assert non-zero failure or a message
      expect(err).toBeTruthy()
      // Ensure no dist output was created under unknown
      expect(
        fs.existsSync(path.join(templatePath, 'dist', 'unknown'))
      ).toBeFalsy()
    })
  })
})
