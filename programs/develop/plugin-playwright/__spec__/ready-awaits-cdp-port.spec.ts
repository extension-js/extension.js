import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  contractPath,
  makeWriter as makeProjectWriter,
  patchContract,
  readContract,
  stampReadyBrowserLaunch,
  stampReadyBrowserLaunchFailed,
  stampReadyCdpFault,
  stampReadyCdpPort,
  type WriterOptions,
  writeManifest
} from './helpers/contract'

// The Chromium launcher stamps the browser process and its CDP port after the
// compile. A dev contract that went ready on the compile named neither.
describe('a Chromium dev contract holds ready until the launch is stamped', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-awaits-cdp-'))
    writeManifest(path.join(tmp, 'src'), {name: 'Fixture', version: '1.0.0'})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = (overrides: Partial<WriterOptions>) =>
    makeProjectWriter(tmp, {
      browser: 'chrome',
      readyAwaitsCdpPort: true,
      ...overrides
    })

  const readyPath = (browser = 'chrome') => contractPath(tmp, browser)

  const contract = (browser = 'chrome') => readContract(readyPath(browser))

  const stampLaunch = () =>
    stampReadyBrowserLaunch(readyPath(), {
      browserPid: 4242,
      binary: '/browsers/chrome',
      profilePath: '/profiles/one'
    })

  it('keeps the compile at starting with its compiledAt while nothing is stamped', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')

    const ready = contract()
    expect(ready.status).toBe('starting')
    expect(ready.compiledAt).toBe('2026-11-01T00:00:00.000Z')
    expect(ready.browserPid).toBeUndefined()
  })

  it('stays at starting on a recompile that finds the process but no port', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    stampLaunch()

    writer.writeReady('2026-11-01T00:00:01.000Z')

    expect(contract().status).toBe('starting')
    expect(contract().browserPid).toBe(4242)
  })

  it('goes ready on the recompile after the launcher stamped the port, and keeps the launch', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    stampLaunch()
    stampReadyCdpPort(readyPath(), 9222)

    writer.writeReady('2026-11-01T00:00:01.000Z')

    const ready = contract()
    expect(ready.status).toBe('ready')
    expect(ready.cdpPort).toBe(9222)
    expect(ready.browserPid).toBe(4242)
    expect(ready.binary).toBe('/browsers/chrome')
  })

  it('goes ready with the fault when the CDP wire never came up', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    stampLaunch()
    stampReadyCdpFault(readyPath(), 'E_CDP_CONNECT')

    writer.writeReady('2026-11-01T00:00:01.000Z')

    expect(contract().status).toBe('ready')
    expect(contract().cdpFaultCode).toBe('E_CDP_CONNECT')
  })

  it('does not take a port from another run as settled', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    patchContract(readyPath(), {runId: 'an-earlier-run'})
    stampReadyCdpPort(readyPath(), 9222)

    writer.writeReady('2026-11-01T00:00:01.000Z')

    expect(contract().status).toBe('starting')
    expect(contract().cdpPort).toBeUndefined()
  })

  it('goes ready when the launcher comes back with nothing to stamp', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    expect(contract().status).toBe('starting')

    writer.settleBrowserLaunch()

    expect(contract().status).toBe('ready')
    expect(contract().compiledAt).toBe('2026-11-01T00:00:00.000Z')
  })

  it('lets the session writer settle the launch for the writer that compiles', () => {
    const session = makeWriter({})
    const compiler = makeWriter({})
    session.writeStarting()
    compiler.writeStarting()
    compiler.writeReady('2026-11-01T00:00:00.000Z')

    session.settleBrowserLaunch()
    expect(contract().status).toBe('ready')

    compiler.writeReady('2026-11-01T00:00:01.000Z')
    expect(contract().status).toBe('ready')
  })

  it('leaves a launch failure standing when the launcher comes back', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    stampReadyBrowserLaunchFailed(readyPath(), {
      status: 'error',
      code: 'browser_launch_failed'
    })

    writer.settleBrowserLaunch()

    expect(contract().status).toBe('error')
    expect(contract().code).toBe('browser_launch_failed')
  })

  it('leaves a compile that still waits for the hello to the hello', () => {
    const writer = makeWriter({readyAwaitsExecutor: true})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    expect(typeof contract().awaitingExecutorSince).toBe('string')

    writer.settleBrowserLaunch()
    expect(contract().status).toBe('starting')

    writer.stampExecutorAttached()
    expect(contract().status).toBe('ready')
  })

  it('holds the hello for the port, so neither wait lets ready out early', () => {
    const writer = makeWriter({readyAwaitsExecutor: true})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')

    writer.stampExecutorAttached()
    expect(contract().status).toBe('starting')

    stampLaunch()
    stampReadyCdpPort(readyPath(), 9222)
    writer.writeReady('2026-11-01T00:00:01.000Z')
    expect(contract().status).toBe('ready')
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

    expect(contract(browser).status).toBe('ready')
  })

  it('turns a start receipt held for its launch ready when the launch settles', () => {
    const writer = makeWriter({command: 'start', browser: 'chrome'})
    writer.writeStarting()
    writer.writeCompiled('2026-11-01T00:00:00.000Z')
    expect(contract('chrome').status).toBe('starting')

    writer.settleBrowserLaunch()

    expect(contract('chrome').status).toBe('ready')
  })

  it('does not hold a dev contract with no browser to launch', () => {
    const writer = makeWriter({readyAwaitsCdpPort: false})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')

    expect(contract().status).toBe('ready')
  })
})
