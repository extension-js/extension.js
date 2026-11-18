import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'
import {listOutput} from './helpers/compile-harness'

// Whole builds of a fixture project: a page, a stylesheet or the manifest
// names a root-absolute path that public/ does not hold.

const holders: string[] = []

afterAll(() => {
  for (const holder of holders) {
    fs.rmSync(holder, {recursive: true, force: true})
  }
})

// Obvious fakes: no file here holds a real value.
const MARKER = 'FAKE-MARKER-NOT-A-REAL-VALUE'
const canLink = process.platform !== 'win32'

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

const PAGE = '<!doctype html><html><head></head><body></body></html>'

function manifest(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    manifest_version: 3,
    name: 'root-refs',
    version: '1.0.0',
    action: {default_popup: 'popup.html'},
    ...extra
  })
}

// The project sits one folder down, so a climbing path has a file to reach.
function project(files: Record<string, string>) {
  const holder = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-root-private-'))
  )
  holders.push(holder)

  const root = path.join(holder, 'project')
  const all: Record<string, string> = {
    '.env': `PRIVATE_KEY=${MARKER}-env\n`,
    '.env.local': `PRIVATE_KEY=${MARKER}-env-local\n`,
    '.envrc': `export PRIVATE_KEY=${MARKER}-envrc\n`,
    '.npmrc': `# ${MARKER}-npmrc\n`,
    '.git/config': `# ${MARKER}-git\n`,
    'package.json': JSON.stringify({
      name: 'root-refs',
      version: '1.0.0',
      private: true,
      description: `${MARKER}-package`
    }),
    'extension.config.js': 'export default {}\n',
    'node_modules/pkg/data.json': `{"value":"${MARKER}-node-modules"}`,
    'a/keep.txt': 'keep',
    'data/ok.json': '{"ok":true}',
    'manifest.json': manifest(),
    'popup.html': PAGE,
    ...files
  }

  for (const [relative, contents] of Object.entries(all)) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, contents)
  }

  fs.writeFileSync(path.join(holder, 'outside.txt'), `${MARKER}-outside\n`)
  fs.mkdirSync(path.join(holder, 'outside-folder'))
  fs.writeFileSync(
    path.join(holder, 'outside-folder', 'inner.txt'),
    `${MARKER}-outside-folder\n`
  )

  if (canLink) {
    fs.symlinkSync(
      path.join(holder, 'outside.txt'),
      path.join(root, 'linked.txt')
    )

    fs.symlinkSync(
      path.join(holder, 'outside-folder'),
      path.join(root, 'linked-folder')
    )
  }

  return root
}

const ESC = String.fromCharCode(27)
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')

// A bundled asset carries a content hash in its name.
const withoutHash = (name: string) =>
  name.replace(/\.[0-9a-f]{8}(?=\.|$)/, '.<hash>')

interface Built {
  // Every file in the output folder but the page and the manifest.
  shipped: string[]
  // The files that carry a marker, which no build should hold.
  marked: string[]
  // The refs a warning or an error names as missing.
  missing: string[]
  printed: string
  errors: number
}

async function build(root: string): Promise<Built> {
  const {extensionBuild} = await import('../../command-build')
  const lines: string[] = []

  const keep = (...parts: unknown[]) => {
    lines.push(parts.map(String).join(' '))
  }

  const write = (chunk: unknown) => {
    lines.push(String(chunk))

    return true
  }

  const spies = [
    vi.spyOn(console, 'log').mockImplementation(keep),
    vi.spyOn(console, 'info').mockImplementation(keep),
    vi.spyOn(console, 'warn').mockImplementation(keep),
    vi.spyOn(console, 'error').mockImplementation(keep),
    vi.spyOn(process.stdout, 'write').mockImplementation(write),
    vi.spyOn(process.stderr, 'write').mockImplementation(write)
  ]
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: false,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)
    const out = listOutput(path.join(root, 'dist', 'chrome'))
    const printed = [lines.join('\n'), JSON.stringify(summary)]
      .join('\n')
      .replace(ANSI, '')
    const missing = new Set<string>()

    for (const match of printed.matchAll(
      /Update the (\/\S+) reference to point|A url\((\/[^)]+)\) reference points to a file that exists nowhere/g
    )) {
      missing.add(match[1] || match[2])
    }

    return {
      shipped: Object.keys(out)
        .filter((name) => !/^(?:action\/index\.\w+|manifest\.json)$/.test(name))
        .map(withoutHash)
        .sort(),
      marked: Object.keys(out)
        .filter((name) => out[name].includes(MARKER))
        .map(withoutHash)
        .sort(),
      missing: [...missing].sort(),
      printed,
      errors: Number(summary?.errors_count ?? -1)
    }
  } finally {
    for (const spy of spies) spy.mockRestore()

    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

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

      // The manifest features ship these, not the special folders plugin.
      expect(result.shipped).toEqual(
        [
          '.env.local',
          '.envrc',
          '.git/config',
          '.npmrc',
          'assets/outside.<hash>.txt',
          'data/ok.json',
          'extension.config.js',
          ...LINKED_OUTPUT,
          'node_modules/pkg/data.json',
          'package.json'
        ].sort()
      )

      expect(result.marked).toEqual(
        [
          '.env.local',
          '.envrc',
          '.git/config',
          '.npmrc',
          'assets/outside.<hash>.txt',
          ...LINKED_OUTPUT,
          'node_modules/pkg/data.json',
          'package.json'
        ].sort()
      )

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
