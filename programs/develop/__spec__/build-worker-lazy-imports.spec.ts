import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {describe, expect, it} from 'vitest'
import type {BrowserType} from '../types'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'

const tempFolder = trackTempFolders()

// A background that asks for code only when a message arrives: a sibling
// file, a file that asks for a second one, a package, and a module the
// popup asks for too.
const BACKGROUND = [
  "globalThis.later = () => import('./lazy-later.js').then((m) => m.where())",
  "globalThis.nested = () => import('./lazy-outer.js').then((m) => m.inner())",
  "globalThis.fromPackage = () => import('lazy-pkg').then((m) => m.name())",
  "globalThis.shared = () => import('./shared.js').then((m) => m.marker())",
  ''
].join('\n')

const FILES: Record<string, string> = {
  'background.js': BACKGROUND,
  'lazy-later.js': "export const where = () => 'later ran'\n",
  'lazy-outer.js':
    "export const inner = () => import('./lazy-inner.js').then((m) => m.value())\n",
  'lazy-inner.js': "export const value = () => 'inner ran'\n",
  'shared.js': "export const marker = () => 'shared-module-marker'\n",
  'popup.html':
    '<!doctype html><html><body><script src="./popup.js"></script></body></html>\n',
  'popup.js':
    "import('./shared.js').then((m) => { document.title = m.marker() })\n",
  'node_modules/lazy-pkg/package.json': JSON.stringify({
    name: 'lazy-pkg',
    version: '1.0.0',
    main: 'index.js'
  }),
  'node_modules/lazy-pkg/index.js': "export const name = () => 'package ran'\n"
}

function project(background: Record<string, unknown>) {
  const root = tempFolder('extjs-worker-lazy-')

  for (const [file, source] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true})
    fs.writeFileSync(path.join(root, file), source)
  }

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'worker-lazy', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'worker-lazy',
      version: '1.0.0',
      action: {default_popup: 'popup.html'},
      background
    })
  )

  return root
}

type Mode = 'development' | 'production'

async function build(root: string, browser: BrowserType, mode: Mode) {
  const summary = await buildProject(root, {browser, mode})
  expect(summary.errors_count).toBe(0)

  return path.join(root, 'dist', browser)
}

function scriptsIn(dist: string, dir = ''): string[] {
  return fs
    .readdirSync(path.join(dist, dir), {withFileTypes: true})
    .flatMap((entry) => {
      const relative = path.posix.join(dir, entry.name)

      if (entry.isDirectory()) return scriptsIn(dist, relative)

      return relative.endsWith('.js') ? [relative] : []
    })
}

function backgroundFile(dist: string): string {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8')
  )
  const background = manifest.background

  return background.service_worker || background.scripts[0]
}

// Starts the emitted worker the way Chrome runs it after install: no
// document, and every fetch of a further script refused.
function startAsInstalledWorker(script: string) {
  const root = 'chrome-extension://abcdefghijklmnop/'
  const self: Record<string, unknown> = {
    location: new URL(`${root}background/service_worker.js`),
    importScripts: (...urls: string[]) => {
      throw new Error(`importScripts after install: ${urls.join(', ')}`)
    }
  }
  const listener = {addListener: () => undefined}
  const sandbox: Record<string, unknown> = {
    self,
    importScripts: self.importScripts,
    location: self.location,
    chrome: {
      runtime: {
        id: 'abcdefghijklmnop',
        getURL: (p: string) => `${root}${String(p).replace(/^\/+/, '')}`,
        getManifest: () => ({manifest_version: 3}),
        onMessage: listener,
        onConnect: listener,
        onInstalled: listener,
        onStartup: listener
      }
    },
    URL,
    console,
    setTimeout,
    clearTimeout
  }
  sandbox.globalThis = sandbox

  vm.runInNewContext(script, sandbox, {filename: 'service_worker.js'})

  return sandbox as Record<string, () => Promise<string>>
}

async function answers(dist: string) {
  const worker = startAsInstalledWorker(
    fs.readFileSync(path.join(dist, backgroundFile(dist)), 'utf8')
  )

  return {
    later: await worker.later(),
    nested: await worker.nested(),
    fromPackage: await worker.fromPackage(),
    shared: await worker.shared()
  }
}

const RAN = {
  later: 'later ran',
  nested: 'inner ran',
  fromPackage: 'package ran',
  shared: 'shared-module-marker'
}

describe('a worker background answers import() from its own file', () => {
  it.each([
    ['production', {service_worker: 'background.js'}],
    ['development', {service_worker: 'background.js'}],
    ['production', {service_worker: 'background.js', type: 'module'}],
    ['production', {scripts: ['background.js']}]
  ] as Array<[Mode, Record<string, unknown>]>)(
    'a chrome %s build of background %j loads every lazy import with no further file',
    async (mode, background) => {
      const dist = await build(project(background), 'chrome', mode)
      const worker = backgroundFile(dist)

      expect(await answers(dist)).toEqual(RAN)

      // The popup still gets the module it shares with the worker as a file
      // of its own, and nothing else is emitted beside the two entries.
      const others = scriptsIn(dist).filter(
        (file) => file !== worker && !file.startsWith('action/')
      )
      expect(others).toHaveLength(1)
      expect(fs.readFileSync(path.join(dist, others[0]), 'utf8')).toContain(
        'shared-module-marker'
      )
    },
    180_000
  )

  it('a firefox build keeps the lazy imports of its event page as separate files', async () => {
    const dist = await build(
      project({scripts: ['background.js']}),
      'firefox',
      'production'
    )
    const page = fs.readFileSync(path.join(dist, backgroundFile(dist)), 'utf8')

    expect(page).not.toContain('later ran')
    expect(
      scriptsIn(dist).some((file) =>
        fs.readFileSync(path.join(dist, file), 'utf8').includes('later ran')
      )
    ).toBe(true)
  }, 180_000)
})
