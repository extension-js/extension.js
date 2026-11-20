import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'
import {printRunningInDevelopmentSummary} from '../../run-firefox/rdp/remote-firefox/firefox-utils'

const dirs: string[] = []
let log: MockInstance<typeof console.log>

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

  // A pre-release marker is still a bare version, so the browser name stays
  // in front of it: the card once printed "158.0a1" alone.
  it('keeps the browser name in front of a pre-release version', async () => {
    await printRunningInDevelopmentSummary(
      [addon('firefox')],
      'firefox',
      undefined,
      '158.0a1'
    )

    await printRunningInDevelopmentSummary(
      [addon('zen')],
      'zen',
      undefined,
      '1.22.3b'
    )

    const output = log.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(output).toContain('Firefox Nightly 158.0a1')
    expect(output).toContain('Zen 1.22.3b')
  })

  // The managed folder can hold a nightly that updated in place, and the row
  // once passed it off as the release channel the install asks for.
  it('names the Nightly channel for an alpha version and no other', async () => {
    await printRunningInDevelopmentSummary(
      [addon('firefox')],
      'firefox',
      undefined,
      'Mozilla Firefox 160.0a1'
    )

    const output = log.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(output).toContain('Mozilla Firefox Nightly 160.0a1')
  })

  it('spells LibreWolf the way its vendor does', async () => {
    const printed = await printRunningInDevelopmentSummary(
      [addon('librewolf')],
      'librewolf',
      undefined,
      '156.0'
    )

    expect(printed).toBe(true)
    const output = log.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(output).toContain('LibreWolf 156.0')
    expect(output).not.toContain('Librewolf')
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

// The card names the user's add-on, never a companion loaded next to it.
describe('the dev card beside the theme companion', () => {
  function folder(prefix: string, manifest: Record<string, unknown>) {
    const root = mkdtempSync(join(tmpdir(), prefix))
    dirs.push(root)
    const dir = join(root, 'firefox')
    mkdirSync(dir, {recursive: true})
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 2,
        version: '1.0.0',
        browser_specific_settings: {gecko: {id: 'user@example.com'}},
        ...manifest
      })
    )

    return dir
  }

  function themeCompanion() {
    const root = mkdtempSync(join(tmpdir(), 'extjs-card-companions-'))
    dirs.push(root)
    const dir = join(root, 'extension-js-theme', 'firefox')
    mkdirSync(dir, {recursive: true})
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 2,
        name: 'Extension.js Theme',
        version: '1.0.0',
        theme: {colors: {}},
        browser_specific_settings: {gecko: {id: 'theme@extension.js'}}
      })
    )

    return dir
  }

  it.each([
    [
      'a folder whose name starts like the companion',
      'extension-js-theme-lab-',
      'Lab Sample'
    ],
    [
      'a name with the word theme in it',
      'extjs-card-user-',
      'Dark Theme Toggle'
    ]
  ])('names the add-on in %s', async (_label, prefix, name) => {
    const user = folder(prefix, {name})

    await printRunningInDevelopmentSummary(
      [user, themeCompanion()],
      'firefox',
      undefined,
      '145.0'
    )

    const output = log.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(output).toContain(name)
    expect(output).not.toContain('Extension.js Theme')
  })
})
