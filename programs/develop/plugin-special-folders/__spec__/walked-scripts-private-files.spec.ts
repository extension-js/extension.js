import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  getSpecialFoldersDataForProjectRoot,
  walkedScriptsLeftOut
} from '../get-data'
import {listOutput} from './helpers/compile-harness'
import {
  build,
  canLink,
  expectNothingPrivate,
  MARKER,
  project
} from './helpers/private-files-project'

// Whole production builds of a project whose scripts/ folder holds files no
// field names: the walk of the folder finds them. Each file logs its own
// path, so a bundle that took a file in says which one.

// A row in one line: the output file that holds the text of a source file.
type Table = Record<string, string>

const PRIVATE_FILES = [
  'scripts/.env.js',
  'scripts/.env.local.js',
  'scripts/.env.example.js',
  'scripts/.git/tool.js',
  'scripts/nested/.git/tool.js',
  '.env.js',
  '../outside.js',
  '../outside-scripts/tool.js',
  '../outside-scripts/nested/tool.js'
]

const PLAIN_FILES = [
  'scripts/ok.js',
  'scripts/nested/deep/ok.js',
  'scripts/.hidden.js',
  'scripts/node_modules/pkg/lib.js',
  'lib/inside.js',
  'lib/more/inner.js',
  'src/scripts/moved.js',
  'src/scripts/nested/moved.js'
]

const textOf = (file: string) =>
  `${PRIVATE_FILES.includes(file) ? MARKER : 'PLAIN-TEXT'}-of(${file})`

const codeOf = (file: string) =>
  `console.log(${JSON.stringify(textOf(file))})\n`

const withoutHash = (name: string) =>
  name.replace(/\.[0-9a-f]{8}(?=\.|$)/, '.<hash>')

// Every file of both lists but the ones under the folders left out, and the
// links a case asks for, each named by the path it leads to.
function fixture(
  links: Record<string, string>,
  without: string[] = [],
  config = 'export default {}\n'
) {
  const files: Record<string, string> = {'extension.config.js': config}

  for (const file of [...PRIVATE_FILES, ...PLAIN_FILES]) {
    if (file.startsWith('../')) continue
    if (without.some((folder) => file.startsWith(folder))) continue

    files[file] = codeOf(file)
  }

  const root = project(files)
  const holder = path.dirname(root)

  for (const file of PRIVATE_FILES) {
    if (!file.startsWith('../')) continue

    const target = path.join(root, file)

    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, codeOf(file))
  }

  for (const [name, target] of Object.entries(links)) {
    fs.symlinkSync(
      target.startsWith('../')
        ? path.join(holder, target.slice(3))
        : path.join(root, target),
      path.join(root, name)
    )
  }

  return root
}

async function tableFor(root: string) {
  const result = await build(root)
  const out = listOutput(path.join(root, 'dist', 'chrome'))
  const table: Table = {}

  for (const file of [...PRIVATE_FILES, ...PLAIN_FILES]) {
    const held = Object.keys(out)
      .sort()
      .filter((name) => out[name].includes(textOf(file)))
      .map(withoutHash)

    if (held.length) table[file] = held.join(' + ')
  }

  return {table, result}
}

// The whole warning for the files left out, as the build prints it.
const leftOut = (files: string[], browser = 'chrome') =>
  [
    `${files.join(', ')} ${files.length === 1 ? 'is' : 'are'} left out of the ${browser} build.`,
    `The build never bundles env files, tooling files or repository files, or a file a link brings from outside the project or from node_modules. To build ${files.length === 1 ? 'it as a script, give it another name or copy it' : 'them as scripts, give them another name or copy them'} into the project.`
  ].join('\n')

// How many times the build said a file was left out, in any words.
const timesSaid = (printed: string) =>
  printed.split('left out of the').length - 1

const TIMEOUT = 600_000

describe.skipIf(!canLink)('a file the walk of scripts/ finds', () => {
  it(
    'is an entry by its own name, in a nested folder too',
    async () => {
      const {table, result} = await tableFor(fixture({}))

      // A private name is no entry, and neither is an installed package. A
      // dot-file the rule does not list is built as authored.
      expect(table).toEqual({
        'scripts/ok.js': 'scripts/ok.js',
        'scripts/nested/deep/ok.js': 'scripts/nested/deep/ok.js',
        'scripts/.hidden.js': 'scripts/.hidden.js'
      })

      // Not an error: no field names these files. One warning names them,
      // and the installed package is passed over without a word.
      expect(result.errors).toBe(0)
      expect(result.printed).toContain(
        leftOut([
          'scripts/.env.example.js',
          'scripts/.env.js',
          'scripts/.env.local.js',
          'scripts/.git/tool.js',
          'scripts/nested/.git/tool.js'
        ])
      )

      // Once on the human channel and once in the result the build returns.
      expect(timesSaid(result.printed)).toBe(2)
      expect(result.printed).not.toContain('node_modules/pkg/lib.js')
      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'is a link to a file or to a folder',
    async () => {
      const {table, result} = await tableFor(
        fixture({
          'scripts/linked-in.js': 'lib/inside.js',
          'scripts/linked-folder-in': 'lib/more',
          'scripts/linked-private.js': '.env.js',
          'scripts/linked-out.js': '../outside.js',
          'scripts/linked-folder-out': '../outside-scripts',
          'scripts/linked-package.js': 'scripts/node_modules/pkg/lib.js',
          'scripts/broken.js': 'lib/gone.js',
          'scripts/loop': 'scripts',
          'scripts/nested/again': 'scripts/nested/deep'
        })
      )

      // A link that stays inside the project is an entry under its own
      // name, and a folder reached twice is built once.
      expect(table).toEqual({
        'scripts/ok.js': 'scripts/ok.js',
        'scripts/nested/deep/ok.js': 'scripts/nested/deep/ok.js',
        'scripts/.hidden.js': 'scripts/.hidden.js',
        'lib/inside.js': 'scripts/linked-in.js',
        'lib/more/inner.js': 'scripts/linked-folder-in/inner.js'
      })

      expect(result.errors).toBe(0)
      expect(result.printed).toContain(
        leftOut([
          'scripts/.env.example.js',
          'scripts/.env.js',
          'scripts/.env.local.js',
          'scripts/.git/tool.js',
          'scripts/linked-folder-out',
          'scripts/linked-out.js',
          'scripts/linked-package.js',
          'scripts/linked-private.js',
          'scripts/nested/.git/tool.js'
        ])
      )

      expect(timesSaid(result.printed)).toBe(2)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'sits in a scripts/ folder that is itself a link out of the project',
    async () => {
      const {table, result} = await tableFor(
        fixture({scripts: '../outside-scripts'}, ['scripts/'])
      )

      expect(table).toEqual({})
      expect(result.errors).toBe(0)
      expect(result.printed).toContain(
        leftOut(['scripts/nested/tool.js', 'scripts/tool.js'])
      )

      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'sits in a scripts/ folder that is itself a link to a project folder',
    async () => {
      const {table, result} = await tableFor(
        fixture({scripts: 'src/scripts'}, ['scripts/'])
      )

      expect(table).toEqual({
        'src/scripts/moved.js': 'scripts/moved.js',
        'src/scripts/nested/moved.js': 'scripts/nested/moved.js'
      })

      expect(result.errors).toBe(0)
      expect(timesSaid(result.printed)).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'sits in the folder the config names, inside the project',
    async () => {
      const {table, result} = await tableFor(
        fixture(
          {},
          ['scripts/'],
          'export default {folders: {scripts: "src/scripts"}}\n'
        )
      )

      expect(table).toEqual({
        'src/scripts/moved.js': 'scripts/moved.js',
        'src/scripts/nested/moved.js': 'scripts/nested/moved.js'
      })

      expect(result.errors).toBe(0)
      expect(timesSaid(result.printed)).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )
})

describe('the list of walked scripts', () => {
  const keysOf = (root: string, folders = {}) =>
    Object.keys(
      getSpecialFoldersDataForProjectRoot(root, folders).scripts ?? {}
    ).sort()

  it('holds no private name and no installed package', () => {
    const root = fixture({})

    expect(keysOf(root)).toEqual([
      'scripts/.hidden',
      'scripts/nested/deep/ok',
      'scripts/ok'
    ])

    expect(walkedScriptsLeftOut(root)).toEqual([
      'scripts/.env.example.js',
      'scripts/.env.js',
      'scripts/.env.local.js',
      'scripts/.git/tool.js',
      'scripts/nested/.git/tool.js'
    ])
  })

  it('is whole for a folder the config names outside the project', () => {
    const root = fixture({})
    const folders = {scripts: '../outside-scripts/scripts'}
    const moved = path.join(path.dirname(root), 'outside-scripts', 'scripts')

    fs.mkdirSync(path.join(moved, '.git'), {recursive: true})
    fs.writeFileSync(path.join(moved, 'shared.js'), 'console.log("shared")\n')
    fs.writeFileSync(path.join(moved, '.env.js'), codeOf('scripts/.env.js'))
    fs.writeFileSync(
      path.join(moved, '.git', 'tool.js'),
      codeOf('scripts/.git/tool.js')
    )

    // The author named the folder, and a private name in it stays out.
    expect(keysOf(root, folders)).toEqual(['scripts/shared'])
    expect(walkedScriptsLeftOut(root, folders)).toEqual([
      '../outside-scripts/scripts/.env.js',
      '../outside-scripts/scripts/.git/tool.js'
    ])
  })

  it('is left as scanned once the config turns the folder off', () => {
    const root = fixture({})

    expect(keysOf(root, {scripts: false})).toEqual([])
    expect(walkedScriptsLeftOut(root, {scripts: false})).toEqual([])
  })
})
