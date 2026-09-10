import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  buildBrowserLaunchRequest,
  resolveStartingUrl
} from '../browsers-lib/runtime-options'
import {createChromiumContext} from '../run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from '../run-chromium/chromium-launch'
import {
  browserConfig as chromiumBrowserConfig,
  chromiumLaunchPlan
} from '../run-chromium/chromium-launch/browser-config'
import {createFirefoxContext} from '../run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from '../run-firefox/firefox-launch'
import {browserConfig as firefoxBrowserConfig} from '../run-firefox/firefox-launch/browser-config'
import {
  composeConverterArgs,
  resolveSafariBuildConfig
} from '../run-safari/safari-launch/safari-config'

// --no-open means open nothing at all, so no family may put the starting URL
// on the command line. Pinned here across families so they cannot re-diverge.
const URL = 'https://example.com/'

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
  tmp = mkdtempSync(join(tmpdir(), 'extjs-no-open-'))
  dirs.push(tmp)
  out = join(tmp, 'ext')
  pin = join(tmp, 'pinned-browser')
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

describe('--no-open suppresses the starting URL', () => {
  it('resolveStartingUrl is the one reading both families share', () => {
    expect(resolveStartingUrl({startingUrl: URL})).toBe(URL)
    expect(resolveStartingUrl({startingUrl: URL, noOpen: false})).toBe(URL)
    expect(resolveStartingUrl({startingUrl: URL, noOpen: true})).toBeUndefined()
    expect(resolveStartingUrl({noOpen: true})).toBeUndefined()
  })

  it('chromium drops the URL from the launch argv', () => {
    const withOpen = chromiumLaunchPlan(pin, ['--flag'], URL)
    expect(withOpen.args).toEqual(['--flag', URL])

    const withNoOpen = chromiumLaunchPlan(pin, ['--flag'], URL, true)
    expect(withNoOpen.args).toEqual(['--flag'])
  })

  it('firefox drops the URL from the launch argv', async () => {
    const withOpen = await firefoxBrowserConfig(compilation(), {
      extension: '/ext',
      browser: 'firefox',
      startingUrl: URL
    } as any)
    expect(withOpen).toContain(URL)

    const withNoOpen = await firefoxBrowserConfig(compilation(), {
      extension: '/ext',
      browser: 'firefox',
      startingUrl: URL,
      noOpen: true
    } as any)
    expect(withNoOpen).not.toContain(URL)
    expect(withNoOpen).not.toContain('--url')
  })

  it('the two families agree on the same options', async () => {
    const chromiumFlags = chromiumBrowserConfig(
      compilation(),
      {browser: 'chrome', extension: [out], profile: join(tmp, 'p')} as any,
      {provision: false}
    )
    const chromiumArgs = chromiumLaunchPlan(
      pin,
      chromiumFlags,
      URL,
      true
    ).args.join(' ')
    const firefoxArgs = await firefoxBrowserConfig(compilation(), {
      extension: '/ext',
      browser: 'firefox',
      startingUrl: URL,
      noOpen: true
    } as any)

    expect(chromiumArgs).not.toContain(URL)
    expect(firefoxArgs).not.toContain(URL)
  })

  it('the chromium launcher prints an argv without the URL', async () => {
    const plugin = new ChromiumLaunchPlugin(
      {
        browser: 'chrome',
        extension: [out],
        chromiumBinary: pin,
        dryRun: true,
        profile: join(tmp, 'p'),
        startingUrl: URL,
        noOpen: true
      } as any,
      createChromiumContext() as any
    )
    await plugin.runOnce(compilation())

    expect(printed()).toContain(pin)
    expect(argsLine('FLAGS')).not.toContain(URL)
  })

  it('the firefox launcher prints an argv without the URL', async () => {
    const plugin = new FirefoxLaunchPlugin(
      {
        browser: 'firefox',
        extension: [out],
        geckoBinary: pin,
        dryRun: true,
        profile: join(tmp, 'my-profile'),
        startingUrl: URL,
        noOpen: true
      } as any,
      createFirefoxContext() as any
    )
    await plugin.runOnce(
      compilation(),
      buildBrowserLaunchRequest(
        {
          browser: 'firefox',
          profile: join(tmp, 'my-profile'),
          startingUrl: URL,
          noOpen: true
        } as any,
        'production'
      ) as any
    )

    expect(printed()).toContain(pin)
    expect(argsLine('ARGS')).not.toContain(URL)
    expect(argsLine('ARGS')).not.toContain('--url')
  })

  it('the shared launch request carries noOpen to the gecko launcher', () => {
    // Gecko reads the flag off the launch request, not off the host options,
    // so dropping the key here silently re-opened the URL under --no-open.
    expect(
      buildBrowserLaunchRequest(
        {browser: 'firefox', startingUrl: URL, noOpen: true} as any,
        'development'
      ).noOpen
    ).toBe(true)
    expect(
      buildBrowserLaunchRequest(
        {browser: 'firefox', startingUrl: URL} as any,
        'development'
      ).noOpen
    ).toBeUndefined()
  })

  it('safari raises nothing and has no starting-URL surface', () => {
    const host = {browser: 'safari', extension: out, noOpen: true} as any
    const config = resolveSafariBuildConfig(compilation(), host)

    expect(config.open).toBe(false)
    expect(composeConverterArgs(config)).not.toContain(URL)
    expect(composeConverterArgs(config)).toContain('--no-open')

    const opening = resolveSafariBuildConfig(compilation(), {
      ...host,
      noOpen: false
    })
    expect(opening.open).toBe(true)
  })
})
