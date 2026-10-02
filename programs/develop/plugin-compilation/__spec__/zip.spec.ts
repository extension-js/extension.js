import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {unzipSync} from 'fflate'
import {afterEach, describe, expect, it} from 'vitest'
import {getFilesToZip, isDeniedFromSourceZip, ZipPlugin} from '../zip'
import {getZipArtifacts, getZipFailures} from '../zip-artifacts'

const toPosix = (value: string) => value.replace(/\\/g, '/')

const created: string[] = []

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)

  return dir
}

afterEach(() => {
  for (const dir of created) {
    try {
      fs.rmSync(dir, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  }

  created.length = 0
})

function write(file: string, contents: string) {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, contents)
}

// A project carrying every secret the source zip must never ship: a full
// .git database, live env files, the dev control token, a managed browser
// profile under dist/extension-js and node_modules.
function scaffoldSecretProject(
  root: string,
  options: {gitignore?: string | null} = {}
) {
  write(
    path.join(root, 'manifest.json'),
    JSON.stringify({name: 'My App', version: '1.2.3', manifest_version: 3})
  )

  write(path.join(root, 'src', 'a.ts'), 'export const a = 1')
  write(path.join(root, 'src', 'b.ts'), 'export const b = 2')
  write(path.join(root, '.env'), 'API_KEY=live-secret')
  write(path.join(root, '.env.development'), 'API_KEY=dev-secret')
  write(path.join(root, '.env.example'), 'API_KEY=')
  write(
    path.join(root, '.git', 'config'),
    '[remote "origin"]\n\turl = https://x-access-token:tok@example.com/r.git'
  )

  write(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main')
  write(
    path.join(root, '.extension-js', 'control-token-chrome'),
    'live-control-token'
  )

  write(path.join(root, 'dist', 'extension-js', '.gitignore'), '*\n')
  write(
    path.join(root, 'dist', 'extension-js', 'profiles', 'chrome', 'Cookies'),
    'cookie-db'
  )

  write(path.join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports=1')

  if (options.gitignore !== null) {
    write(path.join(root, '.gitignore'), options.gitignore ?? 'coverage\n')
  }
}

describe('getFilesToZip', () => {
  it('never lists .git even though no .gitignore mentions it', async () => {
    const root = makeTempDir('zip-spec-')
    scaffoldSecretProject(root)

    const files = (await getFilesToZip(root)).files.map(toPosix)
    expect(files.some((file) => file.split('/').includes('.git'))).toBe(false)
    expect(files).toContain('src/a.ts')
    expect(files).toContain('manifest.json')
  })

  it('excludes .git when it is a worktree pointer file', async () => {
    const root = makeTempDir('zip-spec-')
    write(path.join(root, 'manifest.json'), '{}')
    write(path.join(root, '.git'), 'gitdir: /elsewhere/.git/worktrees/x')

    const files = (await getFilesToZip(root)).files.map(toPosix)
    expect(files).not.toContain('.git')
    expect(files).toContain('manifest.json')
  })

  it('excludes env files but keeps the shareable .env.example', async () => {
    const root = makeTempDir('zip-spec-')
    scaffoldSecretProject(root)

    const files = (await getFilesToZip(root)).files.map(toPosix)
    expect(files).not.toContain('.env')
    expect(files).not.toContain('.env.development')
    expect(files).toContain('.env.example')
  })

  it('excludes the .extension-js session state (live control token)', async () => {
    const root = makeTempDir('zip-spec-')
    scaffoldSecretProject(root)

    const files = (await getFilesToZip(root)).files.map(toPosix)
    expect(
      files.some((file) => file.split('/').includes('.extension-js'))
    ).toBe(false)
  })

  it('excludes dist/extension-js even when the root .gitignore lacks dist', async () => {
    const root = makeTempDir('zip-spec-')
    scaffoldSecretProject(root, {gitignore: 'coverage\n'})

    const files = (await getFilesToZip(root)).files.map(toPosix)
    expect(files.some((file) => file.startsWith('dist/extension-js'))).toBe(
      false
    )
  })

  it('protects a project with no .gitignore at all', async () => {
    const root = makeTempDir('zip-spec-')
    scaffoldSecretProject(root, {gitignore: null})

    const files = (await getFilesToZip(root)).files.map(toPosix)
    expect(files.some((file) => file.split('/').includes('.git'))).toBe(false)
    expect(files.some((file) => file.split('/').includes('node_modules'))).toBe(
      false
    )

    expect(files).not.toContain('.env')
    expect(
      files.some((file) => file.split('/').includes('.extension-js'))
    ).toBe(false)

    expect(files).toContain('src/a.ts')
  })

  it('still honors the root .gitignore as a supplement', async () => {
    const root = makeTempDir('zip-spec-')
    scaffoldSecretProject(root, {gitignore: 'notes.txt\n'})
    write(path.join(root, 'notes.txt'), 'private notes')

    const files = (await getFilesToZip(root)).files.map(toPosix)
    expect(files).not.toContain('notes.txt')
    expect(files).toContain('src/b.ts')
  })

  it('honors nested .gitignore rules whatever separator the glob emits', async () => {
    const root = makeTempDir('zip-spec-')
    scaffoldSecretProject(root, {
      gitignore: 'coverage/\nsecrets/\nsrc/scratch/\n*.log\n'
    })

    write(path.join(root, 'coverage', 'report.html'), '<html></html>')
    write(path.join(root, 'secrets', 'keys.json'), '{"k":"v"}')
    write(path.join(root, 'src', 'scratch', 'todo.md'), 'later')
    write(path.join(root, 'app.log'), 'line')

    const {files} = await getFilesToZip(root)
    expect(files.every((file) => !file.includes('\\'))).toBe(true)
    expect(files).not.toContain('coverage/report.html')
    expect(files).not.toContain('secrets/keys.json')
    expect(files).not.toContain('src/scratch/todo.md')
    expect(files).not.toContain('app.log')
    expect(files).toContain('src/a.ts')
  })

  it('returns only files, never directory entries', async () => {
    const root = makeTempDir('zip-spec-')
    scaffoldSecretProject(root)

    const {files} = await getFilesToZip(root)

    for (const file of files) {
      expect(fs.statSync(path.join(root, file)).isFile()).toBe(true)
    }
  })
})

describe('isDeniedFromSourceZip', () => {
  it('denies nested repositories and nested node_modules', () => {
    expect(isDeniedFromSourceZip('vendor/lib/.git/config')).toBe(true)
    expect(
      isDeniedFromSourceZip('dist/.extension-build-chrome-abc/manifest.json')
    ).toBe(true)

    expect(isDeniedFromSourceZip('packages/a/node_modules/x/index.js')).toBe(
      true
    )

    expect(isDeniedFromSourceZip('src/git/helper.ts')).toBe(false)
  })

  it('denies env files anywhere except example variants', () => {
    expect(isDeniedFromSourceZip('config/.env')).toBe(true)
    expect(isDeniedFromSourceZip('.env.production')).toBe(true)
    expect(isDeniedFromSourceZip('.envrc')).toBe(true)
    expect(isDeniedFromSourceZip('.env.example')).toBe(false)
    expect(isDeniedFromSourceZip('.env.production.example')).toBe(false)
    expect(isDeniedFromSourceZip('src/environment.ts')).toBe(false)
  })
})

function makeCompiler(ctx: string, outPath: string) {
  let doneCb: any
  const compiler: any = {
    options: {
      context: ctx,
      output: {path: outPath}
    },
    hooks: {
      done: {
        tapPromise: (_name: string, cb: any) => {
          doneCb = cb
        }
      }
    }
  }

  return {
    compiler,
    emitDone: async (stats: any = {compilation: {warnings: []}}) => {
      await doneCb(stats)

      return stats
    }
  }
}

describe('ZipPlugin', () => {
  it('writes a source zip whose entry list carries no secret', async () => {
    const root = makeTempDir('zip-spec-')
    scaffoldSecretProject(root)
    const outPath = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(outPath, {recursive: true})

    const {compiler, emitDone} = makeCompiler(root, outPath)
    const plugin = new ZipPlugin({
      browser: 'chrome',
      zipData: {zipSource: true},
      manifestPath: path.join(root, 'manifest.json')
    })
    plugin.apply(compiler)
    const stats = await emitDone()
    expect(stats.compilation.warnings.length).toBe(0)

    const sourcePath = path.join(root, 'dist', 'my-app-1.2.3-source.zip')
    expect(fs.existsSync(sourcePath)).toBe(true)

    const entries = Object.keys(
      unzipSync(new Uint8Array(fs.readFileSync(sourcePath)))
    )
      .filter((name) => !name.endsWith('/'))
      .map(toPosix)
    expect(entries).toContain('src/a.ts')
    expect(entries).toContain('manifest.json')
    expect(entries).toContain('.env.example')
    expect(entries).not.toContain('.env')
    expect(entries).not.toContain('.env.development')
    expect(
      entries.some((e) =>
        e.split('/').some((seg) => seg.startsWith('.extension-build-'))
      )
    ).toBe(false)

    expect(entries.some((e) => e.split('/').includes('.git'))).toBe(false)
    expect(entries.some((e) => e.split('/').includes('.extension-js'))).toBe(
      false
    )

    expect(entries.some((e) => e.split('/').includes('node_modules'))).toBe(
      false
    )

    expect(entries.some((e) => e.startsWith('dist/extension-js'))).toBe(false)
  })

  it('creates the dist zip beside outPath when zip=true and respects zipFilename', async () => {
    const root = makeTempDir('zip-spec-')
    const outPath = path.join(root, 'dist', 'edge')
    write(
      path.join(outPath, 'manifest.json'),
      JSON.stringify({name: 'My App', version: '1.2.3'})
    )

    const {compiler, emitDone} = makeCompiler(root, outPath)
    const plugin = new ZipPlugin({
      browser: 'edge',
      zipData: {zip: true, zipFilename: 'My File Name'}
    })
    plugin.apply(compiler)
    await emitDone()

    expect(
      fs.existsSync(path.join(path.dirname(outPath), 'My File Name-edge.zip'))
    ).toBe(true)
  })

  it('keeps the dashes and extension of an explicit zipFilename', async () => {
    const root = makeTempDir('zip-spec-')
    const outPath = path.join(root, 'dist', 'chrome')
    write(
      path.join(outPath, 'manifest.json'),
      JSON.stringify({name: 'My App', version: '1.2.3'})
    )

    const {compiler, emitDone} = makeCompiler(root, outPath)
    const plugin = new ZipPlugin({
      browser: 'chrome',
      zipData: {zip: true, zipFilename: 'my-extension.zip'}
    })
    plugin.apply(compiler)
    await emitDone()

    expect(
      fs.existsSync(path.join(path.dirname(outPath), 'my-extension-chrome.zip'))
    ).toBe(true)
  })

  it('appends .zip once and strips path segments from an explicit name', async () => {
    const root = makeTempDir('zip-spec-')
    const outPath = path.join(root, 'dist', 'chrome')
    write(
      path.join(outPath, 'manifest.json'),
      JSON.stringify({name: 'My App', version: '1.2.3'})
    )

    const {compiler, emitDone} = makeCompiler(root, outPath)
    const plugin = new ZipPlugin({
      browser: 'chrome',
      zipData: {zip: true, zipFilename: '../up/Release_v2'}
    })
    plugin.apply(compiler)
    await emitDone()

    expect(
      fs.existsSync(path.join(path.dirname(outPath), 'Release_v2-chrome.zip'))
    ).toBe(true)
  })

  it('records each written zip on the compilation for the build receipt', async () => {
    const root = makeTempDir('zip-spec-')
    const outPath = path.join(root, 'dist', 'chrome')
    write(
      path.join(outPath, 'manifest.json'),
      JSON.stringify({name: 'My App', version: '1.2.3'})
    )

    const {compiler, emitDone} = makeCompiler(root, outPath)
    const plugin = new ZipPlugin({
      browser: 'chrome',
      zipData: {zip: true, zipFilename: 'payload.zip'}
    })
    plugin.apply(compiler)
    const stats = await emitDone()

    const artifacts = getZipArtifacts(stats.compilation)
    expect(artifacts.length).toBe(1)
    expect(toPosix(artifacts[0].path)).toMatch(/\/payload-chrome\.zip$/)
    expect(artifacts[0].kind).toBe('dist')
    expect(typeof artifacts[0].size).toBe('number')
    expect(artifacts[0].size).toBeGreaterThan(0)
  })

  it('pushes warning on error without throwing', async () => {
    const root = makeTempDir('zip-spec-')
    const outPath = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(outPath, {recursive: true})

    const {compiler, emitDone} = makeCompiler(root, outPath)
    const plugin = new ZipPlugin({
      browser: 'chrome',
      zipData: {zip: true},
      manifestPath: path.join(root, 'missing', 'manifest.json')
    })
    plugin.apply(compiler)

    const stats = await emitDone({compilation: {warnings: []}})
    expect(stats.compilation.warnings.length).toBe(1)
    expect(String(stats.compilation.warnings[0].message)).toMatch(
      /ZipPlugin: Failed/
    )
  })

  // One symlink used to take both archives down: it is listed as a file,
  // reading it throws, and the single catch downgraded that to a warning.
  it('skips a symlink and still writes both archives', async () => {
    const root = makeTempDir('zip-spec-')
    const outPath = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(outPath, {recursive: true})
    write(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'Linky', version: '1.0.0', manifest_version: 3})
    )

    write(path.join(outPath, 'manifest.json'), '{}')
    write(path.join(root, 'src', 'a.ts'), 'export const a = 1')
    const linkTarget = makeTempDir('zip-link-target-')
    write(path.join(linkTarget, 'util.js'), 'export const u = 1')
    fs.symlinkSync(linkTarget, path.join(root, 'shared'))
    fs.symlinkSync('./gone.js', path.join(root, 'dangling.js'))

    const {compiler, emitDone} = makeCompiler(root, outPath)
    new ZipPlugin({
      browser: 'chrome',
      zipData: {zip: true, zipSource: true},
      manifestPath: path.join(root, 'manifest.json')
    }).apply(compiler)

    const stats = await emitDone({compilation: {warnings: []}})
    const artifacts = getZipArtifacts(stats.compilation)

    expect(getZipFailures(stats.compilation)).toEqual([])
    expect(artifacts.map((a) => a.kind).sort()).toEqual(['dist', 'source'])

    for (const artifact of artifacts) {
      expect(fs.existsSync(artifact.path)).toBe(true)
    }

    const warned = stats.compilation.warnings
      .map((w: Error) => String(w.message))
      .join('\n')
    expect(warned).toMatch(/skipped 2 symlinks/)
    expect(warned).toMatch(/dangling\.js/)
    expect(warned).toMatch(/shared/)
  })

  // An archive the caller asked for and did not get is a failure. Reporting it
  // as a warning let `build --zip` exit 0 having written nothing.
  it('records a failure when a requested archive cannot be written', async () => {
    const root = makeTempDir('zip-spec-')
    const outPath = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(outPath, {recursive: true})
    write(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'Blocked', version: '1.0.0', manifest_version: 3})
    )

    write(path.join(outPath, 'manifest.json'), '{}')
    // The destination is a directory, so writing the archive throws EISDIR.
    fs.mkdirSync(path.join(root, 'dist', 'blocked-chrome.zip'), {
      recursive: true
    })

    const {compiler, emitDone} = makeCompiler(root, outPath)
    new ZipPlugin({
      browser: 'chrome',
      zipData: {zip: true, zipFilename: 'blocked.zip'},
      manifestPath: path.join(root, 'manifest.json')
    }).apply(compiler)

    const stats = await emitDone({compilation: {warnings: []}})
    const failures = getZipFailures(stats.compilation)

    expect(getZipArtifacts(stats.compilation)).toEqual([])
    expect(failures).toHaveLength(1)
    expect(failures[0].kind).toBe('dist')
    expect(toPosix(failures[0].path)).toMatch(/\/blocked-chrome\.zip$/)
    expect(failures[0].reason).toMatch(/EISDIR/)
  })

  it('names the source archive from an explicit zip filename', async () => {
    const root = makeTempDir('zip-spec-')
    const outPath = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(outPath, {recursive: true})
    write(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'Named', version: '1.0.0', manifest_version: 3})
    )

    write(path.join(outPath, 'manifest.json'), '{}')

    const {compiler, emitDone} = makeCompiler(root, outPath)
    new ZipPlugin({
      browser: 'chrome',
      zipData: {zip: true, zipSource: true, zipFilename: 'review-bundle'},
      manifestPath: path.join(root, 'manifest.json')
    }).apply(compiler)

    const stats = await emitDone({compilation: {warnings: []}})
    const byKind = Object.fromEntries(
      getZipArtifacts(stats.compilation).map((a) => [a.kind, toPosix(a.path)])
    )

    expect(byKind.dist).toMatch(/\/review-bundle-chrome\.zip$/)
    expect(byKind.source).toMatch(/\/review-bundle-source\.zip$/)
  })

  it('keeps one archive per browser when two runs share an explicit name', async () => {
    const root = makeTempDir('zip-spec-')
    write(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'Shared', version: '1.0.0', manifest_version: 3})
    )

    const paths: string[] = []

    for (const browser of ['chrome', 'firefox'] as const) {
      const outPath = path.join(root, 'dist', browser)
      write(path.join(outPath, 'manifest.json'), '{}')
      write(path.join(outPath, `${browser}.txt`), browser)

      const {compiler, emitDone} = makeCompiler(root, outPath)
      new ZipPlugin({
        browser,
        zipData: {zip: true, zipSource: true, zipFilename: 'release'},
        manifestPath: path.join(root, 'manifest.json')
      }).apply(compiler)

      const stats = await emitDone({compilation: {warnings: []}})
      const dist = getZipArtifacts(stats.compilation).find(
        (artifact) => artifact.kind === 'dist'
      )
      paths.push(toPosix(dist?.path || ''))
    }

    expect(paths[0]).toMatch(/\/dist\/release-chrome\.zip$/)
    expect(paths[1]).toMatch(/\/dist\/release-firefox\.zip$/)
    expect(fs.readdirSync(path.join(root, 'dist')).sort()).toEqual([
      'chrome',
      'firefox',
      'release-chrome.zip',
      'release-firefox.zip',
      'release-source.zip'
    ])
  })

  it('does not repeat a browser the explicit name already ends with', async () => {
    const root = makeTempDir('zip-spec-')
    const outPath = path.join(root, 'dist', 'firefox')
    write(
      path.join(outPath, 'manifest.json'),
      JSON.stringify({name: 'My App', version: '1.2.3'})
    )

    const {compiler, emitDone} = makeCompiler(root, outPath)
    new ZipPlugin({
      browser: 'firefox',
      zipData: {zip: true, zipFilename: 'store-Firefox.zip'}
    }).apply(compiler)

    await emitDone()

    expect(
      fs.readdirSync(path.dirname(outPath)).filter((f) => f.endsWith('.zip'))
    ).toEqual(['store-Firefox.zip'])
  })
})
