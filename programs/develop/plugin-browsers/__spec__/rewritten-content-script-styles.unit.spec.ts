import {createHash} from 'node:crypto'
import {describe, expect, it, vi} from 'vitest'
import {
  type ReloadInstruction,
  readContentScriptDigests,
  reloadForRewrittenContentScripts
} from '../../plugin-reload'
import {type BrowserController, BrowsersPlugin} from '../index'

const CONTEXT = '/tmp/ext'
const OUTPUT = '/tmp/ext/dist/firefox'
const BUNDLE = 'content_scripts/content-0.e5213110.js'
const SHEET = 'content_scripts/content-0.css'

interface Emitted {
  js?: string[]
  css?: string[]
  assets?: Record<string, string>
}

// Gecko registers the manifest it loaded, and a content script stylesheet
// keeps one name across compiles while a bundle is renamed by its hash.
function createHarness(browser = 'firefox') {
  const reload = vi.fn()
  const controller: BrowserController = {
    enableUnifiedLogging: vi.fn().mockResolvedValue(undefined)
  }
  const plugin = new BrowsersPlugin({
    launcher: vi.fn().mockResolvedValue(controller),
    browserOptions: {browser} as never
  })
  plugin.extensionsToLoad = [OUTPUT]
  plugin.emitter.on(
    'compiled',
    (ev: {reloadInstruction?: ReloadInstruction}) => {
      if (ev.reloadInstruction) reload(ev.reloadInstruction)
    }
  )

  let watchRunCb: (() => void) | undefined
  const doneSync: Array<(stats: unknown) => void> = []
  let doneCb: ((stats: unknown) => Promise<void>) | undefined

  const compiler: any = {
    options: {context: CONTEXT},
    modifiedFiles: undefined as ReadonlySet<string> | undefined,
    hooks: {
      watchRun: {tap: (_: string, fn: () => void) => (watchRunCb = fn)},
      done: {
        tap: (_: string, fn: (s: unknown) => void) => {
          doneSync.push(fn)
        },
        tapPromise: (_: string, fn: (s: unknown) => Promise<void>) =>
          (doneCb = fn)
      },
      assetEmitted: {tap: () => {}}
    }
  }

  plugin.apply(compiler)

  return {
    reload,
    async compile(emitted: Emitted, modifiedFiles: string[] = []) {
      compiler.modifiedFiles = new Set(
        modifiedFiles.map((file) => `${CONTEXT}/${file}`)
      )

      watchRunCb?.()

      const assets: Record<string, string> = {
        ...emitted.assets,
        'manifest.json': JSON.stringify({
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
          ]
        })
      }
      const stats = {
        compilation: {
          errors: [],
          options: {context: CONTEXT, output: {path: OUTPUT}},
          getAsset: (name: string) =>
            name in assets ? {source: {source: () => assets[name]}} : undefined
        }
      }

      for (const fn of doneSync) fn(stats)
      await doneCb?.(stats)
    }
  }
}

const sheet = (color: string) => ({
  css: [SHEET],
  assets: {[SHEET]: `.probe { color: ${color}; }\n`}
})

describe('BrowsersPlugin after a compile rewrites a content script stylesheet', () => {
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
    const h = createHarness()

    await h.compile(sheet('red'))
    await h.compile(sheet('blue'), ['src/widget.module.css'])
    await h.compile(sheet('blue'), ['src/notes.txt'])

    expect(h.reload.mock.calls.map((call) => call[0].type)).toEqual([
      'content-scripts',
      'content-scripts'
    ])

    expect(h.reload.mock.calls[1][0].refreshedStylesheets).toBeUndefined()
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

describe('readContentScriptDigests', () => {
  const compilation = (assets: Record<string, string>) =>
    ({
      getAsset: (name: string) =>
        name in assets ? {source: {source: () => assets[name]}} : undefined
    }) as never

  // A bundle carries the compile hash in its runtime, so its bytes change on
  // every compile under one name and say nothing about the edit.
  it('digests the stylesheets and skips the bundles', () => {
    const digests = readContentScriptDigests(
      compilation({[BUNDLE]: 'console.log(1)', [SHEET]: '.a{}'}),
      [BUNDLE, SHEET, 'content_scripts/missing.css']
    )

    expect(Object.keys(digests)).toEqual([SHEET])
  })

  it('answers differently once the bytes change', () => {
    const before = readContentScriptDigests(compilation({[SHEET]: '.a{}'}), [
      SHEET
    ])
    const after = readContentScriptDigests(compilation({[SHEET]: '.b{}'}), [
      SHEET
    ])

    expect(after[SHEET]).not.toBe(before[SHEET])
  })
})

describe('reloadForRewrittenContentScripts', () => {
  const content: ReloadInstruction = {
    type: 'content-scripts',
    changedContentScriptEntries: ['content_scripts/content-0'],
    changedAssets: ['src/widget.module.css'],
    label: 'content_script (src/widget.module.css)'
  }

  it('leaves a static entry to the worker, which reloads the extension and its tabs', () => {
    const instruction = {
      ...content,
      staticContentScriptEntries: ['content_scripts/content-0']
    }

    expect(
      reloadForRewrittenContentScripts(
        instruction,
        {[SHEET]: 'a'},
        {[SHEET]: 'b'}
      )
    ).toBe(instruction)
  })

  it('does not call a stylesheet the loaded manifest never named rewritten', () => {
    expect(reloadForRewrittenContentScripts(content, {}, {[SHEET]: 'b'})).toBe(
      content
    )
  })

  it('names the extension when no source explains the new bytes', () => {
    expect(
      reloadForRewrittenContentScripts(
        undefined,
        {[SHEET]: 'a'},
        {[SHEET]: 'b'}
      )
    ).toMatchObject({type: 'full', label: 'extension (manifest.json)'})
  })

  it('names the rewritten sheets instead of a reload for a browser that swaps them in place', () => {
    expect(
      reloadForRewrittenContentScripts(
        content,
        {[SHEET]: 'a', 'content_scripts/content-1.css': 'same'},
        {[SHEET]: 'b', 'content_scripts/content-1.css': 'same'},
        {refreshInPlace: true}
      )
    ).toEqual({...content, refreshedStylesheets: [{file: SHEET, digest: 'b'}]})
  })

  it('turns a page edit that rewrote a declared sheet into a swap, named by the sheet', () => {
    expect(
      reloadForRewrittenContentScripts(
        undefined,
        {[SHEET]: 'a'},
        {[SHEET]: 'b'},
        {refreshInPlace: true}
      )
    ).toEqual({
      type: 'content-scripts',
      changedAssets: [SHEET],
      refreshedStylesheets: [{file: SHEET, digest: 'b'}],
      label: `content_script (${SHEET})`
    })
  })

  it('keeps a reload that already restarts the extension or its worker, swap or not', () => {
    const full: ReloadInstruction = {type: 'full', label: 'extension'}

    expect(
      reloadForRewrittenContentScripts(
        full,
        {[SHEET]: 'a'},
        {[SHEET]: 'b'},
        {refreshInPlace: true}
      )
    ).toBe(full)
  })
})
