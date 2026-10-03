import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../../lib/project'
import webpackConfig from '../../rspack-config'

const roots: string[] = []

const TYPED_TS =
  'export interface Shape {\n  a: number\n}\nexport const typed: number = 1\n'
const SNIPPET_JS = 'export const snippet = 1\n'
const STYLE_CSS = 'body {\n  color: red;\n}\n'
const NOTES_TXT = 'hello text\n'

function scaffold(name: string) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), `extjs-raw-${name}-`))
  )
  roots.push(root)

  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: `extjs-raw-${name}`,
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'raw',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    }),
    'typed.ts': TYPED_TS,
    'snippet.js': SNIPPET_JS,
    'style.css': STYLE_CSS,
    'notes.txt': NOTES_TXT,
    'background.js': [
      "import typedRaw from './typed.ts?raw'",
      "import snippetRaw from './snippet.js?raw'",
      "import styleRaw from './style.css?raw'",
      "import notesRaw from './notes.txt?raw'",
      "import notesUrl from './notes.txt?url'",
      "import {typed} from './typed.ts'",
      "import {snippet} from './snippet.js'",
      'globalThis.__raw = {typedRaw, snippetRaw, styleRaw, notesRaw, notesUrl, typed, snippet}',
      ''
    ].join('\n')
  }

  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, contents)
  }

  return root
}

async function compile(root: string, mode: 'development' | 'production') {
  const distPath = path.join(root, 'dist', 'chrome')
  const projectStructure = await getProjectStructure(root)
  const config = webpackConfig(projectStructure, {
    browser: 'chrome',
    mode,
    metadataCommand: mode === 'production' ? 'build' : 'dev',
    silent: true,
    output: {clean: true, path: distPath}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false

  const stats = await new Promise<Stats>((resolve, reject) => {
    rspack(config).run((error, result) => {
      if (error) return reject(error)
      if (!result) return reject(new Error('no stats'))

      resolve(result)
    })
  })

  return {
    errors: (stats.toJson({errors: true}).errors || []).map(
      (error) => error.message || String(error)
    ),
    worker: fs.readFileSync(
      path.join(distPath, 'background', 'service_worker.js'),
      'utf-8'
    )
  }
}

// The worker only needs enough of a browser to reach the assignment: every
// chrome.* member is a no-op so the runtime scaffolding around it stays quiet.
function evaluateWorker(source: string) {
  const chrome: any = new Proxy(function noop() {}, {
    get: (_target, key) =>
      key === 'getURL' ? (p: string) => `chrome-extension://id/${p}` : chrome,
    apply: () => chrome
  })
  const sandbox: Record<string, unknown> = {
    console: {log() {}, warn() {}, error() {}, info() {}, debug() {}},
    chrome,
    setTimeout,
    clearTimeout,
    addEventListener() {},
    location: {href: 'chrome-extension://id/background/service_worker.js'}
  }
  sandbox.globalThis = sandbox
  sandbox.self = sandbox
  vm.runInNewContext(source, sandbox)

  return sandbox.__raw as Record<string, unknown>
}

afterAll(() => {
  for (const root of roots) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('?raw returns the file text for every extension', () => {
  for (const mode of ['production', 'development'] as const) {
    it(`${mode}: ts, js and css ?raw imports are the exact source text`, async () => {
      const root = scaffold(mode)
      const {errors, worker} = await compile(root, mode)
      expect(errors).toEqual([])

      const raw = evaluateWorker(worker)

      // swc used to strip the interface and the annotation, the wrapper
      // reprinted the js with a semicolon, and the css rule won the type.
      expect(raw.typedRaw).toBe(TYPED_TS)
      expect(raw.snippetRaw).toBe(SNIPPET_JS)
      expect(raw.styleRaw).toBe(STYLE_CSS)
      expect(raw.notesRaw).toBe(NOTES_TXT)

      // The same files keep compiling through their plain and ?url imports.
      expect(raw.typed).toBe(1)
      expect(raw.snippet).toBe(1)
      expect(raw.notesUrl).toMatch(/\/assets\/notes\.[0-9a-f]{8}\.txt$/)
    })
  }
})
