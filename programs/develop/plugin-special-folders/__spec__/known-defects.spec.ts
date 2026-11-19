import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {getSpecialFoldersData} from 'browser-extension-manifest-fields'
import {afterEach, describe, expect, it} from 'vitest'
import {SpecialFoldersPlugin} from '..'
import {rememberSpecialFoldersConfig} from '../folders-config'
import {
  getSpecialFoldersDataForCompiler,
  getSpecialFoldersDataForProjectRoot,
  type ScanSpecialFolders
} from '../get-data'
import {inspectPublicFolders} from '../resolve-public-folder'
import {WarnUponFolderChanges} from '../warn-upon-folder-changes'
import {
  closeCompiler,
  compileFixture,
  fixtureCompiler,
  makeFixtureRoot,
  removeFixtureRoots,
  runCompiler,
  writeFixtureFiles
} from './helpers/compile-harness'

// Each case pins a defect as the code behaves today. The fix flips the
// assertion under the marker comment.

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rememberSpecialFoldersConfig(root, undefined)
  }

  removeFixtureRoots()
})

const fixtureRoots: string[] = []

function project(files: Record<string, string> = {}): string {
  const root = makeFixtureRoot(files)
  fixtureRoots.push(root)

  return root
}

const plugin = (
  manifest = 'manifest.json',
  include?: Record<string, string>
) => ({
  apply(compiler: Parameters<SpecialFoldersPlugin['apply']>[0]) {
    new SpecialFoldersPlugin({
      manifestPath: path.join(String(compiler.options.context), manifest),
      include
    }).apply(compiler)
  }
})

describe('D1: the scan walks every public/ file for a list nothing reads', () => {
  it('visits each file of public/ once per scan and hands the list back untouched', () => {
    const files: Record<string, string> = {}

    for (let index = 0; index < 60; index += 1) {
      files[`public/assets/${index % 6}/file-${index}.bin`] = String(index)
    }

    files['public/.well-known/hidden.txt'] = 'dot folder'
    files['public/dist/old.js'] = 'a build folder inside public'
    const root = project(files)
    const counted: number[] = []
    const reads: PropertyKey[] = []

    const data = getSpecialFoldersDataForProjectRoot(root, {}, undefined, {
      scan: (options) => {
        const scanned = getSpecialFoldersData(options)
        counted.push(Object.keys(scanned.public).length)

        // Any consumer that looks inside the list leaves a trace here.
        return {
          ...scanned,
          public: new Proxy(scanned.public, {
            get(target, key, receiver) {
              reads.push(key)

              return Reflect.get(target, key, receiver)
            },
            ownKeys(target) {
              reads.push('ownKeys')

              return Reflect.ownKeys(target)
            }
          })
        }
      }
    })

    // Pins today's behavior.
    expect(counted).toEqual([62])
    expect(Object.keys(data)).toContain('public')
    expect(reads).toEqual([])
  })
})

describe('D3: an unreadable folder under the scan', () => {
  it('lets the raw EACCES through, unframed', () => {
    const root = project()
    const denied = Object.assign(
      new Error(
        `EACCES: permission denied, scandir '${path.join(root, 'public', 'locked')}'`
      ),
      {code: 'EACCES', syscall: 'scandir'}
    )

    const scan: ScanSpecialFolders = () => {
      throw denied
    }

    let thrown: unknown

    try {
      getSpecialFoldersDataForProjectRoot(root, {}, undefined, {scan})
    } catch (error) {
      thrown = error
    }

    // Pins today's behavior.
    expect(thrown).toBe(denied)
  })
})

describe('D4: a public/ file whose output name an entry already emits', () => {
  it('is skipped with no diagnostic in a real compile', async () => {
    const result = await compileFixture({
      files: {
        'index.js': 'self.fromEntry = "entry-marker"\n',
        'manifest.json': '{"manifest_version": 3}',
        'public/main.js': 'self.fromPublic = "public-marker"\n'
      },
      plugins: [plugin()]
    })

    expect(result.outputPath).toBe(path.join(result.root, 'dist'))
    expect(result.emitted['main.js']).toContain('entry-marker')
    // Pins today's behavior.
    expect(result.emitted['main.js']).not.toContain('public-marker')
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })
})

describe('D5: an include source missing when the session starts', () => {
  it('is reported, then never copied once it appears', async () => {
    const root = project({
      'index.js': 'self.out = 1\n',
      'manifest.json': '{"manifest_version": 3}'
    })
    const compiler = fixtureCompiler({
      root,
      mode: 'development',
      plugins: [plugin('manifest.json', {'models/x.bin': './models/x.bin'})]
    })

    try {
      const before = await runCompiler(root, compiler)
      expect(before.outputPath).toBe(path.join(root, 'dist'))
      expect(before.errors.map((error) => error.name)).toEqual([
        'IncludeFilesError'
      ])

      writeFixtureFiles(root, {'models/x.bin': 'weights'})
      const after = await runCompiler(root, compiler)

      expect(after.errors).toEqual([])
      // Pins today's behavior.
      expect(after.assets['models/x.bin']).toBeUndefined()
      expect(after.emitted['models/x.bin']).toBeUndefined()
    } finally {
      await closeCompiler(compiler)
    }
  })
})

function watcherSession(root: string) {
  const requests: Array<{reason: string; pathAfter?: string}> = []
  const watchRun: Array<() => void> = []
  const thisCompilation: Array<(compilation: unknown) => void> = []
  const compiler = {
    options: {mode: 'development', watchOptions: {}, context: root},
    hooks: {
      watchRun: {tap: (_name: string, fn: () => void) => watchRun.push(fn)},
      thisCompilation: {
        tap: (_name: string, fn: (compilation: unknown) => void) =>
          thisCompilation.push(fn)
      },
      done: {tap: () => {}}
    },
    modifiedFiles: new Set<string>(),
    removedFiles: new Set<string>()
  }

  new WarnUponFolderChanges({
    requestRestart: (_target, request) => {
      requests.push(request)

      return true
    }
  }).apply(compiler as never)

  return {
    requests,
    cycle(modified: string[] = []) {
      compiler.modifiedFiles = new Set(modified)
      for (const fn of watchRun) fn()

      const compilation = {
        warnings: [],
        errors: [],
        contextDependencies: new Set<string>(),
        missingDependencies: new Set<string>()
      }

      for (const fn of thisCompilation) fn(compilation)
    }
  }
}

describe('D6: the scan and the watcher disagree on what scripts/ holds', () => {
  it('the scan enrolls dot-files and dist/ or build/ files the watcher never sees', () => {
    const root = project({'scripts/content.js': 'document.title = "c"'})
    const session = watcherSession(root)
    session.cycle()

    writeFixtureFiles(root, {
      'scripts/.late.js': 'document.title = "dot"',
      'scripts/dist/late.js': 'document.title = "dist"',
      'scripts/build/late.js': 'document.title = "build"',
      'scripts/fresh.js': 'document.title = "fresh"'
    })

    session.cycle()

    const scanned = Object.keys(
      getSpecialFoldersDataForCompiler({options: {context: root}} as never)
        .scripts || {}
    ).sort()

    // Pins today's behavior.
    expect(scanned).toEqual([
      'scripts/.late',
      'scripts/build/late',
      'scripts/content',
      'scripts/dist/late',
      'scripts/fresh'
    ])

    expect(session.requests).toEqual([
      {reason: 'scripts', pathAfter: path.join(root, 'scripts', 'fresh.js')}
    ])
  })

  it('the watcher restarts for an upper-case extension the scan never enrolls', () => {
    const root = project({'scripts/content.js': 'document.title = "c"'})
    const session = watcherSession(root)
    session.cycle()

    const upper = path.join(root, 'scripts', 'LOUD.JS')
    writeFixtureFiles(root, {'scripts/LOUD.JS': 'document.title = "loud"'})
    session.cycle([upper])

    const scanned = Object.keys(
      getSpecialFoldersDataForCompiler({options: {context: root}} as never)
        .scripts || {}
    )

    // Pins today's behavior.
    expect(scanned).toEqual(['scripts/content'])
    expect(session.requests).toEqual([{reason: 'scripts', pathAfter: upper}])
  })
})

describe('D7: a public folder spelled Public/', () => {
  const root = path.join(os.tmpdir(), 'extjs-case-probe')
  const manifest = path.join(root, 'manifest.json')
  const onDisk = path.join(root, 'Public')

  it('ships on a case-insensitive disk and silently does not on a case-sensitive one', () => {
    const insensitive = inspectPublicFolders(manifest, root, {
      isDir: (candidate) => candidate.toLowerCase() === onDisk.toLowerCase()
    })
    const sensitive = inspectPublicFolders(manifest, root, {
      isDir: (candidate) => candidate === onDisk
    })

    // Pins today's behavior.
    expect(insensitive.publicDir).toBe(path.join(root, 'public'))
    expect(sensitive).toEqual({
      publicDir: undefined,
      fromRoot: path.join(root, 'public'),
      fromManifest: path.join(root, 'public'),
      usedFallback: false,
      bothExist: false
    })
  })
})

describe('D9: a symlinked file inside scripts/', () => {
  // Creating a symlink needs a privilege Windows runners do not grant.
  it.skipIf(process.platform === 'win32')('is an entry', () => {
    const root = project({
      'scripts/content.js': 'document.title = "c"',
      'shared/linked.js': 'document.title = "linked"'
    })
    fs.symlinkSync(
      path.join(root, 'shared', 'linked.js'),
      path.join(root, 'scripts', 'linked.js')
    )

    const scanned = getSpecialFoldersDataForCompiler({
      options: {context: root}
    } as never).scripts

    expect(
      fs.lstatSync(path.join(root, 'scripts', 'linked.js')).isSymbolicLink()
    ).toBe(true)

    // Fixed: a link that stays inside the project is walked like a file.
    expect(scanned).toEqual({
      'scripts/content': path.join(root, 'scripts', 'content.js'),
      'scripts/linked': path.join(root, 'scripts', 'linked.js')
    })
  })
})
