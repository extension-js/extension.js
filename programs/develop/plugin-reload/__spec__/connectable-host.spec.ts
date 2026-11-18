import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import webpackConfig from '../../rspack-config'
import {ReloadPlugin} from '../index'
import {InjectBridgeProducer} from '../steps/inject-bridge-producer'
import HMRDevServerPlugin from '../steps/setup-reload-strategy/webpack-target-webextension-fork/lib/webpack5/HMRDevServer'
import {
  bakedBridgeWorker,
  compileFiles,
  idleCompiler,
  writeProject
} from './helpers/real-compiler'

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

// The hostname the HMR client of a real compiler is told to dial.
function hmrHost(options?: Record<string, unknown>) {
  const root = makeTempFolder('extjs-connectable-hmr-')
  const compiler: Compiler = idleCompiler(root, 'development')

  compiler.options.devServer = {hot: true, host: '0.0.0.0', port: 8080}

  const Plugin = HMRDevServerPlugin as unknown as new (
    options?: Record<string, unknown>
  ) => {apply(compiler: Compiler): void}

  new Plugin(options).apply(compiler)

  const client = compiler.options.devServer?.client as {
    webSocketURL?: {hostname?: string}
  }

  return client.webSocketURL?.hostname ?? null
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

  it('is the environment when no option names one', async () => {
    expect(await compiledHost({controlPort: 9001})).toBe(SECOND_SESSION_ENV)
  })
})

describe('the connectable host of a dev session config', () => {
  it('is the one each of two sessions was given, not the environment', () => {
    vi.stubEnv(HOST_ENV, 'from-env.example')

    expect(configHost('session-a.example', 50111)).toBe('session-a.example')
    expect(configHost('session-b.example', 50222)).toBe('session-b.example')
  })
})

describe('the hostname the HMR client is told to dial', () => {
  it('is the one each of two sessions was given, not the environment', () => {
    vi.stubEnv(HOST_ENV, 'from-env.example')

    expect(hmrHost({connectableHost: 'session-a.example'})).toBe(
      'session-a.example'
    )

    expect(hmrHost({connectableHost: 'session-b.example'})).toBe(
      'session-b.example'
    )
  })

  it('is the environment when no option names one', () => {
    expect(hmrHost()).toBe(SECOND_SESSION_ENV)
  })

  it('is loopback for a wildcard bind with no host anywhere', () => {
    vi.stubEnv(HOST_ENV, undefined)

    expect(hmrHost()).toBe('127.0.0.1')
  })
})
