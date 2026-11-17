import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as messages from '../../lib/messages'
import {
  type BrowserController,
  type BrowserLaunchOptions,
  BrowsersPlugin,
  type BuildErrorEvent,
  type CompiledEvent
} from '../index'
import {fakeCompilation, fakeCompiler} from './fake-compiler'

const CONTEXT = '/tmp/project'
const OUTPUT = '/tmp/project/dist/chrome'

let printed: {log: string[]; error: string[]}

beforeEach(() => {
  expect.hasAssertions()
  printed = {log: [], error: []}
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    printed.log.push(parts.join(' '))
  })

  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    printed.error.push(parts.join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const controller = (
  overrides: Partial<BrowserController> = {}
): BrowserController => ({
  enableUnifiedLogging: vi.fn().mockResolvedValue(undefined),
  ...overrides
})

type Launcher = (options: BrowserLaunchOptions) => Promise<BrowserController>

// A dev session on a fake compiler: every event the plugin emits and every
// listener call it makes is recorded, in order.
function session(
  launcher: Launcher,
  browserOptions: {browser: string; logLevel?: string} = {browser: 'chrome'}
) {
  const launch = vi.fn(launcher)
  const plugin = new BrowsersPlugin({launcher: launch, browserOptions})
  const events: string[] = []
  const compiled: CompiledEvent[] = []
  const errors: BuildErrorEvent[] = []

  plugin.emitter.on('compiled', (event) => {
    compiled.push(event)
    events.push('compiled')
  })

  plugin.emitter.on('error', (event) => {
    errors.push(event)
    events.push('error')
  })

  plugin.emitter.on('close', () => events.push('close'))
  plugin.setReadyListener(() => events.push('ready'))
  plugin.setLaunchSettledListener(() => events.push('settled'))

  const fake = fakeCompiler({owner: BrowsersPlugin.name, context: CONTEXT})
  plugin.apply(fake.compiler)

  return {
    plugin,
    launch,
    fake,
    events,
    compiled,
    errors,
    compile: async (files: string[] = []) => {
      fake.watchRun(files)
      await fake.done(
        fakeCompilation({
          context: CONTEXT,
          output: OUTPUT,
          manifest: {manifest_version: 3, name: 'fake', version: '0'}
        })
      )
    }
  }
}

describe('browser launch slot', () => {
  it('launches again on the next compile after a launch that threw', async () => {
    const dev = session(
      vi
        .fn<Launcher>()
        .mockRejectedValueOnce(new Error('Chrome binary not found'))
        .mockResolvedValueOnce(controller())
    )

    await dev.compile()

    expect(dev.events).toEqual(['settled', 'error', 'compiled'])
    expect(printed.error).toEqual([
      messages.browserLaunchFailed('chrome', 'Chrome binary not found')
    ])

    await dev.compile()

    expect(dev.launch).toHaveBeenCalledTimes(2)
    expect(dev.events).toEqual([
      'settled',
      'error',
      'compiled',
      'settled',
      'ready',
      'compiled'
    ])
  })

  it('reports the retried compile as the first one', async () => {
    const dev = session(
      vi
        .fn<Launcher>()
        .mockRejectedValueOnce(new Error('Chrome binary not found'))
        .mockResolvedValueOnce(controller())
    )

    await dev.compile()
    await dev.compile()

    expect(dev.compiled.map((event) => event.isFirstCompile)).toEqual([
      true,
      true
    ])
  })

  it('does not launch twice once a browser is up', async () => {
    const dev = session(async () => controller())

    await dev.compile()
    await dev.compile()

    expect(dev.launch).toHaveBeenCalledTimes(1)
    expect(dev.compiled.map((event) => event.isFirstCompile)).toEqual([
      true,
      false
    ])

    expect(dev.events).toEqual(['settled', 'ready', 'compiled', 'compiled'])
    expect(printed.error).toEqual([])
  })

  it('keeps a running browser when only logging setup fails', async () => {
    const dev = session(
      async () =>
        controller({
          enableUnifiedLogging: vi.fn(async () => {
            throw new Error('logging refused')
          })
        }),
      {browser: 'chrome', logLevel: 'info'}
    )

    await dev.compile()
    await dev.compile()

    expect(dev.launch).toHaveBeenCalledTimes(1)
  })
})

// The ready contract of a dev session waits for what the launcher stamps,
// so it has to hear the launcher come back whichever way that goes.
describe('the launch settled listener', () => {
  it('hears the launcher come back with a browser, once', async () => {
    const dev = session(async () => controller())

    await dev.compile()
    await dev.compile()

    expect(dev.events.filter((event) => event === 'settled')).toHaveLength(1)
  })

  it('hears a launch that threw', async () => {
    const dev = session(async () => {
      throw new Error('Chrome binary not found')
    })

    await dev.compile()

    expect(dev.events).toEqual(['settled', 'error', 'compiled'])
  })

  it('never lets a throwing listener break the compile loop', async () => {
    const dev = session(async () => controller())
    dev.plugin.setLaunchSettledListener(() => {
      throw new Error('listener failed')
    })

    await dev.compile()

    expect(dev.events).toEqual(['ready', 'compiled'])
  })
})
