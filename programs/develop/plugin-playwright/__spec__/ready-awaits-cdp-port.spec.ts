import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createPlaywrightMetadataWriter} from '../index'

// The Chromium launcher stamps the browser process and its CDP port after the
// compile. A dev contract that went ready on the compile named neither.
describe('a Chromium dev contract holds ready until the launch is stamped', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-awaits-cdp-'))
    fs.mkdirSync(path.join(tmp, 'src'), {recursive: true})
    fs.writeFileSync(
      path.join(tmp, 'src', 'manifest.json'),
      JSON.stringify({name: 'Fixture', version: '1.0.0'})
    )
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = (
    overrides: Partial<Parameters<typeof createPlaywrightMetadataWriter>[0]>
  ) =>
    createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'chrome',
      command: 'dev',
      distPath: path.join(tmp, 'dist', overrides.browser || 'chrome'),
      manifestPath: path.join(tmp, 'src', 'manifest.json'),
      readyAwaitsCdpPort: true,
      ...overrides
    })

  const readyPath = (browser = 'chrome') =>
    path.join(tmp, 'dist', 'extension-js', browser, 'ready.json')

  const readContract = (browser = 'chrome') =>
    JSON.parse(fs.readFileSync(readyPath(browser), 'utf-8')) as Record<
      string,
      unknown
    >

  const patchContract = (patch: Record<string, unknown>) => {
    fs.writeFileSync(readyPath(), JSON.stringify({...readContract(), ...patch}))
  }

  const launchStamp = {
    browserPid: 4242,
    binary: '/browsers/chrome',
    profilePath: '/profiles/one'
  }

  it('keeps the compile at starting with its compiledAt while nothing is stamped', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')

    const ready = readContract()
    expect(ready.status).toBe('starting')
    expect(ready.compiledAt).toBe('2026-11-01T00:00:00.000Z')
    expect(ready.browserPid).toBeUndefined()
  })

  it('stays at starting on a recompile that finds the process but no port', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    patchContract(launchStamp)

    writer.writeReady('2026-11-01T00:00:01.000Z')

    expect(readContract().status).toBe('starting')
    expect(readContract().browserPid).toBe(4242)
  })

  it('goes ready on the recompile after the launcher stamped the port, and keeps the launch', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    patchContract({...launchStamp, cdpPort: 9222})

    writer.writeReady('2026-11-01T00:00:01.000Z')

    const ready = readContract()
    expect(ready.status).toBe('ready')
    expect(ready.cdpPort).toBe(9222)
    expect(ready.browserPid).toBe(4242)
    expect(ready.binary).toBe('/browsers/chrome')
  })

  it('goes ready with the fault when the CDP wire never came up', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    patchContract({...launchStamp, cdpFaultCode: 'E_CDP_CONNECT'})

    writer.writeReady('2026-11-01T00:00:01.000Z')

    expect(readContract().status).toBe('ready')
    expect(readContract().cdpFaultCode).toBe('E_CDP_CONNECT')
  })

  it('does not take a port from another run as settled', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    patchContract({runId: 'an-earlier-run', cdpPort: 9222})

    writer.writeReady('2026-11-01T00:00:01.000Z')

    expect(readContract().status).toBe('starting')
    expect(readContract().cdpPort).toBeUndefined()
  })

  it('goes ready when the launcher comes back with nothing to stamp', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    expect(readContract().status).toBe('starting')

    writer.settleBrowserLaunch()

    expect(readContract().status).toBe('ready')
    expect(readContract().compiledAt).toBe('2026-11-01T00:00:00.000Z')
  })

  it('lets the session writer settle the launch for the writer that compiles', () => {
    const session = makeWriter({})
    const compiler = makeWriter({})
    session.writeStarting()
    compiler.writeStarting()
    compiler.writeReady('2026-11-01T00:00:00.000Z')

    session.settleBrowserLaunch()
    expect(readContract().status).toBe('ready')

    compiler.writeReady('2026-11-01T00:00:01.000Z')
    expect(readContract().status).toBe('ready')
  })

  it('leaves a launch failure standing when the launcher comes back', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    patchContract({status: 'error', code: 'browser_launch_failed'})

    writer.settleBrowserLaunch()

    expect(readContract().status).toBe('error')
    expect(readContract().code).toBe('browser_launch_failed')
  })

  it('leaves a compile that still waits for the hello to the hello', () => {
    const writer = makeWriter({readyAwaitsExecutor: true})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    expect(typeof readContract().awaitingExecutorSince).toBe('string')

    writer.settleBrowserLaunch()
    expect(readContract().status).toBe('starting')

    writer.stampExecutorAttached()
    expect(readContract().status).toBe('ready')
  })

  it('holds the hello for the port, so neither wait lets ready out early', () => {
    const writer = makeWriter({readyAwaitsExecutor: true})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')

    writer.stampExecutorAttached()
    expect(readContract().status).toBe('starting')

    patchContract({...launchStamp, cdpPort: 9222})
    writer.writeReady('2026-11-01T00:00:01.000Z')
    expect(readContract().status).toBe('ready')
  })

  it.each([
    ['start', 'chrome'],
    ['preview', 'chrome'],
    ['dev', 'firefox'],
    ['dev', 'safari']
  ] as const)('does not hold a %s contract on %s', (command, browser) => {
    const writer = makeWriter({command, browser})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')

    expect(readContract(browser).status).toBe('ready')
  })

  it('does not hold a dev contract with no browser to launch', () => {
    const writer = makeWriter({readyAwaitsCdpPort: false})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')

    expect(readContract().status).toBe('ready')
  })
})
