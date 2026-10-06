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
        web_accessible_resources?: Array<{
          resources: string[]
          matches?: string[]
        }>
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

function page(options: {runtime: boolean; sheet?: string}) {
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
    URL,
    fetch: (url: unknown) => {
      const asked = String(url)
      fetched.push(asked)

      return Promise.resolve({
        ok: true,
        text: () =>
          Promise.resolve(
            asked.startsWith('data:')
              ? decodeURIComponent(asked.slice(asked.indexOf(',') + 1))
              : (options.sheet ?? '.fetched{color:red}')
          )
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

describe('the sheet file a content script CSS module lands in', () => {
  const files = {
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'exposure-module',
      version: '1.0.0',
      content_scripts: [
        {matches: ['https://example.com/*'], js: ['content/index.ts']}
      ]
    }),
    'public/images/root-owned.png': Buffer.alloc(3000, 3),
    'local/beside.png': Buffer.alloc(5000, 5),
    'content/panel.module.css':
      ".rootOwned{background:url('/images/root-owned.png')}\n" +
      ".beside{background:url('../local/beside.png')}\n",
    'content/index.ts':
      'import styles from "./panel.module.css"\n' +
      'globalThis.__seenClasses = styles.rootOwned + " " + styles.beside\n' +
      'export {}\n'
  }
  const sheetName = 'content_scripts/content-0.css'
  const besideName = /^assets\/beside\.[0-9a-f]{8}\.png$/

  it('names its url() targets from the extension root, in production and in development', async () => {
    for (const mode of ['production', 'development'] as const) {
      const build = await compile(scaffold(`module-${mode}`, files), mode)
      expect(build.errors, mode).toEqual([])

      const beside = build.emitted.filter((entry) => besideName.test(entry))
      const sheets = build.emitted.filter((entry) => entry.endsWith('.css'))

      expect(beside, mode).toHaveLength(1)
      expect(sheets, mode).toEqual([sheetName])

      const sheet = build.read(sheetName).replace(/"/g, '')

      expect(sheet, mode).not.toContain('__EXTENSIONJS_EXTENSION_ROOT__')
      expect(sheet, mode).toContain('url(/images/root-owned.png)')
      expect(sheet, mode).toContain(`url(/${beside[0]})`)

      expect(exposedResources(build), mode).toEqual(
        expect.arrayContaining(['images/root-owned.png', beside[0]])
      )

      if (mode === 'production') {
        expect(build.manifest().content_scripts[0].css).toEqual([sheetName])
      } else {
        expect(build.emitted).toContain(`${sheetName}.map`)
      }
    }
  }, 180_000)

  it('reaches a shadow root with every url() pointing at the extension', async () => {
    const production = await compile(
      scaffold('module-hydrated', files),
      'production'
    )
    expect(production.errors).toEqual([])

    const beside = production.emitted.find((entry) => besideName.test(entry))
    const sheet = production.read(sheetName)
    const mounted = page({runtime: true, sheet})
    const shadow = element('#shadow-root')
    const host = element('div')
    host.setAttribute('data-extension-root', 'true')
    host.shadowRoot = shadow
    mounted.run(production.read('content_scripts/content-0.js'))
    await mounted.settle(30, (round) => {
      if (round === 3) mounted.hosts.push(host)
    })

    expect(mounted.fetched).toEqual([`${EXTENSION_BASE}${sheetName}`])
    expect(shadow.children).toHaveLength(1)

    const hydrated = shadow.children[0].textContent

    expect(hydrated).toContain(`url(${EXTENSION_BASE}images/root-owned.png)`)
    expect(hydrated).toContain(`url(${EXTENSION_BASE}${beside})`)
    expect(hydrated).not.toMatch(/url\(\s*["']?\/(?!\/)/)
    expect(hydrated).not.toContain('__EXTENSIONJS_EXTENSION_ROOT__')
    expect(hydrated.split('url(')).toHaveLength(3)
  }, 180_000)
})

describe('one image a declared sheet, an imported sheet and a page sheet all name', () => {
  const matches = ['https://example.com/*']
  const files = {
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'exposure-shared',
      version: '1.0.0',
      action: {default_popup: 'popup/index.html'},
      content_scripts: [
        {matches, js: ['content/index.ts'], css: ['content/declared.css']}
      ]
    }),
    'local/shared.png': Buffer.alloc(5000, 9),
    'content/declared.css':
      ".declared{background:url('../local/shared.png')}\n",
    'content/imported.css':
      ".imported{background:url('../local/shared.png')}\n",
    'content/index.ts': 'import "./imported.css"\nexport {}\n',
    'popup/index.html':
      '<!doctype html><html><head><link rel="stylesheet" href="./popup.css"></head><body></body></html>\n',
    'popup/popup.css': ".page{background:url('../local/shared.png')}\n"
  }
  const sharedName = /^assets\/shared\.[0-9a-f]{8}\.png$/

  it('ships once, under the name every sheet points at', async () => {
    for (const mode of ['production', 'development'] as const) {
      const build = await compile(scaffold(`shared-${mode}`, files), mode)
      expect(build.errors, mode).toEqual([])

      const images = build.emitted.filter((entry) => entry.endsWith('.png'))
      const sheets = build.emitted.filter((entry) => entry.endsWith('.css'))

      expect(images, mode).toHaveLength(1)
      expect(images[0], mode).toMatch(sharedName)
      expect(sheets, mode).toEqual([
        'action/index.css',
        'content_scripts/content-0.css'
      ])

      for (const sheet of sheets) {
        expect(
          build.read(sheet).replace(/"/g, ''),
          `${mode} ${sheet}`
        ).toContain(`url(/${images[0]})`)
      }

      const bundles = build.emitted
        .filter((entry) => /^content_scripts\/content-0.*\.js$/.test(entry))
        .map((entry) => build.read(entry))

      expect(bundles.length, mode).toBeGreaterThan(0)

      for (const bundle of bundles) {
        expect(bundle, mode).toContain(images[0])
        expect(bundle, mode).not.toContain('assets/local/shared.png')
      }

      const exposed = (build.manifest().web_accessible_resources || []).filter(
        (group) => group.resources.includes(images[0])
      )

      expect(
        exposed.map((group) => group.matches),
        mode
      ).toEqual([matches])
    }
  }, 180_000)

  it('reaches a shadow root from the imported sheet and the declared sheet as that one copy', async () => {
    const production = await compile(
      scaffold('shared-hydrated', files),
      'production'
    )
    expect(production.errors).toEqual([])

    const image = production.emitted.find((entry) => sharedName.test(entry))
    const sheetName = 'content_scripts/content-0.css'
    const mounted = page({runtime: true, sheet: production.read(sheetName)})
    const shadow = element('#shadow-root')
    const host = element('div')
    host.setAttribute('data-extension-root', 'true')
    host.shadowRoot = shadow
    mounted.run(production.read('content_scripts/content-0.js'))
    await mounted.settle(30, (round) => {
      if (round === 3) mounted.hosts.push(host)
    })

    expect(mounted.fetched).toHaveLength(2)
    expect(mounted.fetched[0]).toMatch(/^data:text\/css/)
    expect(mounted.fetched[1]).toBe(`${EXTENSION_BASE}${sheetName}`)
    expect(shadow.children).toHaveLength(1)

    const hydrated = shadow.children[0].textContent

    expect(hydrated.replace(/"/g, '')).toContain(
      `.imported{background:url(${EXTENSION_BASE}${image})}`
    )

    expect(hydrated.replace(/"/g, '')).toContain(
      `.declared{background:url(${EXTENSION_BASE}${image})}`
    )

    expect(hydrated.indexOf('.imported')).toBeLessThan(
      hydrated.indexOf('.declared')
    )

    expect(hydrated.split('url(')).toHaveLength(3)
  }, 180_000)

  it('lifts every imported sheet into the shadow root, in import order', async () => {
    const production = await compile(
      scaffold('two-imports', {
        'manifest.json': JSON.stringify({
          manifest_version: 3,
          name: 'exposure-two-imports',
          version: '1.0.0',
          content_scripts: [{matches, js: ['content/index.ts']}]
        }),
        'content/first.css': '.first{color:blue}\n',
        'content/second.css': '.second{color:green}\n',
        'content/index.ts':
          'import "./first.css"\nimport "./second.css"\nexport {}\n'
      }),
      'production'
    )
    expect(production.errors).toEqual([])

    const mounted = page({runtime: true})
    const shadow = element('#shadow-root')
    const host = element('div')
    host.setAttribute('data-extension-root', 'true')
    host.shadowRoot = shadow
    mounted.run(production.read('content_scripts/content-0.js'))
    await mounted.settle(30, (round) => {
      if (round === 3) mounted.hosts.push(host)
    })

    expect(mounted.fetched).toHaveLength(2)
    expect(shadow.children.map((child) => child.textContent)).toEqual([
      '.first{color:blue}\n\n.second{color:green}\n'
    ])
  }, 180_000)

  it('reaches a MAIN world shadow root the same way, a file under the inline limit as a data: URL', async () => {
    const production = await compile(
      scaffold('shared-main', {
        'manifest.json': JSON.stringify({
          manifest_version: 3,
          name: 'exposure-shared-main',
          version: '1.0.0',
          content_scripts: [{matches, js: ['content/index.ts'], world: 'MAIN'}]
        }),
        'local/shared.png': Buffer.alloc(5000, 9),
        'local/small.png': Buffer.alloc(90, 9),
        'content/imported.css':
          ".imported{background:url('../local/shared.png?v=3#mark')}\n" +
          ".small{background:url('../local/small.png')}\n",
        'content/index.ts': 'import "./imported.css"\nexport {}\n'
      }),
      'production'
    )
    expect(production.errors).toEqual([])

    const images = production.emitted.filter((entry) => entry.endsWith('.png'))
    const main = production
      .manifest()
      .content_scripts.find((script) => script.world === 'MAIN')
    const world = page({runtime: false})
    const shadow = element('#shadow-root')
    const host = element('div')
    host.setAttribute('data-extension-root', 'true')
    host.shadowRoot = shadow
    world.html.setAttribute(BASE_ATTRIBUTE, EXTENSION_BASE)
    world.run(production.read(String(main?.js[0])))
    await world.settle(30, (round) => {
      if (round === 3) world.hosts.push(host)
    })

    expect(images).toHaveLength(1)
    expect(images[0]).toMatch(sharedName)
    expect(shadow.children).toHaveLength(1)

    const [imported, small] = shadow.children[0].textContent.split('\n')

    expect(imported).toBe(
      `.imported{background:url("${EXTENSION_BASE}${images[0]}?v=3#mark")}`
    )

    expect(small).toBe(
      `.small{background:url("data:image/png;base64,${Buffer.alloc(90, 9).toString('base64')}")}`
    )
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
