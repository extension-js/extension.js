import {mkdtempSync, rmSync} from 'node:fs'
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
import {
  buildBrowserLaunchRequest,
  resolveStartingUrl
} from '../../browsers-lib/runtime-options'
import {createChromiumContext} from '../../run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from '../../run-chromium/chromium-launch'
import {
  browserConfig as chromiumBrowserConfig,
  chromiumLaunchPlan
} from '../../run-chromium/chromium-launch/browser-config'
import {createFirefoxContext} from '../../run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from '../../run-firefox/firefox-launch'
import {browserConfig as firefoxBrowserConfig} from '../../run-firefox/firefox-launch/browser-config'
import {
  composeConverterArgs,
  resolveSafariBuildConfig
} from '../../run-safari/safari-launch/safari-config'
import type {SafariPluginLike} from '../../run-safari/safari-types'
import {fakeChromium, fakeFirefox} from '../fake-browser'

type FirefoxConfigOptions = Parameters<typeof firefoxBrowserConfig>[1]

// The rows set only the launch fields the URL decision reads.
function firefoxOptions(
  fields: Partial<FirefoxConfigOptions>
): FirefoxConfigOptions {
  return fields as FirefoxConfigOptions
}

// --no-open means open nothing at all, so no family may put the starting URL
// on the command line. Pinned here across families so they cannot re-diverge.
const URL = 'https://example.com/'

const dirs: string[] = []
let log: MockInstance<typeof console.log>
let tmp: string
let out: string
let pin: string

function compilation() {
  return {
    options: {mode: 'production', context: tmp, output: {path: out}},
    errors: [],
    hooks: {done: {tap: () => {}}}
  }
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
  // Only ever a name in a plan here: nothing in this file runs it.
  pin = join(tmp, 'pinned-browser')
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
    const withOpen = await firefoxBrowserConfig(
      compilation(),
      firefoxOptions({
        extension: '/ext',
        browser: 'firefox',
        startingUrl: URL
      })
    )
    // The launch opens about:blank; the URL follows the add-on install.
    expect(withOpen).toContain('--url about:blank')

    const withNoOpen = await firefoxBrowserConfig(
      compilation(),
      firefoxOptions({
        extension: '/ext',
        browser: 'firefox',
        startingUrl: URL,
        noOpen: true
      })
    )
    expect(withNoOpen).not.toContain(URL)
    expect(withNoOpen).not.toContain('--url')
  })

  it('the two families agree on the same options', async () => {
    const chromiumFlags = chromiumBrowserConfig(
      compilation(),
      {browser: 'chrome', extension: [out], profile: join(tmp, 'p')},
      {provision: false}
    )
    const chromiumArgs = chromiumLaunchPlan(
      pin,
      chromiumFlags,
      URL,
      true
    ).args.join(' ')
    const firefoxArgs = await firefoxBrowserConfig(
      compilation(),
      firefoxOptions({
        extension: '/ext',
        browser: 'firefox',
        startingUrl: URL,
        noOpen: true
      })
    )

    expect(chromiumArgs).not.toContain(URL)
    expect(firefoxArgs).not.toContain(URL)
  })

  it('the chromium launcher prints an argv without the URL', async () => {
    const fake = await fakeChromium()

    try {
      const binary = fake.project.plantBinary()
      const plugin = new ChromiumLaunchPlugin(
        {
          browser: 'chrome',
          extension: [fake.project.out],
          chromiumBinary: binary,
          dryRun: true,
          profile: join(fake.project.root, 'p'),
          startingUrl: URL,
          noOpen: true
        },
        createChromiumContext(),
        fake.deps
      )
      await plugin.runOnce(fake.project.compilation())

      expect(printed()).toContain(binary)
      expect(argsLine('FLAGS')).toContain('--load-extension=')
      expect(argsLine('FLAGS')).not.toContain(URL)
      expect(fake.spawns).toEqual([])
    } finally {
      await fake.close()
    }
  })

  it('the firefox launcher prints an argv without the URL', async () => {
    const fake = await fakeFirefox()

    try {
      const binary = fake.project.plantBinary()
      const profile = join(fake.project.root, 'my-profile')
      const plugin = new FirefoxLaunchPlugin(
        {
          browser: 'firefox',
          extension: [fake.project.out],
          geckoBinary: binary,
          dryRun: true,
          profile,
          startingUrl: URL,
          noOpen: true
        },
        createFirefoxContext(),
        fake.deps
      )
      await plugin.runOnce(
        fake.project.compilation(),
        buildBrowserLaunchRequest(
          {browser: 'firefox', profile, startingUrl: URL, noOpen: true},
          'production'
        )
      )

      expect(printed()).toContain(binary)
      expect(argsLine('ARGS')).toContain(`-profile ${profile}`)
      expect(argsLine('ARGS')).not.toContain(URL)
      expect(argsLine('ARGS')).not.toContain('--url')
      expect(fake.spawns).toEqual([])
    } finally {
      await fake.close()
    }
  })

  it('the shared launch request carries noOpen to the gecko launcher', () => {
    // Gecko reads the flag off the launch request, not off the host options,
    // so dropping the key here silently re-opened the URL under --no-open.
    expect(
      buildBrowserLaunchRequest(
        {browser: 'firefox', startingUrl: URL, noOpen: true},
        'development'
      ).noOpen
    ).toBe(true)

    expect(
      buildBrowserLaunchRequest(
        {browser: 'firefox', startingUrl: URL},
        'development'
      ).noOpen
    ).toBeUndefined()
  })

  it('safari raises nothing and has no starting-URL surface', () => {
    const host: SafariPluginLike = {
      browser: 'safari',
      extension: out,
      noOpen: true
    }
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
