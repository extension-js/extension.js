import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {printRunningInDevelopmentSummary} from '../run-firefox/rdp/remote-firefox/firefox-utils'

const dirs: string[] = []
let log: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true})
})

function addon(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `extjs-fork-card-${name}-`))
  dirs.push(dir)
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 2,
      name: `${name} sample`,
      version: '1.0.0',
      browser_specific_settings: {gecko: {id: `${name}@example.com`}}
    })
  )

  return dir
}

describe('the dev card for a gecko fork', () => {
  it('names the fork that runs, with the version read off its binary', async () => {
    const printed = await printRunningInDevelopmentSummary(
      [addon('zen')],
      'zen',
      undefined,
      '1.22.2'
    )

    expect(printed).toBe(true)
    const output = log.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(output).toContain('Zen 1.22.2')
    expect(output).not.toContain('Firefox')
  })

  it('still says Firefox for firefox itself', async () => {
    const printed = await printRunningInDevelopmentSummary(
      [addon('firefox')],
      'firefox',
      undefined,
      '145.0'
    )

    expect(printed).toBe(true)
    const output = log.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(output).toContain('Firefox 145.0')
  })
})
