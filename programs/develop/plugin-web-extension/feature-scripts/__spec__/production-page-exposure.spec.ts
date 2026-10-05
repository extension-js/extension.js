import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import vm from 'node:vm'
import {rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../../../lib/project'
import webpackConfig from '../../../rspack-config'

const roots: string[] = []
const EXTENSION_BASE = 'chrome-extension://abcdefghijklmnop/'
const BASE_ATTRIBUTE = 'data-extjs-extension-base'

function scaffold(name: string, files: Record<string, string | Buffer>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), `extjs-exposure-${name}-`))
  )
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      name: `extjs-exposure-${name}`,
      version: '0.0.0'
    })
  )

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

  const emitted = (
    fs.readdirSync(distPath, {recursive: true} as any) as unknown[]
  )
    .map((entry) => String(entry).split(path.sep).join('/'))
    .filter((entry) => fs.statSync(path.join(distPath, entry)).isFile())
    .sort()

  const read = (relative: string) =>
    fs.readFileSync(path.join(distPath, relative), 'utf-8')

  return {
    emitted,
    errors: (stats.toJson({errors: true}).errors || []).map(
      (error) => error.message || String(error)
    ),
    read,
    manifest: () =>
      JSON.parse(read('manifest.json')) as {
        content_scripts: Array<{js: string[]; css?: string[]; world?: string}>
        web_accessible_resources?: Array<{resources: string[]}>
      }
  }
}

function exposedResources(
  build: Awaited<ReturnType<typeof compile>>
): string[] {
  return (build.manifest().web_accessible_resources || []).flatMap(
    (group) => group.resources
  )
}

interface FakeElement {
  tagName: string
  children: FakeElement[]
  textContent: string
  parentNode: FakeElement | null
  shadowRoot?: FakeElement
  setAttribute: (name: string, value: unknown) => void
  getAttribute: (name: string) => string | null
  removeAttribute: (name: string) => void
  hasAttribute: (name: string) => boolean
  appendChild: (child: FakeElement) => FakeElement
  insertBefore: (child: FakeElement) => FakeElement
  removeChild: (child: FakeElement) => void
  querySelectorAll: (selector: string) => FakeElement[]
  querySelector: () => null
  addEventListener: () => void
}

function element(tagName: string): FakeElement {
  const attributes: Record<string, string> = {}
  const self: FakeElement = {
    tagName,
    children: [],
    textContent: '',
    parentNode: null,
    setAttribute: (name, value) => {
      attributes[name] = String(value)
    },
    getAttribute: (name) => (name in attributes ? attributes[name] : null),
    removeAttribute: (name) => {
      delete attributes[name]
    },
    hasAttribute: (name) => name in attributes,
    appendChild: (child) => {
      self.children.push(child)
      child.parentNode = self

      return child
    },
    insertBefore: (child) => {
      self.children.unshift(child)
      child.parentNode = self

      return child
    },
    removeChild: (child) => {
      self.children = self.children.filter((other) => other !== child)
    },
    querySelectorAll: (selector) =>
      selector === 'style'
        ? self.children.filter((child) => child.tagName === 'style')
        : [],
    querySelector: () => null,
    addEventListener: () => {}
  }

  return self
}

function page(options: {runtime: boolean}) {
  const fetched: string[] = []
  const timers: Array<() => void> = []
  const html = element('html')
  const hosts: FakeElement[] = []
  const context: Record<string, unknown> = {
    console: {log() {}, warn() {}, error() {}},
    location: {href: 'https://example.com/'},
    document: {
      readyState: 'complete',
      documentElement: html,
      head: element('head'),
      body: element('body'),
      querySelectorAll: (selector: string) =>
        selector.includes('extension-root') ? hosts : [],
      querySelector: () => null,
      getElementById: () => null,
      createElement: element,
      addEventListener() {},
      removeEventListener() {}
    },
    fetch: (url: unknown) => {
      fetched.push(String(url))

      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('.fetched{color:red}')
      })
    },
    setTimeout: (callback: () => void) => {
      timers.push(callback)

      return timers.length
    },
    clearTimeout() {}
  }

  if (options.runtime) {
    context.chrome = {
      runtime: {
        id: 'abcdefghijklmnop',
        getURL: (relative: string) =>
          EXTENSION_BASE + String(relative).replace(/^\//, '')
      }
    }
  }

  context.globalThis = context
  context.window = context
  context.self = context
  vm.createContext(context)

  return {
    context,
    fetched,
    hosts,
    html,
    run: (source: string) => vm.runInContext(source, context),
    settle: async (rounds: number, between?: (round: number) => void) => {
      for (let round = 0; round < rounds; round++) {
        between?.(round)

        for (const callback of timers.splice(0)) callback()

        await new Promise((resolve) => setImmediate(resolve))
      }
    }
  }
}

afterAll(() => {
  for (const root of roots) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('a stylesheet a production content script declares', () => {
  const manifest = JSON.stringify({
    manifest_version: 3,
    name: 'exposure',
    version: '1.0.0',
    content_scripts: [
      {
        matches: ['https://example.com/*'],
        js: ['content/index.ts'],
        css: ['content/styles.css']
      }
    ]
  })

  it('stays off web_accessible_resources when the script never fetches it', async () => {
    const root = scaffold('declared-only', {
      'manifest.json': manifest,
      'content/styles.css': '.declared{color:red}\n',
      'content/index.ts': 'console.log("DECLARED_ONLY")\nexport {}\n'
    })

    const production = await compile(root, 'production')
    expect(production.errors).toEqual([])

    expect(production.manifest().content_scripts[0].css).toEqual([
      'content_scripts/content-0.css'
    ])

    expect(exposedResources(production)).toEqual([])

    const bundle = production.read('content_scripts/content-0.js')

    expect(bundle).not.toContain('fetch(')
    expect(bundle).not.toContain('content_scripts/content-0.css')
    expect(production.read('content_scripts/content-0.css')).not.toContain(
      '__EXTENSIONJS_EXTENSION_ROOT__'
    )

    const development = await compile(root, 'development')
    expect(development.errors).toEqual([])
    expect(exposedResources(development)).toContain(
      'content_scripts/content-0.css'
    )
  }, 180_000)

  it('is exposed for a script that lifts it into its shadow root, and fetched only once a root is there', async () => {
    const root = scaffold('declared-hydrated', {
      'manifest.json': manifest,
      'content/styles.css': '.declared{color:red}\n',
      'content/label.ts': 'export const label = "panel"\n',
      'content/index.ts':
        'import {label} from "./label"\nconsole.log(label)\nexport {}\n'
    })

    const production = await compile(root, 'production')
    expect(production.errors).toEqual([])
    expect(exposedResources(production)).toEqual([
      'content_scripts/content-0.css'
    ])

    const bundle = production.read('content_scripts/content-0.js')
    expect(bundle).toContain('content_scripts/content-0.css')

    const bare = page({runtime: true})
    bare.run(bundle)
    await bare.settle(30)

    expect(bare.fetched).toEqual([])

    const mounted = page({runtime: true})
    const shadow = element('#shadow-root')
    const host = element('div')
    host.setAttribute('data-extension-root', 'true')
    host.shadowRoot = shadow
    mounted.run(bundle)
    await mounted.settle(30, (round) => {
      if (round === 3) mounted.hosts.push(host)
    })

    expect(mounted.fetched).toEqual([
      `${EXTENSION_BASE}content_scripts/content-0.css`
    ])

    expect(shadow.children.map((child) => child.textContent)).toEqual([
      '.fetched{color:red}'
    ])
  }, 180_000)
})

describe('the extension base a MAIN-world bundle reads off the page', () => {
  const files = {
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'exposure-main',
      version: '1.0.0',
      content_scripts: [
        {
          matches: ['https://example.com/*'],
          js: ['content/main.ts'],
          world: 'MAIN'
        }
      ]
    }),
    'content/blob.bin': Buffer.alloc(40_000, 7),
    'content/main.ts':
      'import blobUrl from "./blob.bin?url"\n' +
      'globalThis.__seenAsset = String(blobUrl)\n' +
      'globalThis.__seenAttribute = document.documentElement.getAttribute("data-extjs-extension-base")\n' +
      'export {}\n'
  }

  it('is taken at boot and cleared from <html> in a production bundle', async () => {
    const production = await compile(scaffold('main', files), 'production')
    expect(production.errors).toEqual([])

    const scripts = production.manifest().content_scripts
    const main = scripts.find((script) => script.world === 'MAIN')
    const asset = production.emitted.find((entry) => entry.endsWith('.bin'))

    expect(main, JSON.stringify(scripts)).toBeDefined()
    expect(asset, production.emitted.join(', ')).toBeDefined()

    const world = page({runtime: false})
    world.html.setAttribute(BASE_ATTRIBUTE, EXTENSION_BASE)
    world.run(production.read(String(main?.js[0])))
    await world.settle(5)

    expect(world.html.hasAttribute(BASE_ATTRIBUTE)).toBe(false)
    expect(world.context.__seenAttribute).toBeNull()
    expect(world.context.__seenAsset).toBe(`${EXTENSION_BASE}${asset}`)
    expect(world.context).not.toHaveProperty('__EXTJS_EXTENSION_BASE__')
  }, 180_000)

  it('stays on <html> in development, where the reload runtime reads it later', async () => {
    const development = await compile(
      scaffold('main-dev', files),
      'development'
    )
    expect(development.errors).toEqual([])

    const bundles = development.emitted
      .filter((entry) => entry.endsWith('.js'))
      .map((entry) => development.read(entry))
      .filter((source) => source.includes('__seenAsset'))

    expect(bundles.length, development.emitted.join(', ')).toBeGreaterThan(0)

    for (const bundle of bundles) {
      expect(bundle).toContain(BASE_ATTRIBUTE)
      expect(bundle).not.toContain('removeAttribute')
      expect(bundle).not.toContain('__EXTENSIONJS_BRIDGE_BASE')
    }
  }, 180_000)
})
