import {createHash} from 'node:crypto'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  fakeCompilation,
  fakeCompiler
} from '../../plugin-browsers/__spec__/fake-compiler'
import {BrowsersPlugin} from '../../plugin-browsers/index'
import type {ReloadBroker, ReloadInstruction} from '../index'

const CONTEXT = '/tmp/ext'
const OUTPUT = '/tmp/ext/dist/firefox'
const BUNDLE = 'content_scripts/content-0.e5213110.js'
const SHEET = 'content_scripts/content-0.css'

beforeEach(() => {
  expect.hasAssertions()
})

interface Emitted {
  js?: string[]
  css?: string[]
  resources?: string[]
  assets?: Record<string, string>
}

// Gecko registers the manifest it loaded, and a content script stylesheet
// keeps one name across compiles while a bundle is renamed by its hash.
function createHarness(browser = 'firefox', broker?: ReloadBroker) {
  const reload = vi.fn<(instruction: ReloadInstruction) => void>()
  const plugin = new BrowsersPlugin({
    launcher: vi.fn().mockResolvedValue({
      enableUnifiedLogging: vi.fn().mockResolvedValue(undefined)
    }),
    browserOptions: {browser}
  })
  plugin.extensionsToLoad = [OUTPUT]
  if (broker) plugin.setReloadBroker(broker)

  plugin.emitter.on('compiled', (ev) => {
    if (ev.reloadInstruction) reload(ev.reloadInstruction)
  })

  const fake = fakeCompiler({owner: BrowsersPlugin.name, context: CONTEXT})
  plugin.apply(fake.compiler)

  return {
    reload,
    async compile(emitted: Emitted, modifiedFiles: string[] = []) {
      fake.watchRun(modifiedFiles)

      await fake.done(
        fakeCompilation({
          context: CONTEXT,
          output: OUTPUT,
          assets: emitted.assets,
          manifest: {
            manifest_version: 3,
            name: 'fake',
            version: '0',
            background: {scripts: ['background/scripts.js']},
            content_scripts: [
              {
                matches: ['<all_urls>'],
                js: emitted.js ?? [BUNDLE],
                ...(emitted.css ? {css: emitted.css} : {})
              }
            ],
            ...(emitted.resources
              ? {
                  web_accessible_resources: [
                    {resources: emitted.resources, matches: ['<all_urls>']}
                  ]
                }
              : {})
          }
        })
      )
    }
  }
}

const sheet = (color: string) => ({
  css: [SHEET],
  assets: {[SHEET]: `.probe { color: ${color}; }\n`}
})

describe('the reload after a compile rewrites a content script stylesheet', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Firefox keeps the declared sheet by address, so the producer is told which
  // file to drop from the open tabs and insert again under a fresh address.
  it('hands Firefox a stylesheet-only edit to swap in place, with no extension reload', async () => {
    const h = createHarness()

    await h.compile(sheet('red'))
    await h.compile(sheet('blue'), ['src/widget.module.css'])

    expect(h.reload).toHaveBeenCalledTimes(1)
    expect(h.reload.mock.calls[0][0]).toMatchObject({
      type: 'content-scripts',
      label: 'content_script (src/widget.module.css)',
      changedAssets: ['src/widget.module.css'],
      refreshedStylesheets: [
        {
          file: SHEET,
          digest: createHash('sha256')
            .update('.probe { color: blue; }\n')
            .digest('hex')
        }
      ]
    })
  })

  // No other engine is known to drop a declared copy, so a manifest that
  // names the sheet itself still reloads the extension there.
  it('still reloads the extension for the same edit on a browser that cannot swap it', async () => {
    const h = createHarness('chrome')

    await h.compile(sheet('red'))
    await h.compile(sheet('blue'), ['src/widget.module.css'])

    expect(h.reload.mock.calls[0][0]).toMatchObject({type: 'full'})
    expect(h.reload.mock.calls[0][0].refreshedStylesheets).toBeUndefined()
  })

  it('reloads the extension when the script changed with the stylesheet', async () => {
    const h = createHarness()

    await h.compile(sheet('red'))
    await h.compile(
      {...sheet('blue'), js: ['content_scripts/content-0.ffffffff.js']},
      ['src/widget.module.css', 'src/content.ts']
    )

    expect(h.reload.mock.calls[0][0]).toMatchObject({type: 'full'})
    expect(h.reload.mock.calls[0][0].refreshedStylesheets).toBeUndefined()
  })

  it('keeps an edit that leaves the stylesheet bytes alone a content-scripts reload', async () => {
    const h = createHarness()

    await h.compile(sheet('red'))
    await h.compile(sheet('red'), ['src/notes.txt'])

    expect(h.reload.mock.calls[0][0]).toMatchObject({type: 'content-scripts'})
  })

  // The swap handed the open tabs the new bytes, so the next compile compares
  // against those and an unrelated edit swaps nothing again.
  it('compares the next compile with the stylesheet the swap delivered', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const h = createHarness('firefox', {
      broadcastReload: vi.fn().mockReturnValue(1)
    })

    await h.compile(sheet('red'))
    await h.compile(sheet('blue'), ['src/widget.module.css'])
    await h.compile(sheet('blue'), ['src/notes.txt'])

    expect(h.reload.mock.calls.map((call) => call[0].type)).toEqual([
      'content-scripts',
      'content-scripts'
    ])

    expect(h.reload.mock.calls[1][0].refreshedStylesheets).toBeUndefined()
  })

  // An idle event page that could not be started took nothing, and the open
  // tabs still hold the old bytes, so the next save has to name the sheet.
  it('names the stylesheet again after a swap no producer took', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broadcastReload = vi.fn().mockReturnValue(0)
    const h = createHarness('firefox', {
      broadcastReload,
      deliverLatchedReload: vi.fn().mockResolvedValue(false)
    })
    const named = () =>
      h.reload.mock.calls.map((call) =>
        (call[0].refreshedStylesheets ?? []).map(
          (each: {file: string}) => each.file
        )
      )

    await h.compile(sheet('red'))
    await h.compile(sheet('blue'), ['src/widget.module.css'])
    await h.compile(sheet('blue'), ['src/notes.txt'])

    expect(named()).toEqual([[SHEET], [SHEET]])

    broadcastReload.mockReturnValue(1)
    await h.compile(sheet('blue'), ['src/notes.txt'])
    await h.compile(sheet('blue'), ['src/notes.txt'])

    expect(named()).toEqual([[SHEET], [SHEET], [SHEET], []])
  })

  // A page is refused a file the loaded manifest did not list, and an
  // imported asset is listed under a name that holds its content hash.
  it('reloads the extension when the manifest lists a web resource the browser never loaded', async () => {
    const h = createHarness('chrome')
    const stub = (logo: string) => ({
      js: ['content_scripts/dev-stub-0.js'],
      assets: {'content_scripts/dev-stub-0.js': ';(function(){})();\n'},
      resources: [`assets/logo.${logo}.png`]
    })

    await h.compile(stub('aaaaaaaa'))
    await h.compile(stub('bbbbbbbb'), ['src/logo.png'])
    await h.compile(stub('bbbbbbbb'), ['src/notes.txt'])

    expect(h.reload.mock.calls.map((call) => call[0].type)).toEqual([
      'full',
      'content-scripts'
    ])

    expect(h.reload.mock.calls[0][0].label).toBe(
      'content_script (src/logo.png)'
    )
  })

  // Chromium's dev manifest names only the stubs, the worker registers the
  // real files and reloads the tabs, so the stylesheet is not compared there.
  it('leaves a stub manifest to the worker that registers the real files', async () => {
    const h = createHarness('chrome')
    const stub = (color: string) => ({
      js: ['content_scripts/dev-stub-0.js'],
      assets: {
        'content_scripts/dev-stub-0.js': ';(function(){})();\n',
        [SHEET]: `.probe { color: ${color}; }\n`
      }
    })

    await h.compile(stub('red'))
    await h.compile(stub('blue'), ['src/widget.module.css'])

    expect(h.reload.mock.calls[0][0]).toMatchObject({type: 'content-scripts'})
  })
})
