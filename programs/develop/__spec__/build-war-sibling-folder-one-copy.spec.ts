import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const SUITE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-war-sibling-folder-')
)

const MATCHES = 'https://sibling-folder.example/*'
const IMAGE_BYTES = Buffer.concat([
  Buffer.from('sibling-folder-png-'),
  Buffer.alloc(48 * 1024, 9)
])

function write(root: string, relPath: string, contents: string | Buffer) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function writeFixture(
  name: string,
  options: {resource: string; background?: string}
): string {
  const root = path.join(SUITE_ROOT, name)
  fs.mkdirSync(root, {recursive: true})

  write(root, 'shared/sibling-picture.png', IMAGE_BYTES)

  write(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      name: `extjs-build-war-sibling-folder-${name}`,
      version: '0.0.0'
    })
  )

  write(
    root,
    'src/manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: `Build Spec, WAR sibling folder ${name}`,
      version: '1.0.0',
      ...(options.background
        ? {background: {service_worker: 'background.js'}}
        : {}),
      content_scripts: [
        {matches: [MATCHES], js: ['content.js'], css: ['style.css']}
      ],
      web_accessible_resources: [
        {resources: [options.resource], matches: [MATCHES]}
      ]
    })
  )

  write(root, 'src/content.js', "console.log('sibling folder')\n")
  write(
    root,
    'src/style.css',
    ".shared{background:url('../shared/sibling-picture.png')}\n"
  )

  if (options.background) write(root, 'src/background.js', options.background)

  return root
}

async function buildFixture(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function distPngs(distDir: string) {
  return (fs.readdirSync(distDir, {recursive: true}) as string[])
    .map((entry) => String(entry).split(path.sep).join('/'))
    .filter((entry) => entry.endsWith('.png'))
    .sort()
}

function declaredPngs(distDir: string) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  ) as {
    web_accessible_resources?: Array<{resources: string[]}>
  }

  return (manifest.web_accessible_resources || [])
    .flatMap((group) => group.resources)
    .filter((resource) => resource.endsWith('.png'))
    .sort()
}

afterAll(() => {
  fs.rmSync(SUITE_ROOT, {recursive: true, force: true})
})

describe('build: a web_accessible_resources file in a folder beside a src manifest', () => {
  it('ships one bundler-named copy when the entry points at the file and a sheet uses it', async () => {
    const root = writeFixture('one-copy', {
      resource: '../shared/sibling-picture.png'
    })
    const summary = await buildFixture(root)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'chrome')
    const images = distPngs(distDir)

    expect(images).toHaveLength(1)
    expect(images[0]).toMatch(/^assets\/sibling-picture\.[0-9a-f]{8}\.png$/)
    expect(
      fs.existsSync(path.join(distDir, 'shared/sibling-picture.png'))
    ).toBe(false)

    expect(fs.readFileSync(path.join(distDir, images[0]))).toEqual(IMAGE_BYTES)

    const sheet = fs
      .readFileSync(path.join(distDir, 'content_scripts/content-0.css'), 'utf8')
      .replace(/"/g, '')
    expect(sheet).toContain(`url(/${images[0]})`)

    expect(declaredPngs(distDir)).toEqual([images[0]])
  }, 120_000)

  it('serves the same bytes at the literal path when a runtime.getURL literal names it', async () => {
    const root = writeFixture('geturl', {
      resource: '../shared/sibling-picture.png',
      background:
        "console.log(chrome.runtime.getURL('shared/sibling-picture.png'))\n"
    })
    const summary = await buildFixture(root)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'chrome')
    const literal = path.join(distDir, 'shared/sibling-picture.png')

    expect(fs.existsSync(literal)).toBe(true)
    expect(fs.readFileSync(literal)).toEqual(IMAGE_BYTES)
    expect(declaredPngs(distDir)).toContain('shared/sibling-picture.png')
  }, 120_000)

  it('keeps the literal path when the manifest entry spells the root path', async () => {
    const root = writeFixture('root-spelling', {
      resource: 'shared/sibling-picture.png'
    })
    const summary = await buildFixture(root)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'chrome')
    const literal = path.join(distDir, 'shared/sibling-picture.png')

    expect(fs.existsSync(literal)).toBe(true)
    expect(fs.readFileSync(literal)).toEqual(IMAGE_BYTES)
    expect(declaredPngs(distDir)).toContain('shared/sibling-picture.png')
  }, 120_000)
})
