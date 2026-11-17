import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {ScriptsPlugin} from '../index'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-scripts-steps-'))
  )
  roots.push(root)

  const files: Record<string, string> = {
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'steps',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content/isolated.js']},
        {matches: ['<all_urls>'], js: ['content/main.js'], world: 'MAIN'}
      ]
    }),
    'background.js': [
      'chrome.scripting.registerContentScripts([',
      "  {id: 'hook', js: ['scripts/hook.js'], matches: ['<all_urls>'], world: 'MAIN'}",
      '])',
      ''
    ].join('\n'),
    'scripts/hook.js': 'console.log("hook")\n',
    'content/isolated.js': 'export default function main() {}\n',
    'content/main.js': 'export default function main() {}\n'
  }

  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true})
    fs.writeFileSync(path.join(root, name), text)
  }

  return root
}

function hookTaps(compiler: Compiler) {
  const taps: string[] = []

  for (const [hook, value] of Object.entries(compiler.hooks)) {
    for (const tap of (value as {taps?: Array<{name: string}>}).taps || []) {
      taps.push(`${hook}:${tap.name}`)
    }
  }

  return taps
}

function close(compiler: Compiler) {
  return new Promise<void>((resolve) => compiler.close(() => resolve()))
}

// A real compiler that is made and never run, so nothing is written: the
// taps and rules ScriptsPlugin added are what a build would execute.
async function made(
  mode: 'development' | 'production',
  options: {devSession?: boolean; browser?: string; manifest?: string} = {}
) {
  const root = project()
  const at = (name: string) => path.join(root, name)
  const base = {
    context: root,
    mode,
    entry: {},
    output: {path: at('dist')}
  }
  const bare = rspack(base)
  const known = new Set(hookTaps(bare))
  const compiler = rspack({
    ...base,
    plugins: [
      new ScriptsPlugin({
        manifestPath: at(options.manifest || 'manifest.json'),
        browser: (options.browser || 'chrome') as 'chrome',
        ...('devSession' in options ? {devSession: options.devSession} : {}),
        includeList: {
          'background/service_worker': at('background.js'),
          'content_scripts/content-0': [at('content/isolated.js')],
          'content_scripts/content-1': [at('content/main.js')],
          'scripts/hook': at('scripts/hook.js')
        }
      })
    ]
  })
  const taps = hookTaps(compiler)
    .filter((tap) => !known.has(tap))
    .sort()
  const loaders = (compiler.options.module.rules as any[]).flatMap((rule) =>
    [rule, ...(rule?.oneOf || [])].flatMap((one: any) =>
      (Array.isArray(one?.use) ? one.use : []).map((use: any) => ({
        loader: path.basename(String(use.loader)),
        options: use.options
      }))
    )
  )

  await close(bare)
  await close(compiler)

  return {root, taps, loaders}
}

// Taps every build takes, whatever the mode or browser.
const EVERY_BUILD = [
  'compilation:BaseUriRuntimeModule',
  'thisCompilation:TraceRuntimeLoadedFiles',
  'thisCompilation:WarnMovedPageRelativeUrls',
  'thisCompilation:WarnUnshippedRuntimeAssets',
  'thisCompilation:scripts:add-content-script-wrapper',
  'thisCompilation:scripts:keep-completion-value',
  'thisCompilation:scripts:place-runtime-script-sheets',
  'thisCompilation:scripts:root-injected-sheet-urls',
  'thisCompilation:scripts:route-main-world-copies',
  'thisCompilation:scripts:validate-emitted-script-syntax',
  'thisCompilation:scripts:validate-include-list',
  'thisCompilation:scripts:warn-page-context-worker',
  'thisCompilation:scripts:warn-split-initial-chunks',
  'thisCompilation:scripts:warn-unknown-registration-world'
]

const GECKO = [
  'thisCompilation:PairRuntimeMainWorldBridges',
  'thisCompilation:scripts:take-extension-base',
  'thisCompilation:scripts:warn-page-relative-script-path'
]

const DEV_SESSION = [
  'done:scripts:place-runtime-script-sheets',
  'shutdown:scripts:warn-main-world-registration-changed',
  'thisCompilation:scripts:compile-main-world',
  'thisCompilation:scripts:warn-main-world-registration-changed',
  'watchClose:scripts:warn-main-world-registration-changed'
]

const PRODUCTION = [
  'compilation:PublicPathRuntimeModule',
  'thisCompilation:PruneMainWorldBridges',
  'thisCompilation:scripts:warn-missing-build-constants'
]

const sorted = (...lists: string[][]) => lists.flat().sort()

const WRAPPED = [
  'feature-scripts-native-geturl-import-loader',
  'feature-scripts-content-script-wrapper',
  'feature-scripts-classic-concat-loader',
  'feature-scripts-content-script-wrapper',
  'feature-scripts-content-script-wrapper',
  'feature-scripts-content-script-wrapper'
]

describe('ScriptsPlugin steps on a real compiler', () => {
  it('applies the dev session steps in development and no production step', async () => {
    const {taps} = await made('development', {browser: 'firefox'})

    expect(taps).toEqual(sorted(EVERY_BUILD, GECKO, DEV_SESSION))
  })

  it('applies the production steps in production and no dev session step', async () => {
    const {taps} = await made('production', {browser: 'firefox'})

    expect(taps).toEqual(sorted(EVERY_BUILD, GECKO, PRODUCTION))
  })

  it('takes no Gecko step on Chromium, and WebKit stamps the BOM and roots no sheet', async () => {
    const chrome = await made('production', {browser: 'chrome'})
    const safari = await made('production', {browser: 'safari'})

    expect(chrome.taps).toEqual(sorted(EVERY_BUILD, PRODUCTION))
    expect(safari.taps).toEqual(
      sorted(
        EVERY_BUILD.filter(
          (tap) => tap !== 'thisCompilation:scripts:root-injected-sheet-urls'
        ),
        PRODUCTION,
        ['thisCompilation:scripts:stamp-webkit-utf8-bom']
      )
    )
  })

  it('wraps content scripts in both modes and tells the loader the mode', async () => {
    for (const mode of ['development', 'production'] as const) {
      const {loaders} = await made(mode)

      expect(loaders.map(({loader}) => loader)).toEqual(WRAPPED)
      expect(
        loaders.filter(({options}) => options).map(({options}) => options.mode)
      ).toEqual([mode, mode, mode, mode])
    }
  })

  it('hands a dev build without a session to the wrapper and the constant warning', async () => {
    const plain = await made('development', {devSession: false})
    const session = await made('development')
    const wrapperOptions = (loaders: typeof plain.loaders) =>
      loaders.filter(({options}) => options).map(({options}) => options)

    expect(wrapperOptions(plain.loaders).map((o) => o.devSession)).toEqual([
      false,
      false,
      false,
      false
    ])

    expect(plain.taps).toContain(
      'thisCompilation:scripts:warn-missing-build-constants'
    )

    expect(
      wrapperOptions(session.loaders).map((o) => 'devSession' in o)
    ).toEqual([false, false, false, false])

    expect(session.taps).not.toContain(
      'thisCompilation:scripts:warn-missing-build-constants'
    )
  })

  it('applies nothing when the manifest path is not a file', async () => {
    const missing = await made('production', {manifest: 'absent.json'})
    const folder = await made('production', {manifest: 'content'})

    expect(missing.taps).toEqual([])
    expect(missing.loaders).toEqual([])
    expect(folder.taps).toEqual([])
    expect(folder.loaders).toEqual([])
  })
})
