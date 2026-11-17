import {createHash} from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {extensionPreview} from '../command-preview'

const store = vi.hoisted(() => ({fetch: vi.fn()}))

vi.mock('extension-from-store', () => ({fetchExtensionFromStore: store.fetch}))

const created: string[] = []

function tree(layout: Record<string, string>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-preview-state-'))
  )
  created.push(root)

  for (const [rel, content] of Object.entries(layout)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

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

// Where a preview keeps the state of a folder that is not under dist/.
function tempRootOf(build: string) {
  const key = createHash('sha1').update(build).digest('hex').slice(0, 12)
  const tempRoot = path.join(os.tmpdir(), 'extension-js', key)

  created.push(tempRoot)

  return tempRoot
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

describe('previewing a build folder no project owns', () => {
  it('writes nothing inside a build under a project that does not own it', async () => {
    const root = tree({
      'package.json': '{"name":"repo","private":true}',
      'dist/chrome/manifest.json': MANIFEST
    })
    const build = path.join(root, 'dist', 'chrome')

    await preview(build)

    expect(everyFileUnder(build)).toEqual(['manifest.json'])

    const ready = readJson(
      path.join(root, 'dist', 'extension-js', 'chrome', 'ready.json')
    )

    expect(ready.status).toBe('ready')
    expect(ready.command).toBe('preview')
    expect(ready.distPath).toBe(build)
  })

  it('keeps the session in a temp root keyed by a folder outside dist', async () => {
    const root = tree({'unpacked/manifest.json': MANIFEST})
    const build = path.join(root, 'unpacked')

    await preview(build)

    // Nothing appears in a folder the user did not make for builds.
    expect(fs.readdirSync(root)).toEqual(['unpacked'])
    expect(everyFileUnder(build)).toEqual(['manifest.json'])

    const ready = readJson(path.join(tempRootOf(build), 'chrome', 'ready.json'))
    const readme = fs.readFileSync(
      path.join(tempRootOf(build), 'README.md'),
      'utf-8'
    )

    expect(ready.status).toBe('ready')
    expect(ready.distPath).toBe(build)
    expect(readme).toContain('a folder\nthat no project owns')
    expect(readme).not.toContain('dist/')
    expect(readme).not.toContain('sibling')
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'uses the temp root when dist takes no write',
    async () => {
      const root = tree({'dist/chrome/manifest.json': MANIFEST})
      const dist = path.join(root, 'dist')
      const build = path.join(dist, 'chrome')

      fs.chmodSync(dist, 0o555)

      try {
        await preview(build)
      } finally {
        fs.chmodSync(dist, 0o755)
      }

      expect(fs.readdirSync(dist)).toEqual(['chrome'])
      expect(everyFileUnder(build)).toEqual(['manifest.json'])
      expect(
        readJson(path.join(tempRootOf(build), 'chrome', 'ready.json')).distPath
      ).toBe(build)
    }
  )

  it('lets another process find each of two sibling folders on its own', async () => {
    const root = tree({
      'first/manifest.json': MANIFEST,
      'second/manifest.json': MANIFEST,
      'never/manifest.json': MANIFEST
    })
    const first = path.join(root, 'first')
    const second = path.join(root, 'second')

    await preview(first)
    await preview(second)
    // A process that did not run the previews has only the disk to go by.
    vi.resetModules()

    const paths = await import('../lib/session-paths')
    const {resolveSessionProjectRoot} = await import(
      '../lib/session-project-root'
    )

    for (const build of [first, second]) {
      const sessionRoot = resolveSessionProjectRoot(build)
      const readyPath = paths.readyContractPath(sessionRoot, 'chrome')

      expect(sessionRoot).toBe(build)
      expect(readyPath).toBe(
        path.join(tempRootOf(build), 'chrome', 'ready.json')
      )

      expect(readJson(readyPath).distPath).toBe(build)
      expect(paths.eventsPath(sessionRoot, 'chrome')).toBe(
        path.join(tempRootOf(build), 'chrome', 'events.ndjson')
      )
    }

    expect(tempRootOf(first)).not.toBe(tempRootOf(second))
    // The folder next to them was never previewed, so it keeps its own root.
    expect(paths.readyContractPath(path.join(root, 'never'), 'chrome')).toBe(
      path.join(root, 'never', 'dist', 'extension-js', 'chrome', 'ready.json')
    )
  })

  it('lets another process find a build previewed from under dist', async () => {
    const root = tree({
      'package.json': '{"name":"repo","private":true}',
      'dist/chrome/manifest.json': MANIFEST
    })
    const build = path.join(root, 'dist', 'chrome')

    await preview(build)
    vi.resetModules()

    const paths = await import('../lib/session-paths')

    expect(paths.readyContractPath(build, 'chrome')).toBe(
      path.join(root, 'dist', 'extension-js', 'chrome', 'ready.json')
    )
  })

  it('leaves a folder that a command compiles with its own dist', async () => {
    const root = tree({'plain/manifest.json': MANIFEST})
    const project = path.join(root, 'plain')

    await preview(project)
    vi.resetModules()

    const paths = await import('../lib/session-paths')

    paths.keepSessionArtifactsInProject(project)

    expect(paths.sessionArtifactsRootDir(project)).toBe(
      path.join(project, 'dist', 'extension-js')
    )
  })

  it('reads the newer record when an earlier version left one inside', async () => {
    const root = tree({
      'unpacked/manifest.json': MANIFEST,
      'unpacked/dist/extension-js/chrome/ready.json': '{"status":"ready"}'
    })
    const build = path.join(root, 'unpacked')
    const inside = path.join(build, 'dist', 'extension-js', 'chrome')
    const before = new Date(Date.now() - 60_000)

    fs.utimesSync(path.join(inside, 'ready.json'), before, before)
    await preview(build)
    vi.resetModules()

    const paths = await import('../lib/session-paths')

    expect(paths.readyContractPath(build, 'chrome')).toBe(
      path.join(tempRootOf(build), 'chrome', 'ready.json')
    )
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
    expect(quiet.warnings[0]).toMatch(/^E_COMPANION_EXTENSION_PATH: /)
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

  it('fetches no store companion and refuses no entry', async () => {
    const root = project()
    const {warnings} = await preview(root, {
      extensions: [
        'https://chromewebstore.google.com/detail/some-name/abcdefghijklmnopabcdefghijklmnop',
        'chromewebstore.google.com/detail/some-name/abcdefghijklmnopabcdefghijklmnop',
        'https://example.com/not-a-store',
        'abcdefghijklmnopabcdefghijklmnop',
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

  it('warns about a folder that is there and holds no manifest, though its name reads as a host', async () => {
    const root = project()

    fs.mkdirSync(path.join(root, 'my.ext', 'foo'), {recursive: true})

    const {warnings} = await preview(root, {
      extensions: ['my.ext/foo', 'my.ext/gone']
    })

    // The entry with no folder behind it still reads as a link and is left.
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('ENTRY my.ext/foo')
    expect(warnings[0]).toContain(
      `NOT FOUND ${path.join(root, 'my.ext', 'foo', 'manifest.json')}`
    )

    expect(store.fetch).not.toHaveBeenCalled()
  })

  it('warns once about a declared extensions.dir that is not there, browser or not', async () => {
    const root = project()
    const declared = {extensions: {dir: './extensions/none'}}
    const quiet = await preview(root, declared)

    expect(quiet.warnings).toHaveLength(1)
    expect(quiet.warnings[0]).toMatch(/^E_COMPANION_EXTENSION_PATH: /)
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
