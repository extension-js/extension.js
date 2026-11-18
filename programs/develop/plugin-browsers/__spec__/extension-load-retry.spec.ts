import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as messages from '../../lib/messages'
import type {ReloadBroker} from '../../plugin-reload'
import {
  type BrowserController,
  BrowsersPlugin,
  type CompiledEvent,
  type ExtensionLoadRetryResult
} from '../index'
import {fakeCompilation, fakeCompiler} from './fake-compiler'

const CONTEXT = '/tmp/project'
const OUTPUT = '/tmp/project/dist/chrome'
const LAUNCH_REASON = 'Variable $2$ used but not defined.'
const SHEET = 'content_scripts/content-0.css'

let printed: {log: string[]; error: string[]; stderr: string[]}

beforeEach(() => {
  expect.hasAssertions()
  printed = {log: [], error: [], stderr: []}
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    printed.log.push(parts.join(' '))
  })

  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    printed.error.push(parts.join(' '))
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// A browser that refused the extension at launch with LAUNCH_REASON, unless
// told it loaded. A retry that loads clears the refusal, as the launcher does.
function refusingBrowser(
  retry?: () => Promise<ExtensionLoadRetryResult>,
  refusal: string | null = LAUNCH_REASON
) {
  let current = refusal
  const retryExtensionLoad = vi.fn(async () => {
    const outcome = (await retry?.()) ?? {status: 'unknown' as const}
    if (outcome.status === 'loaded') current = null

    return outcome
  })
  const controller: BrowserController = {
    enableUnifiedLogging: vi.fn().mockResolvedValue(undefined),
    getExtensionLoadRefusal: () => current,
    ...(retry ? {retryExtensionLoad} : {})
  }

  return {controller, retryExtensionLoad}
}

// A launched session on a fake compiler. Each compile hands the done hook a
// manifest naming one content script stylesheet, with the color given.
function session(
  controller: BrowserController,
  broker?: ReloadBroker,
  browser = 'chrome'
) {
  const plugin = new BrowsersPlugin({
    launcher: vi.fn().mockResolvedValue(controller),
    browserOptions: {browser}
  })
  const events: string[] = []
  const compiled: CompiledEvent[] = []

  if (broker) plugin.setReloadBroker(broker)

  plugin.emitter.on('compiled', (event) => {
    compiled.push(event)
    events.push('compiled')
  })

  plugin.emitter.on('error', () => events.push('error'))
  plugin.setReadyListener(() => events.push('ready'))

  const fake = fakeCompiler({owner: BrowsersPlugin.name, context: CONTEXT})
  plugin.apply(fake.compiler)

  return {
    plugin,
    events,
    compiled,
    compile: async (color = 'red', files: string[] = []) => {
      fake.watchRun(files)
      await fake.done(
        fakeCompilation({
          context: CONTEXT,
          output: OUTPUT,
          assets: {[SHEET]: `.probe { color: ${color}; }\n`},
          manifest: {
            manifest_version: 3,
            name: 'fake',
            version: '0',
            content_scripts: [
              {
                matches: ['<all_urls>'],
                js: ['content_scripts/content-0.aaaaaaaa.js'],
                css: [SHEET]
              }
            ]
          }
        })
      )
    }
  }
}

describe('the ready listener', () => {
  it('hears a browser that is open with the extension loaded', async () => {
    const dev = session(refusingBrowser(undefined, null).controller)

    await dev.compile()

    expect(dev.events).toEqual(['ready', 'compiled'])
  })

  it('hears nothing while the browser refuses the extension', async () => {
    const dev = session(refusingBrowser().controller)

    await dev.compile()
    await dev.compile()

    expect(dev.events).toEqual(['compiled', 'compiled'])
  })

  it('never lets a throwing listener break the compile loop', async () => {
    const dev = session(refusingBrowser(undefined, null).controller)
    dev.plugin.setReadyListener(() => {
      throw new Error('listener failed')
    })

    await dev.compile()

    expect(dev.events).toEqual(['compiled'])
  })
})

describe('the retry of a refused extension on the next compile', () => {
  // The regression that matters: loadUnpacked RESTARTS an already-loaded
  // extension, so a healthy session must never reach the retry.
  it('never re-asks a browser that is not refusing', async () => {
    const browser = refusingBrowser(
      async () => ({status: 'loaded' as const}),
      null
    )
    const dev = session(browser.controller)

    await dev.compile()
    await dev.compile()

    expect(browser.retryExtensionLoad).not.toHaveBeenCalled()
    expect(dev.events).toEqual(['ready', 'compiled', 'compiled'])
  })

  it('reports recovery once the browser accepts the dist', async () => {
    const browser = refusingBrowser(async () => ({status: 'loaded' as const}))
    const dev = session(browser.controller)

    await dev.compile()
    await dev.compile()

    expect(browser.retryExtensionLoad).toHaveBeenCalledTimes(1)
    expect(printed.log).toEqual([messages.extensionLoadRecovered()])

    expect(dev.events).toEqual(['compiled', 'ready', 'compiled'])
  })

  // The guest started from the dist this compile wrote, so the swap that
  // compile classified is not sent, and the next compile compares with it.
  it('sends nothing for the compile the retry loaded, and compares with it next', async () => {
    const broadcastReload = vi.fn(() => 1)
    const browser = refusingBrowser(async () => ({status: 'loaded' as const}))
    const dev = session(browser.controller, {broadcastReload}, 'firefox')

    await dev.compile('red')
    await dev.compile('blue', ['src/widget.module.css'])

    expect(dev.compiled[1].reloadInstruction?.refreshedStylesheets).toEqual([
      {file: SHEET, digest: expect.any(String)}
    ])

    expect(broadcastReload).not.toHaveBeenCalled()

    await dev.compile('blue', ['src/notes.txt'])

    expect(dev.compiled[2].reloadInstruction).toMatchObject({
      type: 'content-scripts'
    })

    expect(
      dev.compiled[2].reloadInstruction?.refreshedStylesheets
    ).toBeUndefined()

    expect(dev.events).toEqual(['compiled', 'ready', 'compiled', 'compiled'])
  })

  it('keeps the recovery line off stdout while a machine owns it', async () => {
    vi.stubEnv('EXTENSION_OUTPUT', 'json')
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      printed.stderr.push(String(chunk))

      return true
    })

    const dev = session(
      refusingBrowser(async () => ({status: 'loaded' as const})).controller
    )

    await dev.compile()
    await dev.compile()

    expect(printed.log).toEqual([])
    expect(printed.stderr).toEqual([`${messages.extensionLoadRecovered()}\n`])
  })

  // The operator just changed something, so a repeat refusal must show the
  // browser's CURRENT answer rather than replaying the launch-time one.
  it("prints the browser's new reason when it still refuses", async () => {
    const dev = session(
      refusingBrowser(async () => ({
        status: 'refused' as const,
        reason: 'Could not load theme/images/missing.png.'
      })).controller
    )

    await dev.compile()
    await dev.compile()

    expect(printed.error).toEqual([
      messages.extensionLoadStillRefused(
        'Could not load theme/images/missing.png.'
      )
    ])

    expect(dev.events).toEqual(['compiled', 'compiled'])
  })

  // The dist can recompile several times before the fix lands in it. Repeating
  // the same reason each time reads as "my fix did nothing".
  it('reports an unchanged reason only once', async () => {
    const browser = refusingBrowser(async () => ({
      status: 'refused' as const,
      reason: LAUNCH_REASON
    }))
    const dev = session(browser.controller)

    await dev.compile()
    await dev.compile()
    await dev.compile()

    // The launch-time print already showed this exact text.
    expect(browser.retryExtensionLoad).toHaveBeenCalledTimes(2)
    expect(printed.error).toEqual([])
  })

  // 'unknown' is not a verdict: stay quiet and leave the session as it was.
  it('says nothing when the browser could not be asked', async () => {
    const browser = refusingBrowser(async () => ({status: 'unknown' as const}))
    const dev = session(browser.controller)

    await dev.compile()
    await dev.compile()

    expect(browser.retryExtensionLoad).toHaveBeenCalledTimes(1)
    expect(printed.error).toEqual([])
    expect(printed.log).toEqual([])
    expect(dev.events).toEqual(['compiled', 'compiled'])
  })

  it('tolerates a controller that cannot retry at all', async () => {
    const dev = session(refusingBrowser().controller)

    await dev.compile()
    await dev.compile()

    expect(dev.events).toEqual(['compiled', 'compiled'])
    expect(printed.error).toEqual([])
  })

  it('never lets a throwing retry break the compile', async () => {
    const browser = refusingBrowser(async () => {
      throw new Error('CDP socket closed')
    })
    const dev = session(browser.controller)

    await dev.compile()
    await expect(dev.compile()).resolves.toBeUndefined()

    expect(browser.retryExtensionLoad).toHaveBeenCalledTimes(1)
    expect(dev.events).toEqual(['compiled', 'compiled'])
  })

  // Pins today's behavior. Ledger 1382 D8.
  it('prints nothing at all when the retry throws', async () => {
    const browser = refusingBrowser(async () => {
      throw new Error('CDP socket closed')
    })
    const dev = session(browser.controller)

    await dev.compile()
    await dev.compile()

    expect(printed.log).toEqual([])
    expect(printed.error).toEqual([])
    expect(dev.events).not.toContain('error')
  })
})
