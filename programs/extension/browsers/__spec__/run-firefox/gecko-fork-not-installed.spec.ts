import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
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
import type {CompilationLike} from '../../browsers-types'
import {createFirefoxContext} from '../../run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from '../../run-firefox/firefox-launch'
import type {FirefoxPluginRuntime} from '../../run-firefox/firefox-types'

vi.mock('floorp-location', () => ({
  default: () => null,
  getInstallGuidance: () =>
    [
      "We couldn't find a Floorp browser on this machine.",
      '',
      'To install one:',
      '',
      '1) Install Floorp from the official site',
      '',
      'Re-run your command afterward and it will be detected automatically.'
    ].join('\n')
}))

const dirs: string[] = []
let errors: MockInstance<typeof console.error>
let tmp: string

function compilation() {
  return {
    options: {mode: 'development', context: tmp, output: {path: tmp}},
    errors: [],
    hooks: {done: {tap: () => {}}}
  } as CompilationLike
}

// The private hint these rows print, reached through one cast.
interface LaunchInternals {
  printInstallHint(compilation: CompilationLike, raw: string): void
}

function internals(plugin: FirefoxLaunchPlugin): LaunchInternals {
  return plugin as unknown as LaunchInternals
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'extjs-fork-missing-'))
  dirs.push(tmp)
  writeFileSync(
    join(tmp, 'manifest.json'),
    JSON.stringify({manifest_version: 2, name: 'x', version: '1.0.0'})
  )

  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true})
})

describe('a named gecko fork that is not installed', () => {
  it('names the fork and its own install steps, not the managed cache', () => {
    const plugin = new FirefoxLaunchPlugin(
      {browser: 'floorp', extension: [tmp]} as FirefoxPluginRuntime,
      createFirefoxContext()
    )
    internals(plugin).printInstallHint(
      compilation(),
      'npx extension install firefox'
    )

    const printed = errors.mock.calls
      .map((call) => call.map(String).join(' '))
      .join('\n')
    expect(printed).toContain("Floorp isn't installed")
    expect(printed).toContain('Install Floorp from the official site')
    expect(printed).toContain('--gecko-binary')
    expect(printed).not.toContain('Chromium')
    expect(printed).not.toContain('managed browser cache')
    expect(printed).not.toContain('extension install firefox')
  })

  it('keeps the managed cache guidance for firefox itself', () => {
    const plugin = new FirefoxLaunchPlugin(
      {browser: 'firefox', extension: [tmp]} as FirefoxPluginRuntime,
      createFirefoxContext()
    )
    internals(plugin).printInstallHint(
      compilation(),
      'npx extension install firefox'
    )

    const printed = errors.mock.calls
      .map((call) => call.map(String).join(' '))
      .join('\n')
    expect(printed).toContain(
      "Firefox isn't available in the managed browser cache"
    )

    expect(printed).toContain('extension install firefox')
  })
})
