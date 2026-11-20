import * as fs from 'node:fs'
import * as path from 'node:path'
import {Compilation, type Compiler, rspack, type Stats} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {buildPages, writePageProject} from '../../__spec__/helpers/page-builds'
import {writeProject} from '../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {ReloadPlugin} from '../index'
import {
  BRIDGE_STAGE_AFTER_REPORT,
  DEV_CONTENT_SCRIPTS_STAGE_AFTER_REPORT,
  REPLAY_SHIM_STAGE_AFTER_REPORT
} from '../steps/stages'
import {sessionBridge, setSessionBridge} from './helpers/session-bridge'

const makeTempFolder = trackTempFolders()

beforeEach(() => {
  setSessionBridge({controlPort: 8123})
  vi.stubEnv('EXTENSION_NO_RELOAD', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// What a step of another plugin at the shared report stage sees in the
// background, whichever plugin the config registers first.
function probeAt(stage: number, seen: string[]) {
  return {
    apply(compiler: Compiler) {
      compiler.hooks.thisCompilation.tap('stage-probe', (compilation) => {
        compilation.hooks.processAssets.tap(
          {name: 'stage-probe', stage},
          () => {
            const background = compilation.getAsset(
              'background/service_worker.js'
            )
            seen.push(String(background?.source.source() ?? ''))
          }
        )
      })
    }
  }
}

async function compileWith(plugins: Array<{apply(c: Compiler): void}>) {
  const root = writeProject(makeTempFolder('extjs-reload-stage-'), {
    'manifest.json': {
      manifest_version: 3,
      name: 'stage',
      version: '1.0.0',
      background: {service_worker: 'src/background.js'}
    },
    'src/background.js': "console.log('worker')\n"
  })
  const compiler = rspack({
    mode: 'development',
    context: root,
    devtool: false,
    entry: {},
    output: {path: path.join(root, 'dist'), publicPath: '/'},
    plugins: [
      new ReloadPlugin({
        ...sessionBridge(),
        manifestPath: path.join(root, 'manifest.json'),
        browser: 'chrome',
        devSession: true
      } as ConstructorParameters<typeof ReloadPlugin>[0]),
      ...plugins
    ]
  })
  const stats = await new Promise<Stats>((resolve, reject) =>
    compiler.run((error, result) =>
      error || !result ? reject(error) : resolve(result)
    )
  )
  await new Promise((resolve) => compiler.close(resolve))

  expect(stats.hasErrors()).toBe(false)

  return String(
    stats.compilation.getAsset('background/service_worker.js')?.source.source()
  )
}

describe('the stage the reload steps write the background at', () => {
  it('comes after every step of the shared report stage', async () => {
    const seen: string[] = []
    const background = await compileWith([
      probeAt(Compilation.PROCESS_ASSETS_STAGE_REPORT + 100, seen),
      probeAt(Compilation.PROCESS_ASSETS_STAGE_REPORT + 101, seen)
    ])

    expect(background).toContain('__extjsScriptsReplayInstalled')
    expect(
      seen.map((text) => text.includes('__extjsScriptsReplayInstalled'))
    ).toEqual([false, false])
  })
})

// Three steps prepend to the background, so the last to run sits on top.
// Each has a stage of its own: the order never rests on which was applied
// first.
describe('the order the reload steps write the background in', () => {
  it('gives the replay shim, the stand-ins and the bridge one stage each', () => {
    expect([
      REPLAY_SHIM_STAGE_AFTER_REPORT,
      DEV_CONTENT_SCRIPTS_STAGE_AFTER_REPORT,
      BRIDGE_STAGE_AFTER_REPORT
    ]).toEqual([149, 150, 151])
  })

  it('names each stage in the step that owns it and nowhere else', () => {
    const steps = path.resolve(__dirname, '..', 'steps')
    const users = (name: string) =>
      fs
        .readdirSync(steps)
        .filter(
          (file) =>
            file !== 'stages.ts' &&
            file.endsWith('.ts') &&
            fs.readFileSync(path.join(steps, file), 'utf8').includes(name)
        )
        .sort()

    expect(users('REPLAY_SHIM_STAGE_AFTER_REPORT')).toEqual([
      'inject-scripts-replay-shim.ts'
    ])

    expect(users('DEV_CONTENT_SCRIPTS_STAGE_AFTER_REPORT')).toEqual([
      'setup-dev-content-scripts.ts'
    ])

    expect(users('BRIDGE_STAGE_AFTER_REPORT')).toEqual([
      'inject-bridge-producer.ts',
      'inject-bridge-relay.ts'
    ])
  })

  it('leaves the bridge above the stand-ins above the replay shim in a dev session', async () => {
    const root = fs.realpathSync(makeTempFolder('extjs-reload-order-'))

    writePageProject(root)

    const built = await buildPages(root, 'development session')
    const background = fs.readFileSync(
      path.join(
        root,
        'dist',
        'chrome-development-session',
        'background',
        'service_worker.js'
      ),
      'utf8'
    )
    const at = [
      '__extjsBridgeProducerInstalled',
      '__extjsDevContentScriptsInstalled',
      '__extjsScriptsReplayInstalled'
    ].map((marker) => background.indexOf(marker))

    expect(built.errors).toEqual([])
    expect(at.every((index) => index !== -1)).toBe(true)
    expect(at).toEqual([...at].sort((a, b) => a - b))
  }, 180_000)
})
