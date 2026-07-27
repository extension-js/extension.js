import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {claimCardKey} from '../../helpers/messaging'
import {printDevBannerOnce, printProdBannerOnce} from '../browsers-lib/banner'

function makeTempOutPath(manifest: Record<string, unknown>): string {
  const outPath = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-banner-'))
  fs.writeFileSync(
    path.join(outPath, 'manifest.json'),
    JSON.stringify(manifest),
    'utf-8'
  )
  return outPath
}

describe('printDevBannerOnce', () => {
  it('derives Chromium extension id from manifest key when runtime info is unavailable', async () => {
    const outPath = makeTempOutPath({
      name: 'Test Extension',
      version: '1.0.0',
      key: Buffer.from('test-public-key-bytes').toString('base64')
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const printed = await printDevBannerOnce({
      browser: 'chromium',
      outPath,
      hostPort: {host: '127.0.0.1', port: 9333},
      getInfo: async () => null
    })

    expect(printed).toBe(true)
    const output = logSpy.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    const idLine =
      output.split('\n').find((line) => line.includes('Extension ID')) || ''
    const extracted = idLine.split('Extension ID')[1]?.trim() || ''
    expect(extracted).toMatch(/^[a-p]{32}$/)
    expect(output).not.toContain('(temporary)')
    logSpy.mockRestore()
  })

  it('derives Chromium extension id from load path when manifest has no key and no runtime surface', async () => {
    const outPath = makeTempOutPath({
      name: 'Init Example',
      version: '1.0.0'
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const printed = await printDevBannerOnce({
      browser: 'chromium',
      outPath,
      hostPort: {host: '127.0.0.1', port: 9333},
      getInfo: async () => null
    })

    expect(printed).toBe(true)
    const output = logSpy.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    const idLine =
      output.split('\n').find((line) => line.includes('Extension ID')) || ''
    const extracted = idLine.split('Extension ID')[1]?.trim() || ''
    expect(extracted).toMatch(/^[a-p]{32}$/)
    logSpy.mockRestore()
  })

  it('derives Firefox extension id from manifest gecko id when runtime info is unavailable', async () => {
    const outPath = makeTempOutPath({
      name: 'Test Firefox Extension',
      version: '1.0.1',
      browser_specific_settings: {gecko: {id: 'addon@example.com'}}
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const printed = await printDevBannerOnce({
      browser: 'firefox',
      outPath,
      hostPort: {host: '127.0.0.1', port: 6000},
      browserVersionLine: 'Firefox (unit test)',
      getInfo: async () => null
    })

    expect(printed).toBe(true)
    const output = logSpy.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(output).toContain('Extension ID')
    expect(output).toContain('addon@example.com')
    expect(output).not.toContain('(temporary)')
    logSpy.mockRestore()
  })
})

describe('printProdBannerOnce', () => {
  it('derives Chromium extension id from load path when no manifest key is present', async () => {
    const outPath = makeTempOutPath({
      name: 'No Key Extension',
      version: '1.0.0'
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const printed = await printProdBannerOnce({
      browser: 'chromium',
      outPath,
      browserVersionLine: 'Chromium 120.0'
    })

    expect(printed).toBe(true)
    const output = logSpy.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    const idLine =
      output.split('\n').find((line) => line.includes('Extension ID')) || ''
    const extracted = idLine.split('Extension ID')[1]?.trim() || ''
    expect(extracted).toMatch(/^[a-p]{32}$/)
    logSpy.mockRestore()
  })

  it('derives Chromium extension id from manifest key in production banner', async () => {
    const outPath = makeTempOutPath({
      name: 'Prod Key Extension',
      version: '2.0.0',
      key: Buffer.from('test-public-key-bytes').toString('base64')
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const printed = await printProdBannerOnce({
      browser: 'chromium',
      outPath,
      browserVersionLine: 'Chromium 120.0'
    })

    expect(printed).toBe(true)
    const output = logSpy.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    const idLine =
      output.split('\n').find((line) => line.includes('Extension ID')) || ''
    const extracted = idLine.split('Extension ID')[1]?.trim() || ''
    expect(extracted).toMatch(/^[a-p]{32}$/)
    logSpy.mockRestore()
  })

  it('derives Firefox extension id from manifest gecko id in production banner', async () => {
    const outPath = makeTempOutPath({
      name: 'Prod Firefox Extension',
      version: '2.0.1',
      browser_specific_settings: {gecko: {id: 'prod-addon@example.com'}}
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const printed = await printProdBannerOnce({
      browser: 'firefox',
      outPath,
      browserVersionLine: 'Firefox 145.0'
    })

    expect(printed).toBe(true)
    const output = logSpy.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(output).toContain('Extension ID')
    expect(output).toContain('prod-addon@example.com')
    logSpy.mockRestore()
  })

  it('includes Run ID when ready metadata is provided', async () => {
    const outPath = makeTempOutPath({
      name: 'Prod Key Extension',
      version: '2.0.0',
      key: Buffer.from('test-public-key-bytes').toString('base64')
    })
    const readyPath = path.join(outPath, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({runId: 'run-123', pid: 4242}),
      'utf-8'
    )

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const printed = await printProdBannerOnce({
      browser: 'chromium',
      outPath,
      browserVersionLine: 'Chromium 120.0',
      readyPath,
      includeRunId: true
    })

    expect(printed).toBe(true)
    const output = logSpy.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(output).toContain('Run ID')
    expect(output).toContain('run-123')
    expect(output).toContain('4242')
    logSpy.mockRestore()
  })
})

describe('nameable is decoupled from already-printed', () => {
  const previousCardKeys = process.env.EXTENSION_CLI_CARD_KEYS
  const previousBannerFlag = process.env.EXTENSION_CLI_BANNER_PRINTED

  beforeEach(() => {
    delete process.env.EXTENSION_CLI_CARD_KEYS
    delete process.env.EXTENSION_CLI_BANNER_PRINTED
  })

  afterEach(() => {
    if (previousCardKeys === undefined)
      delete process.env.EXTENSION_CLI_CARD_KEYS
    else process.env.EXTENSION_CLI_CARD_KEYS = previousCardKeys
    if (previousBannerFlag === undefined)
      delete process.env.EXTENSION_CLI_BANNER_PRINTED
    else process.env.EXTENSION_CLI_BANNER_PRINTED = previousBannerFlag
  })

  // The firefox add-on install treats this boolean as its verification, so a
  // dedupe hit must keep answering "the guest is nameable", not "no print".
  it('returns true without reprinting when the same key already printed', async () => {
    const outPath = makeTempOutPath({
      name: 'Dedupe Extension',
      version: '1.0.0'
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const first = await printDevBannerOnce({
      browser: 'chromium',
      outPath,
      hostPort: {host: '127.0.0.1', port: 9345},
      getInfo: async () => null
    })
    const callsAfterFirst = logSpy.mock.calls.length
    const second = await printDevBannerOnce({
      browser: 'chromium',
      outPath,
      hostPort: {host: '127.0.0.1', port: 9345},
      getInfo: async () => null
    })

    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(logSpy.mock.calls.length).toBe(callsAfterFirst)
    logSpy.mockRestore()
  })

  it('honors a card key claimed by another bundle without printing', async () => {
    const outPath = makeTempOutPath({
      name: 'Cross Bundle Extension',
      version: '1.0.0'
    })
    claimCardKey(`chromium::${path.resolve(outPath)}`)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const dev = await printDevBannerOnce({
      browser: 'chromium',
      outPath,
      hostPort: {host: '127.0.0.1', port: 9346},
      getInfo: async () => null
    })
    const prod = await printProdBannerOnce({
      browser: 'chromium',
      outPath
    })

    expect(dev).toBe(true)
    expect(prod).toBe(true)
    expect(logSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('still reports false when no id can be derived after a prior print', async () => {
    const outPath = makeTempOutPath({
      name: 'Anonymous Firefox Add-on',
      version: '1.0.0'
    })
    claimCardKey(`firefox::${path.resolve(outPath)}`)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const printed = await printDevBannerOnce({
      browser: 'firefox',
      outPath,
      hostPort: {host: '127.0.0.1'},
      getInfo: async () => null
    })

    expect(printed).toBe(false)
    expect(logSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })
})
