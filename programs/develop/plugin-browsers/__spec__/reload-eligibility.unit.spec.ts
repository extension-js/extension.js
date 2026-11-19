import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {ReloadBroker} from '../../plugin-reload'
import {
  type BrowserController,
  type BrowserLaunchOptions,
  BrowsersPlugin,
  type CompiledEvent
} from '../index'
import {fakeCompilation, fakeCompiler} from './fake-compiler'

const CONTEXT = '/tmp/ext'
const OUTPUT = '/tmp/ext/dist/firefox'
const SHEET = 'content_scripts/content-0.css'
const FIRST = 'content_scripts/content-0.aaaaaaaa.js'
const SECOND = 'content_scripts/content-0.bbbbbbbb.js'
const THIRD = 'content_scripts/content-0.cccccccc.js'

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

type Launcher = (options: BrowserLaunchOptions) => Promise<BrowserController>

const browserUp: Launcher = async () => ({
  enableUnifiedLogging: vi.fn().mockResolvedValue(undefined)
})

interface Build {
  // The content script bundle the emitted manifest names.
  bundle?: string
  // The color of the one stylesheet that manifest names, when it names one.
  sheet?: string
  contentScripts?: number
  // Project-relative saves that started this rebuild.
  files?: string[]
  errors?: unknown[]
}

// A launched session on a fake compiler, with a broker that records every
// frame it is asked to send and says one producer took it.
function session(
  options: {
    browser?: string
    launcher?: Launcher
    broker?: boolean
    context?: string
    output?: string
  } = {}
) {
  const context = options.context ?? CONTEXT
  const output = options.output ?? OUTPUT
  const frames: Array<Record<string, unknown>> = []
  const broker: ReloadBroker = {
    broadcastReload: (frame) => {
      frames.push({...frame})

      return 1
    }
  }
  const launch = vi.fn(options.launcher ?? browserUp)
  const plugin = new BrowsersPlugin({
    launcher: launch,
    browserOptions: {browser: options.browser ?? 'firefox'}
  })
  const compiled: CompiledEvent[] = []
  const errors: string[][] = []

  if (options.broker !== false) plugin.setReloadBroker(broker)

  plugin.emitter.on('compiled', (event) => compiled.push(event))
  plugin.emitter.on('error', (event) => errors.push(event.errors))

  const fake = fakeCompiler({owner: BrowsersPlugin.name, context})
  plugin.apply(fake.compiler)

  return {
    frames,
    launch,
    compiled,
    errors,
    compile: async (build: Build = {}) => {
      fake.watchRun(build.files ?? [])

      await fake.done(
        fakeCompilation({
          context,
          output,
          errors: build.errors,
          assets: build.sheet
            ? {[SHEET]: `.probe { color: ${build.sheet}; }\n`}
            : {},
          manifest: {
            manifest_version: 3,
            name: 'fake',
            version: '0',
            background: {scripts: ['background/scripts.js']},
            content_scripts: Array.from(
              {length: build.contentScripts ?? 1},
              () => ({
                matches: ['<all_urls>'],
                js: [build.bundle ?? FIRST],
                ...(build.sheet ? {css: [SHEET]} : {})
              })
            )
          }
        })
      )
    }
  }
}

const sent = (dev: ReturnType<typeof session>) =>
  dev.frames.map((frame) => frame.type)

describe('when a compile of a launched session may reload', () => {
  it('sends nothing while no browser is up, and compares with the build the relaunch loaded', async () => {
    const dev = session({
      launcher: vi
        .fn<Launcher>()
        .mockRejectedValueOnce(new Error('Firefox binary not found'))
        .mockImplementation(browserUp)
    })

    await dev.compile({bundle: FIRST})
    await dev.compile({bundle: SECOND, files: ['src/manifest.json']})

    // The failed launch reports on 'error', so only the relaunch is compiled.
    expect(dev.launch).toHaveBeenCalledTimes(2)
    expect(dev.frames).toEqual([])
    expect(dev.compiled.map((event) => event.reloadInstruction)).toEqual([
      undefined
    ])

    await dev.compile({bundle: SECOND})

    expect(dev.frames).toEqual([])

    await dev.compile({bundle: THIRD})

    expect(sent(dev)).toEqual(['full'])
  })

  it('never compares a compile that failed with what the browser loaded', async () => {
    const dev = session()

    await dev.compile({bundle: FIRST})
    await dev.compile({bundle: SECOND, errors: [new Error('typo')]})
    await dev.compile({bundle: FIRST})

    expect(dev.errors).toEqual([['typo']])
    expect(dev.frames).toEqual([])
    expect(dev.compiled.map((event) => event.reloadInstruction)).toEqual([
      undefined,
      undefined
    ])

    await dev.compile({bundle: SECOND})

    expect(sent(dev)).toEqual(['full'])
  })

  // A worker reload makes the browser read the manifest again, as a reload
  // of the whole extension does.
  it('takes a worker reload as the browser reading the renamed bundle', async () => {
    const dev = session()

    await dev.compile({bundle: FIRST})
    await dev.compile({bundle: SECOND, files: ['src/background.ts']})
    await dev.compile({bundle: SECOND})

    expect(sent(dev)).toEqual(['service-worker'])
  })

  // Nothing can say a producer took the swap, so the open tabs are never
  // taken to hold the new bytes.
  it('names a rewritten stylesheet on every compile when no broker can deliver it', async () => {
    const dev = session({broker: false})

    await dev.compile({sheet: 'red'})
    await dev.compile({sheet: 'blue', files: ['src/widget.module.css']})
    await dev.compile({sheet: 'blue', files: ['src/notes.txt']})

    expect(
      dev.compiled.map((event) =>
        event.reloadInstruction?.refreshedStylesheets?.map((each) => each.file)
      )
    ).toEqual([undefined, [SHEET], [SHEET]])
  })
})
