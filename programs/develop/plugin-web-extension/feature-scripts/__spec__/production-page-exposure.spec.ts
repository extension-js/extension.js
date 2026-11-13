import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import vm from 'node:vm'
import {rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {CHROMIUM_EXTENSION_ROOT} from '../scripts-lib/injected-sheet-urls'
import {
  EXTENSION_BASE_GLOBAL,
  readTakeBlock
} from '../../../lib/extension-base-from-stack'
import {getProjectStructure} from '../../../lib/project'
import webpackConfig from '../../../rspack-config'

const roots: string[] = []
const EXTENSION_BASE = 'chrome-extension://abcdefghijklmnop/'

// Chromium fills the extension id in as it hands a sheet over, a fetch too.
function asChromiumServes(sheet: string): string {
  return sheet.split(CHROMIUM_EXTENSION_ROOT).join(EXTENSION_BASE)
}

const BASE_ATTRIBUTE = 'data-extjs-extension-base'
const FIREFOX_BASE = 'moz-extension://0f0f0f0f-aaaa-bbbb-cccc-121212121212/'
const OTHER_FIREFOX_BASE =
  'moz-extension://1a1a1a1a-aaaa-bbbb-cccc-343434343434/'
// Every extension names its own global, all of them behind this stem.
const BASE_GETTER_REMOVAL = `delete window.${EXTENSION_BASE_GLOBAL.slice(0, -1)}`

// The global a bundle's opening read names, the shared one when it has none.
function takenGlobal(bundle: string): string {
  const named = /__EXTJS_EXTENSION_BASE_[0-9a-f]{8}__/.exec(
    readTakeBlock(bundle) || ''
  )

  return named ? named[0] : EXTENSION_BASE_GLOBAL
}

// The attribute a bundle's own bridge writes, keyed the way its global is.
function takenAttribute(bundle: string): string {
  const key = /^__EXTJS_EXTENSION_BASE_([0-9a-f]{8})__$/.exec(
    takenGlobal(bundle)
  )

  return key ? `${BASE_ATTRIBUTE}-${key[1]}` : BASE_ATTRIBUTE
}

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

async function compile(
  root: string,
  mode: 'development' | 'production',
  browser: 'chrome' | 'firefox' = 'chrome'
) {
  const distPath = path.join(root, 'dist', browser)
  const projectStructure = await getProjectStructure(root)
  const config = webpackConfig(projectStructure, {
    browser,
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

// Chromium development registers a one-rule probe sheet beside each entry's
// own. The browser applies it itself, so no build exposes it to a page.
const DEV_PROBE_SHEET = 'content_scripts/dev-sheet-0.css'

function withDevProbe(
  mode: 'production' | 'development',
  sheets: string[]
): string[] {
  return mode === 'development' ? [...sheets, DEV_PROBE_SHEET].sort() : sheets
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
    run: (source: string, filename?: string) =>
      vm.runInContext(source, context, filename ? {filename} : undefined),
    settle: async (rounds: number, between?: (round: number) => void) => {
      for (let round = 0; round < rounds; round++) {
        between?.(round)

        for (const callback of timers.splice(0)) callback()

        await new Promise((resolve) => setImmediate(resolve))
      }
    }
  }
}

// A Firefox page whose script patched every builtin a bundle could hand
// the base to, with the bridge's getter standing on its window.
function firefoxPage(answer: () => string) {
  const world = page({runtime: false})
  const handed: string[] = []
  let asked = 0

  Object.assign(world.context.location as object, {protocol: 'https:'})
  world.context.__handed = handed
  world.run(
    `(function () {
      var starts = String.prototype.indexOf
      var note = function (value) {
        if (typeof value === "string" && starts.call(value, "moz-extension:") === 0) __handed.push(value)
      }
      var wrap = function (owner, name) {
        var original = owner[name]
        owner[name] = function () {
          note(this)
          for (var i = 0; i < arguments.length; i++) note(arguments[i])
          return original.apply(this, arguments)
        }
      }
      wrap(String.prototype, "replace")
      wrap(String.prototype, "charAt")
      wrap(String.prototype, "match")
      wrap(String.prototype, "slice")
      wrap(String.prototype, "indexOf")
      wrap(RegExp.prototype, "exec")
      wrap(RegExp.prototype, "test")
      var NativeString = String
      String = function (value) { note(value); return NativeString(value) }
      String.prototype = NativeString.prototype
    })()`
  )

  const attribute = world.html.getAttribute

  world.html.getAttribute = (name) => {
    const value = attribute(name)
    if (value) handed.push(value)

    return value
  }

  const published = new Set<string>()

  // The bridge of a bundle's own extension published right before it ran.
  const publish = (global: string) => {
    if (published.has(global)) return

    published.add(global)
    Object.defineProperty(world.context, global, {
      get: () => {
        asked++

        return answer()
      },
      configurable: true,
      enumerable: false
    })
  }

  return {
    ...world,
    run: (source: string, filename?: string) => {
      publish(takenGlobal(source))

      return world.run(source, filename)
    },
    handed,
    asked: () => asked,
    publishes: () =>
      [...published].some(
        (global) =>
          Object.getOwnPropertyDescriptor(world.context, global) !== undefined
      )
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
      expect(sheets, mode).toEqual(withDevProbe(mode, [sheetName]))
      expect(exposedResources(build), mode).not.toContain(DEV_PROBE_SHEET)

      const sheet = build.read(sheetName).replace(/"/g, '')

      expect(sheet, mode).not.toContain('__EXTENSIONJS_EXTENSION_ROOT__')
      expect(sheet, mode).toContain(
        `url(${CHROMIUM_EXTENSION_ROOT}images/root-owned.png)`
      )

      expect(sheet, mode).toContain(
        `url(${CHROMIUM_EXTENSION_ROOT}${beside[0]})`
      )

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
    const sheet = asChromiumServes(production.read(sheetName))
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

    const hydrated = shadow.children[0].textContent.replace(/"/g, '')

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
      expect(sheets, mode).toEqual(
        withDevProbe(mode, [
          'action/index.css',
          'content_scripts/content-0.css'
        ])
      )

      expect(exposedResources(build), mode).not.toContain(DEV_PROBE_SHEET)

      for (const sheet of sheets.filter((each) => each !== DEV_PROBE_SHEET)) {
        expect(
          build.read(sheet).replace(/"/g, ''),
          `${mode} ${sheet}`
        ).toContain(
          sheet.startsWith('content_scripts/')
            ? `url(${CHROMIUM_EXTENSION_ROOT}${images[0]})`
            : `url(/${images[0]})`
        )
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
    const mounted = page({
      runtime: true,
      sheet: asChromiumServes(production.read(sheetName))
    })
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

  // A script that hands its URLs to no builtin, so every call seen is ours.
  const quietFiles = {
    ...files,
    'content/main.ts':
      'import blobUrl from "./blob.bin?url"\n' +
      'globalThis.__seenAsset = blobUrl\n' +
      'globalThis.__seenLater = new URL("later.png", import.meta.url).href\n' +
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

    // A Chromium bundle finds the base on its own, so no bridge ships
    expect(scripts, JSON.stringify(scripts)).toHaveLength(1)

    const bundle = production.read(String(main?.js[0]))

    expect(readTakeBlock(bundle)).toBeNull()
    expect(bundle).not.toContain('__extjsTakenBase')
    expect(bundle).not.toContain(BASE_GETTER_REMOVAL)
  }, 180_000)

  it('reads the base off its own script URL in a Chromium production bundle, with nothing on <html>', async () => {
    const production = await compile(scaffold('main-self', files), 'production')
    expect(production.errors).toEqual([])

    const main = production
      .manifest()
      .content_scripts.find((script) => script.world === 'MAIN')
    const asset = production.emitted.find((entry) => entry.endsWith('.bin'))
    const world = page({runtime: false})
    world.run(
      production.read(String(main?.js[0])),
      `${EXTENSION_BASE}${String(main?.js[0])}`
    )

    await world.settle(5)

    expect(world.html.hasAttribute(BASE_ATTRIBUTE)).toBe(false)
    expect(world.context.__seenAsset).toBe(`${EXTENSION_BASE}${asset}`)
  }, 180_000)

  it('keeps the bridge in a Firefox production bundle, whose stack names no extension file', async () => {
    const production = await compile(
      scaffold('main-firefox', files),
      'production',
      'firefox'
    )
    expect(production.errors).toEqual([])

    const scripts = production.manifest().content_scripts
    const bridge = scripts.find((script) => script.world !== 'MAIN')
    expect(bridge, JSON.stringify(scripts)).toBeDefined()
    expect(production.emitted).toContain(String(bridge?.js[0]))
  }, 180_000)

  it('is taken from the getter in a Firefox production bundle, which hands the page nothing and removes it', async () => {
    const production = await compile(
      scaffold('main-firefox-getter', quietFiles),
      'production',
      'firefox'
    )
    expect(production.errors).toEqual([])

    const main = production
      .manifest()
      .content_scripts.find((script) => script.world === 'MAIN')
    const asset = production.emitted.find((entry) => entry.endsWith('.bin'))
    const bundle = production.read(String(main?.js[0]))

    expect(readTakeBlock(bundle)).not.toBeNull()
    expect(bundle.split(String(readTakeBlock(bundle)))).toHaveLength(2)

    const world = firefoxPage(() => FIREFOX_BASE)
    world.run(bundle)

    // The getter is gone before the page gets its next turn.
    expect(world.publishes()).toBe(false)
    expect(world.asked()).toBe(1)
    expect(world.context.__seenAsset).toBe(`${FIREFOX_BASE}${asset}`)
    expect(world.context.__seenLater).toBe(`${FIREFOX_BASE}later.png`)
    expect(world.handed).toEqual([])
    expect(world.html.hasAttribute(BASE_ATTRIBUTE)).toBe(false)
  }, 180_000)

  it('falls back to <html> in a Firefox production bundle the getter answers nothing, and clears both', async () => {
    const production = await compile(
      scaffold('main-firefox-fallback', quietFiles),
      'production',
      'firefox'
    )
    expect(production.errors).toEqual([])

    const main = production
      .manifest()
      .content_scripts.find((script) => script.world === 'MAIN')
    const asset = production.emitted.find((entry) => entry.endsWith('.bin'))
    const keyed = takenAttribute(production.read(String(main?.js[0])))

    expect(keyed).not.toBe(BASE_ATTRIBUTE)
    expect(keyed.startsWith(`${BASE_ATTRIBUTE}-`)).toBe(true)

    for (const answer of [
      () => '',
      () => {
        throw new Error('page getter')
      },
      // A page that held the name first answers whatever it likes.
      () => 'https://evil.example/',
      () => 'chrome-extension://abcdefghijklmnop/',
      () => 42 as unknown as string
    ]) {
      const world = firefoxPage(answer)
      world.html.setAttribute(keyed, FIREFOX_BASE)
      world.run(production.read(String(main?.js[0])))

      expect(world.context.__seenAsset).toBe(`${FIREFOX_BASE}${asset}`)
      expect(world.html.hasAttribute(keyed)).toBe(false)
      expect(world.publishes()).toBe(false)
    }

    // The name every extension shared carries another extension's base.
    const shared = firefoxPage(() => '')
    shared.html.setAttribute(BASE_ATTRIBUTE, OTHER_FIREFOX_BASE)
    shared.html.setAttribute(keyed, FIREFOX_BASE)
    shared.run(production.read(String(main?.js[0])))

    expect(shared.context.__seenAsset).toBe(`${FIREFOX_BASE}${asset}`)
    expect(shared.html.getAttribute(BASE_ATTRIBUTE)).toBe(OTHER_FIREFOX_BASE)

    const foreign = firefoxPage(() => '')
    foreign.html.setAttribute(BASE_ATTRIBUTE, OTHER_FIREFOX_BASE)
    foreign.run(production.read(String(main?.js[0])))

    expect(String(foreign.context.__seenAsset)).not.toContain(
      OTHER_FIREFOX_BASE
    )

    // The shared name of earlier builds is a page's to define as well.
    const held = firefoxPage(() => '')
    Object.defineProperty(held.context, EXTENSION_BASE_GLOBAL, {
      get: () => {
        throw new Error('page getter')
      }
    })

    held.html.setAttribute(keyed, FIREFOX_BASE)
    held.run(production.read(String(main?.js[0])))

    expect(held.context.__seenAsset).toBe(`${FIREFOX_BASE}${asset}`)

    // A document copy the page rewrote is no base either.
    const rewritten = firefoxPage(() => 'https://evil.example/')
    rewritten.html.setAttribute(keyed, 'https://evil.example/')
    rewritten.run(production.read(String(main?.js[0])))

    expect(String(rewritten.context.__seenAsset)).not.toContain('evil.example')
    expect(String(rewritten.context.__seenAsset)).toContain(String(asset))
  }, 180_000)

  it('asks no runtime the page made up for a URL in a Firefox production bundle', async () => {
    const production = await compile(
      scaffold('main-firefox-forged-runtime', quietFiles),
      'production',
      'firefox'
    )
    expect(production.errors).toEqual([])

    const main = production
      .manifest()
      .content_scripts.find((script) => script.world === 'MAIN')
    const asset = production.emitted.find((entry) => entry.endsWith('.bin'))
    const bundle = production.read(String(main?.js[0]))

    for (const forged of ['https://evil.example/', OTHER_FIREFOX_BASE]) {
      for (const name of ['browser', 'chrome']) {
        const world = firefoxPage(() => FIREFOX_BASE)

        world.context[name] = {
          runtime: {
            id: 'forged',
            getURL: (relative: string) =>
              forged + String(relative).replace(/^\//, '')
          }
        }

        world.run(bundle)

        expect(world.context.__seenAsset, `${name} answering ${forged}`).toBe(
          `${FIREFOX_BASE}${asset}`
        )

        expect(world.context.__seenLater).toBe(`${FIREFOX_BASE}later.png`)
      }
    }
  }, 180_000)

  it('gives each of two Firefox extensions its own base when the page holds both names', async () => {
    const built = []

    for (const name of ['locked-first', 'locked-second']) {
      const production = await compile(
        scaffold(name, {
          ...quietFiles,
          'manifest.json': JSON.stringify({
            ...JSON.parse(files['manifest.json']),
            name
          })
        }),
        'production',
        'firefox'
      )
      expect(production.errors).toEqual([])

      const scripts = production.manifest().content_scripts
      const main = scripts.find((script) => script.world === 'MAIN')
      const bridge = scripts.find((script) => script.world !== 'MAIN')
      const bundle = production.read(String(main?.js[0]))
      const attribute = takenAttribute(bundle)

      // The bridge writes the name its files read, and no shared one.
      expect(production.read(String(bridge?.js[0]))).toContain(
        JSON.stringify(attribute)
      )

      expect(production.read(String(bridge?.js[0]))).not.toContain(
        JSON.stringify(BASE_ATTRIBUTE)
      )

      built.push({
        attribute,
        bundle,
        global: takenGlobal(bundle),
        asset: production.emitted.find((entry) => entry.endsWith('.bin'))
      })
    }

    const [first, second] = built

    expect(first.attribute).not.toBe(second.attribute)

    for (const order of [
      [first, second],
      [second, first]
    ]) {
      // The page locked both names, so both bridges wrote on the document
      // before either file ran, in the order the extensions loaded.
      const world = page({runtime: false})
      Object.assign(world.context.location as object, {protocol: 'https:'})

      for (const {global} of built) {
        Object.defineProperty(world.context, global, {
          value: 'https://evil.example/',
          configurable: false
        })
      }

      const bases = new Map([
        [first, FIREFOX_BASE],
        [second, OTHER_FIREFOX_BASE]
      ])

      for (const extension of order) {
        world.html.setAttribute(
          extension.attribute,
          String(bases.get(extension))
        )
      }

      for (const extension of order) {
        world.run(extension.bundle)

        expect(world.context.__seenAsset).toBe(
          `${bases.get(extension)}${extension.asset}`
        )

        expect(world.html.hasAttribute(extension.attribute)).toBe(false)
      }
    }
  }, 180_000)

  it('leaves no Firefox file reading the shared global or the shared attribute', async () => {
    for (const mode of ['production', 'development'] as const) {
      const built = await compile(
        scaffold(`main-firefox-readers-${mode}`, {
          ...quietFiles,
          'content/main.ts':
            'import "./main.css"\n' +
            'import blobUrl from "./blob.bin?url"\n' +
            'globalThis.__seenAsset = blobUrl\n' +
            'export {}\n',
          'content/main.css': '.exposed { background: url("./blob.bin"); }\n'
        }),
        mode,
        'firefox'
      )
      expect(built.errors).toEqual([])

      const scripts = built.emitted.filter((entry) => entry.endsWith('.js'))
      expect(scripts.length).toBeGreaterThan(1)

      for (const file of scripts) {
        const text = built.read(file)

        expect(text, file).not.toContain(`globalThis.${EXTENSION_BASE_GLOBAL}`)
        // A development file carries its modules as text, quotes escaped.
        expect(text, file).not.toContain(`Attribute("${BASE_ATTRIBUTE}")`)
        expect(text, file).not.toContain(`Attribute(\\"${BASE_ATTRIBUTE}\\")`)
      }
    }
  }, 180_000)

  it('keeps the shared attribute and no keyed one in a Chromium bundle', async () => {
    const production = await compile(
      scaffold('main-chromium-readers', quietFiles),
      'production',
      'chrome'
    )
    expect(production.errors).toEqual([])

    const main = production
      .manifest()
      .content_scripts.find((script) => script.world === 'MAIN')
    const bundle = production.read(String(main?.js[0]))

    expect(bundle).toContain(`"${BASE_ATTRIBUTE}"`)
    expect(bundle).not.toContain(`${BASE_ATTRIBUTE}-`)
  }, 180_000)

  it('leaves no file of any browser or mode reading the shared global', async () => {
    for (const browser of ['chrome', 'firefox'] as const) {
      for (const mode of ['production', 'development'] as const) {
        const built = await compile(
          scaffold(`main-${browser}-no-global-${mode}`, {
            ...quietFiles,
            'content/main.ts':
              'import "./main.css"\n' +
              'import blobUrl from "./blob.bin?url"\n' +
              'globalThis.__seenAsset = blobUrl\n' +
              'export {}\n',
            'content/main.css': '.exposed { background: url("./blob.bin"); }\n'
          }),
          mode,
          browser
        )
        expect(built.errors).toEqual([])

        for (const file of built.emitted.filter((entry) =>
          entry.endsWith('.js')
        )) {
          expect(built.read(file), `${browser} ${mode} ${file}`).not.toContain(
            EXTENSION_BASE_GLOBAL
          )
        }
      }
    }
  }, 180_000)

  it('loads its own asset in Chromium when the page set the shared global', async () => {
    const production = await compile(
      scaffold('main-chromium-evil-global', quietFiles),
      'production',
      'chrome'
    )
    expect(production.errors).toEqual([])

    const main = production
      .manifest()
      .content_scripts.find((script) => script.world === 'MAIN')
    const asset = production.emitted.find((entry) => entry.endsWith('.bin'))
    const file = `${EXTENSION_BASE}${main?.js[0]}`

    // No stack names the file here, the one case the global used to answer.
    const unnamed = page({runtime: false})
    unnamed.context[EXTENSION_BASE_GLOBAL] = 'https://evil.example/'
    unnamed.run(production.read(String(main?.js[0])))

    expect(String(unnamed.context.__seenAsset)).not.toContain('evil.example')

    const named = page({runtime: false})
    named.context[EXTENSION_BASE_GLOBAL] = 'https://evil.example/'
    named.run(production.read(String(main?.js[0])), file)

    expect(named.context.__seenAsset).toBe(`${EXTENSION_BASE}${asset}`)
  }, 180_000)

  it('names a global of its own for each of two Firefox extensions, in the bridge and the file', async () => {
    const built = []

    for (const name of ['exposure-first', 'exposure-second']) {
      const production = await compile(
        scaffold(name, {
          ...quietFiles,
          'manifest.json': JSON.stringify({
            ...JSON.parse(files['manifest.json']),
            name
          })
        }),
        'production',
        'firefox'
      )
      expect(production.errors).toEqual([])

      const scripts = production.manifest().content_scripts
      const main = scripts.find((script) => script.world === 'MAIN')
      const bridge = scripts.find((script) => script.world !== 'MAIN')
      const global = takenGlobal(production.read(String(main?.js[0])))

      expect(global).not.toBe(EXTENSION_BASE_GLOBAL)
      expect(production.read(String(bridge?.js[0]))).toContain(global)
      expect(production.read(String(main?.js[0]))).toContain(
        `delete window.${global}`
      )

      built.push({global, bundle: production.read(String(main?.js[0]))})
    }

    const [first, second] = built
    const other = 'moz-extension://1a1a1a1a-aaaa-bbbb-cccc-343434343434/'

    expect(first.global).not.toBe(second.global)

    // Both bridges ran before either file, the order that collided.
    const world = page({runtime: false})
    Object.assign(world.context.location as object, {protocol: 'https:'})

    for (const [global, base] of [
      [first.global, FIREFOX_BASE],
      [second.global, other]
    ]) {
      Object.defineProperty(world.context, global, {
        get: () => base,
        configurable: true
      })
    }

    world.run(first.bundle)
    expect(String(world.context.__seenAsset).startsWith(FIREFOX_BASE)).toBe(
      true
    )

    world.run(second.bundle)
    expect(String(world.context.__seenAsset).startsWith(other)).toBe(true)
  }, 180_000)

  it('is cleared from <html> in a Chromium development bundle, whose stack names it again', async () => {
    const development = await compile(
      scaffold('main-dev', files),
      'development'
    )
    expect(development.errors).toEqual([])

    // The dev manifest names stubs, the real bundle is the one that runs.
    const bundles = development.emitted
      .filter((entry) => entry.endsWith('.js'))
      .map((entry) => development.read(entry))
      .filter((source) => source.includes('__seenAsset'))

    expect(bundles.length, development.emitted.join(', ')).toBeGreaterThan(0)

    for (const bundle of bundles) {
      expect(bundle).toContain('__EXTENSIONJS_BRIDGE_BASE')
      expect(bundle).toContain(`removeAttribute("${BASE_ATTRIBUTE}")`)
      expect(bundle).not.toContain('__extjsTakenBase')
      expect(bundle).not.toContain(BASE_GETTER_REMOVAL)
    }
  }, 180_000)

  it('is taken from the getter in a Firefox development bundle, which leaves it for the reload runtime', async () => {
    const development = await compile(
      scaffold('main-dev-firefox', files),
      'development',
      'firefox'
    )
    expect(development.errors).toEqual([])

    const bundles = development.emitted
      .filter((entry) => entry.endsWith('.js'))
      .map((entry) => development.read(entry))
      .filter((source) => source.includes('__seenAsset'))

    expect(bundles.length, development.emitted.join(', ')).toBeGreaterThan(0)

    for (const bundle of bundles) {
      expect(readTakeBlock(bundle)).not.toBeNull()
      expect(bundle.split(String(readTakeBlock(bundle)))).toHaveLength(2)
      expect(bundle).toContain(
        'var __EXTENSIONJS_BRIDGE_BASE = typeof __extjsTakenBase === "string" && __extjsTakenBase || '
      )

      // The attribute is the fallback a dev bundle still reads, never clears.
      expect(bundle).toContain(BASE_ATTRIBUTE)
      expect(bundle).not.toContain('removeAttribute')
      expect(bundle).not.toContain(BASE_GETTER_REMOVAL)
    }
  }, 180_000)
})

describe('the extension base two runtime-registered MAIN world files share', () => {
  const files = {
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'exposure-runtime-main',
      version: '1.0.0',
      permissions: ['scripting'],
      host_permissions: ['<all_urls>'],
      background: {scripts: ['background.js']},
      browser_specific_settings: {gecko: {id: 'exposure@example.com'}}
    }),
    'background.js':
      'const api = globalThis.browser || globalThis.chrome\n' +
      'api.scripting.registerContentScripts([{id: "pair", js: ["scripts/first.js", "scripts/second.js"], world: "MAIN", matches: ["<all_urls>"]}])\n',
    'media/first.bin': Buffer.alloc(40_000, 3),
    'media/second.bin': Buffer.alloc(40_000, 4),
    'scripts/first.js':
      'import blobUrl from "../media/first.bin?url"\n' +
      'globalThis.__firstAsset = String(blobUrl)\n',
    'scripts/second.js':
      'import blobUrl from "../media/second.bin?url"\n' +
      'globalThis.__secondAsset = String(blobUrl)\n' +
      'globalThis.__secondLater = () => import("../media/lazy.js")\n',
    'media/lazy.js': 'export const lazy = "LAZY"\n'
  }

  it('reaches both files in a Firefox production build and is cleared once they have run', async () => {
    const production = await compile(
      scaffold('runtime-main', files),
      'production',
      'firefox'
    )
    expect(production.errors).toEqual([])

    const assets = production.emitted.filter((entry) => entry.endsWith('.bin'))
    expect(assets, production.emitted.join(', ')).toHaveLength(2)

    const world = page({runtime: false})
    Object.assign(world.context.location as object, {protocol: 'https:'})
    const keyed = takenAttribute(production.read('scripts/first.js'))

    expect(keyed).not.toBe(BASE_ATTRIBUTE)
    expect(takenAttribute(production.read('scripts/second.js'))).toBe(keyed)

    world.html.setAttribute(keyed, FIREFOX_BASE)
    // One registration runs its files back to back, with no turn between.
    world.run(production.read('scripts/first.js'))
    world.run(production.read('scripts/second.js'))

    const seen = [world.context.__firstAsset, world.context.__secondAsset]
    expect(seen.sort()).toEqual(
      assets.map((asset) => `${FIREFOX_BASE}${asset}`).sort()
    )

    await world.settle(1)

    expect(world.html.hasAttribute(keyed)).toBe(false)

    // No module loads here, so the import of a later chunk fails, and the
    // failure asks no bridge and appends no element.
    const asked: unknown[] = []
    const created: string[] = []
    const create = (world.context.document as {createElement: typeof element})
      .createElement
    Object.assign(world.context.document as object, {
      createElement: (tagName: string) => {
        created.push(tagName)

        return create(tagName)
      }
    })

    Object.assign(world.context, {
      addEventListener() {},
      removeEventListener() {},
      postMessage: (message: unknown) => asked.push(message)
    })

    const later = (world.context.__secondLater as () => Promise<unknown>)()
    const failure = later.then(
      () => null,
      (error: Error) => error.name
    )

    await world.settle(3)

    expect(asked).toEqual([])
    expect(created).toEqual([])
    expect(await failure).toBe('ChunkLoadError')

    for (const file of ['scripts/first.js', 'scripts/second.js']) {
      expect(production.read(file), file).not.toContain('EXTJS_WTW_LOAD')
    }
  }, 180_000)

  it('asks no bridge for a chunk when the page kept the base from a Firefox bundle', async () => {
    const production = await compile(
      scaffold('runtime-main-denied', files),
      'production',
      'firefox'
    )
    expect(production.errors).toEqual([])

    const world = firefoxPage(() => '')
    const asked: unknown[] = []
    const created: string[] = []
    const create = (world.context.document as {createElement: typeof element})
      .createElement
    Object.assign(world.context.document as object, {
      createElement: (tagName: string) => {
        created.push(tagName)

        return create(tagName)
      }
    })

    Object.assign(world.context, {
      addEventListener() {},
      removeEventListener() {},
      postMessage: (message: unknown) => asked.push(message)
    })

    world.run(production.read('scripts/second.js'))

    const failure = (
      world.context.__secondLater as () => Promise<unknown>
    )().then(
      () => null,
      (error: Error) => error.name
    )

    await world.settle(3)

    expect(asked).toEqual([])
    expect(created).toEqual([])
    expect(world.handed).toEqual([])
    expect(await failure).toBe('ChunkLoadError')
  }, 180_000)

  it('is taken from the getter by both files in a Firefox production build, and the getter goes once they have run', async () => {
    const production = await compile(
      scaffold('runtime-main-getter', {
        ...files,
        'scripts/first.js':
          'import blobUrl from "../media/first.bin?url"\n' +
          'globalThis.__firstAsset = blobUrl\n',
        'scripts/second.js':
          'import blobUrl from "../media/second.bin?url"\n' +
          'globalThis.__secondAsset = blobUrl\n'
      }),
      'production',
      'firefox'
    )
    expect(production.errors).toEqual([])

    const assets = production.emitted.filter((entry) => entry.endsWith('.bin'))
    const first = production.read('scripts/first.js')
    const second = production.read('scripts/second.js')

    expect(readTakeBlock(first)).not.toBeNull()
    expect(readTakeBlock(second)).toBe(readTakeBlock(first))

    const world = firefoxPage(() => FIREFOX_BASE)
    world.run(first)
    world.run(second)

    expect(world.asked()).toBe(2)
    expect(
      [world.context.__firstAsset, world.context.__secondAsset].sort()
    ).toEqual(assets.map((asset) => `${FIREFOX_BASE}${asset}`).sort())

    expect(world.handed).toEqual([])

    await world.settle(1)

    expect(world.publishes()).toBe(false)
    expect(world.html.hasAttribute(BASE_ATTRIBUTE)).toBe(false)
  }, 180_000)

  it('stays on <html> in a Firefox development build, as it does for a declared group', async () => {
    const development = await compile(
      scaffold('runtime-main-dev', files),
      'development',
      'firefox'
    )
    expect(development.errors).toEqual([])

    const bundles = development.emitted
      .filter((entry) => entry.endsWith('.js'))
      .map((entry) => development.read(entry))
      .filter((source) => source.includes('__firstAsset'))

    expect(bundles.length, development.emitted.join(', ')).toBeGreaterThan(0)

    for (const bundle of bundles) {
      expect(bundle).not.toContain('removeAttribute')
      expect(bundle).not.toContain(BASE_GETTER_REMOVAL)
    }

    expect(
      bundles.filter((bundle) => readTakeBlock(bundle) !== null)
    ).toHaveLength(1)
  }, 180_000)

  it('leaves a Chromium production bundle without the take or the clear', async () => {
    const production = await compile(
      scaffold('runtime-main-chrome', files),
      'production'
    )
    expect(production.errors).toEqual([])

    for (const file of ['scripts/first.js', 'scripts/second.js']) {
      const shipped = production.read(file)

      expect(shipped, file).not.toContain('removeAttribute')
      expect(shipped, file).not.toContain('__extjsTakenBase')
      expect(shipped, file).not.toContain(BASE_GETTER_REMOVAL)
    }

    // A Chromium bundle names itself on its stack and keeps both loaders.
    expect(production.read('scripts/second.js')).toContain('EXTJS_WTW_LOAD')
  }, 180_000)
})

describe('a MAIN-world script that never resolves a URL against the extension', () => {
  const files = {
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'exposure-main-plain',
      version: '1.0.0',
      content_scripts: [
        {
          matches: ['https://example.com/*'],
          js: ['content/hook.ts'],
          run_at: 'document_start',
          world: 'MAIN'
        }
      ]
    }),
    'content/hook.ts':
      'const original = HTMLMediaElement.prototype.play\n' +
      'HTMLMediaElement.prototype.play = function () {\n' +
      '  return original.call(this)\n' +
      '}\n' +
      'export {}\n'
  }

  it('ships no bridge in a production build, so no page learns the extension base', async () => {
    const production = await compile(
      scaffold('main-plain', files),
      'production'
    )
    expect(production.errors).toEqual([])

    const scripts = production.manifest().content_scripts
    expect(scripts, JSON.stringify(scripts)).toHaveLength(1)
    expect(scripts[0].world).toBe('MAIN')

    const shipped = production.emitted.filter((entry) => entry.endsWith('.js'))
    expect(shipped, shipped.join(', ')).toEqual([scripts[0].js[0]])

    for (const file of shipped) {
      expect(production.read(file)).not.toContain('EXTJS_WTW_LOADED')
    }

    // The bundle runs on the host page's own window, so it plants no
    // extension-named global there, the cleanup registry included.
    const bundle = production.read(scripts[0].js[0])
    expect(bundle).not.toContain('__EXTENSIONJS_registerCleanup')
    expect(bundle).not.toMatch(/globalThis\.__EXTENSIONJS_\w+\s*=/)

    const world = page({runtime: false})
    world.context.HTMLMediaElement = {prototype: {play() {}}}
    world.run(bundle)
    await world.settle(5)

    const planted = Object.keys(world.context).filter((key) =>
      /EXTENSIONJS|extjs/i.test(key)
    )
    expect(planted).toEqual([])
  }, 180_000)

  it('keeps the bridge in development, where the reload runtime reads the base', async () => {
    const development = await compile(
      scaffold('main-plain-dev', files),
      'development'
    )
    expect(development.errors).toEqual([])
    expect(development.manifest().content_scripts).toHaveLength(2)
  }, 180_000)
})
