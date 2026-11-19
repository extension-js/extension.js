import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {HOST_CHECK_MIDDLEWARE_NAME, REQUEST_SITE_MIDDLEWARE_NAME} from '../cors'
import {createEmulatorFileIndexHolder} from '../emulator-lane'
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
    onSiteRefused: () => {},
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
    ['/proj/dist/chrome/background.js', '/proj/dist/chrome', true],
    ['/proj/dist/chrome/manifest.json', '/proj/dist/chrome', false],
    ['/proj/dist/chrome/MANIFEST.JSON', '/proj/dist/chrome', false],
    ['/proj/dist/chrome/manifest.json', '/proj/dist/chrome/', false],
    ['/proj/dist/chrome/./manifest.json', '/proj/dist/chrome', false],
    ['manifest.json', '/proj/dist/chrome', false],
    ['/proj/dist/chrome/app/manifest.json', '/proj/dist/chrome', true],
    ['/proj/dist/chrome/a/b/manifest.json', '/proj/dist/chrome', true],
    ['app/manifest.json', '/proj/dist/chrome', true],
    ['/proj/dist/chrome/manifest.json.map', '/proj/dist/chrome', true],
    ['/proj/dist/chrome/web.manifest.json', '/proj/dist/chrome', true],
    ['/proj/dist/chrome/../src/index.js', '/proj/dist/chrome', false],
    ['/proj/dist/chrome/app/../manifest.json', '/proj/dist/chrome', false],
    // A sibling folder whose name only starts like the output folder.
    ['/proj/dist/chrome-beta/manifest.json', '/proj/dist/chrome', true],
    ['C:\\proj\\dist\\chrome\\manifest.json', 'C:\\proj\\dist\\chrome', false],
    [
      'C:\\proj\\dist\\chrome\\manifest.json',
      'C:\\proj\\dist\\chrome\\',
      false
    ],
    ['c:\\Proj\\Dist\\Chrome\\Manifest.json', 'C:\\proj\\dist\\chrome', false],
    ['C:/proj/dist/chrome/manifest.json', 'C:\\proj\\dist\\chrome', false],
    ['C:\\proj\\dist\\chrome\\manifest.json', 'C:/proj/dist/chrome', false],
    [
      '\\\\?\\C:\\proj\\dist\\chrome\\manifest.json',
      'C:\\proj\\dist\\chrome',
      false
    ],
    ['\\\\host\\share\\dist\\manifest.json', '\\\\host\\share\\dist', false],
    [
      'C:\\proj\\dist\\chrome\\app\\manifest.json',
      'C:\\proj\\dist\\chrome',
      true
    ],
    ['C:/proj/dist/chrome/app/manifest.json', 'C:\\proj\\dist\\chrome', true],
    ['C:\\proj\\dist\\chrome\\app/manifest.json', 'C:/proj/dist/chrome', true],
    ['D:\\proj\\dist\\chrome\\manifest.json', 'C:\\proj\\dist\\chrome', true],
    [
      'C:\\proj\\dist\\chrome\\..\\src\\index.js',
      'C:\\proj\\dist\\chrome',
      false
    ]
  ])('writes %s under %s to disk: %s', (file, outputPath, expected) => {
    expect(shouldWriteAssetToDisk(file, outputPath)).toBe(expected)
  })

  it.each([
    ['/proj/dist/chrome/manifest.json', false],
    ['/proj/dist/chrome/app/manifest.json', false],
    ['C:\\proj\\dist\\chrome\\app\\Manifest.json', false],
    ['/proj/dist/chrome/background.js', true]
  ])('with no output folder known, writes %s to disk: %s', (file, expected) => {
    expect(shouldWriteAssetToDisk(file, undefined)).toBe(expected)
  })

  it('judges a file against the output folder of the live compiler', () => {
    let outputPath: string | undefined = '/proj/dist/chrome'
    const config = buildServerConfig(
      input({
        activeCompiler: () =>
          (outputPath
            ? {options: {output: {path: outputPath}}}
            : null) as ReturnType<ServerConfigInput['activeCompiler']>
      })
    )
    const writeToDisk = config.devMiddleware?.writeToDisk as (
      file: string
    ) => boolean

    expect(writeToDisk('/proj/dist/chrome/manifest.json')).toBe(false)
    expect(writeToDisk('/proj/dist/chrome/app/manifest.json')).toBe(true)

    // A restart can swap in a compiler that writes to another folder.
    outputPath = '/proj/dist/firefox'
    expect(writeToDisk('/proj/dist/firefox/manifest.json')).toBe(false)

    outputPath = undefined
    expect(writeToDisk('/proj/dist/chrome/app/manifest.json')).toBe(false)
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

  it('swaps the two stock request checks for ours in place', () => {
    const config = buildServerConfig(input())
    const stock = [
      {name: HOST_CHECK_MIDDLEWARE_NAME, middleware: () => {}},
      {name: REQUEST_SITE_MIDDLEWARE_NAME, middleware: () => {}},
      {name: 'compression', middleware: () => {}},
      {name: 'webpack-dev-middleware', middleware: () => {}}
    ]
    const result = config.setupMiddlewares?.(stock as never, {} as never) as
      | Array<{name: string; middleware: unknown}>
      | undefined

    expect(result?.map((entry) => entry.name)).toEqual([
      HOST_CHECK_MIDDLEWARE_NAME,
      REQUEST_SITE_MIDDLEWARE_NAME,
      'compression',
      'webpack-dev-middleware'
    ])

    expect(result?.[0]?.middleware).not.toBe(stock[0].middleware)
    expect(result?.[1]?.middleware).not.toBe(stock[1].middleware)
  })

  it('adds the request site check after the host check when stock has none', () => {
    const config = buildServerConfig(input())
    const stock = [
      {name: 'compression', middleware: () => {}},
      {name: HOST_CHECK_MIDDLEWARE_NAME, middleware: () => {}},
      {name: 'webpack-dev-middleware', middleware: () => {}}
    ]
    const result = config.setupMiddlewares?.(stock as never, {} as never) as
      | Array<{name: string}>
      | undefined

    expect(result?.map((entry) => entry.name)).toEqual([
      'compression',
      HOST_CHECK_MIDDLEWARE_NAME,
      REQUEST_SITE_MIDDLEWARE_NAME,
      'webpack-dev-middleware'
    ])
  })

  it('serves the viewer file index after both request checks', () => {
    const config = buildServerConfig(
      input({
        emulatorOrigin: 'https://viewer.example',
        emulatorFiles: createEmulatorFileIndexHolder('instance')
      })
    )
    const stock = [
      {name: HOST_CHECK_MIDDLEWARE_NAME, middleware: () => {}},
      {name: REQUEST_SITE_MIDDLEWARE_NAME, middleware: () => {}},
      {name: 'webpack-dev-middleware', middleware: () => {}}
    ]
    const result = config.setupMiddlewares?.(stock as never, {} as never) as
      | Array<{name: string}>
      | undefined

    expect(result?.map((entry) => entry.name)).toEqual([
      HOST_CHECK_MIDDLEWARE_NAME,
      REQUEST_SITE_MIDDLEWARE_NAME,
      'extjs-emulator-files',
      'webpack-dev-middleware'
    ])
  })

  it('reports a refused request once per session, across restarts', () => {
    const refused: string[] = []
    const config = buildServerConfig(
      input({onSiteRefused: (origin) => refused.push(origin)})
    )

    const refuse = (origin = 'https://other.test') => {
      const entries = config.setupMiddlewares?.(
        [{name: HOST_CHECK_MIDDLEWARE_NAME, middleware: () => {}}] as never,
        {isValidHost: () => true} as never
      ) as unknown as Array<{
        name: string
        middleware: (req: unknown, res: unknown, next: () => void) => void
      }>
      const check = entries.find(
        (entry) => entry.name === REQUEST_SITE_MIDDLEWARE_NAME
      )
      const response = {statusCode: 0, setHeader: () => {}, end: () => {}}
      let passed = false

      check?.middleware(
        {
          headers: {
            host: '127.0.0.1:51234',
            origin,
            'sec-fetch-site': 'cross-site'
          }
        },
        response,
        () => {
          passed = true
        }
      )

      return {status: response.statusCode, passed}
    }

    // An extension the session has not met yet is refused without a line.
    expect(refuse('chrome-extension://abcdefgh')).toEqual({
      status: 403,
      passed: false
    })

    expect(refused).toEqual([])
    expect(refuse()).toEqual({status: 403, passed: false})
    expect(refuse()).toEqual({status: 403, passed: false})
    // A restart runs setupMiddlewares again on the same config.
    expect(refuse()).toEqual({status: 403, passed: false})
    expect(refused).toEqual(['https://other.test'])
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
