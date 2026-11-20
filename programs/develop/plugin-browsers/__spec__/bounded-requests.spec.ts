import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  fakeCompilation,
  fakeCompiler
} from '../../__spec__/helpers/fake-compiler'
import * as messages from '../../lib/messages'
import {
  BROWSER_REQUEST_TIMEOUT_MS,
  type BrowserController,
  BrowsersPlugin,
  type ExtensionLoadRetryResult
} from '../index'

const CONTEXT = '/tmp/project'
const OUTPUT = '/tmp/project/dist/chrome'

let printed: {log: string[]; warn: string[]; error: string[]}

beforeEach(() => {
  expect.hasAssertions()
  vi.useFakeTimers()
  printed = {log: [], warn: [], error: []}

  for (const channel of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, channel).mockImplementation((...parts: unknown[]) => {
      printed[channel].push(parts.join(' '))
    })
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// A browser that refused the extension at launch and answers a retry only
// when the test says so. A retry that loads clears the refusal.
function slowBrowser() {
  let refusal: string | null = 'Manifest file is missing or unreadable.'
  const answers: Array<(outcome: ExtensionLoadRetryResult) => void> = []
  const wakes: Array<(woke: boolean) => void> = []

  const controller: BrowserController = {
    enableUnifiedLogging: async () => {},
    getExtensionLoadRefusal: () => refusal,
    retryExtensionLoad: () =>
      new Promise<ExtensionLoadRetryResult>((resolve) => {
        answers.push((outcome) => {
          if (outcome.status === 'loaded') refusal = null

          resolve(outcome)
        })
      }),
    wakeBackground: () =>
      new Promise<boolean>((resolve) => {
        wakes.push(resolve)
      })
  }

  return {controller, answers, wakes}
}

function session(controller: BrowserController) {
  const plugin = new BrowsersPlugin({
    launcher: async () => controller,
    browserOptions: {browser: 'chrome'}
  })
  const events: string[] = []

  plugin.emitter.on('compiled', () => events.push('compiled'))
  plugin.emitter.on('error', () => events.push('error'))
  plugin.setReadyListener(() => events.push('ready'))

  const fake = fakeCompiler({owner: BrowsersPlugin.name, context: CONTEXT})
  plugin.apply(fake.compiler)

  return {
    plugin,
    events,
    compile: () => {
      fake.watchRun([])

      return fake.done(fakeCompilation({context: CONTEXT, output: OUTPUT}))
    }
  }
}

// The done hook holds every later rebuild, so a browser that never answers
// one request must not hold the session for good.
describe('a retry the browser never answers', () => {
  it('returns the done hook at the bound and warns once', async () => {
    const browser = slowBrowser()
    const dev = session(browser.controller)
    await dev.compile()

    let hookReturned = false
    void dev.compile().then(() => {
      hookReturned = true
    })

    await vi.advanceTimersByTimeAsync(BROWSER_REQUEST_TIMEOUT_MS - 1)
    expect(hookReturned).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(hookReturned).toBe(true)
    expect(printed.warn).toHaveLength(1)
    expect(printed.warn[0]).toContain(
      'could not be asked to load the extension again'
    )

    expect(printed.warn[0]).toContain('did not answer within 1 minute')
    expect(dev.events).toEqual(['compiled', 'compiled'])
  })

  it('asks no second time while the first ask is still out', async () => {
    const browser = slowBrowser()
    const dev = session(browser.controller)
    await dev.compile()

    void dev.compile()
    await vi.advanceTimersByTimeAsync(BROWSER_REQUEST_TIMEOUT_MS)
    await dev.compile()
    await dev.compile()

    expect(browser.answers).toHaveLength(1)
    expect(printed.warn).toHaveLength(1)
  })

  it('says ready when the answer comes late and the extension loaded', async () => {
    const browser = slowBrowser()
    const dev = session(browser.controller)
    await dev.compile()

    void dev.compile()
    await vi.advanceTimersByTimeAsync(BROWSER_REQUEST_TIMEOUT_MS)
    expect(dev.events).not.toContain('ready')

    browser.answers[0]({status: 'loaded'})
    await vi.advanceTimersByTimeAsync(0)

    expect(dev.events).toEqual(['compiled', 'compiled', 'ready'])
    expect(printed.log).toEqual([messages.extensionLoadRecovered()])
  })

  it('asks again on the next save once a late answer still refused', async () => {
    const browser = slowBrowser()
    const dev = session(browser.controller)
    await dev.compile()

    void dev.compile()
    await vi.advanceTimersByTimeAsync(BROWSER_REQUEST_TIMEOUT_MS)
    browser.answers[0]({status: 'refused', reason: 'Still unreadable.'})
    await vi.advanceTimersByTimeAsync(0)

    expect(printed.error).toEqual([
      messages.extensionLoadStillRefused('Still unreadable.')
    ])

    void dev.compile()
    await vi.advanceTimersByTimeAsync(0)

    expect(browser.answers).toHaveLength(2)
    expect(dev.events).not.toContain('ready')
  })
})

describe('a wake the browser never answers', () => {
  it('answers false at the bound, so the broker stops waiting', async () => {
    const browser = slowBrowser()
    const dev = session(browser.controller)
    await dev.compile()

    let answer: boolean | undefined
    void dev.plugin.wakeBackground().then((woke) => {
      answer = woke
    })

    await vi.advanceTimersByTimeAsync(BROWSER_REQUEST_TIMEOUT_MS - 1)
    expect(answer).toBeUndefined()

    await vi.advanceTimersByTimeAsync(1)
    expect(answer).toBe(false)
  })

  it('answers true for a wake that comes back in time', async () => {
    const browser = slowBrowser()
    const dev = session(browser.controller)
    await dev.compile()

    const wake = dev.plugin.wakeBackground()
    await vi.advanceTimersByTimeAsync(0)
    browser.wakes[0](true)

    expect(await wake).toBe(true)
  })
})
