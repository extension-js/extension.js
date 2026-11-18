import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  type Built,
  build,
  canLink,
  expectNothingPrivate,
  linkPackages,
  MARKER,
  manifest,
  PAGE,
  project
} from './helpers/private-files-project'

// Whole builds of a fixture project: a page, a stylesheet or the manifest
// names a root-absolute path that public/ does not hold.

const PRIVATE_TARGETS = [
  '/.env',
  '/.env.local',
  '/.npmrc',
  '/.git/config',
  '/a/../.envrc',
  '/node_modules/plain-pkg/.env',
  '/node_modules/.npmrc'
]
// A file of an installed package, through a package manager's links too.
const PACKAGE_TARGETS = [
  '/node_modules/pkg/data.json',
  ...(canLink
    ? [
        '/node_modules/store-pkg/data.json',
        '/node_modules/workspace-pkg/data.json'
      ]
    : [])
]
const CLIMBING_TARGETS = [
  '/../outside.txt',
  '/%2e%2e/outside.txt',
  '/a/../../outside.txt'
]
const LINKED_TARGETS = canLink
  ? [
      '/linked.txt',
      '/linked-folder/inner.txt',
      '/node_modules/stray-pkg/data.json',
      '/node_modules/far-pkg/data.json'
    ]
  : []
const PROJECT_TARGETS = ['/package.json', '/extension.config.js']
const PLAIN_TARGETS = ['/data/ok.json', '/nothing.txt']
const TARGETS = [
  ...PRIVATE_TARGETS,
  ...PACKAGE_TARGETS,
  ...CLIMBING_TARGETS,
  ...LINKED_TARGETS,
  ...PROJECT_TARGETS,
  ...PLAIN_TARGETS
]

const TIMEOUT = 120_000

function packaged(files: Record<string, string>) {
  const root = project(files)

  linkPackages(root)

  return root
}

const PACKAGE_OUTPUT = PACKAGE_TARGETS.map((ref) => ref.slice(1))

// The page step applies the same rule to what it copies on its own.
const SHIPPED_FROM_A_PAGE = [
  ...PACKAGE_OUTPUT,
  'data/ok.json',
  'extension.config.js',
  'package.json'
].sort()

const MARKED_FROM_A_PAGE = ['package.json']

const MISSING_FROM_A_PAGE = [
  ...PRIVATE_TARGETS,
  ...CLIMBING_TARGETS,
  ...LINKED_TARGETS,
  '/nothing.txt'
].sort()

const times = (text: string, part: string) => text.split(part).length - 1

// Each ref is said once, in the words a missing page asset gets. The text is
// read twice over: the printed lines, then the summary that repeats them.
function expectEachSaidOnce(result: Built) {
  for (const ref of MISSING_FROM_A_PAGE) {
    expect(times(result.printed, `Update the ${ref} reference`), ref).toBe(2)
  }

  expect(
    times(result.printed, "The page references an asset that doesn't exist.")
  ).toBe(MISSING_FROM_A_PAGE.length * 2)
}

describe('a root-absolute path that names a file outside public/', () => {
  it(
    'in a link href',
    async () => {
      const links = TARGETS.map((ref) => `<link rel="preload" href="${ref}">`)
      const result = await build(
        packaged({
          'popup.html': PAGE.replace('<head>', `<head>${links.join('')}`)
        })
      )

      expect(result.shipped).toEqual(SHIPPED_FROM_A_PAGE)
      expect(result.marked).toEqual(MARKED_FROM_A_PAGE)
      expect(result.missing).toEqual(MISSING_FROM_A_PAGE)
      expect(result.errors).toBe(0)
      expectEachSaidOnce(result)
      expectNothingPrivate(result, 'printed')
    },
    TIMEOUT
  )

  it(
    'in an img src',
    async () => {
      const images = TARGETS.map((ref) => `<img src="${ref}">`)
      const result = await build(
        packaged({
          'popup.html': PAGE.replace('<body>', `<body>${images.join('')}`)
        })
      )

      expect(result.shipped).toEqual(SHIPPED_FROM_A_PAGE)
      expect(result.marked).toEqual(MARKED_FROM_A_PAGE)
      expect(result.missing).toEqual(MISSING_FROM_A_PAGE)
      expect(result.errors).toBe(0)
      expectEachSaidOnce(result)
      expectNothingPrivate(result, 'printed')
    },
    TIMEOUT
  )

  it(
    'in a url() of a stylesheet the page links',
    async () => {
      const rules = TARGETS.map(
        (ref, index) => `.c${index}{background:url(${ref})}`
      )
      const result = await build(
        packaged({
          'popup.html': PAGE.replace(
            '<head>',
            '<head><link rel="stylesheet" href="./popup.css">'
          ),
          'popup.css': rules.join('\n')
        })
      )

      // The bundler ships these, not the special folders plugin: two of a
      // name are the project's file and the one inside a package.
      const marked = [
        'assets/.env.<hash>',
        'assets/.env.<hash>',
        'assets/.env.<hash>.local',
        'assets/.envrc.<hash>',
        'assets/.npmrc.<hash>',
        'assets/.npmrc.<hash>',
        'assets/config.<hash>',
        // The two package links that lead out of the project.
        ...(canLink
          ? ['assets/data.<hash>.json', 'assets/data.<hash>.json']
          : []),
        'assets/package.<hash>.json'
      ]

      expect(result.shipped).toEqual(
        [
          ...marked,
          ...PACKAGE_TARGETS.map(() => 'assets/data.<hash>.json'),
          'assets/ok.<hash>.json',
          'extension.config.js'
        ].sort()
      )

      expect(result.marked).toEqual(marked)

      expect(result.missing).toEqual(['/nothing.txt'])
      expect(result.errors).toBe(0)
      expectNothingPrivate(result, 'printed')
    },
    TIMEOUT
  )

  it(
    'in a url() of a stylesheet public/ ships as authored',
    async () => {
      const rules = TARGETS.map(
        (ref, index) => `.c${index}{background:url(${ref})}`
      )
      const result = await build(
        packaged({
          'popup.html': PAGE.replace(
            '<head>',
            '<head><link rel="stylesheet" href="/theme.css">'
          ),
          'public/theme.css': rules.join('\n')
        })
      )

      expect(result.shipped).toEqual(
        [
          'data/ok.json',
          'extension.config.js',
          ...PACKAGE_OUTPUT,
          'package.json',
          'theme.css'
        ].sort()
      )

      expect(result.marked).toEqual(['package.json'])
      expect(result.missing).toEqual(
        [...PRIVATE_TARGETS, ...CLIMBING_TARGETS, ...LINKED_TARGETS].sort()
      )

      // In the words a dead stylesheet reference gets.
      expect(result.printed).toContain(
        'A url(/.env) reference points to a file that exists nowhere in the project.'
      )

      expect(result.errors).toBe(0)
      expectNothingPrivate(result, 'printed')
    },
    TIMEOUT
  )

  it(
    'in a manifest field',
    async () => {
      const resources = [
        {
          resources: TARGETS.filter((ref) => ref !== '/.env'),
          matches: ['<all_urls>']
        }
      ]
      const withheld = [
        ...PRIVATE_TARGETS,
        ...CLIMBING_TARGETS,
        ...LINKED_TARGETS
      ].filter((ref) => ref !== '/.env')

      // An icon the build never copies stops the build, so nothing is
      // written, the resource list included.
      const root = packaged({
        'manifest.json': manifest({
          icons: {16: '/.env'},
          web_accessible_resources: resources
        })
      })
      const stopped = await build(root)

      expect(stopped.errors).toBe(1)
      expect(stopped.shipped).toEqual([])
      expect(stopped.marked).toEqual([])
      expect(stopped.printed).toContain(
        "Can't find an icon file listed in icons."
      )

      expect(stopped.printed).toContain(`NOT FOUND ${path.join(root, '.env')}`)
      expect(stopped.printed).not.toContain(MARKER)

      // Without the icon the same resource list builds.
      const result = await build(
        packaged({
          'manifest.json': manifest({web_accessible_resources: resources})
        })
      )

      // The resource list ships only project content and names every other
      // entry as missing.
      expect(result.shipped).toEqual(
        [
          'data/ok.json',
          'extension.config.js',
          ...PACKAGE_OUTPUT,
          'package.json'
        ].sort()
      )

      expect(result.marked).toEqual(['package.json'])

      for (const ref of withheld) {
        expect(result.printed).toContain(
          `Can't find the file ${ref.slice(1)} listed in web_accessible_resources.`
        )
      }

      expect(result.errors).toBe(0)
      expectNothingPrivate(result, 'printed')
    },
    TIMEOUT
  )

  it(
    'with the same name in public/',
    async () => {
      const result = await build(
        packaged({
          'public/.env': `PRIVATE_KEY=${MARKER}-public-env\n`,
          'public/.npmrc': `# ${MARKER}-public-npmrc\n`,
          'public/theme.css':
            '.a{background:url(/.env)}\n.b{background:url(/.npmrc)}',
          'popup.html': PAGE.replace(
            '<head>',
            '<head><link rel="stylesheet" href="/theme.css"><link rel="preload" href="/.env">'
          ).replace('<body>', '<body><img src="/.npmrc">')
        })
      )

      // The copier leaves the file out, so public/ does not answer for it.
      expect(result.shipped).toEqual(['theme.css'])
      expect(result.marked).toEqual([])
      expect(result.missing).toEqual(['/.env', '/.npmrc'])
      expect(result.printed).toContain(
        'public/.env is an env file, and it is left out of the chrome build.'
      )

      for (const ref of ['/.env', '/.npmrc']) {
        expect(result.printed).toContain(
          `A url(${ref}) reference points to a file that exists nowhere in the project.`
        )
      }

      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'keeps answering for project content',
    async () => {
      const refs = [
        '/data/ok.json',
        '/.well-known/links.json',
        '/.env.example',
        '/alias.txt'
      ]
      const root = packaged({
        '.env.example': 'EXAMPLE_KEY=\n',
        '.well-known/links.json': '[]',
        'data/real.txt': 'real',
        'fonts/face.woff2': 'font',
        'img/from-css.txt': 'from css',
        'public/theme.css':
          '.a{background:url(/img/from-css.txt)}\n@font-face{src:url(/fonts/face.woff2)}',
        'popup.html': PAGE.replace(
          '<head>',
          '<head><link rel="stylesheet" href="/theme.css">' +
            refs.map((ref) => `<link rel="preload" href="${ref}">`).join('')
        )
      })

      // A link that stays inside the project is followed.
      if (canLink) {
        fs.symlinkSync(
          path.join(root, 'data', 'real.txt'),
          path.join(root, 'alias.txt')
        )
      }

      const result = await build(root)

      expect(result.shipped).toEqual(
        [
          '.env.example',
          '.well-known/links.json',
          ...(canLink ? ['alias.txt'] : []),
          'data/ok.json',
          'fonts/face.woff2',
          'img/from-css.txt',
          'theme.css'
        ].sort()
      )

      expect(result.marked).toEqual([])
      expect(result.missing).toEqual(canLink ? [] : ['/alias.txt'])

      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )
})
