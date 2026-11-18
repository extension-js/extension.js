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

const LINKED_OUTPUT = LINKED_TARGETS.map((ref) => ref.slice(1))

const PACKAGE_OUTPUT = PACKAGE_TARGETS.map((ref) => ref.slice(1))

// The page step copies these on its own, whatever this plugin decides.
const MARKED_FROM_A_PAGE = [
  '.envrc',
  ...LINKED_OUTPUT,
  'node_modules/.npmrc',
  'node_modules/plain-pkg/.env',
  'package.json'
].sort()

const SHIPPED_FROM_A_PAGE = [
  ...MARKED_FROM_A_PAGE,
  ...PACKAGE_OUTPUT,
  'data/ok.json',
  'extension.config.js'
].sort()

const MISSING_FROM_A_PAGE = [
  '/%2e%2e/outside.txt',
  '/../outside.txt',
  '/.env',
  '/.env.local',
  '/.git/config',
  '/.npmrc',
  '/a/../../outside.txt',
  '/nothing.txt'
]

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
      const result = await build(
        packaged({
          'manifest.json': manifest({
            icons: {16: '/.env'},
            web_accessible_resources: [
              {
                resources: TARGETS.filter((ref) => ref !== '/.env'),
                matches: ['<all_urls>']
              }
            ]
          })
        })
      )

      // The icons step ships the env file. The resource list ships only
      // project content and names every other entry as missing.
      expect(result.shipped).toEqual(
        [
          '.env',
          'data/ok.json',
          'extension.config.js',
          ...PACKAGE_OUTPUT,
          'package.json'
        ].sort()
      )

      expect(result.marked).toEqual(['.env', 'package.json'])

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
      // The page step drops a leading dot when it looks, so it calls the
      // two dot-names missing. They ship all the same.
      expect(result.missing).toEqual([
        '/.env.example',
        '/.well-known/links.json',
        ...(canLink ? [] : ['/alias.txt'])
      ])

      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )
})

// Each warning of a build, whole, from the summary it ends on.
function warningsOf(result: Built, root: string): string[] {
  const summary = result.printed.slice(result.printed.lastIndexOf('\n{"'))

  return (
    (JSON.parse(summary).warnings as string[])
      // A path outside the project is the one a Windows build spells
      // natively, so only what follows the holder is read with slashes.
      .map((warning) =>
        warning
          .split(path.dirname(root))
          .map((part, index) =>
            index === 0
              ? part
              : part.replace(/^\S*/, (rest) => rest.split(path.sep).join('/'))
          )
          .join('<holder>')
      )
      .sort()
  )
}

describe('a withheld root-absolute reference and a missing one', () => {
  // A path that climbs out of the extension root from either page.
  const climbing = (dir: string, ext = 'txt') =>
    `/${dir}a/${dir ? '../' : ''}../../outside.${ext}`
  const tags = (dir: string) =>
    PAGE.replace(
      '<head>',
      '<head>' +
        `<link rel="stylesheet" href="/${dir}.env.css">` +
        `<link rel="stylesheet" href="/${dir}missing.css">` +
        `<link rel="stylesheet" href="/${dir}.npmrc">` +
        `<link rel="stylesheet" href="/${dir}missing">` +
        `<script src="/${dir}.env.js"></script>` +
        `<script src="/${dir}missing.js"></script>` +
        `<link rel="stylesheet" href="${climbing(dir, 'css')}">` +
        `<script src="${climbing(dir, 'js')}"></script>`
    ).replace(
      '<body>',
      `<body><img src="${climbing(dir)}"><img src="/${dir}missing.png">`
    )

  it(
    'of the same tag, on a page the manifest names',
    async () => {
      const root = project({
        '.env.css': `a{content:"${MARKER}-css"}\n`,
        '.env.js': `globalThis.fake = "${MARKER}-js"\n`,
        'o/.env.css': `a{content:"${MARKER}-css"}\n`,
        'o/.env.js': `globalThis.fake = "${MARKER}-js"\n`,
        'o/.npmrc': `# ${MARKER}-npmrc\n`,
        'manifest.json': manifest({
          options_ui: {page: 'settings/options.html'}
        }),
        'popup.html': tags(''),
        'settings/options.html': tags('o/')
      })
      const result = await build(root)
      const hint =
        "A path starting with '/' resolves from the extension root, so the file must sit at that path in your project or in public/."
      const said = (
        code: string,
        noun: string,
        page: string,
        missing: string,
        update: string
      ) =>
        [
          `${code}The page references ${noun} that doesn't exist.`,
          `PATH ${page}`,
          `NOT FOUND ${missing}`,
          hint,
          update
        ].join('\n')
      const script = 'Update the <script> src to point to a file that exists.'
      const sheet = 'Update the <link> href to point to a file that exists.'
      const asset = (ref: string) =>
        `Update the ${ref} reference to point to a file that exists.`
      const missing = (page: string, dir: string) => [
        said(
          'E_ENTRY_NOT_FOUND: ',
          'a script file',
          page,
          `${dir}missing.js`,
          script
        ),
        said(
          'E_ENTRY_NOT_FOUND: ',
          'a stylesheet',
          page,
          `${dir}missing.css`,
          sheet
        ),
        said(
          'E_ASSET_MISSING: ',
          'an asset',
          page,
          `${dir}missing`,
          asset(`/${dir}missing`)
        ),
        said(
          'E_ASSET_MISSING: ',
          'an asset',
          page,
          `${dir}missing.png`,
          asset(`/${dir}missing.png`)
        ),
        // The page step says a climbing script and sheet itself, once.
        said(
          'E_ENTRY_NOT_FOUND: ',
          'a script file',
          page,
          '<holder>/outside.js',
          script
        ),
        said(
          'E_ENTRY_NOT_FOUND: ',
          'a stylesheet',
          page,
          '<holder>/outside.css',
          sheet
        )
      ]
      const withheld = (page: string, dir: string) => [
        said('', 'a script file', page, `${dir}.env.js`, script),
        said('', 'a stylesheet', page, `${dir}.env.css`, sheet),
        said('', 'an asset', page, `${dir}.npmrc`, asset(`/${dir}.npmrc`)),
        said('', 'an asset', page, 'outside.txt', asset(climbing(dir)))
      ]

      const warnings = warningsOf(result, root)
      // The noun and the PATH a warning opens on, without its code.
      const opening = (notFound: string) =>
        warnings
          .find((warning) => warning.includes(`NOT FOUND ${notFound}\n`))
          ?.replace(/^E_\w+: /, '')
          .split('\n')
          .slice(0, 2)

      expect(warnings).toEqual(
        [
          ...missing('popup.html', ''),
          ...missing('settings/options.html', 'o/'),
          ...withheld('popup.html', ''),
          ...withheld('settings/options.html', 'o/')
        ].sort()
      )

      // Each withheld ref opens as a missing one of the same tag.
      for (const dir of ['', 'o/']) {
        for (const [kept, absent] of [
          ['.env.js', 'missing.js'],
          ['.env.css', 'missing.css'],
          ['.npmrc', 'missing']
        ]) {
          expect(opening(`${dir}${kept}`), kept).toEqual(
            opening(`${dir}${absent}`)
          )
        }
      }

      expect(opening('outside.txt')).toEqual(opening('missing.png'))

      expect(result.errors).toBe(0)
      expectNothingPrivate(result, 'printed')
    },
    TIMEOUT
  )
})
