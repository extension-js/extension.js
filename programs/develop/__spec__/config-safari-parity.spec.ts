import * as fs from 'node:fs'
import * as path from 'node:path'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {SafariPackagerFn, SafariPackagerOverrides} from '../types'
import {buildProject} from './helpers/build-project'
import {writeExtensionProject} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

// A dev session stops at the server, which is the one seam. The build is a
// real one, and both read the same extension.config.js from disk.
const devServer = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}))

vi.mock('../dev-server', () => ({devServer}))

import {extensionDev} from '../command-dev'

const tempFolder = trackTempFolders()

function project(config?: string) {
  return writeExtensionProject(tempFolder('safari-parity-'), {
    name: 'safari-parity',
    manifest: {background: {service_worker: 'background.js'}},
    config,
    files: {'background.js': 'console.log("started")\n'}
  })
}

function layers(config: {
  browser?: Record<string, unknown>
  command?: Record<string, unknown>
}): string {
  return JSON.stringify({
    ...(config.browser ? {browser: {safari: config.browser}} : {}),
    ...(config.command
      ? {commands: {build: config.command, dev: config.command}}
      : {})
  })
}

const commandLayer = {
  appName: 'Command App',
  bundleId: 'com.example.command',
  developmentTeam: 'CMDTEAM01',
  macOsOnly: false,
  forceRegenerate: true,
  safariBinary: '/Applications/Safari Technology Preview.app'
}

const browserLayer = {
  appName: 'Browser App',
  bundleId: 'com.example.browser',
  developmentTeam: 'BRWTEAM01',
  macOsOnly: true,
  forceRegenerate: false,
  safariBinary: '/Applications/Safari.app'
}

const identityKeys = [
  'appName',
  'bundleId',
  'developmentTeam',
  'macOsOnly',
  'forceRegenerate',
  'safariBinary'
] as const

function identityOf(overrides: SafariPackagerOverrides | undefined) {
  return Object.fromEntries(identityKeys.map((key) => [key, overrides?.[key]]))
}

async function buildPackagerInput(root: string) {
  const safariPackager = vi.fn<SafariPackagerFn>(async () => undefined)

  await buildProject(root, {browser: 'safari', safariPackager})

  return safariPackager
}

// The session hands its packager to the Safari plugin, which runs it after
// each compile. This runs it once, as the first compile would.
async function devPackagerInput(root: string) {
  const safariPackager = vi.fn<SafariPackagerFn>(async () => undefined)

  devServer.mockClear()

  await extensionDev(root, {
    browser: 'safari',
    install: false,
    safariPackager
  })

  const options = devServer.mock.calls[0]?.[1] as
    | {
        browsersPlugin?: {
          packager?: (distPath: string, mode: 'full') => Promise<unknown>
        }
      }
    | undefined

  await options?.browsersPlugin?.packager?.(
    path.join(root, 'dist', 'safari'),
    'full'
  )

  return safariPackager
}

describe('safari identity, dev versus build', () => {
  beforeEach(() => {
    devServer.mockClear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('hands both packagers the same identity from the command layer', async () => {
    const root = project(layers({browser: browserLayer, command: commandLayer}))

    const build = await buildPackagerInput(root)
    const dev = await devPackagerInput(root)

    expect(build).toHaveBeenCalledTimes(1)
    expect(dev).toHaveBeenCalledTimes(1)

    const buildIdentity = identityOf(build.mock.calls[0][2])
    const devIdentity = identityOf(dev.mock.calls[0][2])

    expect(buildIdentity).toEqual(commandLayer)
    expect(devIdentity).toEqual(commandLayer)
    expect(buildIdentity.macOsOnly).toBe(false)
  })

  it('hands both packagers the browser layer when no command layer is set', async () => {
    const root = project(layers({browser: browserLayer}))

    const build = await buildPackagerInput(root)
    const dev = await devPackagerInput(root)

    expect(identityOf(build.mock.calls[0][2])).toEqual(browserLayer)
    expect(identityOf(dev.mock.calls[0][2])).toEqual(browserLayer)
  })

  it('hands the build packager the folder the build wrote', async () => {
    const root = project()

    const build = await buildPackagerInput(root)
    const dist = path.join(root, 'dist', 'safari')

    expect(build.mock.calls[0][0]).toBe(dist)
    expect(build.mock.calls[0][1]).toBe('full')
    expect(
      JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8')).name
    ).toBe('safari-parity')
  })

  it('hands the dev packager the starting URL a config layer sets', async () => {
    const root = project(
      layers({browser: {startingUrl: 'http://127.0.0.1:8766/call.html'}})
    )

    const dev = await devPackagerInput(root)

    expect(dev.mock.calls[0][2]?.startingUrl).toBe(
      'http://127.0.0.1:8766/call.html'
    )
  })

  it('accepts a config bundle id whose segment starts with a digit', async () => {
    const root = project(layers({browser: {bundleId: 'com.1password.ext'}}))

    const build = await buildPackagerInput(root)

    expect(build).toHaveBeenCalledTimes(1)
    expect(identityOf(build.mock.calls[0][2]).bundleId).toBe(
      'com.1password.ext'
    )
  })

  it('refuses a bundle id from a config layer before any build or server starts', async () => {
    const fromBrowser = project(layers({browser: {bundleId: 'my extension'}}))
    const buildPackager = vi.fn<SafariPackagerFn>(async () => undefined)

    await expect(
      buildProject(fromBrowser, {
        browser: 'safari',
        safariPackager: buildPackager
      })
    ).rejects.toThrow(/bundle identifier/)

    expect(buildPackager).not.toHaveBeenCalled()
    // No compile ran: neither the output nor a staging folder beside it.
    expect(fs.existsSync(path.join(fromBrowser, 'dist'))).toBe(false)

    const fromCommand = project(layers({command: {bundleId: '../../etc/x'}}))
    const devPackager = vi.fn<SafariPackagerFn>(async () => undefined)

    await expect(
      extensionDev(fromCommand, {
        browser: 'safari',
        install: false,
        safariPackager: devPackager
      })
    ).rejects.toThrow(/bundle identifier/)

    expect(devPackager).not.toHaveBeenCalled()
    expect(devServer).not.toHaveBeenCalled()
  })

  it('packages the folder a re-pointed output.path emitted into', async () => {
    const root = project(
      `{
  config: (config) => ({
    ...config,
    output: {...config.output, path: require('path').join(__dirname, 'artifacts', 'web')}
  })
}`
    )
    const customOut = path.join(root, 'artifacts', 'web')

    const build = await buildPackagerInput(root)

    expect(build.mock.calls[0][0]).toBe(customOut)
    expect(fs.existsSync(path.join(customOut, 'manifest.json'))).toBe(true)
  })

  // The compile is a real one that is told to emit nothing, so the folder
  // the config points at is never made.
  it('refuses by name when the emitted folder is missing', async () => {
    const root = project(
      `{
  config: (config) => ({
    ...config,
    output: {...config.output, path: require('path').join(__dirname, 'artifacts', 'missing')},
    plugins: [
      ...config.plugins,
      {apply: (compiler) => compiler.hooks.shouldEmit.tap('emit-nothing', () => false)}
    ]
  })
}`
    )
    const missingOut = path.join(root, 'artifacts', 'missing')
    const safariPackager = vi.fn<SafariPackagerFn>(async () => undefined)

    await expect(
      buildProject(root, {browser: 'safari', safariPackager})
    ).rejects.toMatchObject({
      code: 'E_PREVIEW_NO_DIST',
      message: expect.stringContaining(missingOut)
    })

    expect(safariPackager).not.toHaveBeenCalled()
    expect(fs.existsSync(missingOut)).toBe(false)
  })
})
