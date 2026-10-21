import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {type RuleSetRule, rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../../lib/project'
import webpackConfig from '../../rspack-config'

const roots: string[] = []

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

function scaffold(name: string) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), `extjs-scoped-${name}-`))
  )
  roots.push(root)

  const files: Record<string, string | Buffer> = {
    'package.json': JSON.stringify({
      private: true,
      name: `extjs-scoped-${name}`,
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'scoped',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    }),
    'icons/badge.png': PIXEL_PNG,
    'pages/hero.png': PIXEL_PNG,
    'background.js': [
      "import badge from './icons/badge.png'",
      "import hero from './pages/hero.png'",
      'globalThis.__assets = {badge, hero}',
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

async function compile(root: string, userRule: RuleSetRule) {
  const distPath = path.join(root, 'dist', 'chrome')
  const projectStructure = await getProjectStructure(root)
  const config = webpackConfig(projectStructure, {
    browser: 'chrome',
    mode: 'production',
    metadataCommand: 'build',
    silent: true,
    output: {clean: true, path: distPath}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.module = config.module || {}
  config.module.rules = [userRule, ...(config.module.rules || [])]
  config.stats = false

  const stats = await new Promise<Stats>((resolve, reject) => {
    rspack(config).run((error, result) => {
      if (error) return reject(error)
      if (!result) return reject(new Error('no stats'))

      resolve(result)
    })
  })

  const errors = (stats.toJson({errors: true}).errors || []).map(
    (error) => error.message || String(error)
  )
  if (errors.length) return {errors, assets: {}}

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
  vm.runInNewContext(
    fs.readFileSync(
      path.join(distPath, 'background', 'service_worker.js'),
      'utf-8'
    ),
    sandbox
  )

  return {errors, assets: sandbox.__assets as Record<string, string>}
}

afterAll(() => {
  for (const root of roots) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('a scoped user asset rule claims only its scope', () => {
  it('an include-scoped png rule leaves files outside the include to the default', async () => {
    const root = scaffold('include')
    const {errors, assets} = await compile(root, {
      test: /\.png$/i,
      include: path.join(root, 'icons'),
      type: 'asset/resource'
    })

    expect(errors).toEqual([])
    expect(assets.badge).toMatch(/\/assets\/badge\.[0-9a-f]{8}\.png$/)
    expect(assets.hero).toMatch(/^data:image\/png;base64,/)
  })

  it('an exclude-scoped png rule leaves the excluded files to the default', async () => {
    const root = scaffold('exclude')
    const {errors, assets} = await compile(root, {
      test: /\.png$/i,
      exclude: path.join(root, 'pages'),
      type: 'asset/resource'
    })

    expect(errors).toEqual([])
    expect(assets.badge).toMatch(/\/assets\/badge\.[0-9a-f]{8}\.png$/)
    expect(assets.hero).toMatch(/^data:image\/png;base64,/)
  })

  it('a string test is a path prefix and wins inside it', async () => {
    const root = scaffold('string')
    const {errors, assets} = await compile(root, {
      test: path.join(root, 'icons'),
      type: 'asset/resource'
    })

    expect(errors).toEqual([])
    expect(assets.badge).toMatch(/\/assets\/badge\.[0-9a-f]{8}\.png$/)
    expect(assets.hero).toMatch(/^data:image\/png;base64,/)
  })

  it('an unscoped png rule still owns every png', async () => {
    const root = scaffold('bare')
    const {errors, assets} = await compile(root, {
      test: /\.png$/i,
      type: 'asset/resource'
    })

    expect(errors).toEqual([])
    expect(assets.badge).toMatch(/\/assets\/badge\.[0-9a-f]{8}\.png$/)
    expect(assets.hero).toMatch(/\/assets\/hero\.[0-9a-f]{8}\.png$/)
  })
})
