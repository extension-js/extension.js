import * as fs from 'node:fs'
import * as path from 'node:path'
import {beforeAll, describe, expect, it, vi} from 'vitest'
import {buildProject} from '../../../__spec__/helpers/build-project'
import {
  type Built,
  build,
  expectNothingPrivate,
  expectNoWorkspaceAboveTemp,
  manifest,
  notFoundPaths,
  project
} from '../../../plugin-special-folders/__spec__/helpers/private-files-project'

// Whole production builds: an entry the build copies nothing for is named
// in a warning, and the manifest in the output folder does not list it.

beforeAll(expectNoWorkspaceAboveTemp)

const TIMEOUT = 120_000
const KEPT_MATCHES = 'https://kept.example/*'
const DROPPED_MATCHES = 'https://dropped.example/*'

const SHAPES = [
  ['chrome', 3],
  ['chrome', 2],
  ['firefox', 3],
  ['firefox', 2]
] as const

type Version = (typeof SHAPES)[number][1]

function declare(version: Version, resources: string[]) {
  return version === 3
    ? manifest({
        web_accessible_resources: [{resources, matches: [KEPT_MATCHES]}]
      })
    : manifest({
        manifest_version: 2,
        action: undefined,
        browser_action: {default_popup: 'popup.html'},
        web_accessible_resources: resources
      })
}

function written(root: string, browser: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(root, 'dist', browser, 'manifest.json'), 'utf8')
  )
}

// How often the build said the entry: its lines, then its summary.
function said(result: Built, entry: string) {
  const sentence = `Can't find the file ${entry} listed in web_accessible_resources.`

  return {
    printed: result.printed.split(sentence).length - 1,
    coded: result.printed.split(`W_ASSET_MISSING: ${sentence}`).length - 1
  }
}

describe.each(
  SHAPES
)('a refused web_accessible_resources entry, %s manifest version %i', (browser, version) => {
  it(
    'with a private file name is dropped, and the entry beside it stays',
    async () => {
      const root = project({
        'manifest.json': declare(version, ['.env', 'data/ok.json'])
      })
      const result = await build(root, browser)

      expect(written(root, browser).web_accessible_resources).toEqual(
        version === 3
          ? [{matches: [KEPT_MATCHES], resources: ['data/ok.json']}]
          : ['data/ok.json']
      )

      expect(result.shipped).toEqual(['data/ok.json'])
      expect(said(result, '.env')).toEqual({printed: 2, coded: 1})
      // The path is the project's own, in the lines and in the summary.
      expect(notFoundPaths(result.printed)).toEqual(['.env'])
      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'that is the only entry leaves no key behind',
    async () => {
      const root = project({'manifest.json': declare(version, ['.env'])})
      const result = await build(root, browser)

      expect(written(root, browser)).not.toHaveProperty(
        'web_accessible_resources'
      )

      expect(result.shipped).toEqual([])
      expect(said(result, '.env')).toEqual({printed: 2, coded: 1})
      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'naming a file above the project prints the path from the project',
    async () => {
      const root = project({
        'manifest.json': declare(version, ['../outside.txt', 'data/ok.json'])
      })
      const result = await build(root, browser)

      expect(written(root, browser).web_accessible_resources).toEqual(
        version === 3
          ? [{matches: [KEPT_MATCHES], resources: ['data/ok.json']}]
          : ['data/ok.json']
      )

      expect(said(result, '../outside.txt')).toEqual({printed: 2, coded: 1})
      expect(notFoundPaths(result.printed)).toEqual(['../outside.txt'])
      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'that climbs out of the root stays refused beside a file of its name',
    async () => {
      const root = project({
        'outside.txt': 'a file of the project\n',
        'manifest.json': declare(version, ['/../outside.txt'])
      })
      const result = await build(root, browser)

      expect(written(root, browser)).not.toHaveProperty(
        'web_accessible_resources'
      )

      expect(result.shipped).toEqual([])
      expect(said(result, '../outside.txt')).toEqual({printed: 2, coded: 1})
      expect(said(result, '/../outside.txt').printed).toBe(0)
      expect(result.printed).not.toContain('To reference files in public/')
      expect(notFoundPaths(result.printed)).toEqual(['../outside.txt'])
      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )
})

describe('a web_accessible_resources entry that names no file', () => {
  it(
    'is dropped, and its warning prints the path from the project',
    async () => {
      const root = project({
        'manifest.json': declare(3, ['data/nothing.txt', 'data/ok.json'])
      })
      const result = await build(root)

      expect(written(root, 'chrome').web_accessible_resources).toEqual([
        {matches: [KEPT_MATCHES], resources: ['data/ok.json']}
      ])

      expect(said(result, 'data/nothing.txt')).toEqual({printed: 2, coded: 1})
      expect(notFoundPaths(result.printed)).toEqual(['data/nothing.txt'])
      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )
})

describe.each([
  'public/nothing.txt',
  '/nothing.txt'
])('a web_accessible_resources entry %s that public/ does not hold', (entry) => {
  it(
    'is named in public/ as written, from the project, with the public hint',
    async () => {
      const root = project({
        'manifest.json': declare(3, [entry, 'data/ok.json'])
      })
      const result = await build(root)

      expect(said(result, entry)).toEqual({printed: 2, coded: 1})
      expect(said(result, 'nothing.txt').printed).toBe(0)
      expect(notFoundPaths(result.printed)).toEqual(['public/nothing.txt'])
      expect(result.printed).toContain('To reference files in public/')
      expect(result.printed).toContain('Add the file to public/')
      expect(result.printed).not.toContain(
        'Relative paths must point to a real source file'
      )

      // The summary holds the one warning, with no path of the machine.
      const {warnings} = JSON.parse(result.printed.split('\n').at(-1) || '{}')

      expect(warnings).toHaveLength(1)
      expect(warnings[0]).not.toContain(root)
      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )
})

// A development build with no session: the manifest it writes, and whether
// the build said the entry.
async function developmentBuild(root: string) {
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

  try {
    const summary = await buildProject(root, {
      silent: false,
      mode: 'development',
      exitOnError: false
    })

    return {
      printed: [lines.join('\n'), JSON.stringify(summary)].join('\n'),
      errors: Number((summary as {errors_count?: number}).errors_count ?? -1)
    }
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

// The resources of the manifest a build wrote, as one flat list.
function listed(root: string): string[] {
  const war = written(root, 'chrome').web_accessible_resources as
    | Array<string | {resources: string[]}>
    | undefined

  return (war || []).flatMap((entry) =>
    typeof entry === 'string' ? [entry] : entry.resources
  )
}

describe.each([
  3, 2
] as const)('a development build of a version %i manifest', (version) => {
  it(
    'drops a private file name and keeps the entry beside it',
    async () => {
      const root = project({
        'manifest.json': declare(version, ['.env', 'data/ok.json'])
      })
      const result = await developmentBuild(root)

      expect(listed(root)).toContain('data/ok.json')
      expect(listed(root)).not.toContain('.env')
      expect(result.printed).toContain(
        "Can't find the file .env listed in web_accessible_resources."
      )

      expect(notFoundPaths(result.printed)).toEqual(['.env'])
      expect(result.errors).toBe(0)
    },
    TIMEOUT
  )

  it(
    'lists no private file name that was the only entry',
    async () => {
      const root = project({'manifest.json': declare(version, ['.env'])})
      const result = await developmentBuild(root)

      expect(listed(root)).not.toContain('.env')
      expect(result.printed).toContain(
        "Can't find the file .env listed in web_accessible_resources."
      )

      expect(result.errors).toBe(0)
    },
    TIMEOUT
  )
})

describe('a development build with a public/ entry that public/ does not hold', () => {
  it(
    'names the missing file, as a production build does',
    async () => {
      const root = project({
        'manifest.json': declare(3, ['/nothing.txt', 'data/ok.json'])
      })
      const result = await developmentBuild(root)

      expect(listed(root)).toContain('data/ok.json')
      expect(listed(root)).not.toContain('nothing.txt')
      expect(result.printed).toContain('nothing.txt')
      expect(result.errors).toBe(0)
    },
    TIMEOUT
  )
})

describe.each([
  'chrome',
  'firefox'
] as const)('a version 3 group on %s', (browser) => {
  it(
    'whose every entry is refused is dropped, and the other group stays',
    async () => {
      const root = project({
        'manifest.json': manifest({
          web_accessible_resources: [
            {
              resources: ['.env', '../outside.txt'],
              matches: [DROPPED_MATCHES]
            },
            {resources: ['data/ok.json'], matches: [KEPT_MATCHES]}
          ]
        })
      })
      const result = await build(root, browser)

      expect(written(root, browser).web_accessible_resources).toEqual([
        {matches: [KEPT_MATCHES], resources: ['data/ok.json']}
      ])

      expect(said(result, '.env')).toEqual({printed: 2, coded: 1})
      expect(said(result, '../outside.txt')).toEqual({printed: 2, coded: 1})
      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )
})
