import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Watching} from '@rspack/core'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  type DevWatchSession,
  errorsOf,
  openDevWatchSession
} from '../../__spec__/helpers/dev-watch-session'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {reloadForBuild} from '../build-reload'
import type {ReloadInstruction} from '../classify-reload'

// One real watch session over a project with a content script, a glob, a
// loader input, an icon, a web resource and public/. Each row saves one file
// and reads what every rebuild it caused would reload.
const tempFolder = trackTempFolders()

// A loaded machine can take most of a minute for one watch compile.
const COMPILE_DEADLINE_MS = 120000

// Reads a file the bundle never imports and tells rspack it did.
const LOADER = `const fs = require('node:fs')
const path = require('node:path')
module.exports = function (source) {
  const input = path.join(this.rootContext, 'loader-input.txt')
  this.addDependency(input)
  return source.replace('__LOADER_INPUT__', JSON.stringify(fs.readFileSync(input, 'utf8')))
}
`

const png = (text: string) =>
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from(text)
  ])

function writeProject(root: string) {
  const write = (rel: string, body: string | Buffer) => {
    const file = path.join(root, ...rel.split('/'))
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, body)
  }

  write(
    'package.json',
    JSON.stringify({private: true, name: 'unread-files', version: '0.0.0'})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'unread-files',
      version: '1.0.0',
      icons: {'16': 'icons/icon-16.png'},
      background: {service_worker: 'background.js'},
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}],
      web_accessible_resources: [
        {resources: ['resources/data.json'], matches: ['<all_urls>']}
      ]
    })
  )

  write('background.js', 'console.log("bg")\n')
  write(
    'content.js',
    [
      "const parts = require.context('./parts', false, /\\.js$/)",
      'parts.keys().forEach((key) => parts(key))',
      // A glob over the project root makes the watcher report every file there.
      "const shapes = require.context('./', false, /\\.shape\\.js$/)",
      'shapes.keys().forEach((key) => shapes(key))',
      'console.log("content", __LOADER_INPUT__)',
      ''
    ].join('\n')
  )

  write('parts/a.js', 'console.log("a")\n')
  write('star.shape.js', 'console.log("star")\n')
  write('loader-input.txt', 'v1')
  write('loader.cjs', LOADER)
  write('icons/icon-16.png', png('v1'))
  write('resources/data.json', '{"v":1}')
  write('public/data.json', '{"v":1}')
  write('public/gone.json', '{"v":1}')
  write('notes.md', '# notes\n')
  write('docs/notes.md', '# docs\n')
}

let root = ''
let session: DevWatchSession
const instructions: Array<ReloadInstruction | undefined> = []

beforeAll(async () => {
  root = tempFolder('extjs-unread-files-')
  writeProject(root)
  session = await openDevWatchSession(root, 'chrome', (compiler) => {
    compiler.options.module.rules.push({
      test: /content\.js$/,
      use: [{loader: path.join(root, 'loader.cjs')}]
    })
  })

  // The same call the launched and --no-browser paths make after a build.
  session.compiler.hooks.done.tap('spec-unread-files', (stats) => {
    instructions.push(
      reloadForBuild(stats.compilation, {changedSources: session.tracker})
    )
  })

  const first = await session.doneAfter(0, COMPILE_DEADLINE_MS)
  expect(errorsOf(first)).toEqual([])
}, 300000)

afterAll(async () => {
  await session?.close()
})

const at = (rel: string) => path.join(root, ...rel.split('/'))

// Every reload the save caused, once the watcher has gone quiet again. A
// save of a file nothing watches may start no rebuild, which reloads nothing.
async function save(change: () => void, mayNotRebuild = false) {
  const seen = await session.settle()
  const from = instructions.length
  change()

  if (mayNotRebuild) {
    await session.quietFor(3000)
  } else {
    const stats = await session.doneAfter(seen, COMPILE_DEADLINE_MS)
    expect(errorsOf(stats)).toEqual([])
  }

  await session.settle()

  return instructions.slice(from).filter(Boolean) as ReloadInstruction[]
}

// A watcher that names the saved file itself, as one watching the file does,
// rather than only the folder it sits in.
function saveNamed(rel: string, body: string) {
  return save(() => {
    fs.writeFileSync(at(rel), body)
    const watching = (session.compiler as unknown as {watching: Watching})
      .watching
    watching.invalidateWithChangesAndRemovals(new Set([at(rel)]), new Set())
  })
}

const types = (reloads: ReloadInstruction[]) => reloads.map((each) => each.type)

describe('a dev session reloads only for files the build read', () => {
  it('a saved file nothing reads reloads nothing, even when the watcher names it', async () => {
    expect(await saveNamed('notes.md', '# notes\n\nmore\n')).toEqual([])
    expect(await saveNamed('docs/notes.md', '# docs\n\nmore\n')).toEqual([])
  }, 300000)

  it('a new file nothing reads, and one no glob matches, reload nothing', async () => {
    const reloads = await save(() => {
      fs.writeFileSync(at('draft.txt'), 'draft')
      fs.writeFileSync(at('parts/readme.md'), '# parts')
    }, true)

    expect(reloads).toEqual([])
  }, 300000)

  it('an edit to the bundled content script reloads it', async () => {
    const reloads = await save(() =>
      fs.appendFileSync(at('content.js'), 'console.log("more")\n')
    )

    expect(types(reloads)).toContain('content-scripts')
  }, 300000)

  it('a new file a glob matches reloads the content script that globs it', async () => {
    const inFolder = await save(() =>
      fs.writeFileSync(at('parts/b.js'), 'console.log("b")\n')
    )
    const atRoot = await save(() =>
      fs.writeFileSync(at('circle.shape.js'), 'console.log("circle")\n')
    )

    expect(types(inFolder)).toContain('content-scripts')
    expect(inFolder.flatMap((each) => each.changedAssets)).toContain(
      'parts/b.js'
    )

    expect(types(atRoot)).toContain('content-scripts')
    expect(atRoot.flatMap((each) => each.changedAssets)).toContain(
      'circle.shape.js'
    )
  }, 300000)

  it('a deleted file a glob had matched reloads the content script that globbed it', async () => {
    const reloads = await save(() => fs.rmSync(at('parts/a.js')))

    expect(types(reloads)).toContain('content-scripts')
    expect(reloads.flatMap((each) => each.changedAssets)).toContain(
      'parts/a.js'
    )
  }, 300000)

  it('a file a loader reads through addDependency reloads the bundle it feeds', async () => {
    const reloads = await save(() =>
      fs.writeFileSync(at('loader-input.txt'), 'v2')
    )

    expect(types(reloads)).toContain('content-scripts')
  }, 300000)

  it('an icon the manifest names reloads the extension', async () => {
    const reloads = await save(() =>
      fs.writeFileSync(at('icons/icon-16.png'), png('v2'))
    )

    expect(types(reloads)).toContain('full')
  }, 300000)

  it('a web accessible resource the manifest names reloads the extension', async () => {
    const reloads = await save(() =>
      fs.writeFileSync(at('resources/data.json'), '{"v":2}')
    )

    expect(types(reloads)).toContain('full')
  }, 300000)

  it('a public/ edit, add and delete each reload the extension', async () => {
    const edited = await save(() =>
      fs.writeFileSync(at('public/data.json'), '{"v":2}')
    )
    const added = await save(() =>
      fs.writeFileSync(at('public/added.json'), '{"v":1}')
    )
    const deleted = await save(() => fs.rmSync(at('public/gone.json')))

    expect(types(edited)).toContain('full')
    expect(types(added)).toContain('full')
    expect(added.flatMap((each) => each.changedAssets)).toContain(
      'public/added.json'
    )

    expect(types(deleted)).toContain('full')
    expect(deleted.flatMap((each) => each.changedAssets)).toContain(
      'public/gone.json'
    )
  }, 300000)

  it('the manifest itself reloads the extension', async () => {
    const reloads = await save(() => {
      const manifest = JSON.parse(fs.readFileSync(at('manifest.json'), 'utf8'))
      manifest.version = '1.0.1'
      fs.writeFileSync(at('manifest.json'), JSON.stringify(manifest))
    })

    expect(types(reloads)).toContain('full')
  }, 300000)
})
