import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  type DevWatchSession,
  errorsOf,
  openDevWatchSession,
  waitUntil
} from '../../../__spec__/helpers/dev-watch-session'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {
  build,
  makeProject,
  manifest,
  notFoundPaths,
  outputHolding
} from './helpers/private-files-project'
import {writeExtensionProject} from '../../../__spec__/helpers/extension-project'

// A real rspack watch over a popup that embeds a second page. The second
// page names a script, a stylesheet and an image, which ship as plain copies.
const tempFolder = trackTempFolders()
const PRIVATE_MARK = 'FAKE-MARKER-NOT-A-REAL-VALUE-nested-env'
let root = ''
let session: DevWatchSession

const KINDS = [
  ['script', 'inner.js', (n: number) => `console.log("inner-script-${n}")\n`],
  ['stylesheet', 'inner.css', (n: number) => `body{--inner-sheet:${n}}\n`],
  ['image', 'inner.png', (n: number) => `inner-image-bytes-${n}\n`]
] as const

const innerPage = `<!doctype html><html><head><link rel="stylesheet" href="./inner.css"></head><body><img src="./inner.png"><img src="./later.png"><img src="./.env"><img src="./.env.local"><script src="./inner.js"></script></body></html>\n`

const popupPage = (heading: string) =>
  `<!doctype html><html><head></head><body><h1>${heading}</h1><iframe src="./inner.html"></iframe><img src="./logo.png"><script src="./main.js"></script></body></html>\n`

const source = (name: string) => path.join(root, 'popup', name)
const write = (name: string, contents: string) =>
  fs.writeFileSync(source(name), contents)

// The copies of one source file in the output: `assets/<name>.<hash><ext>`.
function copiesOf(name: string): string[] {
  const assets = path.join(session.distPath, 'assets')
  const ext = path.extname(name)
  const base = path.basename(name, ext)

  if (!fs.existsSync(assets)) return []

  return fs
    .readdirSync(assets)
    .filter((file) => file.startsWith(`${base}.`) && file.endsWith(ext))
    .sort()
}

const copyHolding = (name: string, contents: string) =>
  copiesOf(name).filter(
    (file) =>
      fs.readFileSync(path.join(session.distPath, 'assets', file), 'utf8') ===
      contents
  )

// What a shipped page names for one source file, under either of its names.
function shippedRefs(distPath: string, pageName: string, name: string) {
  const html = fs.readFileSync(path.join(distPath, pageName), 'utf8')
  const ext = path.extname(name)
  const base = path.basename(name, ext)

  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((ref) => {
      const file = path.posix.basename(ref)

      return file.startsWith(`${base}.`) && file.endsWith(ext)
    })
}

const innerRefs = (name: string) =>
  shippedRefs(session.distPath, 'assets/popup/inner.html', name)

// Saves one file and returns the rebuild that follows, or fails after thirty
// seconds when the watcher never heard about the file.
async function saveAndRebuild(name: string, contents: string) {
  const seen = await session.settle()
  write(name, contents)

  return session.doneAfter(seen)
}

beforeAll(async () => {
  root = fs.realpathSync(tempFolder('extjs-nested-refs-'))
  fs.mkdirSync(path.join(root, 'popup'))

  writeExtensionProject(root, {
    name: 'nested-refs',
    manifest: {action: {default_popup: 'popup/index.html'}}
  })

  write('index.html', popupPage('one'))
  write('main.js', "console.log('popup')\n")
  write('logo.png', 'logo-bytes-1\n')
  write('inner.html', innerPage)
  write('.env', `PRIVATE_KEY=${PRIVATE_MARK}\n`)
  for (const [, name, bytes] of KINDS) write(name, bytes(1))

  session = await openDevWatchSession(root)
  await session.settle()
}, 120000)

afterAll(async () => {
  await session?.close()
})

describe('the files a page inside a page references, in a watch session', () => {
  // The image is left out: its reference already named the copy.
  it.each(
    KINDS.filter(([kind]) => kind !== 'image')
  )('ships the %s under the name the nested page asks for', (_kind, name, bytes) => {
    const [copy] = copyHolding(name, bytes(1))

    expect(copiesOf(name)).toEqual([copy])
    expect(innerRefs(name)).toEqual([`/assets/${copy}`])
  })

  it.each(KINDS)(
    'rebuilds when the %s is edited and the nested page names the new copy',
    async (_kind, name, bytes) => {
      const stats = await saveAndRebuild(name, bytes(2))

      expect(errorsOf(stats)).toEqual([])
      await waitUntil(() => copyHolding(name, bytes(2)).length === 1, 10000)

      const [copy] = copyHolding(name, bytes(2))

      expect(copy).toMatch(/^inner\.[0-9a-f]{8}\.(?:js|css|png)$/)
      expect(innerRefs(name)).toEqual([`/assets/${copy}`])
    },
    90000
  )

  it.each(KINDS)(
    'leaves one copy of the %s once a rebuild supersedes it',
    async (_kind, name, bytes) => {
      const before = copiesOf(name)
      const seen = await session.settle()

      // The popup is saved too, so the rebuild does not rest on the nested
      // file being watched.
      write(name, bytes(3))
      write('index.html', popupPage(`after ${name}`))
      await session.doneAfter(seen)
      await waitUntil(() => copyHolding(name, bytes(3)).length === 1, 10000)

      expect(before).toHaveLength(1)
      expect(copiesOf(name)).toEqual(copyHolding(name, bytes(3)))
      expect(copiesOf(name)).not.toEqual(before)
    },
    90000
  )

  it.each(KINDS)(
    'rebuilds when the %s is deleted and removes its copy',
    async (_kind, name, bytes) => {
      const seen = await session.settle()
      fs.rmSync(source(name))

      const gone = await session.doneAfter(seen)

      expect(errorsOf(gone)).toEqual([])
      await waitUntil(() => copiesOf(name).length === 0, 10000)
      expect(copiesOf(name)).toEqual([])

      // A file that is not there is watched too, so writing it rebuilds,
      // also under the first name, which an earlier rebuild had removed.
      const back = await saveAndRebuild(name, bytes(1))

      expect(errorsOf(back)).toEqual([])
      await waitUntil(() => copyHolding(name, bytes(1)).length === 1, 10000)
      expect(copiesOf(name)).toEqual(copyHolding(name, bytes(1)))
      expect(copiesOf(name)).toHaveLength(1)
    },
    90000
  )

  it('rebuilds when a file the nested page names is created', async () => {
    expect(copiesOf('later.png')).toEqual([])

    const stats = await saveAndRebuild('later.png', 'later-bytes\n')

    expect(errorsOf(stats)).toEqual([])
    await waitUntil(() => copiesOf('later.png').length === 1, 10000)
    expect(copyHolding('later.png', 'later-bytes\n')).toHaveLength(1)
    expect(innerRefs('later.png')).toEqual([
      `/assets/${copiesOf('later.png')[0]}`
    ])
  }, 90000)

  it('watches what ships and never a private file the nested page names', async () => {
    const stats = await saveAndRebuild('index.html', popupPage('watched'))
    const watched = new Set([...stats.compilation.fileDependencies])
    const awaited = new Set([...stats.compilation.missingDependencies])

    for (const name of ['inner.html', 'inner.js', 'inner.css', 'inner.png']) {
      expect(watched.has(source(name)), name).toBe(true)
    }

    expect(watched.has(source('.env'))).toBe(false)
    expect(awaited.has(source('.env'))).toBe(false)
    expect(awaited.has(source('.env.local'))).toBe(false)
    expect(outputHolding(root, PRIVATE_MARK)).toEqual([])

    // A save of the private file is not heard, so nothing is rebuilt for it.
    const seen = await session.settle()
    write('.env', `PRIVATE_KEY=${PRIVATE_MARK}-edited\n`)

    expect(await session.quietFor(2000)).toBe(seen)
    expect(outputHolding(root, PRIVATE_MARK)).toEqual([])
  }, 90000)

  it('removes the nested page and its copies once the popup stops naming it', async () => {
    expect(copiesOf('inner.js')).toHaveLength(1)

    const stats = await saveAndRebuild(
      'index.html',
      popupPage('alone').replace('<iframe src="./inner.html"></iframe>', '')
    )

    expect(errorsOf(stats)).toEqual([])
    await waitUntil(() => copiesOf('inner.js').length === 0, 10000)

    for (const [, name] of KINDS) expect(copiesOf(name), name).toEqual([])

    expect(
      fs.existsSync(path.join(session.distPath, 'assets/popup/inner.html'))
    ).toBe(false)

    // The popup's own image is still named, so its copy stays.
    expect(copyHolding('logo.png', 'logo-bytes-1\n')).toHaveLength(1)
  }, 90000)
})

describe('an image the popup itself references, in a watch session', () => {
  it('rebuilds when it is edited and leaves one copy', async () => {
    const before = copiesOf('logo.png')
    const stats = await saveAndRebuild('logo.png', 'logo-bytes-2\n')

    expect(errorsOf(stats)).toEqual([])
    await waitUntil(
      () => copyHolding('logo.png', 'logo-bytes-2\n').length === 1,
      10000
    )

    expect(before).toHaveLength(1)
    expect(copiesOf('logo.png')).toEqual(
      copyHolding('logo.png', 'logo-bytes-2\n')
    )

    expect(
      shippedRefs(session.distPath, 'action/index.html', 'logo.png')
    ).toEqual([`/assets/${copiesOf('logo.png')[0]}`])
  }, 90000)
})

describe('the files a page inside a page references, in a production build', () => {
  it.each([
    [
      'script',
      'inner.js',
      '<script src="./inner.js"></script>',
      (mark: string) => `console.log("${mark}")\n`
    ],
    [
      'stylesheet',
      'inner.css',
      '<link rel="stylesheet" href="./inner.css">',
      (mark: string) => `body::after{content:"${mark}"}\n`
    ]
  ] as const)(
    'ships the %s under the name the nested page asks for',
    async (_kind, name, tag, contents) => {
      const mark = `nested-production-${name}`
      const {root: project} = makeProject({
        'popup.html':
          '<!doctype html><html><head></head><body><iframe src="./inner.html"></iframe></body></html>',
        'inner.html': `<!doctype html><html><head></head><body>${tag}</body></html>`,
        [name]: contents(mark)
      })
      const result = await build(project)
      const [copy] = outputHolding(project, mark)

      expect(result.errors).toBe(0)
      expect(outputHolding(project, mark)).toHaveLength(1)
      expect(copy).toMatch(/^assets\/inner\.[0-9a-f]{8}\.(?:js|css)$/)
      expect(
        shippedRefs(
          path.join(project, 'dist', 'chrome'),
          'assets/inner.html',
          name
        )
      ).toEqual([`/${copy}`])
    },
    90000
  )
})

describe('a file a page inside a page names, in a production build', () => {
  const page = (body: string) => ({
    'popup.html':
      '<!doctype html><html><head></head><body><iframe src="./inner.html"></iframe></body></html>',
    'inner.html': `<!doctype html><html><head></head><body>${body}</body></html>`
  })

  const MISSING = [
    [
      'script',
      'gone.js',
      '<script src="./gone.js"></script>',
      'W_ENTRY_NOT_FOUND'
    ],
    [
      'stylesheet',
      'gone.css',
      '<link rel="stylesheet" href="./gone.css">',
      'W_ENTRY_NOT_FOUND'
    ],
    ['image', 'gone.png', '<img src="./gone.png">', 'W_ASSET_MISSING']
  ] as const

  it.each(MISSING)(
    'warns about a missing %s under its code',
    async (_kind, name, tag, code) => {
      const {root: project} = makeProject(page(tag))
      const result = await build(project)

      expect(result.errors).toBe(0)
      expect(notFoundPaths(result.printed)).toContain(path.join(project, name))
      expect(result.printed).toContain(`${code}: The page references`)
    },
    90000
  )

  it('fails on a missing file under strict refs', async () => {
    const {root: project} = makeProject(page('<img src="./gone.png">'))
    const previous = process.env.EXTENSION_STRICT_REFS
    process.env.EXTENSION_STRICT_REFS = 'true'

    try {
      const result = await build(project)

      expect(result.errors).toBe(1)
      expect(notFoundPaths(result.printed)).toContain(
        path.join(project, 'gone.png')
      )
    } finally {
      if (previous === undefined) delete process.env.EXTENSION_STRICT_REFS
      else process.env.EXTENSION_STRICT_REFS = previous
    }
  }, 90000)

  it('says a private file it names is not bundled, under the code of a missing one', async () => {
    const {root: project} = makeProject(page('<img src="./.env">'))
    const result = await build(project)

    expect(result.errors).toBe(0)
    expect(result.printed).toContain(
      'W_ASSET_MISSING: ./.env is not bundled. Check the tag that names it in this page.'
    )

    expect(result.printed).not.toContain('asset that doesn')
  }, 90000)
})

describe('an import in a script of a page inside a page, in a production build', () => {
  const MODULE_PAGE = {
    'popup.html':
      '<!doctype html><html><head></head><body><iframe src="./inner.html"></iframe></body></html>',
    'inner.html':
      '<!doctype html><html><head></head><body><script type="module" src="./inner.js"></script></body></html>'
  }

  const importWarnings = (printed: string) =>
    printed
      .split('\n')
      .filter((line) => line.includes('A script of this page imports'))
      .map((line) => line.replace(/^\S+\s+/, ''))

  // The terminal lines, then the JSON summary that closes the output.
  const terminalOf = (printed: string) =>
    printed.slice(0, printed.lastIndexOf('\n{"'))
  const summaryWarnings = (printed: string): string[] =>
    JSON.parse(printed.slice(printed.lastIndexOf('\n{"') + 1)).warnings

  const withStrictRefs = async <T>(run: () => Promise<T>) => {
    const previous = process.env.EXTENSION_STRICT_REFS
    process.env.EXTENSION_STRICT_REFS = 'true'

    try {
      return await run()
    } finally {
      if (previous === undefined) delete process.env.EXTENSION_STRICT_REFS
      else process.env.EXTENSION_STRICT_REFS = previous
    }
  }

  it('warns once, naming the script and its first import that does not ship', async () => {
    const {root: project} = makeProject({
      ...MODULE_PAGE,
      'inner.js':
        "import {a} from './helper.js'\nimport './second.js'\nconsole.log(a)\n",
      'helper.js': 'export const a = 1\n'
    })
    const result = await build(project)

    expect(result.errors).toBe(0)
    expect(importWarnings(terminalOf(result.printed))).toEqual([
      'Warning: Runtime-risk: A script of this page imports a file that does not ship. (inner.html)'
    ])

    expect(summaryWarnings(result.printed)).toEqual([
      [
        'W_SCRIPT_DEP_MISSING: A script of this page imports a file that does not ship.',
        'PATH inner.html',
        'SCRIPT inner.js',
        'IMPORT ./helper.js',
        'At runtime the page asks for /assets/helper.js and gets a 404.',
        'Only another page reaches this page, so its scripts are copied as written and not bundled.',
        'Put the page under pages/ so it is bundled, or ship the imported file too at that path, for example from public/.',
        'Set EXTENSION_STRICT_REFS=true to make this a build error.'
      ].join('\n')
    ])
  }, 90000)

  it('says the browser cannot resolve a package name', async () => {
    const {root: project} = makeProject({
      ...MODULE_PAGE,
      'inner.js': "import React from 'react'\nconsole.log(React)\n"
    })
    const result = await build(project)

    expect(result.errors).toBe(0)
    expect(importWarnings(terminalOf(result.printed))).toEqual([
      'Warning: Runtime-risk: A script of this page imports a package by name, which the page cannot resolve at runtime. (inner.html)'
    ])

    expect(summaryWarnings(result.printed)).toEqual([
      expect.stringContaining('\nIMPORT react\n')
    ])

    expect(summaryWarnings(result.printed)[0]).toContain(
      "or ship the package's file too and import it by its path."
    )
  }, 90000)

  it('fails the build under strict refs', async () => {
    const {root: project} = makeProject({
      ...MODULE_PAGE,
      'inner.js': "export * from '../lib/gone.js'\n"
    })
    const result = await withStrictRefs(() => build(project))

    expect(result.errors).toBe(1)
    expect(result.printed).toContain('IMPORT ../lib/gone.js')
    expect(result.printed).toContain('the page asks for /lib/gone.js')
    expect(result.printed).not.toContain('EXTENSION_STRICT_REFS=true to make')
  }, 90000)

  it('says nothing when the imported file ships anyway or the page maps names', async () => {
    const {root: project} = makeProject({
      ...MODULE_PAGE,
      'inner.html':
        '<!doctype html><html><head><script type="importmap">{"imports":{"lib":"/war.js"}}</script></head><body><script type="module" src="./inner.js"></script></body></html>',
      'inner.js':
        "// import './commented-out.js'\nimport {a} from './helper.js'\nimport {b} from '../war.js'\nimport {c} from 'https://example.com/c.js'\nimport {d} from 'lib'\nconsole.log(a, b, c, d, import.meta.url)\n",
      'public/assets/helper.js': 'export const a = 1\n',
      'war.js': 'export const b = 2\n',
      'manifest.json': manifest({
        web_accessible_resources: [
          {resources: ['war.js'], matches: ['<all_urls>']}
        ]
      })
    })
    const result = await withStrictRefs(() => build(project))

    expect(importWarnings(result.printed)).toEqual([])
    expect(result.printed).not.toContain('IMPORT ')
    expect(outputHolding(project, 'export const b = 2')).toEqual(['war.js'])
  }, 90000)
})
