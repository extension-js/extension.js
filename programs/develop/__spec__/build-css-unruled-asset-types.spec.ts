import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const SUITE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-css-unruled-types-')
)

const MATCHES = 'https://unruled.example/*'
const CURSOR_BYTES = Buffer.concat([
  Buffer.from('unruled-cur-'),
  Buffer.alloc(3000, 1)
])
const CLIP_BYTES = Buffer.concat([
  Buffer.from('unruled-mp4-'),
  Buffer.alloc(5000, 2)
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
      name: `extjs-build-css-unruled-${name}`,
      version: '0.0.0',
      type: 'module'
    })
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: `Build Spec, css url() types with no rule ${name}`,
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

  write(root, 'local/pointer.cur', CURSOR_BYTES)
  write(root, 'local/clip.mp4', CLIP_BYTES)
  write(
    root,
    'content/declared.css',
    [
      ".pointer{cursor:url('../local/pointer.cur'), auto}",
      ".clip{background:url('../local/clip.mp4')}",
      ''
    ].join('\n')
  )

  write(root, 'content/index.js', "console.log('unruled')\n")
  write(
    root,
    'popup/index.html',
    '<!doctype html><html><head><link rel="stylesheet" href="./popup.css"></head><body></body></html>\n'
  )

  write(
    root,
    'popup/popup.css',
    ".page{cursor:url('../local/pointer.cur'), auto}\n"
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

describe('a file type with no asset rule that a stylesheet names', () => {
  for (const mode of ['production', 'development'] as const) {
    it(`lands under assets/ with its own name and a hash in ${mode}`, async () => {
      const root = writeFixture(mode)
      await buildFixture(root, mode)

      const distDir = path.join(root, 'dist', 'chrome')
      const files = distFiles(distDir)
      const cursor = files.filter((file) => file.endsWith('.cur'))
      const clip = files.filter((file) => file.endsWith('.mp4'))

      expect(cursor).toEqual([
        expect.stringMatching(/^assets\/pointer\.[0-9a-f]{8}\.cur$/)
      ])

      expect(clip).toEqual([
        expect.stringMatching(/^assets\/clip\.[0-9a-f]{8}\.mp4$/)
      ])

      expect(files.filter((file) => !file.includes('/'))).toEqual([
        'manifest.json'
      ])

      expect(fs.readFileSync(path.join(distDir, cursor[0]))).toEqual(
        CURSOR_BYTES
      )

      const read = (file: string) =>
        fs.readFileSync(path.join(distDir, file), 'utf8').replace(/"/g, '')

      expect(read('content_scripts/content-0.css')).toContain(
        `url(/${cursor[0]})`
      )

      expect(read('content_scripts/content-0.css')).toContain(
        `url(/${clip[0]})`
      )

      expect(read('action/index.css')).toContain(`url(/${cursor[0]})`)

      const manifest = JSON.parse(
        fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
      ) as {
        web_accessible_resources?: Array<{
          resources: string[]
          matches: string[]
        }>
      }
      const exposed = (manifest.web_accessible_resources || []).flatMap(
        (group) => group.resources
      )

      expect(exposed).toEqual(expect.arrayContaining([cursor[0], clip[0]]))
    }, 180_000)
  }
})
