import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {cssMinimizerOptions} from '../../lib/css-minimizer-options'
import type {DevOptions} from '../../types'
import {
  compileProject,
  configure,
  linkWorkspaceReact,
  MANIFEST,
  makeProject,
  swcOptionsFor,
  swcRules
} from './project-fixture'

type Browser = DevOptions['browser']

const GECKO_FLOOR = {
  browser_specific_settings: {gecko: {strict_min_version: '118.0'}}
}

describe('the SWC targets each engine compiles for', () => {
  it.each([
    ['chrome', {}, 'chrome >= 100'],
    ['edge', {}, 'chrome >= 100'],
    ['chrome', {minimum_chrome_version: '120'}, 'chrome >= 120'],
    ['firefox', {}, 'firefox >= 98'],
    [
      'firefox',
      {browser_specific_settings: {gecko: {id: 'a@b'}}},
      'firefox >= 98'
    ],
    ['firefox', {minimum_chrome_version: '120'}, 'firefox >= 98'],
    ['firefox', GECKO_FLOOR, 'firefox >= 118'],
    ['gecko-based', {}, 'firefox >= 98'],
    ['safari', {}, 'safari >= 15.4'],
    ['safari', {minimum_chrome_version: '120'}, 'safari >= 15.4'],
    ['safari', GECKO_FLOOR, 'safari >= 15.4']
  ])('a %s build of manifest extras %j compiles for %s', async (browser, extra, target) => {
    const root = makeProject({
      'package.json': {},
      'manifest.json': {...MANIFEST, ...extra}
    })
    const {pages, contentByPath} = swcRules(
      await configure(root, {browser: browser as Browser})
    )

    expect(swcOptionsFor(pages, '/x/a.js').env.targets).toEqual([target])
    expect(swcOptionsFor(contentByPath, '/x/a.js').env.targets).toEqual([
      target
    ])
  })
})

// A static block parses from Safari 16.4 on, and from Chrome 94 and Firefox 93.
const STATIC_BLOCK =
  'export class Registry {\n' +
  '  static items: string[] = []\n' +
  '  static {\n    Registry.items.push("ready")\n  }\n' +
  '}\n'

const PLAIN = {
  'package.json': {},
  'manifest.json': MANIFEST,
  'tsconfig.json': {},
  'main.ts': `${STATIC_BLOCK}console.log(Registry.items)\n`
}

const REACT = {
  'package.json': {dependencies: {react: '19', 'react-dom': '19'}},
  'manifest.json': MANIFEST,
  'tsconfig.json': {},
  'main.tsx':
    "import {createRoot} from 'react-dom/client'\n" +
    STATIC_BLOCK +
    'function App() {\n  return <h1>{Registry.items.join(",")}</h1>\n}\n' +
    "createRoot(document.getElementById('root')!).render(<App />)\n"
}

async function build(
  kind: 'plain' | 'react',
  browser: Browser,
  mode: 'development' | 'production'
) {
  const root = makeProject(kind === 'react' ? REACT : PLAIN)

  if (kind === 'react') linkWorkspaceReact(root)

  const {errors, read} = await compileProject(
    root,
    {main: kind === 'react' ? './main.tsx' : './main.ts'},
    mode,
    browser
  )

  return {errors, main: read('main')}
}

// The start of the class as each target leaves it, where the block sits.
function registryClass(bundle: string): string {
  const start = bundle.indexOf('class Registry')

  return bundle.slice(start, start + 160)
}

describe.each([
  'plain',
  'react'
] as const)('a small %s project built for each engine', (kind) => {
  it.each([
    'development',
    'production'
  ] as const)('compiles for Firefox and Safari in %s', async (mode) => {
    const firefox = await build(kind, 'firefox', mode)
    const safari = await build(kind, 'safari', mode)

    expect(firefox.errors).toEqual([])
    expect(safari.errors).toEqual([])
    expect(firefox.main).toContain('class Registry')
    expect(safari.main).toContain('class Registry')
  }, 120_000)

  it('keeps a static block for Chrome and Firefox and lowers it for Safari', async () => {
    const chrome = await build(kind, 'chrome', 'production')
    const firefox = await build(kind, 'firefox', 'production')
    const safari = await build(kind, 'safari', 'production')

    expect(registryClass(chrome.main)).toMatch(/static\s*\{/)
    expect(registryClass(firefox.main)).toBe(registryClass(chrome.main))
    expect(registryClass(safari.main)).not.toMatch(/static\s*\{/)
    expect(registryClass(safari.main)).toMatch(/static #_ = /)
  }, 120_000)
})

// What each engine needs differs: Safari reads backdrop-filter only with its
// prefix until 18, and Firefox never needed one for mask-image.
const SHEET = '.a{backdrop-filter:blur(2px);mask-image:url(a.svg)}\n'

function minifySheet(browser: Browser, manifest: Record<string, unknown>) {
  const root = makeProject({
    'page.css': SHEET,
    'a.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n'
  })

  return new Promise<string>((resolve, reject) => {
    rspack({
      mode: 'production',
      context: root,
      entry: {page: './page.css'},
      output: {path: path.join(root, 'out')},
      module: {rules: [{test: /\.css$/, type: 'css'}]},
      optimization: {
        minimize: true,
        minimizer: [
          new rspack.LightningCssMinimizerRspackPlugin({
            minimizerOptions: cssMinimizerOptions(manifest, browser)
          })
        ]
      }
    }).run((error, stats) => {
      if (error || !stats) return reject(error)

      resolve(
        String(stats.compilation.getAsset('page.css')?.source.source() ?? '')
          .replace(/url\([^)]*\)/g, 'url()')
          .trim()
      )
    })
  })
}

describe('the targets a stylesheet is minified for', () => {
  it.each([
    ['chrome', {}],
    ['chrome', {minimum_chrome_version: '120'}],
    ['firefox', {}],
    ['firefox', {minimum_chrome_version: '120'}],
    ['firefox', GECKO_FLOOR],
    ['safari', {}],
    ['safari', GECKO_FLOOR]
  ])('a %s build of manifest extras %j minifies for what its scripts compile for', async (browser, extra) => {
    const manifest = {...MANIFEST, ...extra}
    const root = makeProject({'package.json': {}, 'manifest.json': manifest})
    const {pages} = swcRules(
      await configure(root, {browser: browser as Browser})
    )

    expect(cssMinimizerOptions(manifest, browser).targets).toEqual(
      swcOptionsFor(pages, '/x/a.js').env.targets
    )
  })

  it.each([
    [
      'chrome',
      '.a{backdrop-filter:blur(2px);-webkit-mask-image:url();mask-image:url()}'
    ],
    ['firefox', '.a{backdrop-filter:blur(2px);mask-image:url()}'],
    [
      'safari',
      '.a{-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);mask-image:url()}'
    ]
  ])('a %s build prefixes what that engine needs', async (browser, sheet) => {
    expect(await minifySheet(browser as Browser, MANIFEST)).toBe(sheet)
  })
})
