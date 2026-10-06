import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const SUITE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-war-async-chunk-')
)

const MATCHES = 'https://async-scope.example/*'
const IMAGE_BYTES = Buffer.concat([
  Buffer.from('async-scope-png-'),
  Buffer.alloc(60 * 1024, 9)
])

function write(root: string, relPath: string, contents: string | Buffer) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function writeFixture(name: string, manifestVersion: 2 | 3): string {
  const root = path.join(SUITE_ROOT, name)
  fs.mkdirSync(root, {recursive: true})

  write(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      name: `extjs-build-war-async-chunk-${name}`,
      version: '0.0.0',
      type: 'module'
    })
  )

  const popup =
    manifestVersion === 3
      ? {action: {default_popup: 'popup/index.html'}}
      : {browser_action: {default_popup: 'popup/index.html'}}

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: manifestVersion,
      name: `Build Spec, async chunk WAR scope ${name}`,
      version: '1.0.0',
      ...popup,
      content_scripts: [{matches: [MATCHES], js: ['content/index.js']}]
    })
  )

  write(root, 'local/popup-only-picture.png', IMAGE_BYTES)
  write(root, 'local/lazy-only-picture.png', IMAGE_BYTES)
  write(
    root,
    'popup/index.html',
    '<!doctype html><html><body><img src="../local/popup-only-picture.png"></body></html>\n'
  )

  write(root, 'content/index.js', "import('./lazy.js').then((m) => m.show())\n")
  write(
    root,
    'content/lazy.js',
    [
      "import picture from '../local/lazy-only-picture.png'",
      'export function show() {',
      "  const img = document.createElement('img')",
      '  img.src = picture',
      '  document.body.append(img)',
      '}',
      ''
    ].join('\n')
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

type WarGroup = {resources: string[]; matches: string[]}

function readBuiltManifest(root: string) {
  const distDir = path.join(root, 'dist', 'chrome')
  const manifestPath = path.join(distDir, 'manifest.json')
  expect(fs.existsSync(manifestPath), `missing ${manifestPath}`).toBe(true)

  return {
    distDir,
    manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      manifest_version: number
      web_accessible_resources?: string[] | WarGroup[]
    }
  }
}

function emittedAsset(distDir: string, stem: string) {
  const names = fs
    .readdirSync(path.join(distDir, 'assets'))
    .filter((name) => name.startsWith(`${stem}.`) && name.endsWith('.png'))
  expect(names, `one emitted copy of ${stem}`).toHaveLength(1)

  return `assets/${names[0]}`
}

function warResources(manifest: {
  web_accessible_resources?: string[] | WarGroup[]
}): string[] {
  const war: Array<string | WarGroup> = manifest.web_accessible_resources || []

  return war.flatMap((entry) =>
    typeof entry === 'string' ? [entry] : entry.resources || []
  )
}

function warMatchesFor(
  manifest: {web_accessible_resources?: string[] | WarGroup[]},
  resource: string
): string[] {
  const war: Array<string | WarGroup> = manifest.web_accessible_resources || []

  return war
    .filter(
      (group): group is WarGroup =>
        typeof group !== 'string' &&
        Boolean(group.resources?.includes(resource))
    )
    .flatMap((group) => group.matches || [])
}

afterAll(() => {
  fs.rmSync(SUITE_ROOT, {recursive: true, force: true})
})

describe('build: an image reached only through a content script import() is web accessible, a popup-only image is not (real rspack)', () => {
  it('MV3: the lazy image sits under the script matches and the popup image is off the list', async () => {
    const root = writeFixture('mv3', 3)
    const summary = await buildFixture(root)
    expect(summary.errors_count).toBe(0)

    const {distDir, manifest} = readBuiltManifest(root)
    const lazyImage = emittedAsset(distDir, 'lazy-only-picture')
    const popupImage = emittedAsset(distDir, 'popup-only-picture')
    const resources = warResources(manifest)

    expect(resources).toContain(lazyImage)
    expect(warMatchesFor(manifest, lazyImage)).toEqual([MATCHES])
    expect(resources).not.toContain(popupImage)
  }, 120_000)

  it('MV2: the lazy image is in the flat list and the popup image is not', async () => {
    const root = writeFixture('mv2', 2)
    const summary = await buildFixture(root)
    expect(summary.errors_count).toBe(0)

    const {distDir, manifest} = readBuiltManifest(root)
    const lazyImage = emittedAsset(distDir, 'lazy-only-picture')
    const popupImage = emittedAsset(distDir, 'popup-only-picture')
    const resources = warResources(manifest)

    expect(resources).toContain(lazyImage)
    expect(resources).not.toContain(popupImage)
  }, 120_000)
})
