import {describe, it, expect, vi} from 'vitest'
import {printRunningInDevelopmentSummary} from '../firefox-utils'
import * as fs from 'fs'
import * as path from 'path'

describe('printRunningInDevelopmentSummary (Firefox)', () => {
  it('prints banner using provided extensionId when available', async () => {
    const tmp = path.join(process.cwd(), '.tmp-firefox-test')
    const out = path.join(tmp, 'addon')
    const manifestPath = path.join(out, 'manifest.json')

    // Create real files instead of mocking fs to avoid ESM limitations
    fs.mkdirSync(out, {recursive: true})
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({name: 'X', version: '1.0.0'}),
      'utf-8'
    )

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await printRunningInDevelopmentSummary([out], 'firefox', 'abc123')
    const logs = spy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logs).toMatch(/abc123|Extension ID/i)
    spy.mockRestore()
    if (fs.existsSync(tmp)) fs.rmSync(tmp, {recursive: true, force: true})
  })
})
