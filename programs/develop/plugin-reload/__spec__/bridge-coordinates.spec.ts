import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {idleCompiler, writeProject} from '../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import webpackConfig from '../../rspack-config'
import {ReloadPlugin} from '../index'
import {bakedBridgeControl} from './helpers/baked-bridge-control'

const makeTempFolder = trackTempFolders()

// No package scan and no companion extension: only the plugins are read.
vi.mock('../../lib/transpile-packages', async () => ({
  ...(await vi.importActual<object>('../../lib/transpile-packages')),
  resolveTranspilePackageDirs: () => []
}))

vi.mock('../../lib/extensions-to-load', async () => ({
  ...(await vi.importActual<object>('../../lib/extensions-to-load')),
  computeExtensionsToLoad: () => []
}))

type PluginOptions = ConstructorParameters<typeof ReloadPlugin>[0]

beforeEach(() => {
  vi.stubEnv('EXTENSION_CONTROL_PORT', undefined)
  vi.stubEnv('EXTENSION_INSTANCE_ID', undefined)
  vi.stubEnv('EXTENSION_NO_RELOAD', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// What a ReloadPlugin with these options bakes into the control file.
function bakedControl(options: Record<string, unknown> = {}) {
  const root = writeProject(makeTempFolder('extjs-bridge-coords-'), {
    'manifest.json': {
      manifest_version: 3,
      name: 'coordinates',
      version: '1.0.0',
      background: {service_worker: 'src/background.js'}
    },
    'src/background.js': ''
  })
  const compiler = idleCompiler(root, 'development')

  new ReloadPlugin({
    manifestPath: path.join(root, 'manifest.json'),
    browser: 'chrome',
    ...options
  } as PluginOptions).apply(compiler)

  return bakedBridgeControl(compiler)
}

describe('the bridge coordinates a ReloadPlugin bakes', () => {
  it('come from the environment when no option names them', () => {
    vi.stubEnv('EXTENSION_CONTROL_PORT', '8123')
    vi.stubEnv('EXTENSION_INSTANCE_ID', 'from-env')

    expect(bakedControl()).toMatchObject({port: 8123, instanceId: 'from-env'})
  })

  it('come from the environment even when options name others', () => {
    vi.stubEnv('EXTENSION_CONTROL_PORT', '8123')
    vi.stubEnv('EXTENSION_INSTANCE_ID', 'from-env')

    expect(
      bakedControl({instanceId: 'from-options', controlPort: 9001})
    ).toMatchObject({port: 8123, instanceId: 'from-env'})
  })

  it('are the same for two plugins whose options differ', () => {
    vi.stubEnv('EXTENSION_CONTROL_PORT', '8123')
    vi.stubEnv('EXTENSION_INSTANCE_ID', 'from-env')

    const first = bakedControl({instanceId: 'session-a', controlPort: 9001})
    const second = bakedControl({instanceId: 'session-b', controlPort: 9002})

    expect(first).toMatchObject({port: 8123, instanceId: 'from-env'})
    expect(second).toEqual(first)
  })
})

// The dev server hands each session's values to the config it builds.
describe('the reload plugin of a dev session config', () => {
  function bakedFor(instanceId: string, controlPort: number) {
    const root = makeTempFolder('extjs-bridge-config-')
    const manifestPath = path.join(root, 'manifest.json')

    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"demo"}')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({manifest_version: 3, name: 'x', version: '1.0.0'})
    )

    const config = webpackConfig(
      {manifestPath, packageJsonPath: path.join(root, 'package.json')} as never,
      {
        browser: 'chrome',
        mode: 'development',
        metadataCommand: 'dev',
        instanceId,
        controlPort,
        output: {clean: false, path: path.join(root, 'dist', 'chrome')},
        noBrowser: true
      } as never
    )
    const plugin = (config.plugins ?? []).find(
      (candidate: unknown) => candidate instanceof ReloadPlugin
    ) as ReloadPlugin
    const compiler = idleCompiler(root, 'development')

    plugin.apply(compiler)

    return bakedBridgeControl(compiler)
  }

  it('bakes the environment, whatever the session was given', () => {
    vi.stubEnv('EXTENSION_CONTROL_PORT', '8123')
    vi.stubEnv('EXTENSION_INSTANCE_ID', 'from-env')

    expect(bakedFor('session-a', 50111)).toMatchObject({
      port: 8123,
      instanceId: 'from-env'
    })
  })
})
