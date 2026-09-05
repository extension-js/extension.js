import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createChromiumContext} from '../run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from '../run-chromium/chromium-launch'
import {
  browserConfig as chromiumBrowserConfig,
  chromiumLaunchPlan
} from '../run-chromium/chromium-launch/browser-config'
import {createFirefoxContext} from '../run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from '../run-firefox/firefox-launch'
import {FirefoxBinaryDetector} from '../run-firefox/firefox-launch/binary-detector'
import {resolveFirefoxLaunchConfig} from '../run-firefox/firefox-launch/browser-config'

const dirs: string[] = []
let log: ReturnType<typeof vi.spyOn>
let tmp: string
let out: string
let pin: string

function compilation() {
  return {
    options: {mode: 'production', context: tmp, output: {path: out}},
    errors: [],
    hooks: {done: {tap: () => {}}}
  } as any
}

const printed = () =>
  log.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
const argsLine = (label: string) =>
  printed()
    .split('\n')
    .find((line) => line.includes(label)) || ''

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'extjs-dry-run-'))
  dirs.push(tmp)
  out = join(tmp, 'ext')
  writeFileSync(join(tmp, 'placeholder'), '')
  pin = join(tmp, 'canary-browser')
  writeFileSync(pin, '#!/bin/sh\nexit 0\n')
  chmodSync(pin, 0o755)
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true})
})

describe('chromium --dry-run', () => {
  it('prints the flags a launch would use, with the pinned binary', async () => {
    const plugin = new ChromiumLaunchPlugin(
      {
        browser: 'chrome',
        extension: [out],
        chromiumBinary: pin,
        dryRun: true,
        browserFlags: ['--window-size=800,600'],
        startingUrl: 'https://example.com'
      } as any,
      createChromiumContext() as any
    )
    await plugin.runOnce(compilation())

    const flags = argsLine('FLAGS')
    expect(printed()).toContain(pin)
    expect(flags).toContain(`--load-extension=${out}`)
    expect(flags).toMatch(/--user-data-dir=\S+chrome-profile/)
    expect(flags).toContain('--window-size=800,600')
    expect(flags).toMatch(/https:\/\/example\.com\S*$/)
  })

  it('touches no profile on disk', async () => {
    const profile = join(tmp, 'never-created')
    const plugin = new ChromiumLaunchPlugin(
      {
        browser: 'chrome',
        extension: [out],
        chromiumBinary: pin,
        dryRun: true,
        profile
      } as any,
      createChromiumContext() as any
    )
    await plugin.runOnce(compilation())

    expect(argsLine('FLAGS')).toContain(`--user-data-dir=${profile}`)
    expect(existsSync(profile)).toBe(false)
    expect(existsSync(join(tmp, 'extension-js'))).toBe(false)
  })

  it('composes the plan around a placeholder binary inside the test runner', async () => {
    const plugin = new ChromiumLaunchPlugin(
      {browser: 'chrome', extension: [out], dryRun: true} as any,
      createChromiumContext() as any
    )
    await plugin.runOnce(compilation())

    expect(printed()).toContain('chromium-mock-binary')
    expect(argsLine('FLAGS')).toContain(`--load-extension=${out}`)
  })

  it('prints the same argv the spawn seam produces', async () => {
    const plugin = new ChromiumLaunchPlugin(
      {
        browser: 'chrome',
        extension: [out],
        chromiumBinary: pin,
        dryRun: true,
        profile: join(tmp, 'p'),
        startingUrl: 'https://example.com'
      } as any,
      createChromiumContext() as any
    )
    await plugin.runOnce(compilation())

    const flags = chromiumBrowserConfig(
      compilation(),
      {browser: 'chrome', extension: [out], profile: join(tmp, 'p')} as any,
      {provision: false}
    )
    const plan = chromiumLaunchPlan(pin, flags, 'https://example.com')
    expect(argsLine('FLAGS')).toContain(plan.args.join(' '))
    expect(existsSync(join(tmp, 'p'))).toBe(false)
  })
})

describe('firefox --dry-run', () => {
  it('names the pinned binary and prints the launch argv', async () => {
    const profile = join(tmp, 'my-profile')
    const plugin = new FirefoxLaunchPlugin(
      {
        browser: 'firefox',
        extension: [out],
        geckoBinary: pin,
        dryRun: true,
        browserFlags: ['-foreground'],
        profile
      } as any,
      createFirefoxContext() as any
    )
    await plugin.runOnce(compilation(), {mode: 'production'} as any)

    const args = argsLine('ARGS')
    expect(printed()).toContain(pin)
    expect(printed()).not.toContain('firefox-mock-binary')
    expect(printed()).not.toContain('--binary-args=""')
    expect(args).toContain(`-profile ${profile}`)
    expect(args).toContain('-start-debugger-server')
    expect(args).toContain('-foreground')
  })

  it('writes no profile or user.js', async () => {
    const profile = join(tmp, 'my-profile')
    const plugin = new FirefoxLaunchPlugin(
      {
        browser: 'firefox',
        extension: [out],
        geckoBinary: pin,
        dryRun: true,
        profile
      } as any,
      createFirefoxContext() as any
    )
    await plugin.runOnce(compilation(), {mode: 'production'} as any)

    expect(existsSync(profile)).toBe(false)
    expect(existsSync(join(profile, 'user.js'))).toBe(false)
    expect(existsSync(join(tmp, 'extension-js'))).toBe(false)
  })

  it('prints the same argv the spawn seam produces', async () => {
    const profile = join(tmp, 'my-profile')
    const plugin = new FirefoxLaunchPlugin(
      {
        browser: 'firefox',
        extension: [out],
        geckoBinary: pin,
        dryRun: true,
        profile,
        port: 9333
      } as any,
      createFirefoxContext() as any
    )
    await plugin.runOnce(compilation(), {mode: 'production'} as any)

    const config = await resolveFirefoxLaunchConfig(
      compilation(),
      {browser: 'firefox', mode: 'production', profile} as any,
      {provision: false}
    )
    const port = Number(
      argsLine('ARGS').match(/-start-debugger-server (\d+)/)?.[1]
    )
    const plan = FirefoxBinaryDetector.launchPlan({
      binaryPath: pin,
      profilePath: config.profilePath,
      debugPort: port,
      binaryArgs: config.binaryArgs,
      headless: false
    })
    expect(argsLine('ARGS')).toContain(plan.args.join(' '))
  })

  it('composes the plan around a placeholder binary inside the test runner', async () => {
    const plugin = new FirefoxLaunchPlugin(
      {browser: 'firefox', extension: [out], dryRun: true} as any,
      createFirefoxContext() as any
    )
    await plugin.runOnce(compilation(), {mode: 'production'} as any)

    expect(printed()).toContain('firefox-mock-binary')
    expect(argsLine('ARGS')).toContain('-profile')
    expect(existsSync(join(tmp, 'extension-js'))).toBe(false)
  })
})
