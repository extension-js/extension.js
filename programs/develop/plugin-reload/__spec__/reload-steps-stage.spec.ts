import * as path from 'node:path'
import {Compilation, type Compiler, rspack, type Stats} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {writeProject} from '../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {ReloadPlugin} from '../index'

const makeTempFolder = trackTempFolders()

beforeEach(() => {
  vi.stubEnv('EXTENSION_CONTROL_PORT', '8123')
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
