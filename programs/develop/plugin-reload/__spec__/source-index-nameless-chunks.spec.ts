import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compilation, rspack} from '@rspack/core'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../../lib/project'
import webpackConfig from '../../rspack-config'
import {
  buildSourceFeatureIndex,
  classifyReloadFromSources,
  type SourceFeatureIndex
} from '../index'

const files: Record<string, string> = {
  'package.json': JSON.stringify({
    private: true,
    name: 'source-index',
    version: '0.0.0'
  }),
  'manifest.json': JSON.stringify({
    manifest_version: 3,
    name: 'source-index',
    version: '1.0.0',
    background: {service_worker: 'src/background.ts'},
    content_scripts: [
      {matches: ['https://example.com/*'], js: ['src/content.ts']}
    ]
  }),
  'src/shared.ts': "export const VERSION = 'v1'\n",
  'src/lazy.ts': "export const LAZY = 'lazy'\n",
  'src/pipeline.ts': "export const STEP = 'step'\n",
  'src/background.ts': "console.log('background')\n",
  'src/content.ts':
    "import {VERSION} from './shared'\n" +
    'console.log(VERSION)\n' +
    "import('./lazy').then((m) => console.log(m.LAZY))\n",
  'src/worker.ts':
    "import {VERSION} from './shared'\n" +
    "import {STEP} from './pipeline'\n" +
    'self.onmessage = () => console.log(VERSION, STEP)\n',
  'pages/engine.html':
    '<!doctype html><html><body><script src="./engine.ts"></script></body></html>\n',
  'pages/engine.ts':
    "import {VERSION} from '../src/shared'\n" +
    "const worker = new Worker(new URL('../src/worker.ts', import.meta.url))\n" +
    'worker.postMessage(VERSION)\n'
}

let root = ''
let index: SourceFeatureIndex

beforeAll(async () => {
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-source-index-'))
  )

  for (const [relative, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), {recursive: true})
    fs.writeFileSync(path.join(root, relative), contents)
  }

  const config = webpackConfig(await getProjectStructure(root), {
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: true, path: path.join(root, 'dist', 'chrome')}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false

  const compilation = await new Promise<Compilation>((resolve, reject) => {
    rspack(config).run((error, stats) => {
      if (error) return reject(error)
      if (!stats) return reject(new Error('no stats'))

      resolve(stats.compilation)
    })
  })

  index = buildSourceFeatureIndex(compilation, root)
}, 180_000)

afterAll(() => {
  if (root) fs.rmSync(root, {recursive: true, force: true})
})

const classify = (changed: string) =>
  classifyReloadFromSources({
    changedSources: [changed],
    getContentScriptCount: () => 1,
    getSourceFeatureIndex: () => index
  })

describe('a module only a page worker imports', () => {
  it('belongs to the page that starts the worker, not to any content script', () => {
    expect(index.pageSources.has('src/pipeline.ts')).toBe(true)
    expect(index.contentEntriesBySource.has('src/pipeline.ts')).toBe(false)
    expect(index.swSources.has('src/pipeline.ts')).toBe(false)
  })

  it('refreshes the page instead of reloading every content script', () => {
    expect(classify('src/pipeline.ts')).toMatchObject({type: 'page'})
  })
})

describe('a module a content script loads lazily', () => {
  it('belongs to that content script', () => {
    expect([
      ...(index.contentEntriesBySource.get('src/lazy.ts') || [])
    ]).toEqual(['content_scripts/content-0'])
  })
})

describe('a module a content script, a page and a worker share', () => {
  it('reloads the content script that imports it', () => {
    expect(index.pageSources.has('src/shared.ts')).toBe(true)
    expect(classify('src/shared.ts')).toMatchObject({
      type: 'content-scripts',
      changedContentScriptEntries: ['content_scripts/content-0']
    })
  })
})
