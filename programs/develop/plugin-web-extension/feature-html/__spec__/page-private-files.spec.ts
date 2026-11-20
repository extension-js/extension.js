import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {fileNotFound} from '../html-lib/messages'
import {getAssetsFromHtml} from '../html-lib/utils'
import {
  build,
  canLink,
  expectNothingPrivate,
  MARKER,
  makeProject,
  missingRefs,
  notFoundCopies,
  notFoundPaths,
  PAGE,
  PUBLIC_OUTPUT,
  pageNotBundledRefs
} from './helpers/private-files-project'

// Whole builds of a fixture project whose page names files a build never
// copies, and dot-named files in public/ that it does.

const TIMEOUT = 120_000

const LINKED = canLink ? ['/linked.txt', '/linked-folder/inner.txt'] : []

const WITHHELD = [
  '/.env',
  '/.env.local',
  '/.npmrc',
  '/.git/config',
  '/a/../.envrc',
  '/node_modules/pkg/.env',
  '/%2Eenv',
  ...LINKED
]

const KEPT = [
  '/.well-known/links.json',
  '/.env.example',
  '/logo.png',
  '/data/ok.json',
  '/node_modules/pkg/icon.png'
]

const KEPT_OUTPUT = [
  ...PUBLIC_OUTPUT,
  'data/ok.json',
  'node_modules/pkg/icon.png'
].sort()

type Writer = (refs: string[]) => {head?: string; body?: string}

const ATTRIBUTES: Array<[string, Writer]> = [
  [
    'a link href',
    (refs) => ({
      head: refs.map((ref) => `<link rel="preload" href="${ref}">`).join('')
    })
  ],
  [
    'an img src',
    (refs) => ({body: refs.map((ref) => `<img src="${ref}">`).join('')})
  ],
  [
    'an img srcset',
    (refs) => ({body: refs.map((ref) => `<img srcset="${ref} 2x">`).join('')})
  ],
  [
    'a video poster',
    (refs) => ({
      body: refs.map((ref) => `<video poster="${ref}"></video>`).join('')
    })
  ],
  [
    'a source src',
    (refs) => ({
      body: `<audio>${refs.map((ref) => `<source src="${ref}">`).join('')}</audio>`
    })
  ]
]

function page(parts: {head?: string; body?: string}) {
  return PAGE.replace('<head>', `<head>${parts.head || ''}`).replace(
    '<body>',
    `<body>${parts.body || ''}`
  )
}

describe('a page that names a file the build never copies', () => {
  it.each(ATTRIBUTES)(
    'leaves it out and says it is not bundled, in %s',
    async (_label, write) => {
      const project = makeProject()
      const {root} = project
      // An address on this machine is not a path inside the extension.
      const refs = [...WITHHELD, project.outsideFile, ...KEPT]
      fs.writeFileSync(path.join(root, 'popup.html'), page(write(refs)))

      const result = await build(root)

      expect(result.marked).toEqual([])
      expect(result.shipped).toEqual(KEPT_OUTPUT)
      // Only a name with no file behind it is missing.
      expect(result.missing).toEqual(['/%2Eenv'])
      expect(pageNotBundledRefs(result.printed)).toEqual(
        [
          ...WITHHELD.filter((ref) => ref !== '/%2Eenv'),
          project.outsideFile
        ].sort()
      )

      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'leaves it out when the page names it by a relative path',
    async () => {
      const refs = [
        './.envrc',
        '.npmrc',
        'node_modules/pkg/.env',
        ...(canLink ? ['./linked.txt'] : []),
        './data/ok.json',
        './node_modules/pkg/icon.png'
      ]
      const {root} = makeProject({
        'popup.html': page({
          body: refs.map((ref) => `<img src="${ref}">`).join('')
        })
      })
      const result = await build(root)

      expect(result.marked).toEqual([])
      expect(result.shipped).toEqual(
        [
          ...PUBLIC_OUTPUT,
          'assets/icon.<hash>.png',
          'assets/ok.<hash>.json'
        ].sort()
      )

      // The terminal names a file in full, and the JSON summary names it
      // from the project root.
      expect(notFoundCopies(result.printed)).toEqual({
        terminal: [
          path.join(root, '.envrc'),
          path.join(root, '.npmrc'),
          path.join(root, 'node_modules/pkg/.env'),
          ...(canLink ? [path.join(root, 'linked.txt')] : [])
        ].sort(),
        summary: [
          '.envrc',
          '.npmrc',
          ...(canLink ? ['linked.txt'] : []),
          'node_modules/pkg/.env'
        ]
      })

      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'leaves it out when a page that another page embeds names it',
    async () => {
      const refs = [
        './.envrc',
        './node_modules/pkg/data.json',
        './data/ok.json'
      ]
      const {root} = makeProject({
        'popup.html': page({body: '<iframe src="./inner.html"></iframe>'}),
        'inner.html': page({
          body: refs.map((ref) => `<img src="${ref}">`).join('')
        })
      })
      const result = await build(root)

      expect(result.marked).toEqual([])
      expect(result.shipped).toContain('assets/ok.<hash>.json')
      expect(result.shipped).toContain('assets/data.<hash>.json')
      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'names the path with its leading dot',
    async () => {
      const {root} = makeProject({
        'popup.html': page({body: '<img src="/.env"><img src="/.missing">'})
      })
      const result = await build(root)

      expect(notFoundCopies(result.printed)).toEqual({
        terminal: [path.join(root, '.env'), path.join(root, '.missing')],
        summary: ['.env', '.missing']
      })

      expect(result.marked).toEqual([])
    },
    TIMEOUT
  )

  it(
    'leaves out an env name with an image ending, at the root and below',
    async () => {
      const {root} = makeProject({
        '.env.png': `PRIVATE_KEY=${MARKER}-env-png\n`,
        'sub/.env.png': `PRIVATE_KEY=${MARKER}-sub-env-png\n`,
        'public/sub/.env.png': `PRIVATE_KEY=${MARKER}-public-env-png\n`,
        'popup.html': page({
          body: '<img src="/sub/.env.png"><img src="/.env.png">'
        })
      })
      const result = await build(root)

      expect(result.marked).toEqual([])
      expect(result.shipped).toEqual(PUBLIC_OUTPUT)
      expect(result.missing).toEqual([])
      expect(pageNotBundledRefs(result.printed)).toEqual([
        '/.env.png',
        '/sub/.env.png'
      ])

      expect(notFoundCopies(result.printed)).toEqual({
        terminal: [
          path.join(root, '.env.png'),
          path.join(root, 'sub/.env.png')
        ],
        summary: ['.env.png', 'sub/.env.png']
      })

      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'names an env name with an image ending with its leading dot',
    async () => {
      const {root} = makeProject({
        'popup.html': page({body: '<img src="/.env.png">'})
      })
      const result = await build(root)

      expect(result.missing).toEqual(['/.env.png'])
      expect(notFoundCopies(result.printed)).toEqual({
        terminal: [path.join(root, '.env.png')],
        summary: ['.env.png']
      })

      expect(result.marked).toEqual([])
    },
    TIMEOUT
  )

  it(
    'leaves out the same name in public/ and says so',
    async () => {
      const {root} = makeProject({
        'public/.env': `PRIVATE_KEY=${MARKER}-public-env\n`,
        'public/.npmrc': `# ${MARKER}-public-npmrc\n`,
        'popup.html': page({
          body: '<img src="/.env"><img src="/public/.npmrc"><img src="./public/.env">'
        })
      })
      const result = await build(root)

      expect(result.marked).toEqual([])
      expect(result.shipped).toEqual(PUBLIC_OUTPUT)

      expect(result.missing).toEqual([])
      expect(pageNotBundledRefs(result.printed)).toEqual([
        './public/.env',
        '/.env',
        '/public/.npmrc'
      ])

      expectNothingPrivate(result)
    },
    TIMEOUT
  )
})

describe('a page that names a dot-named file public/ ships', () => {
  it(
    'finds it and reports nothing',
    async () => {
      const {root} = makeProject({
        'popup.html': page({
          head: '<link rel="preload" href="/.well-known/links.json">',
          body: '<img src="/.env.example"><img src="/logo.png">'
        })
      })
      const result = await build(root)

      expect(result.shipped).toEqual(PUBLIC_OUTPUT)

      expect(result.missing).toEqual([])
      expect(notFoundPaths(result.printed)).toEqual([])
      expect(result.printed).not.toContain("doesn't exist")
      expect(result.errors).toBe(0)
    },
    TIMEOUT
  )
})

// What a Windows runner writes, read on every platform: a drive letter is
// not a URL scheme, and a `\n` inside a path is not a line break.
const WINDOWS_OUTSIDE =
  'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\holder\\outside.txt'
const WINDOWS_PAGE = 'C:\\Users\\RUNNER~1\\Temp\\holder\\project\\popup.html'

describe('a page ref written as a Windows machine path', () => {
  const spellings = [
    WINDOWS_OUTSIDE,
    'C:/Users/runneradmin/Temp/holder/outside.txt',
    'c:\\temp\\holder\\outside.txt'
  ]

  it.each(ATTRIBUTES)('is a file to look up, in %s', (_label, write) => {
    const assets = getAssetsFromHtml(
      '/project/popup.html',
      page(write(spellings))
    )

    expect(assets.static).toEqual(spellings)
    expect(Object.values(assets.authored || {})).toEqual(spellings)
  })

  it('leaves an address with a scheme alone', () => {
    const assets = getAssetsFromHtml(
      '/project/popup.html',
      page({
        body: '<img src="chrome-extension://abc/x.png"><img src="data:image/png;base64,AA==">'
      })
    )

    expect(assets.static).toEqual([])
  })

  it('is named once as missing, in the line and in its JSON copy', () => {
    const file = `${path.win32.dirname(WINDOWS_PAGE)}\\node_modules\\pkg\\.env`
    const message = [
      fileNotFound(WINDOWS_PAGE, WINDOWS_OUTSIDE, {refLabel: WINDOWS_OUTSIDE}),
      fileNotFound(WINDOWS_PAGE, file, {refLabel: './node_modules/pkg/.env'})
    ]
      .join('\n')
      .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
    const printed = `${message}\n${JSON.stringify({diagnostics: [{message}]})}`

    expect(notFoundPaths(printed)).toEqual([WINDOWS_OUTSIDE, file].sort())
    expect(missingRefs(printed)).toEqual([WINDOWS_OUTSIDE])
  })
})
