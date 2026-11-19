import {beforeEach, describe, expect, it, vi} from 'vitest'
import {
  fakeCompilation,
  fakeCompiler
} from '../../plugin-browsers/__spec__/fake-compiler'
import {BrowsersPlugin} from '../../plugin-browsers/index'
import type {BrowserType} from '../../types'
import type {ReloadInstruction} from '../index'

const CONTEXT = '/tmp/ext'
const OUTPUT = '/tmp/ext/dist/firefox'

beforeEach(() => {
  expect.hasAssertions()
})

// Gecko keeps the hashed bundle names in the manifest it registers, so each
// compile hands the done hook the manifest with this compile's names.
function createHarness(browser: BrowserType = 'firefox') {
  const reload = vi.fn<(instruction: ReloadInstruction) => void>()
  const launcher = vi.fn().mockResolvedValue({
    enableUnifiedLogging: vi.fn().mockResolvedValue(undefined)
  })
  const plugin = new BrowsersPlugin({launcher, browserOptions: {browser}})
  plugin.extensionsToLoad = [OUTPUT]
  plugin.emitter.on('compiled', (ev) => {
    if (ev.reloadInstruction) reload(ev.reloadInstruction)
  })

  const fake = fakeCompiler({owner: BrowsersPlugin.name, context: CONTEXT})
  plugin.apply(fake.compiler)

  return {
    launcher,
    reload,
    async compile(contentScript: string, modifiedFiles: string[] = []) {
      fake.watchRun(modifiedFiles)

      await fake.done(
        fakeCompilation({
          context: CONTEXT,
          output: OUTPUT,
          manifest: {
            manifest_version: 3,
            name: 'fake',
            version: '0',
            background: {scripts: ['background/scripts.js']},
            content_scripts: [{matches: ['<all_urls>'], js: [contentScript]}]
          }
        })
      )
    }
  }
}

describe('the reload after a compile renames a content script bundle', () => {
  // The launch installs the add-on from the first compile. A second compile
  // right after (a file touched in the project root while the first ran)
  // renames the bundle and deletes the file the add-on's manifest names.
  it('reloads the extension when a compile right after launch renames the bundle', async () => {
    const h = createHarness()

    await h.compile('content_scripts/content-0.e5213110.js')
    expect(h.launcher).toHaveBeenCalledTimes(1)

    await h.compile('content_scripts/content-0.0b8b79c0.js')

    expect(h.reload).toHaveBeenCalledTimes(1)
    expect(h.reload.mock.calls[0][0]).toMatchObject({
      type: 'full',
      label: 'extension (manifest.json)'
    })
  })

  it('reloads the extension, not only the tabs, for a content edit that renames the bundle', async () => {
    const h = createHarness()

    await h.compile('content_scripts/content-0.e5213110.js')
    await h.compile('content_scripts/content-0.0b8b79c0.js', ['src/content.js'])

    expect(h.reload.mock.calls[0][0]).toMatchObject({
      type: 'full',
      label: 'content_script (src/content.js)',
      changedAssets: ['src/content.js']
    })
  })

  // The emulator keeps the static entry, reads the new file index on every
  // reload and swaps the content script itself, so a full reload there
  // replaced the whole session for a content edit and was never acked.
  it('keeps a renamed bundle a content-scripts reload in emulated Chromium', async () => {
    const h = createHarness('chromium-emulator')

    await h.compile('content_scripts/content-0.e5213110.js')
    await h.compile('content_scripts/content-0.0b8b79c0.js', ['src/content.js'])

    expect(h.reload.mock.calls[0][0]).toMatchObject({
      type: 'content-scripts',
      label: 'content_script (src/content.js)',
      changedAssets: ['src/content.js']
    })
  })

  it('stays quiet when the bundle names did not change', async () => {
    const h = createHarness()

    await h.compile('content_scripts/content-0.e5213110.js')
    await h.compile('content_scripts/content-0.e5213110.js')

    expect(h.reload).not.toHaveBeenCalled()
  })

  // The reload made the browser read the new manifest, so the next compile
  // compares against that one.
  it('compares the next compile with the manifest the reload loaded', async () => {
    const h = createHarness()

    await h.compile('content_scripts/content-0.e5213110.js')
    await h.compile('content_scripts/content-0.0b8b79c0.js')
    await h.compile('content_scripts/content-0.0b8b79c0.js')

    expect(h.reload).toHaveBeenCalledTimes(1)
  })
})
