import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {buildSourceFeatureIndex} from '../plugin-reload'
import {
  classifyFromSession,
  type DevWatchSession,
  errorsOf,
  openDevWatchSession
} from './helpers/dev-watch-session'

// Replacing an image a script imports is an edit to that script's bundle, so
// the reload must name the bundle that carries it. Real watch-mode compiles.
let root = ''
let session: DevWatchSession

// Above the inline limit, so the import is a file and not a data URL.
const image = (fill: number) =>
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(4096, fill)
  ])

const importing = (file: string) =>
  `import logo from './${file}'\ndocument.documentElement.setAttribute('data-logo', String(logo))\n`

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-asset-reload-'))

  const write = (name: string, contents: string | Buffer) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true})
    fs.writeFileSync(path.join(root, name), contents)
  }

  write(
    'package.json',
    JSON.stringify({private: true, name: 'asset-reload', version: '0.0.0'})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'asset-reload',
      version: '1.0.0',
      permissions: ['scripting'],
      host_permissions: ['<all_urls>'],
      background: {service_worker: 'background.js'},
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content/first.js']},
        {matches: ['<all_urls>'], js: ['content/second.js']}
      ]
    })
  )

  write(
    'background.js',
    "import badge from './badge.png'\nconsole.log('badge', String(badge))\nchrome.scripting.registerContentScripts([{id: 'hook', js: ['scripts/hook.js'], world: 'MAIN', matches: ['<all_urls>']}])\n"
  )

  write('badge.png', image(1))
  write('scripts/hook.js', importing('logo.png'))
  write('scripts/logo.png', image(2))
  write('content/first.js', importing('first.png'))
  write('content/first.png', image(3))
  write('content/second.js', "console.log('second')\n")

  session = await openDevWatchSession(root)
}, 120000)

afterAll(async () => {
  await session?.close()
  if (root) fs.rmSync(root, {recursive: true, force: true})
})

async function replaceAndClassify(file: string, fill: number) {
  const seen = await session.settle()
  fs.writeFileSync(path.join(root, file), image(fill))
  const stats = await session.doneAfter(seen)

  expect(errorsOf(stats)).toEqual([])

  return classifyFromSession(session, stats)
}

describe('dev reload for an image a script imports', () => {
  // The image was attributed to no bundle, so the edit fell through to every
  // declared content script and the scripts/ file that carries it went unnamed.
  it('names the scripts/ bundle that imports the replaced image', async () => {
    const instruction = await replaceAndClassify('scripts/logo.png', 12)

    expect(instruction).toMatchObject({
      type: 'page',
      changedScriptFiles: [
        'scripts/hook.extjs-main-world.js',
        'scripts/hook.js'
      ],
      changedAssets: ['scripts/logo.png']
    })
  }, 60000)

  // A MAIN world script the background registers compiles in a child
  // compilation, and none of its sources were attributed to its bundle.
  it('names the scripts/ bundle for an edit to the registered script itself', async () => {
    const seen = await session.settle()
    fs.appendFileSync(
      path.join(root, 'scripts/hook.js'),
      "console.log('edited')\n"
    )

    const stats = await session.doneAfter(seen)

    expect(errorsOf(stats)).toEqual([])
    expect(classifyFromSession(session, stats)).toMatchObject({
      type: 'page',
      changedScriptFiles: [
        'scripts/hook.extjs-main-world.js',
        'scripts/hook.js'
      ],
      label: 'page (scripts/hook.js)'
    })
  }, 60000)

  it('reloads only the declared content script that imports the replaced image', async () => {
    const instruction = await replaceAndClassify('content/first.png', 13)

    expect(instruction).toMatchObject({
      type: 'content-scripts',
      changedContentScriptEntries: ['content_scripts/content-0'],
      label: 'content_script (content/first.png)'
    })

    expect(instruction?.changedScriptFiles).toBeUndefined()
  }, 60000)

  it('reloads the worker for an image only the background imports', async () => {
    const instruction = await replaceAndClassify('badge.png', 11)

    expect(instruction).toMatchObject({
      type: 'service-worker',
      label: 'service_worker (badge.png)'
    })

    expect(instruction?.changedContentScriptEntries).toBeUndefined()
  }, 60000)
})

describe('the source index over child compilations', () => {
  const chunk = (name: string, sources: string[]) => ({
    name,
    files: [`${name}.js`],
    sources
  })
  const compilationOf = (
    chunks: Array<ReturnType<typeof chunk>>,
    children: unknown[] = []
  ) => ({
    chunks,
    children,
    chunkGraph: {
      getChunkModulesIterable: (each: ReturnType<typeof chunk>) =>
        each.sources.map((source) => ({
          identifier: () => `asset/resource|/project/${source}`
        }))
    }
  })

  // The tracer also emits the registered file beside the worker, and that
  // copy is not the worker: calling it one restarted the whole extension.
  it('reads a scripts/ bundle of a child and leaves a copy under background/ alone', () => {
    const index = buildSourceFeatureIndex(
      compilationOf(
        [chunk('background/service_worker', ['background.js'])],
        [
          compilationOf([chunk('scripts/hook', ['scripts/logo.png'])]),
          compilationOf([
            chunk('background/scripts/hook', ['scripts/logo.png'])
          ])
        ]
      ) as never,
      '/project'
    )

    expect(index.pageSources.has('scripts/logo.png')).toBe(true)
    expect(index.swSources.has('scripts/logo.png')).toBe(false)
    expect([
      ...(index.scriptFilesBySource?.get('scripts/logo.png') || [])
    ]).toEqual(['scripts/hook.js'])

    expect(index.swSources.has('background.js')).toBe(true)
  })

  it('names the declared entry a MAIN world child compiles', () => {
    const index = buildSourceFeatureIndex(
      compilationOf(
        [],
        [compilationOf([chunk('content_scripts/content-1', ['src/main.css'])])]
      ) as never,
      '/project'
    )

    expect([
      ...(index.contentEntriesBySource.get('src/main.css') || [])
    ]).toEqual(['content_scripts/content-1'])
  })
})
