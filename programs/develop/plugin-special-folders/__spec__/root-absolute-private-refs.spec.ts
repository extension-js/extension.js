import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  type Built,
  build,
  canLink,
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
  '/node_modules/pkg/data.json'
]
const CLIMBING_TARGETS = [
  '/../outside.txt',
  '/%2e%2e/outside.txt',
  '/a/../../outside.txt'
]
const LINKED_TARGETS = canLink
  ? ['/linked.txt', '/linked-folder/inner.txt']
  : []
const PROJECT_TARGETS = ['/package.json', '/extension.config.js']
const PLAIN_TARGETS = ['/data/ok.json', '/nothing.txt']
const TARGETS = [
  ...PRIVATE_TARGETS,
  ...CLIMBING_TARGETS,
  ...LINKED_TARGETS,
  ...PROJECT_TARGETS,
  ...PLAIN_TARGETS
]

const TIMEOUT = 120_000

const LINKED_OUTPUT = canLink ? ['linked-folder/inner.txt', 'linked.txt'] : []

// The page step applies the same rule to what it copies on its own.
const SHIPPED_FROM_A_PAGE = [
  'data/ok.json',
  'extension.config.js',
  'package.json'
]

const MARKED_FROM_A_PAGE = ['package.json']

const MISSING_FROM_A_PAGE = [
  '/%2e%2e/outside.txt',
  '/../outside.txt',
  '/.env',
  '/.env.local',
  '/.git/config',
  '/.npmrc',
  '/a/../../outside.txt',
  '/a/../.envrc',
  ...LINKED_TARGETS,
  '/node_modules/pkg/data.json',
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
        project({
          'popup.html': PAGE.replace('<head>', `<head>${links.join('')}`)
        })
      )

      expect(result.shipped).toEqual(SHIPPED_FROM_A_PAGE)
      expect(result.marked).toEqual(MARKED_FROM_A_PAGE)
      expect(result.missing).toEqual(MISSING_FROM_A_PAGE)
      expect(result.errors).toBe(0)
      expectEachSaidOnce(result)
      expect(result.printed).not.toContain(MARKER)
    },
    TIMEOUT
  )

  it(
    'in an img src',
    async () => {
      const images = TARGETS.map((ref) => `<img src="${ref}">`)
      const result = await build(
        project({
          'popup.html': PAGE.replace('<body>', `<body>${images.join('')}`)
        })
      )

      expect(result.shipped).toEqual(SHIPPED_FROM_A_PAGE)
      expect(result.marked).toEqual(MARKED_FROM_A_PAGE)
      expect(result.missing).toEqual(MISSING_FROM_A_PAGE)
      expect(result.errors).toBe(0)
      expectEachSaidOnce(result)
      expect(result.printed).not.toContain(MARKER)
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
        project({
          'popup.html': PAGE.replace(
            '<head>',
            '<head><link rel="stylesheet" href="./popup.css">'
          ),
          'popup.css': rules.join('\n')
        })
      )

      // The bundler ships these, not the special folders plugin.
      expect(result.shipped).toEqual([
        'assets/.env.<hash>',
        'assets/.env.<hash>.local',
        'assets/.envrc.<hash>',
        'assets/.npmrc.<hash>',
        'assets/config.<hash>',
        'assets/data.<hash>.json',
        'assets/ok.<hash>.json',
        'assets/package.<hash>.json',
        'extension.config.js'
      ])

      expect(result.marked).toEqual([
        'assets/.env.<hash>',
        'assets/.env.<hash>.local',
        'assets/.envrc.<hash>',
        'assets/.npmrc.<hash>',
        'assets/config.<hash>',
        'assets/data.<hash>.json',
        'assets/package.<hash>.json'
      ])

      expect(result.missing).toEqual(['/nothing.txt'])
      expect(result.errors).toBe(0)
      expect(result.printed).not.toContain(MARKER)
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
        project({
          'popup.html': PAGE.replace(
            '<head>',
            '<head><link rel="stylesheet" href="/theme.css">'
          ),
          'public/theme.css': rules.join('\n')
        })
      )

      expect(result.shipped).toEqual([
        'data/ok.json',
        'extension.config.js',
        'package.json',
        'theme.css'
      ])

      expect(result.marked).toEqual(['package.json'])
      expect(result.missing).toEqual(
        [...PRIVATE_TARGETS, ...CLIMBING_TARGETS, ...LINKED_TARGETS].sort()
      )

      // In the words a dead stylesheet reference gets.
      expect(result.printed).toContain(
        'A url(/.env) reference points to a file that exists nowhere in the project.'
      )

      expect(result.errors).toBe(0)
      expect(result.printed).not.toContain(MARKER)
    },
    TIMEOUT
  )

  it(
    'in a manifest field',
    async () => {
      const result = await build(
        project({
          'manifest.json': manifest({
            web_accessible_resources: [
              {
                resources: TARGETS.filter((ref) => ref !== '/.env'),
                matches: ['<all_urls>']
              }
            ]
          })
        })
      )

      // The resource list ships only project content and names every other
      // entry as missing.
      expect(result.shipped).toEqual([
        'data/ok.json',
        'extension.config.js',
        'package.json'
      ])

      expect(result.marked).toEqual(['package.json'])

      for (const ref of [
        ...PRIVATE_TARGETS,
        ...CLIMBING_TARGETS,
        ...LINKED_TARGETS
      ]) {
        if (ref === '/.env') continue

        expect(result.printed).toContain(
          `Can't find the file ${ref.slice(1)} listed in web_accessible_resources.`
        )
      }

      expect(result.errors).toBe(0)
      expect(result.printed).not.toContain(MARKER)
    },
    TIMEOUT
  )

  it(
    'with the same name in public/',
    async () => {
      const result = await build(
        project({
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
      expect(result.printed).not.toContain(MARKER)
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
      const root = project({
        '.env.example': 'PRIVATE_KEY=\n',
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
    },
    TIMEOUT
  )
})
