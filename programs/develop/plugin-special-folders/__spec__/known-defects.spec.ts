import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {stripVTControlCharacters as stripAnsi} from 'node:util'
import {afterEach, describe, expect, it} from 'vitest'
import {SpecialFoldersPlugin} from '..'
import {scanEntryFolder} from '../entry-folders'
import {rememberSpecialFoldersConfig} from '../folders-config'
import {
  getSpecialFoldersDataForCompiler,
  getSpecialFoldersDataForProjectRoot,
  walkedEntriesLeftOut
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

// Each case pinned a defect of this folder. The assertion under each
// "Fixed" marker is the behavior that replaced it.

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

describe('D1: the scan reads pages/ and scripts/, never public/', () => {
  it('asks for the two entry folders only and hands back no public list', () => {
    const files: Record<string, string> = {
      'pages/a.html': '<html></html>',
      'scripts/b.js': 'document.title = "b"'
    }

    for (let index = 0; index < 60; index += 1) {
      files[`public/assets/${index % 6}/file-${index}.bin`] = String(index)
    }

    const root = project(files)
    const asked: string[] = []

    const data = getSpecialFoldersDataForProjectRoot(root, {}, undefined, {
      scan: (folder, dir) => {
        asked.push(`${folder} ${path.relative(root, dir)}`)

        return scanEntryFolder(folder, dir)
      }
    })

    // Fixed: public/ is the copier's to walk, and no list of it is built.
    expect(asked).toEqual(['pages pages', 'scripts scripts'])
    expect(Object.keys(data)).not.toContain('public')
    expect(data.pages).toEqual({'pages/a': path.join(root, 'pages', 'a.html')})
    expect(data.scripts).toEqual({
      'scripts/b': path.join(root, 'scripts', 'b.js')
    })
  })

  // A folder no one may read stops a walk, so the default scan proves it
  // never enters public/. Root reads every folder, and Windows has no mode.
  const canLock = process.platform !== 'win32' && process.getuid?.() !== 0

  it.skipIf(!canLock)(
    'builds its lists with an unreadable folder in public/',
    () => {
      const root = project({
        'scripts/b.js': 'document.title = "b"',
        'public/locked/secret.txt': 'x'
      })
      const locked = path.join(root, 'public', 'locked')

      fs.chmodSync(locked, 0o000)

      try {
        expect(
          Object.keys(
            getSpecialFoldersDataForProjectRoot(root, {}).scripts || {}
          )
        ).toEqual(['scripts/b'])
      } finally {
        fs.chmodSync(locked, 0o755)
      }
    }
  )
})

describe('D3: an unreadable folder under the scan', () => {
  const canLock = process.platform !== 'win32' && process.getuid?.() !== 0

  it.skipIf(!canLock)('stops the scan with a named, coded error', () => {
    const root = project({
      'scripts/content.js': 'document.title = "c"',
      'scripts/locked/inner.js': 'document.title = "i"'
    })
    const locked = path.join(root, 'scripts', 'locked')
    let thrown: (Error & {code?: string}) | undefined

    fs.chmodSync(locked, 0o000)

    try {
      getSpecialFoldersDataForProjectRoot(root, {})
    } catch (error) {
      thrown = error as Error & {code?: string}
    } finally {
      fs.chmodSync(locked, 0o755)
    }

    // Fixed: no raw EACCES, and the path is named from the project.
    expect(thrown?.name).toBe('SpecialFolderUnreadable')
    expect(thrown?.code).toBe('E_FOLDER_UNREADABLE')
    expect(stripAnsi(String(thrown?.message))).toBe(
      'scripts/locked cannot be read (EACCES), so the build cannot list the entries in scripts/.\n' +
        'Give your user read access to it, or move it out of scripts/.'
    )

    expect(String(thrown?.message)).not.toContain(root)
  })
})

describe('D4: a public/ file whose output name an entry already emits', () => {
  it('is named in one warning in a real compile', async () => {
    const result = await compileFixture({
      files: {
        'index.js': 'self.fromEntry = "entry-marker"\n',
        'manifest.json': '{"manifest_version": 3}',
        'public/main.js': 'self.fromPublic = "public-marker"\n',
        'public/kept.txt': 'copied'
      },
      plugins: [plugin()]
    })

    expect(result.outputPath).toBe(path.join(result.root, 'dist'))
    expect(result.emitted['main.js']).toContain('entry-marker')
    expect(result.emitted['main.js']).not.toContain('public-marker')
    expect(result.emitted['kept.txt']).toBe('copied')
    expect(result.errors).toEqual([])
    // Fixed: the file the copier skipped is said, once.
    expect(
      result.warnings.map((warning) => ({
        name: warning.name,
        message: stripAnsi(warning.message)
      }))
    ).toEqual([
      {
        name: 'PublicFileShadowedWarning',
        message: expect.stringContaining(
          'public/main.js is not copied into the chrome build, the build already writes that output path from an entry, and the entry wins.'
        )
      }
    ])
  })
})

describe('D5: an include source missing when the session starts', () => {
  it('is reported, then copied once it appears', async () => {
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
      // Fixed: the source is copied on the compile after it appears.
      expect(after.assets['models/x.bin']).toEqual({copied: true})
      expect(after.emitted['models/x.bin']).toBe('weights')
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
    watchMode: true,
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

describe('D6: the scan and the watcher agree on what scripts/ holds', () => {
  it('the watcher sees each file the scan enrolls, dot-files and dist/ or build/ ones too', () => {
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

    expect(scanned).toEqual([
      'scripts/.late',
      'scripts/build/late',
      'scripts/content',
      'scripts/dist/late',
      'scripts/fresh'
    ])

    // Fixed: one walk answers both, so every new entry asks for a restart.
    expect(session.requests).toEqual(
      ['.late.js', 'build/late.js', 'dist/late.js', 'fresh.js'].map((file) => ({
        reason: 'scripts',
        pathAfter: path.join(root, 'scripts', ...file.split('/'))
      }))
    )
  })

  it('neither one takes an upper-case extension', () => {
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

    // Fixed: the watcher asks the scan's question, so no restart is wasted.
    expect(scanned).toEqual(['scripts/content'])
    expect(session.requests).toEqual([])
  })
})

describe('D7: a public folder spelled Public/', () => {
  const root = path.join(os.tmpdir(), 'extjs-case-probe')
  const manifest = path.join(root, 'manifest.json')
  const onDisk = path.join(root, 'Public')
  const readNames = (dir: string) =>
    dir === root ? ['Public', 'manifest.json'] : []
  const base = {
    fromRoot: path.join(root, 'public'),
    fromManifest: path.join(root, 'public'),
    usedFallback: false,
    bothExist: false
  }

  it('ships as today on a disk that ignores letter case, and is named', () => {
    const insensitive = inspectPublicFolders(manifest, root, {
      isDir: (candidate) => candidate.toLowerCase() === onDisk.toLowerCase(),
      readNames
    })

    // Fixed: the folder still ships, and the warning says the name changes.
    expect(insensitive).toEqual({
      ...base,
      publicDir: path.join(root, 'public'),
      miscased: {dir: onDisk, ships: true}
    })
  })

  it('ships nothing on a disk that keeps letter case, and is named', () => {
    const sensitive = inspectPublicFolders(manifest, root, {
      isDir: (candidate) => candidate === onDisk,
      readNames
    })

    // Fixed: nothing ships, as before, and the folder is no longer silent.
    expect(sensitive).toEqual({
      ...base,
      publicDir: undefined,
      miscased: {dir: onDisk, ships: false}
    })
  })

  it('warns in a real compile, with the words for this disk', async () => {
    const result = await compileFixture({
      files: {
        'index.js': 'self.out = 1\n',
        'manifest.json': '{"manifest_version": 3}',
        'Public/logo.txt': 'logo'
      },
      plugins: [plugin()]
    })
    const ignoresCase = fs.existsSync(path.join(result.root, 'pUBLIC'))

    expect(result.emitted['logo.txt']).toBe(ignoresCase ? 'logo' : undefined)
    expect(result.warnings.map((warning) => warning.name)).toEqual([
      'PublicFolderCaseWarning'
    ])

    expect(stripAnsi(result.warnings[0].message)).toBe(
      ignoresCase
        ? 'Public ships as the public folder only because this disk ignores letter case. ' +
            'The folder must be named public/, and another spelling stops working in the next major version.\n' +
            'Rename the folder to public/.'
        : 'Public is not read: the public folder must be named public/ in lowercase, so nothing in it ships.\n' +
            'Rename the folder to public/.'
    )
  })
})

describe('D9: a symlinked file inside scripts/ or pages/', () => {
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

  it.skipIf(process.platform === 'win32')('is a page', () => {
    const root = project({
      'pages/own.html': '<html></html>',
      'shared/linked.html': '<html></html>',
      'shared/folder/inner.html': '<html></html>'
    })
    fs.symlinkSync(
      path.join(root, 'shared', 'linked.html'),
      path.join(root, 'pages', 'linked.html')
    )

    fs.symlinkSync(
      path.join(root, 'shared', 'folder'),
      path.join(root, 'pages', 'folder')
    )

    const scanned = getSpecialFoldersDataForCompiler({
      options: {context: root}
    } as never).pages

    // Fixed: pages are walked the way scripts/ is, links that stay inside too.
    expect(scanned).toEqual({
      'pages/folder/inner': path.join(root, 'pages', 'folder', 'inner.html'),
      'pages/linked': path.join(root, 'pages', 'linked.html'),
      'pages/own': path.join(root, 'pages', 'own.html')
    })
  })

  it.skipIf(process.platform === 'win32')(
    'is left out when it leads out of the project',
    () => {
      const root = project({'pages/own.html': '<html></html>'})
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-page-out-'))

      try {
        fs.writeFileSync(path.join(outside, 'away.html'), '<html></html>')
        fs.symlinkSync(
          path.join(outside, 'away.html'),
          path.join(root, 'pages', 'away.html')
        )

        expect(
          Object.keys(getSpecialFoldersDataForProjectRoot(root, {}).pages || {})
        ).toEqual(['pages/own'])

        expect(walkedEntriesLeftOut(root, {})).toEqual(['pages/away.html'])
      } finally {
        fs.rmSync(outside, {recursive: true, force: true})
      }
    }
  )

  // The watcher names the folder, not the new file, so the folders are read
  // again and a link must show up in that read like a plain file does.
  it.skipIf(process.platform === 'win32')(
    'asks for a restart when it is added mid-session',
    () => {
      const root = project({
        'scripts/content.js': 'document.title = "c"',
        'pages/own.html': '<html></html>',
        'shared/linked.js': 'document.title = "linked"',
        'shared/linked.html': '<html></html>'
      })
      const session = watcherSession(root)
      session.cycle()

      const script = path.join(root, 'scripts', 'linked.js')
      const page = path.join(root, 'pages', 'linked.html')
      fs.symlinkSync(path.join(root, 'shared', 'linked.js'), script)
      fs.symlinkSync(path.join(root, 'shared', 'linked.html'), page)
      session.cycle()

      // Fixed: the watcher lists what the scan takes, links inside included.
      expect(session.requests).toEqual([
        {reason: 'html', pathAfter: page},
        {reason: 'scripts', pathAfter: script}
      ])
    }
  )

  it.skipIf(process.platform === 'win32')(
    'asks for no restart when the added link leads out, and is named',
    () => {
      const root = project({'scripts/content.js': 'document.title = "c"'})
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-link-out-'))

      try {
        const session = watcherSession(root)
        session.cycle()

        fs.writeFileSync(path.join(outside, 'away.js'), 'void 0')
        fs.symlinkSync(
          path.join(outside, 'away.js'),
          path.join(root, 'scripts', 'away.js')
        )

        session.cycle()

        expect(session.requests).toEqual([])
        expect(walkedEntriesLeftOut(root, {})).toEqual(['scripts/away.js'])
      } finally {
        fs.rmSync(outside, {recursive: true, force: true})
      }
    }
  )
})
