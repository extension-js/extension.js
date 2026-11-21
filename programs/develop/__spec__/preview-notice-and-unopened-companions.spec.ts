import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {extensionPreview} from '../command-preview'
import {writeProjectFiles} from './helpers/extension-project'

const store = vi.hoisted(() => ({fetch: vi.fn()}))

vi.mock('extension-from-store', () => ({fetchExtensionFromStore: store.fetch}))

const created: string[] = []

function tree(layout: Record<string, string>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-preview-state-'))
  )
  created.push(root)

  writeProjectFiles(root, layout)

  return root
}

afterEach(() => {
  store.fetch.mockReset()
  vi.restoreAllMocks()
  vi.resetModules()

  for (const dir of created.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

const MANIFEST = JSON.stringify({
  manifest_version: 3,
  name: 'previewed-build',
  version: '1.0.0'
})

async function preview(
  target: string,
  options: Record<string, unknown> = {},
  run: typeof extensionPreview = extensionPreview
) {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  const result = await run(target, {
    browser: 'chrome',
    noBrowser: true,
    ...options
  } as never)
  const text = (calls: unknown[][]) =>
    calls.map((call) => String(call[0])).join('\n')

  return {
    warnings: result?.warnings ?? [],
    logged: text(log.mock.calls),
    warned: text(warn.mock.calls)
  }
}

function everyFileUnder(dir: string): string[] {
  return fs
    .readdirSync(dir, {recursive: true, withFileTypes: true})
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort()
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

describe('where a preview keeps its session state', () => {
  it('keeps it under dist in a folder no project owns, and nowhere else', async () => {
    const root = tree({'unpacked/manifest.json': MANIFEST})
    const build = path.join(root, 'unpacked')
    const state = path.join('dist', 'extension-js')

    await preview(build)

    expect(fs.readdirSync(root)).toEqual(['unpacked'])
    expect(
      everyFileUnder(build).filter((file) => !file.startsWith(state + path.sep))
    ).toEqual(['manifest.json'])

    const ready = readJson(path.join(build, state, 'chrome', 'ready.json'))

    expect(ready.status).toBe('ready')
    expect(ready.command).toBe('preview')
    expect(ready.distPath).toBe(build)
  })

  it('keeps a project with its own package.json where it was', async () => {
    const root = tree({
      'package.json': '{"name":"app","private":true}',
      'manifest.json': MANIFEST
    })

    await preview(root)

    expect(
      readJson(path.join(root, 'dist', 'extension-js', 'chrome', 'ready.json'))
        .status
    ).toBe('ready')
  })
})

describe('the notice for a project above that is left alone', () => {
  it('speaks of the preview, since a preview builds nothing', async () => {
    const root = tree({
      'package.json': '{"name":"repo","private":true}',
      'dist/chrome/manifest.json': MANIFEST
    })
    const {logged} = await preview(path.join(root, 'dist', 'chrome'))

    expect(logged).toContain('Using chrome/ as the project root.')
    expect(logged).toContain(`IGNORED ${path.join(root, 'package.json')}`)
    expect(logged).toContain('stay out of this preview')
    expect(logged).not.toContain('this build')
    expect(logged).not.toContain('Add a package.json')
  })

  it('keeps the build wording for a command that builds', async () => {
    const {declinedProjectRoot} = await import('../lib/messages')
    const said = declinedProjectRoot(
      '/repo/package.json',
      '/repo/x/manifest.json'
    )

    expect(said).toContain('stay out of this build')
    expect(said).toContain('Add a package.json next to your manifest')
  })
})

describe('a named companion that is not an extension, with no browser', () => {
  const project = () =>
    tree({
      'package.json': '{"name":"app","private":true}',
      'manifest.json': MANIFEST,
      'dist/chrome/manifest.json': MANIFEST,
      'extensions/there/manifest.json': MANIFEST
    })

  it('is warned about the way the browser path warns', async () => {
    const root = project()
    const gone = path.join(root, 'extensions', 'gone')
    const named = ['./extensions/gone', './extensions/there']
    const quiet = await preview(root, {extensions: named})

    expect(quiet.warnings).toHaveLength(1)
    expect(quiet.warnings[0]).toMatch(/^W_COMPANION_EXTENSION_PATH: /)
    expect(quiet.warnings[0]).toContain('ENTRY ./extensions/gone')
    expect(quiet.warnings[0]).toContain('DECLARED IN the --extensions flag')
    expect(quiet.warnings[0]).toContain(
      `NOT FOUND ${path.join(gone, 'manifest.json')}`
    )

    expect(
      quiet.warned.split('\n').filter((line) => line.includes('ENTRY'))
    ).toHaveLength(1)

    vi.restoreAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const withBrowser = await extensionPreview(
      root,
      {browser: 'chrome', extensions: named} as never,
      async () => {}
    )

    expect(withBrowser?.warnings).toEqual(quiet.warnings)
  })

  it('fetches no store companion and leaves a store link alone', async () => {
    const root = project()
    const {warnings} = await preview(root, {
      extensions: [
        'https://chromewebstore.google.com/detail/some-name/abcdefghijklmnopabcdefghijklmnop',
        'chromewebstore.google.com/detail/some-name/abcdefghijklmnopabcdefghijklmnop',
        'extensions/gone'
      ]
    })

    expect(store.fetch).not.toHaveBeenCalled()
    // Only the folder that was named and is not there is spoken of.
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('ENTRY extensions/gone')
    expect(
      readJson(path.join(root, 'dist', 'extension-js', 'chrome', 'ready.json'))
        .status
    ).toBe('ready')
  })

  it('warns about a path whose first part reads as a host, on disk or not', async () => {
    const root = project()

    fs.mkdirSync(path.join(root, 'my.ext', 'foo'), {recursive: true})

    const {warnings} = await preview(root, {
      extensions: ['my.ext/foo', 'my.ext/gone']
    })

    // A path with a slash is a folder path, on disk or not, as with a browser.
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('ENTRY my.ext/foo')
    expect(warnings[0]).toContain(
      `NOT FOUND ${path.join(root, 'my.ext', 'foo', 'manifest.json')}`
    )

    expect(warnings[1]).toContain('ENTRY my.ext/gone')

    expect(store.fetch).not.toHaveBeenCalled()
  })

  it('warns once about a declared extensions.dir that is not there, browser or not', async () => {
    const root = project()
    const declared = {extensions: {dir: './extensions/none'}}
    const quiet = await preview(root, declared)

    expect(quiet.warnings).toHaveLength(1)
    expect(quiet.warnings[0]).toMatch(/^W_COMPANION_EXTENSION_PATH: /)
    expect(quiet.warnings[0]).toContain('DIR ./extensions/none')
    expect(quiet.warnings[0]).toContain('DECLARED IN the --extensions flag')
    expect(quiet.warnings[0]).toContain(
      `NOT FOUND ${path.join(root, 'extensions', 'none')}`
    )

    expect(
      quiet.warned.split('\n').filter((line) => line.includes('NOT FOUND'))
    ).toHaveLength(1)

    vi.restoreAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const withBrowser = await extensionPreview(
      root,
      {browser: 'chrome', ...declared} as never,
      async () => {}
    )

    expect(withBrowser?.warnings).toEqual(quiet.warnings)

    // The folder every project is scanned for is not one the user declared.
    fs.rmSync(path.join(root, 'extensions'), {recursive: true})
    expect((await preview(root)).warnings).toEqual([])
  })

  it('still refuses the same entry when a browser is to open', async () => {
    const root = project()

    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(
      extensionPreview(
        root,
        {
          browser: 'chrome',
          extensions: ['abcdefghijklmnopabcdefghijklmnop']
        } as never,
        async () => {}
      )
    ).rejects.toThrow('looks like a store id')

    expect(store.fetch).not.toHaveBeenCalled()
  })
})
