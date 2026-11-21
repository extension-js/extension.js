import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../../lib/project'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../plugin-web-extension/feature-scripts/contracts'
import webpackConfig from '../../rspack-config'
import {EXTENSIONJS_BACKGROUND_LAYER, withBackgroundLayer} from '../index'
import {
  configure,
  fakePackage,
  MANIFEST,
  makeProject,
  swcOptionsFor,
  swcRules
} from './project-fixture'

const WORKSPACE_MODULES = path.resolve(__dirname, '../../../../node_modules')
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

describe('withBackgroundLayer', () => {
  it('layers the service worker, the scripts list and the background page, and nothing else', () => {
    const entry = {
      'action/index': {import: ['/p/popup.js']},
      'background/index': {import: ['/p/background.html']},
      'background/service_worker': {
        import: ['/p/sw.js'],
        chunkLoading: 'import-scripts'
      },
      'background/scripts': '/p/a.js',
      'content_scripts/content-0': {
        import: ['/p/content.js'],
        layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER
      }
    }

    const next = withBackgroundLayer(entry as never)

    expect(next).toEqual({
      ...entry,
      'background/index': {
        import: ['/p/background.html'],
        layer: EXTENSIONJS_BACKGROUND_LAYER
      },
      'background/service_worker': {
        import: ['/p/sw.js'],
        chunkLoading: 'import-scripts',
        layer: EXTENSIONJS_BACKGROUND_LAYER
      },
      'background/scripts': {
        import: ['/p/a.js'],
        layer: EXTENSIONJS_BACKGROUND_LAYER
      }
    })

    expect(withBackgroundLayer(next)).toEqual(next)
    expect(withBackgroundLayer(undefined)).toEqual({})
  })
})

function reactProject(background: object) {
  const root = makeProject({
    'package.json': {dependencies: {react: '19.0.0'}},
    'manifest.json': {...MANIFEST, background}
  })
  fakePackage(
    root,
    'react',
    {version: '19.0.0', main: 'index.js'},
    {
      'index.js': ''
    }
  )

  return root
}

describe('the rule a background script compiles through', () => {
  it('has refresh off in a React development build, where a page has it on', async () => {
    const root = reactProject({service_worker: 'sw.ts'})
    const rules = swcRules(await configure(root))
    const sw = path.join(root, 'sw.ts')

    expect(
      swcOptionsFor(rules.background, sw).jsc.transform.react.refresh
    ).toBe(false)

    expect(swcOptionsFor(rules.pages, sw).jsc.transform.react.refresh).toBe(
      true
    )

    expect(rules.pages?.issuerLayer).toEqual({
      not: [EXTENSIONJS_CONTENT_SCRIPT_LAYER, EXTENSIONJS_BACKGROUND_LAYER]
    })
  })

  it('has refresh off for a module service worker too', async () => {
    const root = reactProject({service_worker: 'sw.ts', type: 'module'})
    const rules = swcRules(await configure(root))
    const sw = path.join(root, 'sw.ts')
    const background = swcOptionsFor(rules.backgroundModules, sw)

    expect(background.isModule).toBe(true)
    expect(background.jsc.transform.react.refresh).toBe(false)
    expect(swcOptionsFor(rules.modules, sw).jsc.transform.react.refresh).toBe(
      true
    )
  })

  it.each([
    ['a React production build', {react: '19.0.0'}, 'production'],
    ['a Preact development build', {preact: '10.0.0'}, 'development'],
    ['a plain development build', {}, 'development']
  ] as const)('is the page rule, with refresh off, in %s', async (_name, dependencies, mode) => {
    const root = makeProject({
      'package.json': {dependencies},
      'manifest.json': {...MANIFEST, background: {service_worker: 'sw.ts'}}
    })
    const rules = swcRules(await configure(root, {mode}))

    expect(rules.background).toBeUndefined()
    expect(rules.pages?.issuerLayer).toEqual({
      not: EXTENSIONJS_CONTENT_SCRIPT_LAYER
    })

    expect(
      swcOptionsFor(rules.pages, '/x/view.jsx').jsc.transform.react.refresh
    ).toBe(false)
  })
})

const BADGE =
  "import {useState} from 'FRAMEWORK'\n" +
  'export function Badge() {\n' +
  '  const [count] = useState(1)\n' +
  '  return <b>badge-marker-{count}</b>\n' +
  '}\n'

const BACKGROUND =
  "import {Badge} from './Badge.jsx'\n" +
  "chrome.runtime.onInstalled.addListener(() => console.log('sw-marker', Badge.name))\n"

function scaffold(input: {
  framework: 'react' | 'preact'
  manifest: object
  files?: Record<string, string>
}) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-refresh-background-'))
  )
  roots.push(root)

  const dependencies =
    input.framework === 'react' ? {react: '*', 'react-dom': '*'} : {preact: '*'}
  const hooks = input.framework === 'react' ? 'react' : 'preact/hooks'
  const mount =
    input.framework === 'react'
      ? "import {createRoot} from 'react-dom/client'\n" +
        "import {Badge} from './Badge.jsx'\n" +
        "createRoot(document.getElementById('root')).render(<Badge />)\n"
      : "import {render} from 'preact'\n" +
        "import {Badge} from './Badge.jsx'\n" +
        "render(<Badge />, document.getElementById('root'))\n"

  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'extjs-refresh-background',
      version: '0.0.0',
      dependencies
    }),
    'manifest.json': JSON.stringify({
      name: 'refresh-background',
      version: '0.0.0',
      ...input.manifest
    }),
    'popup.html':
      '<!doctype html><html><body><div id="root"></div><script type="module" src="./popup.jsx"></script></body></html>',
    'popup.jsx': mount,
    'Badge.jsx': BADGE.replace('FRAMEWORK', hooks),
    'sw.js': BACKGROUND,
    'background.html':
      '<!doctype html><html><body><script src="./sw.js"></script></body></html>',
    ...input.files
  }

  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), contents)
  }

  fs.symlinkSync(WORKSPACE_MODULES, path.join(root, 'node_modules'), 'dir')

  return root
}

async function compileDev(root: string, browser: 'chrome' | 'firefox') {
  const config = webpackConfig(await getProjectStructure(root), {
    browser,
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: path.join(root, 'dist', browser)}
  })
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-ready-contract'
  )

  config.stats = false

  const stats = await new Promise<Stats>((resolve, reject) => {
    rspack(config).run((error, result) => {
      if (error) return reject(error)
      if (!result) return reject(new Error('no stats'))

      resolve(result)
    })
  })

  const dist = path.join(root, 'dist', browser)
  const scripts = fs
    .readdirSync(dist, {recursive: true})
    .map(String)
    .filter((name) => name.endsWith('.js'))
  const read = (names: string[]) =>
    names.map((name) => fs.readFileSync(path.join(dist, name), 'utf8')).join('')
  const isBackground = (name: string) => name.startsWith('background')

  return {
    errors: stats.toJson({all: false, errors: true}).errors || [],
    backgroundFiles: scripts.filter(isBackground),
    background: read(scripts.filter(isBackground)),
    pages: read(scripts.filter((name) => !isBackground(name)))
  }
}

const REFRESH_CODE = [
  '$RefreshReg$',
  '$RefreshSig$',
  '$ReactRefreshRuntime$',
  'reactRefreshInjected',
  'injectIntoGlobalHook'
]

describe('React refresh and the development background bundle (real compile)', () => {
  it.each([
    [
      'a service worker',
      'chrome',
      {manifest_version: 3, background: {service_worker: 'sw.js'}}
    ],
    [
      'a module service worker',
      'chrome',
      {
        manifest_version: 3,
        background: {service_worker: 'sw.js', type: 'module'}
      }
    ],
    [
      'a background scripts list',
      'firefox',
      {manifest_version: 2, background: {scripts: ['sw.js']}}
    ],
    // A document nobody sees: it runs the same sources with nothing to refresh.
    [
      'a background page',
      'firefox',
      {manifest_version: 2, background: {page: 'background.html'}}
    ]
  ] as const)(
    'keeps refresh out of %s and in the page that shares its source',
    async (_name, browser, manifest) => {
      const root = scaffold({
        framework: 'react',
        manifest: {
          ...manifest,
          [manifest.manifest_version === 3 ? 'action' : 'browser_action']: {
            default_popup: 'popup.html'
          }
        }
      })
      const {errors, background, backgroundFiles, pages} = await compileDev(
        root,
        browser
      )

      expect(errors).toEqual([])
      expect(backgroundFiles.length).toBeGreaterThan(0)
      // The shared component is in both bundles, compiled once for each.
      expect(background).toContain('badge-marker-')
      expect(background).toContain('sw-marker')
      expect(pages).toContain('badge-marker-')

      // Every document gets two empty stand-ins for a page with no runtime.
      const compiled = background.replace(
        /if \('function' != typeof g\.\$Refresh(Reg|Sig)\$\)[^\n]*\n/g,
        ''
      )

      for (const code of REFRESH_CODE) {
        expect(compiled, `background carries ${code}`).not.toContain(code)
      }

      expect(pages).toContain('$RefreshReg$')
      expect(pages).toContain('$RefreshSig$')
      expect(pages).toContain('reactRefreshInjected')
    },
    120_000
  )

  it('leaves no refresh call in a Preact background, which has no runtime to answer it', async () => {
    const root = scaffold({
      framework: 'preact',
      manifest: {
        manifest_version: 3,
        action: {default_popup: 'popup.html'},
        background: {service_worker: 'sw.js'}
      }
    })
    const {errors, background, pages} = await compileDev(root, 'chrome')

    expect(errors).toEqual([])
    expect(background).toContain('badge-marker-')
    expect(pages).toContain('badge-marker-')
    expect(background).not.toContain('$RefreshReg$')
    expect(background).not.toContain('$RefreshSig$')
    expect(pages).not.toContain('$RefreshReg$(')
    expect(pages).not.toContain('$RefreshSig$(')
  }, 120_000)
})
