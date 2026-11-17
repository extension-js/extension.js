import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {HOST_CHECK_MIDDLEWARE_NAME} from '../cors'
import {
  buildServerConfig,
  type ServerConfigInput,
  shouldWriteAssetToDisk
} from '../server-config'

const ROOT = path.resolve('/proj')
const PUBLIC = path.join(ROOT, 'public')

function input(overrides: Partial<ServerConfigInput> = {}): ServerConfigInput {
  return {
    host: '127.0.0.1',
    port: 51234,
    connectableHost: '127.0.0.1',
    emulatorOrigin: null,
    isSessionExtensionOrigin: () => false,
    publicFolder: PUBLIC,
    packageJsonDir: ROOT,
    emulatorFiles: null,
    activeCompiler: () => null,
    onHostRefused: () => {},
    server: undefined,
    env: {},
    ...overrides
  }
}

describe('buildServerConfig', () => {
  it('hands rspack the session host and port and leaves signals to us', () => {
    const config = buildServerConfig(input({host: '0.0.0.0', port: 6001}))

    expect(config.host).toBe('0.0.0.0')
    expect(config.port).toBe(6001)
    expect(config.compress).toBe(false)
    expect(config.setupExitSignals).toBe(false)
  })

  it('enables hot and liveReload but disables WDS client injection', () => {
    const config = buildServerConfig(input())

    expect(config.hot).toBe(true)
    expect(config.liveReload).toBe(true)
    expect(config.client).toBe(false)
  })

  it.each([
    ['/proj/dist/chrome/background.js', true],
    ['/proj/dist/chrome/manifest.json', false],
    ['/proj/dist/chrome/MANIFEST.JSON', false],
    ['manifest.json', false],
    ['C:\\proj\\dist\\chrome\\manifest.json', false],
    ['/proj/dist/chrome/../src/index.js', false],
    ['/proj/dist/chrome/manifest.json.map', true]
  ])('writes %s to disk: %s', (file, expected) => {
    const config = buildServerConfig(input())
    const writeToDisk = config.devMiddleware?.writeToDisk as (
      file: string
    ) => boolean

    expect(writeToDisk).toBe(shouldWriteAssetToDisk)
    expect(writeToDisk(file)).toBe(expected)
  })

  it('serves public/ without the stock watcher and watches it through watchFiles', () => {
    const config = buildServerConfig(input())

    expect(config.static).toEqual({directory: PUBLIC, watch: false})
    expect(config.watchFiles).toEqual({
      paths: [path.join(PUBLIC, '**/*')],
      options: {
        ignored: [path.join(ROOT, 'dist', '**/*')]
      }
    })
  })

  it('serves and watches nothing when the public folder is off', () => {
    const config = buildServerConfig(input({publicFolder: undefined}))

    expect(config.static).toBe(false)
    expect((config.watchFiles as {paths: string[]}).paths).toEqual([])
  })

  it.each([
    [{EXTENSION_WATCH_POLL: 'true'}, {usePolling: true, interval: 1000}],
    [
      {EXTENSION_WATCH_POLL: 'true', EXTENSION_WATCH_POLL_INTERVAL: '250'},
      {usePolling: true, interval: 250}
    ],
    [{EXTENSION_WATCH_POLL: '1'}, {}],
    [{}, {}]
  ])('reads the polling switch from %j', (env, expected) => {
    const config = buildServerConfig(input({env}))
    const options = (config.watchFiles as {options: Record<string, unknown>})
      .options

    expect(options).toEqual({
      ignored: [path.join(ROOT, 'dist', '**/*')],
      ...expected
    })
  })

  it('names the connectable host instead of admitting every Host header', () => {
    expect(buildServerConfig(input()).allowedHosts).toEqual(['127.0.0.1'])
    expect(
      buildServerConfig(
        input({
          host: '0.0.0.0',
          connectableHost: 'devbox.local',
          allowedHosts: 'a.test, .b.test,a.test',
          emulatorOrigin: 'https://viewer.example:8443'
        })
      ).allowedHosts
    ).toEqual(['devbox.local', 'viewer.example', 'a.test', '.b.test'])
  })

  it('reflects allow-origin for the extension alone, never a star', () => {
    const config = buildServerConfig(
      input({
        isSessionExtensionOrigin: (origin) =>
          origin === 'chrome-extension://abcdefgh'
      })
    )
    const headers = config.headers as (req: {
      headers: Record<string, string>
    }) => Array<{key: string; value: string}>
    const headerFor = (origin?: string) =>
      new Map(
        headers({headers: origin ? {origin} : {}}).map(({key, value}) => [
          key.toLowerCase(),
          value
        ])
      )

    expect(headerFor('chrome-extension://abcdefgh')).toEqual(
      new Map([
        ['vary', 'Origin'],
        ['access-control-allow-origin', 'chrome-extension://abcdefgh']
      ])
    )

    expect(headerFor('https://evil.test')).toEqual(
      new Map([['vary', 'Origin']])
    )

    expect(headerFor('chrome-extension://zzzzzzzz')).toEqual(
      new Map([['vary', 'Origin']])
    )

    expect(headerFor()).toEqual(new Map([['vary', 'Origin']]))
  })

  it('swaps the stock host check for ours in place', () => {
    const config = buildServerConfig(input())
    const stock = [
      {name: 'compression', middleware: () => {}},
      {name: HOST_CHECK_MIDDLEWARE_NAME, middleware: () => {}},
      {name: 'webpack-dev-middleware', middleware: () => {}}
    ]
    const result = config.setupMiddlewares?.(stock as never, {} as never) as
      | Array<{name: string; middleware: unknown}>
      | undefined

    expect(result?.map((entry) => entry.name)).toEqual([
      'compression',
      HOST_CHECK_MIDDLEWARE_NAME,
      'webpack-dev-middleware'
    ])

    expect(result?.[1]?.middleware).not.toBe(stock[1].middleware)
  })

  it('repairs a one-byte asset from whichever compiler is live', () => {
    const outputFor = (byte: string) => ({
      options: {output: {path: path.join(ROOT, 'dist', 'chrome')}},
      outputFileSystem: {readFileSync: () => Buffer.from(byte)}
    })
    let live = outputFor('a')
    const config = buildServerConfig(
      input({activeCompiler: () => live as never})
    )
    const repair = config.devMiddleware?.modifyResponseData as (
      ...args: unknown[]
    ) => {data: unknown; byteLength: number}
    const emptyStream = () => ({destroy: () => {}})
    const request = {url: '/icon.txt', headers: {}}
    const response = {statusCode: 200}

    expect(repair(request, response, emptyStream(), 0)).toEqual({
      data: Buffer.from('a'),
      byteLength: 1
    })

    live = outputFor('b')

    expect(repair(request, response, emptyStream(), 0)).toEqual({
      data: Buffer.from('b'),
      byteLength: 1
    })
  })
})
