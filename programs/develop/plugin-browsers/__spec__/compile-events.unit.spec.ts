import {beforeEach, describe, expect, it, vi} from 'vitest'
import {
  fakeCompilation,
  fakeCompiler
} from '../../__spec__/helpers/fake-compiler'
import type {ReloadInstruction} from '../../plugin-reload'
import {BrowsersPlugin, BuildEmitter} from '../index'

const CONTEXT = '/tmp/ext'
const OUTPUT = '/tmp/ext/dist/chromium'

beforeEach(() => {
  expect.hasAssertions()
})

// A launched session on a fake compiler whose manifest declares one content
// script, recording every reload a compiled event carries.
function createHarness() {
  const reload = vi.fn<(instruction: ReloadInstruction) => void>()
  const plugin = new BrowsersPlugin({
    launcher: vi.fn().mockResolvedValue({
      enableUnifiedLogging: vi.fn().mockResolvedValue(undefined)
    }),
    browserOptions: {browser: 'chromium'}
  })
  plugin.extensionsToLoad = [OUTPUT]
  plugin.emitter.on('compiled', (ev) => {
    if (ev.reloadInstruction) reload(ev.reloadInstruction)
  })

  const fake = fakeCompiler({owner: BrowsersPlugin.name, context: CONTEXT})
  plugin.apply(fake.compiler)

  return {
    reload,
    async compile(modifiedFiles: string[], errors?: unknown[]) {
      fake.watchRun(modifiedFiles)

      await fake.done(
        fakeCompilation({
          context: CONTEXT,
          output: OUTPUT,
          errors,
          manifest: {
            manifest_version: 3,
            name: 'fake',
            version: '0',
            content_scripts: [
              {
                matches: ['https://example.com/*'],
                js: ['content/script-0.js']
              }
            ]
          }
        })
      )
    }
  }
}

describe('the compiles BrowsersPlugin emits no reload for', () => {
  it('does not emit a reload instruction when compilation has errors', async () => {
    const h = createHarness()

    await h.compile([])
    await h.compile(['src/content/ContentApp.tsx'], [new Error('boom')])

    expect(h.reload).not.toHaveBeenCalled()
  })

  it('skips classification on the first compile (controller not yet live)', async () => {
    const h = createHarness()

    await h.compile(['src/content/ContentApp.tsx'])

    expect(h.reload).not.toHaveBeenCalled()
  })
})

describe('BuildEmitter', () => {
  it('emit("error") does not throw when no listener is attached', () => {
    const emitter = new BuildEmitter()
    expect(() => emitter.emit('error', {errors: ['boom']})).not.toThrow()
  })

  it('user-installed error listeners still fire alongside the default', () => {
    const emitter = new BuildEmitter()
    const seen: string[][] = []
    emitter.on('error', (event) => seen.push([...event.errors]))
    emitter.emit('error', {errors: ['boom']})
    emitter.emit('error', {errors: ['second', 'third']})
    expect(seen).toEqual([['boom'], ['second', 'third']])
  })
})
