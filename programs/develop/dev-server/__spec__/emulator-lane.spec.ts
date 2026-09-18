import {createHash} from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import type {AddressInfo} from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createPlaywrightMetadataWriter} from '../../plugin-playwright'
import {
  buildEmulatorFileIndex,
  buildEmulatorViewerUrl,
  createEmulatorFileIndexHolder,
  createEmulatorFilesMiddleware,
  DEFAULT_EMULATOR_ORIGIN,
  EMULATOR_FILES_PATH,
  isSameWebOrigin,
  normalizeWebOrigin,
  resolveEmulatorOrigin
} from '../emulator-lane'

let dir: string
let server: http.Server | null = null

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-emulator-lane-'))
})

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = null
  }

  fs.rmSync(dir, {recursive: true, force: true})
})

function write(rel: string, content: string) {
  const file = path.join(dir, rel)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

function sha(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

describe('engine origin', () => {
  it('defaults to the hosted browsers origin', () => {
    expect(resolveEmulatorOrigin({})).toBe('https://browsers.extension.land')
    expect(DEFAULT_EMULATOR_ORIGIN).toBe('https://browsers.extension.land')
  })

  it('normalizes a configured origin to scheme, host and port', () => {
    expect(
      resolveEmulatorOrigin({
        EXTENSION_EMULATOR_ORIGIN: 'http://LOCALHOST:8787/some/path'
      })
    ).toBe('http://localhost:8787')

    expect(normalizeWebOrigin('https://browsers.extension.land:443')).toBe(
      'https://browsers.extension.land'
    )
  })

  it('refuses an origin that is not http or https', () => {
    expect(() =>
      resolveEmulatorOrigin({EXTENSION_EMULATOR_ORIGIN: 'chrome-extension://x'})
    ).toThrow(/http or https origin/)

    expect(normalizeWebOrigin('null')).toBeNull()
    expect(normalizeWebOrigin('https://user:pw@browsers.extension.land')).toBe(
      null
    )
  })

  it('compares scheme, host and port exactly', () => {
    const engine = 'https://browsers.extension.land'
    expect(isSameWebOrigin('https://browsers.extension.land', engine)).toBe(
      true
    )

    expect(isSameWebOrigin('http://browsers.extension.land', engine)).toBe(
      false
    )

    expect(
      isSameWebOrigin('https://browsers.extension.land:8443', engine)
    ).toBe(false)

    expect(
      isSameWebOrigin('https://browsers.extension.land.evil.test', engine)
    ).toBe(false)

    expect(isSameWebOrigin('https://evil.test', engine)).toBe(false)
    expect(isSameWebOrigin(undefined, engine)).toBe(false)
    expect(isSameWebOrigin(engine, null)).toBe(false)
  })
})

describe('viewer URL', () => {
  it('carries every session parameter in the fragment, none in the query', () => {
    const url = new URL(
      buildEmulatorViewerUrl({
        origin: 'https://browsers.extension.land',
        host: '127.0.0.1',
        port: 8080,
        controlPort: 61000,
        controlPath: '/extjs-control',
        instanceId: 'inst-1'
      })
    )

    expect(url.origin).toBe('https://browsers.extension.land')
    expect(url.pathname).toBe('/chromium/')
    expect(url.search).toBe('')

    const params = new URLSearchParams(url.hash.slice(1))
    expect([...params.keys()]).toEqual(['files', 'control', 'instance', 'v'])
    expect(params.get('files')).toBe(
      `http://127.0.0.1:8080${EMULATOR_FILES_PATH}`
    )

    expect(params.get('control')).toBe('ws://127.0.0.1:61000/extjs-control')
    expect(params.get('instance')).toBe('inst-1')
    expect(params.get('v')).toBe('1')
  })

  it('brackets an IPv6 host and drops control when the bridge is down', () => {
    const url = new URL(
      buildEmulatorViewerUrl({
        origin: 'http://localhost:8787',
        host: '::1',
        port: 8080,
        controlPort: null,
        controlPath: '/extjs-control',
        instanceId: 'inst-1'
      })
    )
    const params = new URLSearchParams(url.hash.slice(1))
    expect(params.get('files')).toBe(`http://[::1]:8080${EMULATOR_FILES_PATH}`)
    expect(params.has('control')).toBe(false)
  })
})

describe('files.json', () => {
  it('lists every dist file with its size and sha256, sorted', async () => {
    write('manifest.json', '{"manifest_version":3}')
    write('background/service_worker.js', 'self.a = 1')
    write('action/index.html', '<!doctype html>')
    write('.manifest.123.tmp', 'partial')

    const index = await buildEmulatorFileIndex(dir, 'inst-1')

    expect(index).toEqual({
      version: 1,
      instanceId: 'inst-1',
      root: '/',
      files: [
        {
          path: 'action/index.html',
          size: 15,
          sha256: sha('<!doctype html>')
        },
        {
          path: 'background/service_worker.js',
          size: 10,
          sha256: sha('self.a = 1')
        },
        {
          path: 'manifest.json',
          size: 22,
          sha256: sha('{"manifest_version":3}')
        }
      ]
    })
  })

  it('regenerates on refresh and serves JSON with CORS open', async () => {
    write('background/service_worker.js', 'v1')
    const holder = createEmulatorFileIndexHolder(dir, 'inst-1')
    const middleware = createEmulatorFilesMiddleware(holder)

    server = http.createServer((req, res) => {
      void middleware(req, res, () => {
        res.statusCode = 404
        res.end()
      })
    })

    await new Promise<void>((resolve) => server?.listen(0, resolve))
    const port = (server.address() as AddressInfo).port
    const url = `http://127.0.0.1:${port}${EMULATOR_FILES_PATH}`

    const first = await fetch(url)
    expect(first.status).toBe(200)
    expect(first.headers.get('access-control-allow-origin')).toBe('*')
    expect(first.headers.get('content-type')).toContain('application/json')
    expect((await first.json()).files[0].sha256).toBe(sha('v1'))

    write('background/service_worker.js', 'v2')
    const stale = await (await fetch(url)).json()
    expect(stale.files[0].sha256).toBe(sha('v1'))

    await holder.refresh()
    const fresh = await (await fetch(url)).json()
    expect(fresh.files[0].sha256).toBe(sha('v2'))

    const preflight = await fetch(url, {method: 'OPTIONS'})
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('ready.json engine marker', () => {
  function writerFor(browser: string) {
    const manifestPath = path.join(dir, 'src', 'manifest.json')
    write('src/manifest.json', '{"name":"x","version":"1.0.0"}')
    write(`dist/${browser}/manifest.json`, '{"name":"x","version":"1.0.0"}')

    return createPlaywrightMetadataWriter({
      packageJsonDir: dir,
      browser,
      command: 'dev',
      distPath: path.join(dir, 'dist', browser),
      manifestPath,
      port: 8080,
      instanceId: 'inst-1',
      controlPort: 61000,
      controlPath: '/extjs-control',
      managedExtensionDirs: [path.join(dir, 'companion')]
    })
  }

  it('stamps engine emulator, a null browserPid and no CDP or RDP port', () => {
    const writer = writerFor('chromium-emulator')
    writer.writeReady()
    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))

    expect(ready.engine).toBe('emulator')
    expect(ready.browserPid).toBeNull()
    expect(ready).not.toHaveProperty('cdpPort')
    expect(ready).not.toHaveProperty('rdpPort')
    expect(ready).not.toHaveProperty('extensionId')
    expect(ready).not.toHaveProperty('managedExtensions')
    expect(ready.distPath).toBe(path.join(dir, 'dist', 'chromium-emulator'))
  })

  it('leaves a chromium contract without the marker', () => {
    const writer = writerFor('chromium')
    writer.writeReady()
    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))

    expect(ready).not.toHaveProperty('engine')
    expect(ready).not.toHaveProperty('browserPid')
  })
})
