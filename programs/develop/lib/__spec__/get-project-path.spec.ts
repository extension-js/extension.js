import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  getProjectPath,
  getProjectStructure,
  resolveProjectStructureSync
} from '../project'

const created: string[] = []

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)

  return dir
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  for (const d of created) {
    try {
      fs.rmSync(d, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  }

  created.length = 0
})

describe('get-project-path', () => {
  it('resolves relative path to absolute path', async () => {
    const tmp = makeTempDir('extjs-gpp-')
    const rel = 'some/sub/dir'
    const cwd = process.cwd()
    const abs = path.resolve(cwd, rel)
    expect(await getProjectPath(rel)).toBe(abs)
  })

  it('treats GitHub .zip URLs as direct archives', async () => {
    const root = makeTempDir('extjs-github-zip-')
    const extracted = path.join(root, 'content-react.chrome')
    const url =
      'https://github.com/extension-js/examples/releases/download/nightly/content-react.chrome.zip'
    const cwd = process.cwd()
    const downloadAndExtractZip = vi.fn(async () => {
      fs.mkdirSync(extracted, {recursive: true})

      return extracted
    })

    try {
      process.chdir(root)
      vi.doMock('../zip', () => ({downloadAndExtractZip}))
      const {getProjectPath: freshGetProjectPath} = await import('../project')
      const result = await freshGetProjectPath(url)
      expect(result).toBe(extracted)
      expect(downloadAndExtractZip).toHaveBeenCalledTimes(1)
      const [, targetPath] = downloadAndExtractZip.mock.calls[0]
      expect(fs.realpathSync(targetPath)).toBe(fs.realpathSync(root))
    } finally {
      process.chdir(cwd)
      vi.doUnmock('../zip')
    }
  })

  it('auto-extracts a local .zip and resolves its manifest', async () => {
    const root = makeTempDir('extjs-local-zip-')
    const {strToU8, zipSync} = await import('fflate')
    const zipPath = path.join(root, 'packed-extension.zip')
    fs.writeFileSync(
      zipPath,
      Buffer.from(zipSync({'manifest.json': strToU8('{"name":"local-zip"}')}))
    )

    const cwd = process.cwd()

    try {
      process.chdir(root)
      const extracted = await getProjectPath(zipPath)
      expect(fs.realpathSync(extracted)).toBe(
        fs.realpathSync(path.join(root, 'packed-extension'))
      )

      const structure = await getProjectStructure(zipPath)
      expect(path.basename(structure.manifestPath)).toBe('manifest.json')
    } finally {
      process.chdir(cwd)
    }
  })

  it('leaves a local folder path untouched (no .zip handling)', async () => {
    const tmp = makeTempDir('extjs-folder-passthrough-')
    expect(await getProjectPath(tmp)).toBe(path.resolve(tmp))
  })

  it('getProjectStructure finds manifest recursively and optional package.json', async () => {
    const root = makeTempDir('extjs-gps-')
    const nested = path.join(root, 'nested', 'deeper')
    fs.mkdirSync(nested, {recursive: true})
    const manifestDir = path.join(nested, 'ext')
    fs.mkdirSync(manifestDir, {recursive: true})
    fs.writeFileSync(path.join(manifestDir, 'manifest.json'), '{}')
    fs.writeFileSync(
      path.join(nested, 'package.json'),
      JSON.stringify({name: 'pkg'})
    )

    const s = await getProjectStructure(root)
    expect(path.basename(s.manifestPath)).toBe('manifest.json')
    expect(s.packageJsonPath && path.basename(s.packageJsonPath)).toBe(
      'package.json'
    )
  })

  // Pointed straight at a manifest folder inside someone else's project, the
  // package.json above it is a stranger's and the manifest folder is the project.
  it('getProjectStructure declines a package.json above the folder it was pointed at', async () => {
    const root = makeTempDir('extjs-gps-stranger-')
    const manifestDir = path.join(root, 'nested', 'deeper', 'ext')
    fs.mkdirSync(manifestDir, {recursive: true})
    fs.writeFileSync(path.join(manifestDir, 'manifest.json'), '{}')
    fs.writeFileSync(
      path.join(root, 'nested', 'package.json'),
      JSON.stringify({name: 'pkg'})
    )

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      // The quiet resolutions a command runs first must not use up the line.
      resolveProjectStructureSync(manifestDir, {quiet: true})
      expect(log).not.toHaveBeenCalled()

      const s = await getProjectStructure(manifestDir)
      expect(s.packageJsonPath).toBeUndefined()

      await getProjectStructure(manifestDir)

      const printed = log.mock.calls.map((call) => String(call[0]))
      expect(printed.filter((line) => /IGNORED/.test(line))).toHaveLength(1)
      expect(printed.join('\n')).toContain('Using ext/ as the project root.')
    } finally {
      log.mockRestore()
    }
  })

  // The layouts that resolved a root before: the package.json sits at or
  // below the folder the command ran in, whatever it depends on.
  it.each([
    ['a manifest in app/', 'package.json', 'app/manifest.json'],
    ['a manifest in src/app/', 'package.json', 'src/app/manifest.json'],
    [
      'a workspace package',
      'packages/ext/package.json',
      'packages/ext/extension/manifest.json'
    ]
  ])('getProjectStructure keeps the package root for %s', async (...layout) => {
    const [, pkg, manifest] = layout
    const root = makeTempDir('extjs-gps-owned-')

    const write = (rel: string, body: string) => {
      const abs = path.join(root, ...rel.split('/'))
      fs.mkdirSync(path.dirname(abs), {recursive: true})
      fs.writeFileSync(abs, body)
    }

    write(pkg, JSON.stringify({name: 'my-existing-app'}))
    write(manifest, '{}')

    const pointedAt = path.join(root, ...pkg.split('/').slice(0, -1))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const s = await getProjectStructure(pointedAt)

      expect(s.packageJsonPath && fs.realpathSync(s.packageJsonPath)).toBe(
        fs.realpathSync(path.join(root, ...pkg.split('/')))
      )
    } finally {
      log.mockRestore()
    }
  })

  it('getProjectStructure allows web-only (no package.json)', async () => {
    const root = makeTempDir('extjs-webonly-')
    fs.mkdirSync(root, {recursive: true})
    fs.writeFileSync(path.join(root, 'manifest.json'), '{}')
    const s = await getProjectStructure(root)
    expect(s.manifestPath.endsWith('manifest.json')).toBe(true)
    expect(s.packageJsonPath).toBeUndefined()
  })

  it('getProjectStructure ignores manifest.json under public/', async () => {
    const root = makeTempDir('extjs-public-skip-')
    const publicDir = path.join(root, 'public', 'sample')
    const srcDir = path.join(root, 'src')
    fs.mkdirSync(publicDir, {recursive: true})
    fs.mkdirSync(srcDir, {recursive: true})
    fs.writeFileSync(path.join(publicDir, 'manifest.json'), '{}')
    fs.writeFileSync(path.join(srcDir, 'manifest.json'), '{}')
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'pkg'})
    )

    const s = await getProjectStructure(root)
    expect(path.dirname(s.manifestPath)).toBe(srcDir)
  })

  it('prefers src/manifest.json over root manifest.json', async () => {
    const root = makeTempDir('extjs-manifest-prefer-src-')
    const srcDir = path.join(root, 'src')
    fs.mkdirSync(srcDir, {recursive: true})
    fs.writeFileSync(path.join(root, 'manifest.json'), '{"name":"root"}')
    fs.writeFileSync(path.join(srcDir, 'manifest.json'), '{"name":"src"}')
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'pkg'})
    )

    const s = await getProjectStructure(root)
    expect(path.dirname(s.manifestPath)).toBe(srcDir)
  })

  it('rejects manifest.json resolved under <packageRoot>/public', async () => {
    const root = makeTempDir('extjs-manifest-public-guard-')
    const publicDir = path.join(root, 'public', 'sample')
    fs.mkdirSync(publicDir, {recursive: true})
    fs.writeFileSync(path.join(publicDir, 'manifest.json'), '{}')
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'pkg'})
    )

    await expect(getProjectStructure(root)).rejects.toThrow(/manifest\.json/i)
  })

  it('auto-resolves a single nested manifest when package.json exists (workspace root)', async () => {
    const root = makeTempDir('extjs-manifest-single-candidate-')
    const nested = path.join(root, 'packages', 'ext')
    fs.mkdirSync(nested, {recursive: true})
    fs.writeFileSync(path.join(nested, 'manifest.json'), '{}')
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'workspace-root', workspaces: ['packages/*']})
    )

    fs.writeFileSync(
      path.join(nested, 'package.json'),
      JSON.stringify({name: 'ext'})
    )

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const s = await getProjectStructure(root)
    expect(path.dirname(s.manifestPath)).toBe(nested)
    const printed = logSpy.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(printed).toMatch(/Workspace root detected/i)
    logSpy.mockRestore()
  })

  it('rejects when multiple nested manifests exist (ambiguous workspace)', async () => {
    const root = makeTempDir('extjs-manifest-multi-candidate-')
    const first = path.join(root, 'packages', 'ext-a')
    const second = path.join(root, 'packages', 'ext-b')
    fs.mkdirSync(first, {recursive: true})
    fs.mkdirSync(second, {recursive: true})
    fs.writeFileSync(path.join(first, 'manifest.json'), '{}')
    fs.writeFileSync(path.join(second, 'manifest.json'), '{}')
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'workspace-root', workspaces: ['packages/*']})
    )

    await expect(getProjectStructure(root)).rejects.toThrow(/manifest\.json/i)
  })

  const PWA_MANIFEST = JSON.stringify({
    name: 'My PWA',
    start_url: '/',
    display: 'standalone',
    icons: [{src: '/icon-192.png', sizes: '192x192', type: 'image/png'}]
  })

  it('skips a root PWA web-app manifest and resolves a nested extension manifest', async () => {
    const root = makeTempDir('extjs-pwa-nested-ext-')
    const extDir = path.join(root, 'extension')
    fs.mkdirSync(extDir, {recursive: true})
    fs.writeFileSync(path.join(root, 'manifest.json'), PWA_MANIFEST)
    fs.writeFileSync(
      path.join(extDir, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'ext', version: '1.0.0'})
    )

    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'pkg'})
    )

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const s = await getProjectStructure(root)
    expect(path.dirname(s.manifestPath)).toBe(extDir)
    logSpy.mockRestore()
  })

  it('rejects a lone PWA web-app manifest with a clear message', async () => {
    const root = makeTempDir('extjs-pwa-only-')
    fs.writeFileSync(path.join(root, 'manifest.json'), PWA_MANIFEST)
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'pkg'})
    )

    await expect(getProjectStructure(root)).rejects.toThrow(
      /isn't a browser extension manifest/i
    )
  })

  it('keeps accepting minimal manifests without PWA fields', async () => {
    const root = makeTempDir('extjs-minimal-manifest-')
    fs.writeFileSync(path.join(root, 'manifest.json'), '{"name":"minimal"}')

    const s = await getProjectStructure(root)
    expect(s.manifestPath.endsWith('manifest.json')).toBe(true)
  })
})

describe('manifest scan with no project manifest', () => {
  const extensionManifest = (name: string) =>
    JSON.stringify({manifest_version: 3, name, version: '1.0.0'})

  function layout(files: Record<string, string>) {
    const root = fs.realpathSync(makeTempDir('extjs-manifest-scan-'))

    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(root, ...rel.split('/'))
      fs.mkdirSync(path.dirname(abs), {recursive: true})
      fs.writeFileSync(abs, content)
    }

    return root
  }

  const companionOnly = {
    'extensions/helper/manifest.json': extensionManifest('COMPANION HELPER')
  }
  const publicOnly = {
    'public/sample/manifest.json': extensionManifest('PUBLIC SAMPLE')
  }
  const withPackageJson = {'package.json': JSON.stringify({name: 'pkg'})}

  const builtInCompanionOnly = {
    'extensions/extension-js-devtools/manifest.json':
      extensionManifest('BUILT-IN COMPANION')
  }

  const resolvedManifest = async (root: string) => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const s = await getProjectStructure(root)

      return path.relative(root, s.manifestPath).split(path.sep).join('/')
    } finally {
      logSpy.mockRestore()
    }
  }

  it('adopts the only extension of a project under extensions/ when package.json exists', async () => {
    const root = layout({...withPackageJson, ...companionOnly})

    expect(await resolvedManifest(root)).toBe('extensions/helper/manifest.json')
  })

  it('adopts the only extension of a project under extensions/ without package.json', async () => {
    const root = layout(companionOnly)

    expect(await resolvedManifest(root)).toBe('extensions/helper/manifest.json')
  })

  it('refuses a built-in companion manifest when package.json exists', async () => {
    const root = layout({...withPackageJson, ...builtInCompanionOnly})

    await expect(getProjectStructure(root)).rejects.toThrow(
      /Manifest file not found[\s\S]*COMPANION[\s\S]*extensions[\\/]extension-js-devtools/
    )
  })

  it('refuses a built-in companion manifest without package.json', async () => {
    const root = layout(builtInCompanionOnly)

    await expect(getProjectStructure(root)).rejects.toThrow(
      /Manifest file not found[\s\S]*COMPANION[\s\S]*extensions[\\/]extension-js-devtools/
    )
  })

  it('refuses to pick one of several manifests under extensions/', async () => {
    const several = {
      ...companionOnly,
      'extensions/other/manifest.json': extensionManifest('COMPANION OTHER')
    }

    await expect(
      getProjectStructure(layout({...withPackageJson, ...several}))
    ).rejects.toThrow(/Manifest file not found[\s\S]*COMPANION/)

    await expect(getProjectStructure(layout(several))).rejects.toThrow(
      /Manifest file not found[\s\S]*COMPANION/
    )
  })

  it('never adopts a manifest under public/ when package.json exists', async () => {
    const root = layout({...withPackageJson, ...publicOnly})

    await expect(getProjectStructure(root)).rejects.toThrow(
      /Manifest file not found/
    )
  })

  it('never adopts a manifest under public/ without package.json', async () => {
    const root = layout(publicOnly)

    await expect(getProjectStructure(root)).rejects.toThrow(
      /Manifest file not found/
    )
  })

  it('reads a folder named like build output when it holds the only manifest', async () => {
    const root = layout({'out/manifest.json': extensionManifest('ONLY ONE')})

    expect(await resolvedManifest(root)).toBe('out/manifest.json')
  })

  it('prefers a source folder over build output and extensions/ without package.json', async () => {
    const root = layout({
      'build/manifest.json': extensionManifest('BUILT'),
      ...companionOnly,
      'web/manifest.json': extensionManifest('THE REAL PROJECT')
    })

    expect(await resolvedManifest(root)).toBe('web/manifest.json')
  })

  it('still resolves a lone workspace package beside a companion', async () => {
    const root = layout({
      ...withPackageJson,
      ...companionOnly,
      'packages/ext/manifest.json': extensionManifest('THE REAL PROJECT')
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const s = await getProjectStructure(root)
      expect(s.manifestPath.split(path.sep).join('/')).toBe(
        `${root.split(path.sep).join('/')}/packages/ext/manifest.json`
      )

      const printed = logSpy.mock.calls
        .map((call) => String(call[0]))
        .join('\n')
      expect(printed).toMatch(/Workspace root detected/)
    } finally {
      logSpy.mockRestore()
    }
  })
})

// A GitHub tree URL goes through go-git-it, which prints a git version line
// and an unauthenticated rate-limit warning on its own. Those must not reach
// the user unless they asked for --debug.
describe('get-project-path (GitHub source)', () => {
  const url =
    'https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder'
  const gitVersionLine = 'Using git version 9.9.9 (test)'
  const rateLimitLine =
    'GitHub API rate limit reached, continuing without connectivity check...'

  let stdoutSpy: ReturnType<typeof vi.spyOn>
  let stderrSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>
  let prevDebug: string | undefined
  let prevAuthor: string | undefined

  beforeEach(() => {
    prevDebug = process.env.EXTENSION_DEBUG
    prevAuthor = process.env.EXTENSION_AUTHOR_MODE
    delete process.env.EXTENSION_DEBUG
    delete process.env.EXTENSION_AUTHOR_MODE
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((() => true) as never)

    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((() => true) as never)

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
    logSpy.mockRestore()
    if (prevDebug === undefined) delete process.env.EXTENSION_DEBUG
    else process.env.EXTENSION_DEBUG = prevDebug
    if (prevAuthor === undefined) delete process.env.EXTENSION_AUTHOR_MODE
    else process.env.EXTENSION_AUTHOR_MODE = prevAuthor

    vi.doUnmock('go-git-it')
    vi.doUnmock('../zip')
  })

  const writtenTo = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.map((call) => String(call[0])).join('')

  // Stands in for go-git-it: writes what the real tool writes, then lands
  // the sample where the real clone would.
  function mockNoisyClone() {
    const goGitIt = vi.fn(async (_url: string, cwd: string, text: string) => {
      process.stdout.write(`${text}\n`)
      process.stdout.write(`${gitVersionLine}\n`)
      process.stderr.write(`${rateLimitLine}\n`)
      const dest = path.join(cwd, 'sample.page-redder')
      fs.mkdirSync(dest, {recursive: true})
      fs.writeFileSync(path.join(dest, 'manifest.json'), '{"name":"redder"}')
    })
    vi.doMock('go-git-it', () => ({default: goGitIt}))

    return goGitIt
  }

  it('silences go-git-it noise by default and prints no PATH row', async () => {
    const root = makeTempDir('extjs-github-tree-')
    const cwd = process.cwd()
    const goGitIt = mockNoisyClone()

    try {
      process.chdir(root)
      const {getProjectPath: fresh} = await import('../project')
      const result = await fresh(url)

      expect(goGitIt).toHaveBeenCalledTimes(1)
      expect(fs.realpathSync(result)).toBe(
        fs.realpathSync(path.join(root, 'sample.page-redder'))
      )

      expect(writtenTo(stdoutSpy)).not.toContain(gitVersionLine)
      expect(writtenTo(stderrSpy)).not.toContain(rateLimitLine)

      const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(logged).toContain('Downloading')
      expect(logged).toContain('Creating a new browser extension')
      expect(logged).not.toContain('PATH')
      expect(logged).not.toContain(
        '/GoogleChrome/chrome-extensions-samples/tree'
      )
    } finally {
      process.chdir(cwd)
    }
  })

  it('lets go-git-it noise through under EXTENSION_DEBUG=1', async () => {
    const root = makeTempDir('extjs-github-tree-debug-')
    const cwd = process.cwd()
    mockNoisyClone()
    process.env.EXTENSION_DEBUG = '1'

    try {
      process.chdir(root)
      const {getProjectPath: fresh} = await import('../project')
      await fresh(url)
      expect(writtenTo(stdoutSpy)).toContain(gitVersionLine)
      expect(writtenTo(stderrSpy)).toContain(rateLimitLine)
    } finally {
      process.chdir(cwd)
    }
  })

  it('restores stdout and falls back to the codeload zip when the clone rejects', async () => {
    const root = makeTempDir('extjs-github-tree-fallback-')
    const cwd = process.cwd()
    const goGitIt = vi.fn(async () => {
      throw new Error('Failed to connect to GitHub: offline')
    })
    vi.doMock('go-git-it', () => ({default: goGitIt}))
    const downloadAndExtractZip = vi.fn(async (zipUrl: string) => {
      expect(zipUrl).toBe(
        'https://codeload.github.com/GoogleChrome/chrome-extensions-samples/zip/refs/heads/main'
      )

      const sample = path.join(
        root,
        'chrome-extensions-samples-main',
        'functional-samples',
        'sample.page-redder'
      )
      fs.mkdirSync(sample, {recursive: true})
      fs.writeFileSync(path.join(sample, 'manifest.json'), '{"name":"redder"}')

      return root
    })
    vi.doMock('../zip', () => ({downloadAndExtractZip}))

    try {
      process.chdir(root)
      const {getProjectPath: fresh} = await import('../project')
      const result = await fresh(url)
      expect(downloadAndExtractZip).toHaveBeenCalledTimes(1)
      expect(fs.realpathSync(result)).toBe(
        fs.realpathSync(
          path.join(
            root,
            'chrome-extensions-samples-main',
            'functional-samples',
            'sample.page-redder'
          )
        )
      )

      // The silencer must hand stdout back even when the clone fails.
      process.stdout.write('after-fallback')
      expect(writtenTo(stdoutSpy)).toContain('after-fallback')
    } finally {
      process.chdir(cwd)
    }
  })
})
