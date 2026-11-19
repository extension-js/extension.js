import * as fs from 'node:fs'
import * as path from 'node:path'
import {sources} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {fakeCompiler} from '../../plugin-browsers/__spec__/fake-compiler'
import {
  type BrowserLaunchOptions,
  BrowsersPlugin
} from '../../plugin-browsers/index'
import {type ReloadBroker, readDevBuild} from '../index'
import {InjectBridgeProducer} from '../steps/inject-bridge-producer'

const BACKGROUND = 'background/service_worker.js'
const IDLE = 'console.log("nothing registered")\n'

const makeTempFolder = trackTempFolders()

beforeEach(() => {
  expect.hasAssertions()
  vi.stubEnv('EXTENSION_CONTROL_PORT', '8123')
  vi.stubEnv('EXTENSION_INSTANCE_ID', 'abc123')
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// A dev session where the step that reads the background and names the build
// shares one compiler with the plugin that launches and reloads.
function session(background: string, broker?: Partial<ReloadBroker>) {
  const root = makeTempFolder('extjs-browsers-producer-')
  const authored = path.join(root, 'background.js')
  const launcher = vi.fn(async (_options: BrowserLaunchOptions) => ({
    enableUnifiedLogging: vi.fn().mockResolvedValue(undefined)
  }))
  const plugin = new BrowsersPlugin({
    launcher,
    browserOptions: {browser: 'chrome'}
  })
  const frames: Array<Record<string, unknown>> = []

  fs.writeFileSync(authored, background)

  if (broker) {
    plugin.setReloadBroker({
      broadcastReload: (frame) => {
        frames.push({...frame})

        return 1
      },
      ...broker
    })
  }

  const fake = fakeCompiler({owner: BrowsersPlugin.name, context: root})

  new InjectBridgeProducer().apply(fake.compiler)
  plugin.apply(fake.compiler)

  // One compile whose background bundle holds the given bytes, through the
  // asset stage the producer step runs in and then the done hook.
  const compile = async (bundle: string, files: string[] = []) => {
    const assets = new Map<string, sources.Source>([
      [BACKGROUND, new sources.RawSource(bundle)],
      ['manifest.json', new sources.RawSource('{"manifest_version": 3}')]
    ])
    const stages: Array<() => void> = []

    const put = (name: string, source: sources.Source) => {
      assets.set(name, source)
    }

    const compilation = {
      errors: [],
      options: {context: root, output: {path: path.join(root, 'dist')}},
      modules: [{resource: authored}],
      chunkGraph: {getModuleChunksIterable: () => [{files: [BACKGROUND]}]},
      getAssets: () => [...assets].map(([name, source]) => ({name, source})),
      getAsset: (name: string) => {
        const source = assets.get(name)

        return source ? {name, source} : undefined
      },
      emitAsset: put,
      updateAsset: put,
      hooks: {
        processAssets: {
          tap: (_stage: unknown, run: () => void) => stages.push(run)
        }
      }
    }

    fake.watchRun(files)
    fake.thisCompilation(compilation)
    for (const run of stages) run()
    await fake.done(compilation)

    return compilation
  }

  return {launcher, frames, compile}
}

describe('the build a launched session names on a reload', () => {
  // A worker that already names this build is not restarted for it again,
  // which the broker can only tell when the frame carries the name.
  it('sends the reload with the build the compile gave its background', async () => {
    const dev = session(IDLE, {})

    await dev.compile('/* worker one */')
    const edited = await dev.compile('/* worker two */', ['src/manifest.json'])
    const build = readDevBuild(edited)

    expect(build).toMatch(/^[0-9a-f]{16}$/)
    expect(dev.frames).toEqual([
      {
        type: 'full',
        changedContentScriptEntries: undefined,
        label: 'extension (src/manifest.json)',
        changedFiles: ['src/manifest.json'],
        build
      }
    ])
  })
})
