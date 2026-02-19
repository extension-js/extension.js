import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, expect, it, vi} from 'vitest'
import {printDevBannerOnce} from '../browsers-lib/banner'

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
    const output = logSpy.mock.calls.map((call) => String(call[0] || '')).join('\n')
    const idLine = output
      .split('\n')
      .find((line) => line.includes('Extension ID')) || ''
    const extracted = idLine.split('Extension ID')[1]?.trim() || ''
    expect(extracted).toMatch(/^[a-p]{32}$/)
    expect(output).not.toContain('(temporary)')
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
      getInfo: async () => null
    })

    expect(printed).toBe(true)
    const output = logSpy.mock.calls.map((call) => String(call[0] || '')).join('\n')
    expect(output).toContain('Extension ID')
    expect(output).toContain('addon@example.com')
    expect(output).not.toContain('(temporary)')
    logSpy.mockRestore()
  })
})
