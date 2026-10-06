import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const SUITE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-one-copy-per-asset-')
)

const MATCHES = 'https://one-copy.example/*'
const IMAGE_BYTES = Buffer.concat([
  Buffer.from('one-copy-png-'),
  Buffer.alloc(60 * 1024, 7)
])

function write(root: string, relPath: string, contents: string | Buffer) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function writeFixture(name: string): string {
  const root = path.join(SUITE_ROOT, name)
  fs.mkdirSync(root, {recursive: true})

  write(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      name: `extjs-build-one-copy-${name}`,
      version: '0.0.0',
      type: 'module'
    })
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: `Build Spec, one copy per asset ${name}`,
      version: '1.0.0',
      action: {default_popup: 'popup/index.html'},
      content_scripts: [
        {
          matches: [MATCHES],
          js: ['content/index.js'],
          css: ['content/declared.css']
        }
      ]
    })
  )

  write(root, 'local/other.png', IMAGE_BYTES)
  write(
    root,
    'popup/index.html',
    [
      '<!doctype html><html><head>',
      '<link rel="stylesheet" href="./popup.css">',
      '</head><body><img src="../local/other.png"></body></html>',
      ''
    ].join('\n')
  )

  write(
    root,
    'popup/popup.css',
    ".page{background:url('../local/other.png')}\n"
  )

  write(
    root,
    'content/declared.css',
    ".declared{background:url('../local/other.png')}\n"
  )

  write(
    root,
    'content/imported.css',
    ".imported{background:url('../local/other.png')}\n"
  )

  write(
    root,
    'content/index.js',
    [
      "import './imported.css'",
      "import other from '../local/other.png'",
      "console.log('other', other)",
      ''
    ].join('\n')
  )

  return root
}

async function buildFixture(root: string, mode: 'production' | 'development') {
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
      mode,
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

function distFiles(distDir: string): string[] {
  const hits: string[] = []

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else hits.push(path.relative(distDir, abs).split(path.sep).join('/'))
    }
  }

  walk(distDir)

  return hits.sort()
}

afterAll(() => {
  fs.rmSync(SUITE_ROOT, {recursive: true, force: true})
})

describe('one image a page, a page sheet, a content sheet and an import all name', () => {
  for (const mode of ['production', 'development'] as const) {
    it(`ships once in ${mode}, and every reference and the content script's WAR group point at that copy`, async () => {
      const root = writeFixture(mode)
      await buildFixture(root, mode)

      const distDir = path.join(root, 'dist', 'chrome')
      const files = distFiles(distDir)
      const images = files.filter((file) => file.endsWith('.png'))

      expect(images).toHaveLength(1)
      expect(images[0]).toMatch(/^assets\/other\.[0-9a-f]{8}\.png$/)
      expect(files).not.toContain('local/other.png')
      expect(files).not.toContain('assets/local/other.png')
      expect(fs.readFileSync(path.join(distDir, images[0]))).toEqual(
        IMAGE_BYTES
      )

      const read = (file: string) =>
        fs.readFileSync(path.join(distDir, file), 'utf8').replace(/"/g, '')

      expect(read('action/index.html')).toContain(`<img src=/${images[0]}>`)
      expect(read('action/index.css')).toContain(`url(/${images[0]})`)
      expect(read('content_scripts/content-0.css')).toContain(
        `url(/${images[0]})`
      )

      const bundle = files
        .filter((file) => /^content_scripts\/content-0.*\.js$/.test(file))
        .map((file) => read(file))
        .join('\n')

      expect(bundle).toContain(images[0])
      expect(bundle).not.toContain('local/other.png')

      const manifest = JSON.parse(
        fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
      ) as {
        web_accessible_resources?: Array<{
          resources: string[]
          matches: string[]
        }>
      }
      const groups = (manifest.web_accessible_resources || []).filter((group) =>
        group.resources.includes(images[0])
      )

      expect(groups.map((group) => group.matches)).toEqual([[MATCHES]])
    }, 180_000)
  }
})
