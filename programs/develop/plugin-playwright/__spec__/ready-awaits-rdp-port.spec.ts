import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createPlaywrightMetadataWriter, PlaywrightPlugin} from '../index'

// The Firefox launcher stamps rdpPort after the compile. A dev contract that
// went ready on the compile handed readers a session with no debugger port.
describe('a Gecko dev contract holds ready until the RDP port is known', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-awaits-rdp-'))
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
      browser: 'firefox',
      command: 'dev',
      distPath: path.join(tmp, 'dist', overrides.browser || 'firefox'),
      manifestPath: path.join(tmp, 'src', 'manifest.json'),
      readyAwaitsRdpPort: true,
      ...overrides
    })

  const readyPath = (browser = 'firefox') =>
    path.join(tmp, 'dist', 'extension-js', browser, 'ready.json')

  const readContract = (browser = 'firefox') =>
    JSON.parse(fs.readFileSync(readyPath(browser), 'utf-8')) as Record<
      string,
      unknown
    >

  const patchContract = (patch: Record<string, unknown>) => {
    fs.writeFileSync(readyPath(), JSON.stringify({...readContract(), ...patch}))
  }

  it('keeps the compile at starting with its compiledAt while no port is stamped', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')

    const ready = readContract()
    expect(ready.status).toBe('starting')
    expect(ready.compiledAt).toBe('2026-11-01T00:00:00.000Z')
    expect(ready.rdpPort).toBeUndefined()
  })

  it('goes ready on the recompile after the launcher stamped the port, and keeps it', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    patchContract({rdpPort: 6006})

    writer.writeReady('2026-11-01T00:00:01.000Z')

    expect(readContract().status).toBe('ready')
    expect(readContract().rdpPort).toBe(6006)
  })

  it('goes ready with the reason when Firefox never opened the port', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    patchContract({rdpPortError: 'Firefox did not open it'})

    writer.writeReady('2026-11-01T00:00:01.000Z')

    expect(readContract().status).toBe('ready')
    expect(readContract().rdpPortError).toBe('Firefox did not open it')
  })

  it('does not take a port from another run as settled', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    patchContract({runId: 'an-earlier-run', rdpPort: 6006})

    writer.writeReady('2026-11-01T00:00:01.000Z')

    expect(readContract().status).toBe('starting')
    expect(readContract().rdpPort).toBeUndefined()
  })

  it('does not hold a Chromium session, a start receipt, or a dev run with no browser ahead', () => {
    makeWriter({browser: 'chromium'}).writeReady()
    expect(readContract('chromium').status).toBe('ready')

    makeWriter({command: 'start'}).writeReady()
    expect(readContract().status).toBe('ready')

    fs.rmSync(readyPath(), {force: true})
    makeWriter({readyAwaitsRdpPort: false}).writeReady()
    expect(readContract().status).toBe('ready')
  })

  it('the plugin holds a Firefox dev compile and lets a Chromium one go ready', () => {
    const compileOnce = (browser: string) => {
      let onDone: ((stats: unknown) => void) | undefined
      const plugin = new PlaywrightPlugin({
        packageJsonDir: tmp,
        browser,
        mode: 'development',
        outputPath: path.join(tmp, 'dist', browser),
        manifestPath: path.join(tmp, 'src', 'manifest.json'),
        readyAwaitsRdpPort: true
      })

      plugin.apply({
        hooks: {
          compile: {tap: () => {}},
          done: {
            tap: (_name: string, cb: (stats: unknown) => void) => {
              onDone = cb
            }
          },
          failed: {tap: () => {}},
          watchClose: {tap: () => {}}
        }
      } as never)

      onDone?.({
        hasErrors: () => false,
        toJson: () => ({errors: []}),
        compilation: {startTime: 0, endTime: 1}
      })

      return readContract(browser)
    }

    expect(compileOnce('firefox').status).toBe('starting')
    expect(compileOnce('chromium').status).toBe('ready')
  })
})
