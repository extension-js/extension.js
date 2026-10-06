import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const SUITE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-css-public-ref-map-')
)

const DECLARED_SHEET = [
  '.declared-public-map {',
  "  background: url('/img/bg.png');",
  '  color: red;',
  '}',
  ''
].join('\n')
const PAGE_SHEET = [
  '.page-public-map {',
  "  background: url('/img/bg.png');",
  '}',
  ''
].join('\n')

function write(root: string, relPath: string, contents: string | Buffer) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function writeFixture(): string {
  const root = path.join(SUITE_ROOT, 'development')
  fs.mkdirSync(root, {recursive: true})

  write(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      name: 'extjs-build-css-public-ref-map',
      version: '0.0.0',
      type: 'module'
    })
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Build Spec, source map of a sheet naming a public file',
      version: '1.0.0',
      action: {default_popup: 'popup/index.html'},
      content_scripts: [
        {
          matches: ['https://public-map.example/*'],
          js: ['content/index.js'],
          css: ['content/declared.css']
        }
      ]
    })
  )

  write(root, 'public/img/bg.png', Buffer.alloc(3000, 1))
  write(root, 'content/declared.css', DECLARED_SHEET)
  write(root, 'content/index.js', "console.log('public-map')\n")
  write(
    root,
    'popup/index.html',
    '<!doctype html><html><head><link rel="stylesheet" href="./popup.css"></head><body></body></html>\n'
  )

  write(root, 'popup/popup.css', PAGE_SHEET)

  return root
}

async function buildFixture(root: string) {
  const {extensionBuild} = await import('../command-build')

  const previousAuthorMode = process.env.EXTENSION_AUTHOR_MODE
  const previousVitest = process.env.VITEST
  process.env.VITEST = 'true'
  Reflect.deleteProperty(process.env, 'EXTENSION_AUTHOR_MODE')

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'development',
      exitOnError: false
    } as any)
  } finally {
    if (previousAuthorMode === undefined) {
      Reflect.deleteProperty(process.env, 'EXTENSION_AUTHOR_MODE')
    } else {
      process.env.EXTENSION_AUTHOR_MODE = previousAuthorMode
    }

    if (previousVitest === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = previousVitest
    }
  }
}

afterAll(() => {
  fs.rmSync(SUITE_ROOT, {recursive: true, force: true})
})

describe('the development source map of a sheet that names a public file', () => {
  it('shows the author text, not the placeholder host, for a content sheet and a page sheet', async () => {
    const root = writeFixture()
    await buildFixture(root)

    const distDir = path.join(root, 'dist', 'chrome')
    const maps = {
      'content_scripts/content-0.css.map': DECLARED_SHEET,
      'action/index.css.map': PAGE_SHEET
    }

    for (const [file, authored] of Object.entries(maps)) {
      const mapPath = path.join(distDir, file)
      expect(fs.existsSync(mapPath), file).toBe(true)

      const map = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as {
        sources: string[]
        sourcesContent?: string[]
        mappings: string
      }

      expect(map.sourcesContent, file).toEqual([authored])
      expect(JSON.stringify(map), file).not.toContain(
        'extensionjs-public.invalid'
      )

      expect(map.mappings.split(';').length, file).toBeGreaterThanOrEqual(
        authored.trimEnd().split('\n').length
      )

      const sheet = fs.readFileSync(mapPath.replace(/\.map$/, ''), 'utf8')
      expect(sheet, file).toContain('url("/img/bg.png")')
      expect(sheet, file).not.toContain('extensionjs-public.invalid')
    }
  }, 180_000)
})
