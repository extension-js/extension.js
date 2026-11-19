import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {
  fakeCompilation,
  fakeCompiler
} from '../../plugin-browsers/__spec__/fake-compiler'
import {
  type BrowserController,
  type BrowserLaunchOptions,
  BrowsersPlugin,
  type CompiledEvent
} from '../../plugin-browsers/index'
import {classifyReloadFromSources, type ReloadBroker} from '../index'

const CONTEXT = '/tmp/ext'
const OUTPUT = '/tmp/ext/dist/firefox'
const SHEET = 'content_scripts/content-0.css'
const FIRST = 'content_scripts/content-0.aaaaaaaa.js'

const makeTempFolder = trackTempFolders()

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

describe('what a launched session hands the reload classifier and the broker', () => {
  // Only a classifier told both folders can see that the build copied the
  // page, which is what makes the producer reload the tabs that show it.
  it('hands over the output folder and the project root, so a copied page names itself', async () => {
    const root = makeTempFolder('extjs-browsers-page-')
    const output = path.join(root, 'dist')
    const page = '<!doctype html><title>options</title>\n'

    for (const dir of [root, output]) {
      fs.mkdirSync(path.join(dir, 'pages'), {recursive: true})
      fs.writeFileSync(path.join(dir, 'pages/options.html'), page)
    }

    const dev = session({browser: 'chrome', context: root, output})

    await dev.compile({contentScripts: 0})
    await dev.compile({contentScripts: 0, files: ['pages/options.html']})

    expect(dev.frames).toEqual([
      {
        type: 'page',
        label: 'options page (pages/options.html)',
        changedContentScriptEntries: undefined,
        changedFiles: ['pages/options.html'],
        standalonePages: ['pages/options.html']
      }
    ])
  })

  it('emits and sends the instruction the classifier answers for the same save', async () => {
    const dev = session({browser: 'chrome'})
    const classified = classifyReloadFromSources({
      changedSources: ['src/content/scripts.js'],
      getContentScriptCount: () => 2,
      outputPath: OUTPUT,
      contextDir: CONTEXT
    })

    await dev.compile({contentScripts: 2})
    await dev.compile({contentScripts: 2, files: ['src/content/scripts.js']})

    expect(classified).toEqual({
      type: 'content-scripts',
      changedContentScriptEntries: [
        'content_scripts/content-0',
        'content_scripts/content-1'
      ],
      changedAssets: ['src/content/scripts.js'],
      label: 'content_script (src/content/scripts.js)'
    })

    expect(dev.compiled[1].reloadInstruction).toEqual(classified)
    expect(dev.frames).toEqual([
      {
        type: 'content-scripts',
        changedContentScriptEntries: [
          'content_scripts/content-0',
          'content_scripts/content-1'
        ],
        label: 'content_script (src/content/scripts.js)',
        changedFiles: ['src/content/scripts.js']
      }
    ])

    expect(printed.log).toEqual([
      expect.stringContaining(
        'Reloading content_script (src/content/scripts.js)'
      )
    ])
  })
})
