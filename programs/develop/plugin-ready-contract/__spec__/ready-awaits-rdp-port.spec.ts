import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {ReadyContractPlugin} from '../index'
import {
  applyToFakeCompiler,
  contractPath,
  doneStats,
  makeWriter as makeProjectWriter,
  patchContract,
  readContract,
  stampReadyRdpPort,
  stampReadyRdpPortError,
  type WriterOptions,
  writeManifest
} from './helpers/contract'

// The Firefox launcher stamps rdpPort after the compile. A dev contract that
// went ready on the compile handed readers a session with no debugger port.
describe('a Gecko dev contract holds ready until the RDP port is known', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-awaits-rdp-'))
    writeManifest(path.join(tmp, 'src'), {name: 'Fixture', version: '1.0.0'})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = (overrides: Partial<WriterOptions>) =>
    makeProjectWriter(tmp, {
      browser: 'firefox',
      readyAwaitsRdpPort: true,
      ...overrides
    })

  const readyPath = (browser = 'firefox') => contractPath(tmp, browser)

  const contract = (browser = 'firefox') => readContract(readyPath(browser))

  it('keeps the compile at starting with its compiledAt while no port is stamped', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')

    const ready = contract()
    expect(ready.status).toBe('starting')
    expect(ready.compiledAt).toBe('2026-11-01T00:00:00.000Z')
    expect(ready.rdpPort).toBeUndefined()
  })

  it('goes ready on the recompile after the launcher stamped the port, and keeps it', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    stampReadyRdpPort(readyPath(), 6006)

    writer.writeReady('2026-11-01T00:00:01.000Z')

    expect(contract().status).toBe('ready')
    expect(contract().rdpPort).toBe(6006)
  })

  it('goes ready with the reason when Firefox never opened the port', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    stampReadyRdpPortError(readyPath(), 'Firefox did not open it')

    writer.writeReady('2026-11-01T00:00:01.000Z')

    expect(contract().status).toBe('ready')
    expect(contract().rdpPortError).toBe('Firefox did not open it')
  })

  it('does not take a port from another run as settled', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    patchContract(readyPath(), {runId: 'an-earlier-run'})
    stampReadyRdpPort(readyPath(), 6006)

    writer.writeReady('2026-11-01T00:00:01.000Z')

    expect(contract().status).toBe('starting')
    expect(contract().rdpPort).toBeUndefined()
  })

  it('does not hold a Chromium session, a start receipt, or a dev run with no browser ahead', () => {
    makeWriter({browser: 'chromium'}).writeReady()
    expect(contract('chromium').status).toBe('ready')

    makeWriter({command: 'start'}).writeReady()
    expect(contract().status).toBe('ready')

    fs.rmSync(readyPath(), {force: true})
    makeWriter({readyAwaitsRdpPort: false}).writeReady()
    expect(contract().status).toBe('ready')
  })

  it('the plugin holds a Firefox dev compile and lets a Chromium one go ready', () => {
    const compileOnce = (browser: string) => {
      const plugin = new ReadyContractPlugin({
        packageJsonDir: tmp,
        browser,
        mode: 'development',
        outputPath: path.join(tmp, 'dist', browser),
        manifestPath: path.join(tmp, 'src', 'manifest.json'),
        readyAwaitsRdpPort: true
      })

      applyToFakeCompiler(plugin).done(doneStats())

      return contract(browser)
    }

    expect(compileOnce('firefox').status).toBe('starting')
    expect(compileOnce('chromium').status).toBe('ready')
  })
})
