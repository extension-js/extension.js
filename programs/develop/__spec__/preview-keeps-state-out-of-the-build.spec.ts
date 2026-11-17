import {createHash} from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {extensionPreview} from '../command-preview'

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

  it('keeps the session beside a folder that has no project above it', async () => {
    const root = tree({'unpacked/manifest.json': MANIFEST})
    const build = path.join(root, 'unpacked')

    await preview(build)

    expect(everyFileUnder(build)).toEqual(['manifest.json'])
    expect(
      readJson(path.join(root, 'extension-js', 'chrome', 'ready.json')).status
    ).toBe('ready')
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'uses the temp folder when nothing can be written beside the build',
    async () => {
      const root = tree({'locked/unpacked/manifest.json': MANIFEST})
      const parent = path.join(root, 'locked')
      const build = path.join(parent, 'unpacked')
      const key = createHash('sha1').update(build).digest('hex').slice(0, 12)
      const tempRoot = path.join(os.tmpdir(), 'extension-js', key)

      created.push(tempRoot)
      fs.chmodSync(parent, 0o555)

      try {
        await preview(build)
      } finally {
        fs.chmodSync(parent, 0o755)
      }

      expect(fs.readdirSync(parent)).toEqual(['unpacked'])
      expect(everyFileUnder(build)).toEqual(['manifest.json'])
      expect(
        readJson(path.join(tempRoot, 'chrome', 'ready.json')).distPath
      ).toBe(build)
    }
  )

  it('lets another process find the session from the folder alone', async () => {
    const root = tree({
      'unpacked/manifest.json': MANIFEST,
      'other/manifest.json': MANIFEST
    })
    const build = path.join(root, 'unpacked')

    await preview(build)
    // A process that did not run the preview has only the disk to go by.
    vi.resetModules()

    const paths = await import('../lib/session-paths')
    const {resolveSessionProjectRoot} = await import(
      '../lib/session-project-root'
    )
    const sessionRoot = resolveSessionProjectRoot(build)
    const beside = path.join(root, 'extension-js', 'chrome')

    expect(sessionRoot).toBe(build)
    expect(paths.readyContractPath(sessionRoot, 'chrome')).toBe(
      path.join(beside, 'ready.json')
    )

    expect(paths.eventsPath(sessionRoot, 'chrome')).toBe(
      path.join(beside, 'events.ndjson')
    )

    // The folder next to it was never previewed, so it keeps its own root.
    expect(paths.readyContractPath(path.join(root, 'other'), 'chrome')).toBe(
      path.join(root, 'other', 'dist', 'extension-js', 'chrome', 'ready.json')
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
      path.join(root, 'extension-js', 'chrome', 'ready.json')
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
  it('is warned about the way the browser path warns', async () => {
    const root = tree({
      'package.json': '{"name":"app","private":true}',
      'manifest.json': MANIFEST,
      'dist/chrome/manifest.json': MANIFEST
    })
    const gone = path.join(root, 'extensions', 'gone')
    const quiet = await preview(root, {extensions: ['./extensions/gone']})

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
      {browser: 'chrome', extensions: ['./extensions/gone']} as never,
      async () => {}
    )

    expect(withBrowser?.warnings).toEqual(quiet.warnings)
  })
})
