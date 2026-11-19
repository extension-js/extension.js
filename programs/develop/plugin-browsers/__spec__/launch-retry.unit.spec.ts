import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

let printed: {log: string[]; warn: string[]; error: string[]}
const roots: string[] = []

beforeEach(() => {
  expect.hasAssertions()
  printed = {log: [], warn: [], error: []}
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    printed.log.push(parts.join(' '))
  })

  vi.spyOn(console, 'warn').mockImplementation((...parts: unknown[]) => {
    printed.warn.push(parts.join(' '))
  })

  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    printed.error.push(parts.join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()

  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

// A dev session's contract on disk, beside the build folder the launcher is
// handed, the way the engine writes it before the first compile ends.
function sessionContract(browser = 'chrome') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-browsers-'))
  roots.push(root)
  const output = path.join(root, 'dist', browser)
  const readyPath = path.join(
    root,
    'dist',
    'extension-js',
    browser,
    'ready.json'
  )
  fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  fs.writeFileSync(
    readyPath,
    JSON.stringify({status: 'ready', browser, pid: process.pid})
  )

  return {
    output,
    read: () => JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
  }
}

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
  browserOptions: {browser: string; logLevel?: string} = {browser: 'chrome'},
  output = OUTPUT
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
          output,
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

  // The launcher showed the failure with the tool's own output before it
  // threw, so a second block here would say the same thing twice.
  it('prints nothing for a launch failure the launcher already printed', async () => {
    const dev = session(
      vi
        .fn<Launcher>()
        .mockRejectedValueOnce(
          Object.assign(new Error('xcodebuild failed (exit 65)'), {
            code: 'E_SAFARI_TOOLCHAIN',
            printed: true
          })
        )
        .mockResolvedValueOnce(controller())
    )

    await dev.compile()

    expect(printed.error).toEqual([])
    expect(dev.errors).toEqual([{errors: ['xcodebuild failed (exit 65)']}])
    expect(dev.events).toEqual(['settled', 'error', 'compiled'])

    await dev.compile()

    expect(dev.launch).toHaveBeenCalledTimes(2)
    expect(dev.events.slice(3)).toEqual(['settled', 'ready', 'compiled'])
  })

  it.each([
    false,
    'true',
    undefined
  ])('prints a launch failure whose printed mark is %j', async (mark) => {
    const dev = session(async () => {
      throw Object.assign(new Error('Chrome binary not found'), {printed: mark})
    })

    await dev.compile()

    expect(printed.error).toEqual([
      messages.browserLaunchFailed('chrome', 'Chrome binary not found')
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

  // The browser runs with the extension, so a logging failure is a warning
  // beside a session that still says ready, never a failed launch.
  it('reports a logging setup failure as a warning and still says ready', async () => {
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

    expect(printed.error).toEqual([])
    expect(printed.warn).toHaveLength(1)
    expect(printed.warn[0]).toContain('Chrome is running with the extension')
    expect(printed.warn[0]).toContain('logging refused')
    expect(dev.errors).toEqual([])
    expect(dev.events).toEqual(['settled', 'ready', 'compiled', 'compiled'])
  })

  it('names the logging fault on the session contract under a warning code', async () => {
    const contract = sessionContract()
    const dev = session(
      async () =>
        controller({
          enableUnifiedLogging: vi.fn(async () => {
            throw Object.assign(new Error('Log.enable timed out'), {
              code: 'E_CDP_TIMEOUT'
            })
          })
        }),
      {browser: 'chrome', logLevel: 'info'},
      contract.output
    )

    await dev.compile()

    expect(contract.read()).toMatchObject({
      status: 'ready',
      cdpFaultCode: 'W_CDP_TIMEOUT',
      cdpFaultMessage: expect.stringContaining('Log.enable timed out')
    })
  })

  it('files a logging fault with no class of its own under the catch-all warning', async () => {
    const contract = sessionContract()
    const dev = session(
      async () =>
        controller({
          enableUnifiedLogging: vi.fn(async () => {
            throw new Error('logging refused')
          })
        }),
      {browser: 'chrome', logLevel: 'info'},
      contract.output
    )

    await dev.compile()

    expect(contract.read().cdpFaultCode).toBe('W_CDP_OP_FAILED')
  })

  // Pins current behavior: only the message reaches the public error event.
  it("drops the launcher's error code from the emitted error", async () => {
    const dev = session(async () => {
      throw Object.assign(new Error('Chrome binary not found'), {
        code: 'E_BROWSER_NOT_FOUND'
      })
    })

    await dev.compile()

    expect(dev.errors).toEqual([{errors: ['Chrome binary not found']}])
    expect(JSON.stringify(dev.errors)).not.toContain('E_BROWSER_NOT_FOUND')
  })

  // Pins current behavior: 'close' is declared on the plugin and never fires.
  it("never emits the declared 'close' event, and taps no hook that could", async () => {
    const dev = session(async () => controller())

    await dev.compile()
    await dev.compile(['src/manifest.json'])

    expect(dev.fake.tappers('watchClose')).toEqual([])
    expect(dev.fake.tappers('shutdown')).toEqual([])
    expect(dev.fake.tappers('done')).toContain(BrowsersPlugin.name)
    expect(dev.events).not.toContain('close')
  })

  // A session the dev server never handed a broker still classifies, and the
  // emitted event carries the reload, but nothing is sent or announced.
  it('emits the reload and sends nothing when no broker was handed in', async () => {
    const dev = session(async () => controller())

    await dev.compile()
    await dev.compile(['src/manifest.json'])

    expect(dev.compiled[1].reloadInstruction).toEqual({
      type: 'full',
      changedAssets: ['src/manifest.json'],
      label: 'extension (src/manifest.json)'
    })

    expect(printed.log).toEqual([])
    expect(printed.error).toEqual([])
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
