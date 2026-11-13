import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// Firefox names no extension file on a MAIN world stack, so a file the
// background registers there needs the bridge a declared group ships with.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(world: 'MAIN' | 'ISOLATED', readsBase = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-rt-main-pair-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'rt-main-pair', version: '0.0.0'})
  )

  fs.mkdirSync(path.join(root, 'scripts'))
  fs.mkdirSync(path.join(root, 'media'))
  fs.writeFileSync(path.join(root, 'media', 'blob.bin'), Buffer.alloc(40_000))
  fs.writeFileSync(
    path.join(root, 'scripts', 'hook.js'),
    readsBase
      ? 'import blobUrl from "../media/blob.bin?url"\n' +
          'window.__PAGE_HOOK__ = String(blobUrl)\n'
      : 'window.__PAGE_HOOK__ = "RT_MAIN_PAIR_VALUE"\n'
  )

  fs.writeFileSync(
    path.join(root, 'background.js'),
    [
      'const api = globalThis.browser || globalThis.chrome',
      'api.scripting.registerContentScripts([',
      '  {',
      '    id: "page-hook",',
      '    js: ["scripts/hook.js"],',
      `    world: "${world}",`,
      '    matches: ["<all_urls>"],',
      '    runAt: "document_start"',
      '  }',
      '])',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'rt-main-pair',
      version: '1.0.0',
      permissions: ['scripting'],
      host_permissions: ['<all_urls>'],
      background: {scripts: ['background.js']},
      browser_specific_settings: {gecko: {id: 'rt-main-pair@example.com'}}
    })
  )

  return root
}

async function build(root: string, browser: 'chrome' | 'firefox') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    const summary = await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const distDir = path.join(root, 'dist', browser)
  const backgroundDir = path.join(distDir, 'background')
  const background = fs
    .readdirSync(backgroundDir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(path.join(backgroundDir, file), 'utf8'))
    .join('\n')

  return {
    background,
    manifest: JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    ),
    hasBridge: fs.existsSync(
      path.join(distDir, 'scripts', 'extjs-main-world-bridge.js')
    )
  }
}

const PAIRING_MARK = '__extjsMainWorldBridgePaired'

describe('a runtime-registered MAIN world script and its bridge', () => {
  it('firefox: the background pairs the registration with an emitted bridge', async () => {
    const built = await build(project('MAIN'), 'firefox')

    expect(built.background).toContain(PAIRING_MARK)
    expect(built.background).toContain('scripts/extjs-main-world-bridge.js')
    expect(built.hasBridge).toBe(true)
    // The pair is a runtime registration, so the manifest stays as written.
    expect(built.manifest.content_scripts).toBeUndefined()
  }, 180_000)

  it('firefox: the wrapper names the files that read the base', async () => {
    const built = await build(project('MAIN'), 'firefox')

    expect(built.background).toContain(
      'var READERS = ["scripts/hook.js","scripts/hook.extjs-main-world.js"];'
    )
  }, 180_000)

  it('firefox: a MAIN world file that never reads the base goes unpaired', async () => {
    const built = await build(project('MAIN', false), 'firefox')

    expect(built.background).not.toContain(PAIRING_MARK)
    expect(built.hasBridge).toBe(false)
  }, 180_000)

  it('firefox: a project with no MAIN world registration gets no wrapper', async () => {
    const built = await build(project('ISOLATED'), 'firefox')

    expect(built.background).not.toContain(PAIRING_MARK)
    expect(built.hasBridge).toBe(false)
  }, 180_000)

  it('chrome: the bundle reads the base off its stack and is left alone', async () => {
    const built = await build(project('MAIN'), 'chrome')

    expect(built.background).not.toContain(PAIRING_MARK)
    expect(built.hasBridge).toBe(false)
  }, 180_000)
})

// A declared content script is a second bridge user of the same extension.
function withDeclared(root: string, world?: 'MAIN') {
  const manifestPath = path.join(root, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  fs.writeFileSync(
    path.join(root, 'content.js'),
    'import blobUrl from "./media/blob.bin?url"\n' +
      'document.documentElement.dataset.declared = String(blobUrl)\n'
  )

  manifest.content_scripts = [
    {matches: ['<all_urls>'], js: ['content.js'], ...(world ? {world} : {})}
  ]

  fs.writeFileSync(manifestPath, JSON.stringify(manifest))

  return root
}

describe('a runtime-registered MAIN world script next to a declared one', () => {
  it('firefox: the registered file, its bridge and its pairing are the same with or without one', async () => {
    const read = (root: string, file: string) =>
      fs.readFileSync(path.join(root, 'dist', 'firefox', file), 'utf8')
    const alone = project('MAIN')
    const isolated = withDeclared(project('MAIN'))
    const main = withDeclared(project('MAIN'), 'MAIN')
    const built = {
      alone: await build(alone, 'firefox'),
      isolated: await build(isolated, 'firefox'),
      main: await build(main, 'firefox')
    }

    for (const [name, root] of [
      ['isolated', isolated],
      ['main', main]
    ] as const) {
      expect(built[name].hasBridge, name).toBe(true)
      expect(built[name].background, name).toContain(
        'var READERS = ["scripts/hook.js","scripts/hook.extjs-main-world.js"];'
      )

      for (const file of [
        path.join('scripts', 'hook.js'),
        path.join('scripts', 'extjs-main-world-bridge.js')
      ]) {
        expect(read(root, file), `${name} ${file}`).toBe(read(alone, file))
      }
    }

    // The declared MAIN world group keeps a bridge of its own in the manifest.
    expect(built.main.manifest.content_scripts).toHaveLength(2)
    expect(built.isolated.manifest.content_scripts).toHaveLength(1)
  }, 240_000)
})
