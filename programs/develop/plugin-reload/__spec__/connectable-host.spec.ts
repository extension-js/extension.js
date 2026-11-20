import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  compileFiles,
  idleCompiler,
  writeProject
} from '../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import webpackConfig from '../../rspack-config'
import {ReloadPlugin} from '../index'
import {InjectBridgeProducer} from '../steps/inject-bridge-producer'
import {bakedBridgeWorker} from './helpers/baked-bridge-control'

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

const HOST_ENV = 'EXTENSION_DEV_SERVER_CONNECTABLE_HOST'

// Two sessions of one host process: the second wrote its host last.
const SECOND_SESSION_ENV = 'session-b.example'

beforeEach(() => {
  vi.stubEnv('EXTENSION_CONTROL_PORT', undefined)
  vi.stubEnv('EXTENSION_INSTANCE_ID', undefined)
  vi.stubEnv('EXTENSION_NO_RELOAD', undefined)
  vi.stubEnv(HOST_ENV, SECOND_SESSION_ENV)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// The host the bridge producer source dials, as baked into a worker.
function bakedHost(workerSource: string | null | undefined) {
  return /var HOST = "([^"]*)"/.exec(String(workerSource))?.[1] ?? null
}

// A real development compile of one worker with a producer of these options.
async function compiledHost(options: Record<string, unknown>) {
  const root = writeProject(makeTempFolder('extjs-connectable-compile-'), {
    'src/background.js': 'console.log("worker")\n'
  })
  const {errors, files} = await compileFiles(
    root,
    {'background/service_worker': 'src/background.js'},
    new InjectBridgeProducer(options as never),
    'development'
  )

  expect(errors).toEqual([])

  return bakedHost(files['background/service_worker.js'])
}

// The host a dev session config bakes through its reload plugin.
function configHost(connectableHost: string, controlPort: number) {
  const root = makeTempFolder('extjs-connectable-config-')
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
      instanceId: `session-${controlPort}`,
      controlPort,
      connectableHost,
      output: {clean: false, path: path.join(root, 'dist', 'chrome')},
      noBrowser: true
    } as never
  )
  const plugin = (config.plugins ?? []).find(
    (candidate: unknown) => candidate instanceof ReloadPlugin
  ) as ReloadPlugin
  const compiler = idleCompiler(root, 'development')

  plugin.apply(compiler)

  return bakedHost(bakedBridgeWorker(compiler))
}

describe('the connectable host a bridge producer compiles in', () => {
  it('is the one each of two sessions was given, not the environment', async () => {
    vi.stubEnv(HOST_ENV, 'from-env.example')

    const first = await compiledHost({
      controlPort: 9001,
      connectableHost: 'session-a.example'
    })
    const second = await compiledHost({
      controlPort: 9002,
      connectableHost: 'session-b.example'
    })

    expect(first).toBe('session-a.example')
    expect(second).toBe('session-b.example')
  })

  it('is loopback for a blank option, whatever the environment', async () => {
    expect(await compiledHost({controlPort: 9001, connectableHost: '  '})).toBe(
      '127.0.0.1'
    )
  })

  it('is loopback when no option names one, whatever the environment says', async () => {
    expect(await compiledHost({controlPort: 9001})).toBe('127.0.0.1')
  })
})

describe('the connectable host of a dev session config', () => {
  it('is the one each of two sessions was given, not the environment', () => {
    vi.stubEnv(HOST_ENV, 'from-env.example')

    expect(configHost('session-a.example', 50111)).toBe('session-a.example')
    expect(configHost('session-b.example', 50222)).toBe('session-b.example')
  })
})
