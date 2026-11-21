import * as fs from 'node:fs'
import * as path from 'node:path'
import {stripVTControlCharacters as stripAnsi} from 'node:util'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {buildProject} from '../../__spec__/helpers/build-project'
import {
  compileFixture,
  makeFixtureRoot,
  removeFixtureRoots
} from '../../__spec__/helpers/compile-harness'
import {
  foldersRoots,
  miscasedEntryFolders,
  rememberSpecialFoldersConfig
} from '../../lib/special-folders/folders-config'
import {
  getSpecialFoldersDataForProjectRoot,
  walkedEntryCollisions
} from '../../lib/special-folders/get-data'
import {SpecialFoldersPlugin} from '..'

const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rememberSpecialFoldersConfig(root, undefined)
  }

  removeFixtureRoots()
})

function project(files: Record<string, string> = {}): string {
  const root = makeFixtureRoot(files)
  fixtureRoots.push(root)

  return root
}

const plugin = () => ({
  apply(compiler: Parameters<SpecialFoldersPlugin['apply']>[0]) {
    new SpecialFoldersPlugin({
      manifestPath: path.join(String(compiler.options.context), 'manifest.json')
    }).apply(compiler)
  }
})

const base = {
  'index.js': 'self.out = 1\n',
  'manifest.json': '{"manifest_version": 3}'
}

function entries(root: string) {
  const data = getSpecialFoldersDataForProjectRoot(root)
  const fromRoot = (list: Record<string, unknown> = {}) =>
    Object.fromEntries(
      Object.entries(list).map(([name, file]) => [
        name,
        path.relative(root, String(file)).split(path.sep).join('/')
      ])
    )

  return {pages: fromRoot(data.pages), scripts: fromRoot(data.scripts)}
}

describe('an entry folder spelled Pages/ or Scripts/', () => {
  it('is read on no disk, and is named', () => {
    const root = project({
      ...base,
      'Scripts/cs.js': 'document.title = "cs"',
      'Pages/welcome.html': '<!doctype html><title>w</title>'
    })

    expect(entries(root)).toEqual({pages: {}, scripts: {}})
    expect(foldersRoots(root)).toEqual({})
    expect(miscasedEntryFolders(root)).toEqual([
      {name: 'pages', dir: path.join(root, 'Pages')},
      {name: 'scripts', dir: path.join(root, 'Scripts')}
    ])
  })

  it('leaves a project with no such folder, or the right one, alone', () => {
    const root = project({...base, 'scripts/cs.js': 'document.title = "cs"'})

    expect(foldersRoots(root)).toEqual({
      pages: path.join(root, 'pages'),
      scripts: path.join(root, 'scripts')
    })

    expect(miscasedEntryFolders(root)).toEqual([])
    expect(entries(root).scripts).toEqual({'scripts/cs': 'scripts/cs.js'})
  })

  it('follows a folder the config moves, and says nothing once it is off', () => {
    const root = project({...base, 'src/Scripts/cs.js': 'document.title = 1'})

    expect(miscasedEntryFolders(root, {scripts: 'src/scripts'})).toEqual([
      {name: 'scripts', dir: path.join(root, 'src', 'Scripts')}
    ])

    expect(foldersRoots(root, {scripts: 'src/scripts'}).scripts).toBe(undefined)
    expect(miscasedEntryFolders(root, {scripts: false})).toEqual([])
  })

  it('keeps reading scripts/ beside a Scripts/ on a disk that keeps letter case', () => {
    const root = project({...base, 'scripts/cs.js': 'document.title = "cs"'})
    const ignoresCase = fs.existsSync(path.join(root, 'SCRIPTS'))

    if (ignoresCase) return

    fs.mkdirSync(path.join(root, 'Scripts'))
    fs.writeFileSync(path.join(root, 'Scripts', 'other.js'), 'self.o = 1')

    expect(entries(root).scripts).toEqual({'scripts/cs': 'scripts/cs.js'})
    expect(miscasedEntryFolders(root)).toEqual([
      {name: 'scripts', dir: path.join(root, 'Scripts')}
    ])
  })

  it('warns by name in a real compile, with the rename', async () => {
    const result = await compileFixture({
      files: {
        ...base,
        'Scripts/cs.js': 'document.title = "cs"',
        'Pages/welcome.html': '<!doctype html><title>w</title>'
      },
      plugins: [plugin()]
    })

    expect(result.errors).toEqual([])
    expect(
      result.warnings.map((warning) => [
        warning.name,
        stripAnsi(warning.message)
      ])
    ).toEqual([
      [
        'EntryFolderCaseWarning',
        'Pages is not read: the pages folder must be named pages/ in lowercase, so no page in it is built.\n' +
          'Rename the folder to pages/.'
      ],
      [
        'EntryFolderCaseWarning',
        'Scripts is not read: the scripts folder must be named scripts/ in lowercase, so no script in it is built.\n' +
          'Rename the folder to scripts/.'
      ]
    ])
  })

  it('builds, with one coded warning and no stack', async () => {
    const root = project({
      'package.json': JSON.stringify({
        private: true,
        name: 'scripts-case',
        version: '0.0.0'
      }),
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'scripts-case',
        version: '1.0.0',
        background: {service_worker: 'background.js'}
      }),
      'background.js': 'self.ready = 1\n',
      'Scripts/cs.js': 'document.title = "cs"'
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const summary = await buildProject(root, {mode: 'production'})

      expect(summary.errors_count).toBe(0)
      expect(
        (summary.warnings || []).filter((line: string) =>
          line.includes('Scripts')
        )
      ).toEqual([
        'W_PROJECT_LAYOUT: Scripts is not read: the scripts folder must be named scripts/ in lowercase, so no script in it is built.\n' +
          'Rename the folder to scripts/.'
      ])
    } finally {
      logSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
  }, 180_000)
})

describe('two files that build under one entry name', () => {
  const colliding = {
    ...base,
    'pages/a.html': '<!doctype html><title>flat</title>',
    'pages/a/index.html': '<!doctype html><title>folder</title>',
    'pages/solo.html': '<!doctype html><title>solo</title>',
    'scripts/a.js': 'document.title = "js"',
    'scripts/a.jsx': 'document.title = "jsx"',
    'scripts/a.ts': 'document.title = "ts"',
    'scripts/solo.js': 'document.title = "solo"'
  }

  it('builds the file that sorts last and names every other one', () => {
    const root = project(colliding)

    expect(entries(root)).toEqual({
      pages: {'pages/a': 'pages/a/index.html', 'pages/solo': 'pages/solo.html'},
      scripts: {'scripts/a': 'scripts/a.ts', 'scripts/solo': 'scripts/solo.js'}
    })

    expect(walkedEntryCollisions(root)).toEqual([
      {name: 'pages/a', used: 'pages/a/index.html', dropped: ['pages/a.html']},
      {
        name: 'scripts/a',
        used: 'scripts/a.ts',
        dropped: ['scripts/a.js', 'scripts/a.jsx']
      }
    ])
  })

  it('says nothing for a project where every name has one file', () => {
    const root = project({...base, 'scripts/solo.js': 'document.title = 1'})

    expect(walkedEntryCollisions(root)).toEqual([])
  })

  it('warns once in a real compile, naming each file and the one used', async () => {
    const result = await compileFixture({
      files: colliding,
      plugins: [plugin()]
    })

    expect(
      result.warnings.map((warning) => [
        warning.name,
        stripAnsi(warning.message)
      ])
    ).toEqual([
      [
        'EntryNameCollisionWarning',
        'More than one file builds under the same entry name, so only one of them is in the chrome build.\n' +
          'pages/a USING pages/a/index.html IGNORED pages/a.html\n' +
          'scripts/a USING scripts/a.ts IGNORED scripts/a.js, scripts/a.jsx\n' +
          'An entry is named by its path without the extension, and a page named index stands for its folder. The file that sorts last wins.\n' +
          'Rename or delete the ignored files.'
      ]
    ])
  })

  // A link is created with a privilege Windows runners do not grant.
  it.skipIf(process.platform === 'win32')(
    'settles a linked file against a plain one the same way',
    () => {
      const root = project({
        ...base,
        'scripts/a.js': 'document.title = "js"',
        'shared/a.ts': 'document.title = "linked"'
      })
      fs.symlinkSync(
        path.join(root, 'shared', 'a.ts'),
        path.join(root, 'scripts', 'a.ts')
      )

      expect(entries(root).scripts).toEqual({'scripts/a': 'scripts/a.ts'})
      expect(walkedEntryCollisions(root)).toEqual([
        {name: 'scripts/a', used: 'scripts/a.ts', dropped: ['scripts/a.js']}
      ])
    }
  )
})

describe('a declaration file in scripts/', () => {
  it('is never an entry', () => {
    const root = project({
      ...base,
      'scripts/cs.ts': 'document.title = "cs"',
      'scripts/cs.d.ts': 'declare const cs: string',
      'scripts/globals.d.ts': 'declare const g: string',
      'scripts/esm.d.mts': 'export declare const e: string',
      'scripts/common.d.cts': 'export declare const c: string',
      'scripts/d.ts': 'document.title = "named d"'
    })

    expect(entries(root).scripts).toEqual({
      'scripts/cs': 'scripts/cs.ts',
      'scripts/d': 'scripts/d.ts'
    })

    expect(walkedEntryCollisions(root)).toEqual([])
  })
})
