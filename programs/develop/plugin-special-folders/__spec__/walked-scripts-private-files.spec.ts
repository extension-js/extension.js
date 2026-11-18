import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
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

const TIMEOUT = 600_000

describe.skipIf(!canLink)('a file the walk of scripts/ finds', () => {
  it(
    'is an entry by its own name, in a nested folder too',
    async () => {
      const {table, result} = await tableFor(fixture({}))

      // The rows that carry a private name change in the commit that follows.
      expect(table).toEqual({
        'scripts/.env.js': 'scripts/.env.js',
        'scripts/.env.local.js': 'scripts/.env.local.js',
        'scripts/.env.example.js': 'scripts/.env.example.js',
        'scripts/.git/tool.js': 'scripts/.git/tool.js',
        'scripts/nested/.git/tool.js': 'scripts/nested/.git/tool.js',
        'scripts/ok.js': 'scripts/ok.js',
        'scripts/nested/deep/ok.js': 'scripts/nested/deep/ok.js',
        'scripts/.hidden.js': 'scripts/.hidden.js',
        'scripts/node_modules/pkg/lib.js': 'scripts/node_modules/pkg/lib.js'
      })

      expect(result.errors).toBe(0)
      expect(result.printed).not.toContain('left out')
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
          'scripts/loop': 'scripts'
        })
      )

      const linked = Object.fromEntries(
        Object.entries(table).filter(([file]) => !file.startsWith('scripts/'))
      )

      // No link is an entry today, wherever it leads.
      expect(linked).toEqual({})

      expect(result.errors).toBe(0)
    },
    TIMEOUT
  )

  it(
    'sits in a scripts/ folder that is itself a link out of the project',
    async () => {
      const {table, result} = await tableFor(
        fixture({scripts: '../outside-scripts'}, ['scripts/'])
      )

      // Both rows change in the commit that follows.
      expect(table).toEqual({
        '../outside-scripts/tool.js': 'scripts/tool.js',
        '../outside-scripts/nested/tool.js': 'scripts/nested/tool.js'
      })

      expect(result.errors).toBe(0)
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
      expectNothingPrivate(result)
    },
    TIMEOUT
  )
})
