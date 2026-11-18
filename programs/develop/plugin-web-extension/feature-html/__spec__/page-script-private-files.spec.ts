import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  build,
  canLink,
  expectNothingPrivate,
  MARKER,
  makeProject,
  outputHolding,
  PAGE
} from './helpers/private-files-project'

// Whole builds of a fixture project whose page loads, as a script or a
// stylesheet, a file a build never copies. The bundler would compile it
// into the page's bundle, so one reference per build.

const TIMEOUT = 120_000

const script = (mark: string) => `console.log("${mark}")\n`
const sheet = (mark: string) => `.${mark}{color:red}\n`

const WITHHELD_MARK = `${MARKER}-loaded`
const SHIPPED_MARK = 'SHIPPED-BY-NAME'

const scriptTag = (ref: string) => ({body: `<script src="${ref}"></script>`})
const sheetTag = (ref: string) => ({
  head: `<link rel="stylesheet" href="${ref}">`
})

function page(parts: {head?: string; body?: string}) {
  return PAGE.replace('<head>', `<head>${parts.head || ''}`).replace(
    '<body>',
    `<body>${parts.body || ''}`
  )
}

interface Loaded {
  kind: 'script' | 'stylesheet'
  ref: string
  // Where the file sits, from the folder that holds the project.
  file: string
  // A link inside the project that leads to the file.
  link?: string
}

const WITHHELD: Loaded[] = [
  {kind: 'script', ref: '.envrc', file: 'project/.envrc'},
  {kind: 'script', ref: '../outside.js', file: 'outside.js'},
  {kind: 'script', ref: '/.env.js', file: 'project/.env.js'},
  {
    kind: 'script',
    ref: 'node_modules/pkg/.env',
    file: 'project/node_modules/pkg/.env'
  },
  {kind: 'stylesheet', ref: '.npmrc', file: 'project/.npmrc'},
  {kind: 'stylesheet', ref: '../outside.css', file: 'outside.css'},
  {
    kind: 'stylesheet',
    ref: 'node_modules/pkg/.env',
    file: 'project/node_modules/pkg/.env'
  },
  ...(canLink
    ? ([
        {
          kind: 'script',
          ref: 'linked.js',
          file: 'outside-linked.js',
          link: 'project/linked.js'
        },
        {
          kind: 'stylesheet',
          ref: 'linked.css',
          file: 'outside-linked.css',
          link: 'project/linked.css'
        }
      ] as Loaded[])
    : [])
]

const SHIPPED: Loaded[] = [
  {kind: 'script', ref: 'own.js', file: 'project/own.js'},
  {
    kind: 'script',
    ref: 'node_modules/pkg/lib.js',
    file: 'project/node_modules/pkg/lib.js'
  },
  // A name that only looks close to a private one.
  {kind: 'script', ref: 'env.js', file: 'project/env.js'},
  {kind: 'script', ref: '/config.env.js', file: 'project/config.env.js'},
  {kind: 'stylesheet', ref: 'own.css', file: 'project/own.css'},
  {
    kind: 'stylesheet',
    ref: 'node_modules/pkg/theme.css',
    file: 'project/node_modules/pkg/theme.css'
  }
]

// The project with one loaded file written, and the page that loads it.
function projectLoading(loaded: Loaded, mark: string, nested: boolean) {
  const {root} = makeProject()
  const holder = path.dirname(root)
  const target = path.join(holder, loaded.file)
  const tag =
    loaded.kind === 'script' ? scriptTag(loaded.ref) : sheetTag(loaded.ref)

  fs.mkdirSync(path.dirname(target), {recursive: true})
  fs.writeFileSync(
    target,
    loaded.kind === 'script' ? script(mark) : sheet(mark)
  )

  if (loaded.link) fs.symlinkSync(target, path.join(holder, loaded.link))

  if (nested) {
    fs.writeFileSync(path.join(root, 'inner.html'), page(tag))
    fs.writeFileSync(
      path.join(root, 'popup.html'),
      page({body: '<iframe src="./inner.html"></iframe>'})
    )
  } else {
    fs.writeFileSync(path.join(root, 'popup.html'), page(tag))
  }

  return root
}

const label = (loaded: Loaded) => [loaded.kind, loaded.ref, loaded] as const

describe.each([
  ['a page', false],
  ['a page another page embeds', true]
] as const)('%s that loads a file the build never copies', (_where, nested) => {
  it.each(WITHHELD.map(label))(
    'leaves the %s %s out of every bundle and calls it missing',
    async (_kind, ref, loaded) => {
      const root = projectLoading(loaded, WITHHELD_MARK, nested)
      const result = await build(root)

      expect(outputHolding(root, WITHHELD_MARK)).toEqual([])
      expectNothingPrivate(result)
      expect(result.errors).toBe(0)
      // The wording follows the tag, as it does for a missing file.
      expect(result.printed).toContain(
        loaded.kind === 'script'
          ? "The page references a script file that doesn't exist."
          : "The page references a stylesheet that doesn't exist."
      )

      expect(result.printed).toContain(
        loaded.kind === 'script'
          ? 'Update the <script> src to point to a file that exists.'
          : 'Update the <link> href to point to a file that exists.'
      )

      // A ref with a leading slash is read from the extension root.
      const shown = ref.startsWith('/')
        ? path.join(root, ref)
        : path.resolve(root, ref)

      expect(result.printed).toContain(`NOT FOUND ${shown}`)
    },
    TIMEOUT
  )
})

describe('a page that loads a file the build ships', () => {
  it.each(SHIPPED.map(label))(
    'keeps the %s %s',
    async (_kind, _ref, loaded) => {
      const root = projectLoading(loaded, SHIPPED_MARK, false)
      const result = await build(root)

      expect(result.errors).toBe(0)
      expect(outputHolding(root, SHIPPED_MARK)).toHaveLength(1)
      expect(result.printed).not.toContain("doesn't exist")
    },
    TIMEOUT
  )
})
