import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const SUITE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-war-outside-root-')
)

const MATCHES = 'https://outside-root.example/*'
const IMAGE_BYTES = Buffer.concat([
  Buffer.from('outside-root-png-'),
  Buffer.alloc(60 * 1024, 5)
])

function write(root: string, relPath: string, contents: string | Buffer) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function writeFixture(name: string): string {
  const parent = path.join(SUITE_ROOT, name)
  const root = path.join(parent, 'project')
  fs.mkdirSync(root, {recursive: true})

  write(parent, 'shared/outside-picture.png', IMAGE_BYTES)

  write(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      name: `extjs-build-war-outside-root-${name}`,
      version: '0.0.0',
      type: 'module'
    })
  )

  write(
    root,
    'src/manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: `Build Spec, WAR outside root ${name}`,
      version: '1.0.0',
      content_scripts: [
        {
          matches: [MATCHES],
          js: ['content/index.js'],
          css: ['content/style.css']
        }
      ],
      web_accessible_resources: [
        {resources: ['../../shared/outside-picture.png'], matches: [MATCHES]}
      ]
    })
  )

  write(root, 'src/content/index.js', "console.log('outside root')\n")
  write(
    root,
    'src/content/style.css',
    ".shared{background:url('../../../shared/outside-picture.png')}\n"
  )

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
      mode: 'production',
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

describe('build: a web_accessible_resources file outside the project root shares the copy a sheet names', () => {
  it('emits one assets/ copy and the WAR entry and the url() agree on its name', async () => {
    const root = writeFixture('one-copy')
    const summary = await buildFixture(root)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'chrome')
    const images = fs
      .readdirSync(path.join(distDir, 'assets'))
      .filter((name) => name.endsWith('.png'))
      .map((name) => `assets/${name}`)

    expect(images).toHaveLength(1)
    expect(images[0]).toMatch(/^assets\/outside-picture\.[0-9a-f]{8}\.png$/)
    expect(fs.readFileSync(path.join(distDir, images[0]))).toEqual(IMAGE_BYTES)

    const sheet = fs
      .readFileSync(path.join(distDir, 'content_scripts/content-0.css'), 'utf8')
      .replace(/"/g, '')
    expect(sheet).toContain(`url(/${images[0]})`)

    const manifest = JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    ) as {
      web_accessible_resources?: Array<{resources: string[]; matches: string[]}>
    }
    const resources = (manifest.web_accessible_resources || []).flatMap(
      (group) => group.resources
    )

    expect(resources.filter((r) => r.endsWith('.png'))).toEqual([images[0]])
  }, 120_000)
})
