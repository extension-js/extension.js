import {existsSync} from 'node:fs'
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
import {buildBrowserLaunchRequest} from '../../browsers-lib/runtime-options'
import {createChromiumContext} from '../../run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from '../../run-chromium/chromium-launch'
import {
  browserConfig as chromiumBrowserConfig,
  chromiumLaunchPlan
} from '../../run-chromium/chromium-launch/browser-config'
import {createFirefoxContext} from '../../run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from '../../run-firefox/firefox-launch'
import {
  FirefoxBinaryDetector,
  isFirefoxHeadlessRequested
} from '../../run-firefox/firefox-launch/binary-detector'
import {resolveFirefoxLaunchConfig} from '../../run-firefox/firefox-launch/browser-config'
import {
  type FakeChromium,
  type FakeFirefox,
  fakeChromium,
  fakeFirefox
} from '../fake-browser'

let log: MockInstance<typeof console.log>

const printed = () =>
  log.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
const argsLine = (label: string) =>
  printed()
    .split('\n')
    .find((line) => line.includes(label)) || ''

beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('chromium --dry-run', () => {
  let fake: FakeChromium
  let out: string
  let pin: string

  beforeEach(async () => {
    fake = await fakeChromium()
    out = fake.project.out
    pin = fake.project.plantBinary('canary-browser')
  })

  afterEach(async () => {
    // A dry run starts nothing, whatever it was asked to plan.
    expect(fake.spawns).toEqual([])
    await fake.close()
  })

  const dryRun = async (options: Record<string, unknown>) => {
    const plugin = new ChromiumLaunchPlugin(
      {browser: 'chrome', extension: [out], dryRun: true, ...options} as never,
      createChromiumContext() as never,
      fake.deps
    )

    await plugin.runOnce(fake.project.compilation() as never)
  }

  it('prints the flags a launch would use, with the pinned binary', async () => {
    await dryRun({
      chromiumBinary: pin,
      browserFlags: ['--window-size=800,600'],
      startingUrl: 'https://example.com'
    })

    const flags = argsLine('FLAGS')
    expect(printed()).toContain(pin)
    expect(flags).toContain(`--load-extension=${out}`)
    expect(flags).toMatch(/--user-data-dir=\S+chrome-profile/)
    expect(flags).toContain('--window-size=800,600')
    // The starting url opens over the debugger once the extension is in.
    expect(flags).toMatch(/about:blank$/)
    expect(flags).not.toContain('https://example.com')
  })

  it('touches no profile on disk', async () => {
    const profile = join(fake.project.root, 'never-created')
    await dryRun({chromiumBinary: pin, profile})

    expect(argsLine('FLAGS')).toContain(`--user-data-dir=${profile}`)
    expect(existsSync(profile)).toBe(false)
    expect(existsSync(join(fake.project.project, 'dist', 'extension-js'))).toBe(
      false
    )
  })

  it('composes the plan around the binary the system scan found', async () => {
    const system = fake.project.plantBinary('system-chrome')
    fake.deps.locate.chrome = () => system

    await dryRun({})

    expect(argsLine('PATH')).toContain(system)
    expect(argsLine('SOURCE')).toContain('system install')
    expect(argsLine('FLAGS')).toContain(`--load-extension=${out}`)
    expect(fake.probed).toEqual([system])
  })

  it('prints the same argv the spawn seam produces', async () => {
    const profile = join(fake.project.root, 'p')
    await dryRun({
      chromiumBinary: pin,
      profile,
      startingUrl: 'https://example.com'
    })

    const flags = chromiumBrowserConfig(
      fake.project.compilation() as never,
      {browser: 'chrome', extension: [out], profile} as never,
      {provision: false, cdp: true}
    ).map((flag) =>
      // The plan names the port the launch claimed, as the spawn would.
      flag.startsWith('--remote-debugging-port=')
        ? `--remote-debugging-port=${fake.port}`
        : flag
    )
    const plan = chromiumLaunchPlan(pin, flags, 'https://example.com')
    expect(argsLine('FLAGS')).toContain(plan.args.join(' '))
    expect(existsSync(profile)).toBe(false)
  })

  // The plan names the port a launch would be handed, so it takes one the
  // way a launch does and gives it back.
  it('claims a debugging port for a launch it will not make, then releases it', async () => {
    await dryRun({chromiumBinary: pin})

    expect(fake.claims).toEqual([
      {requested: 9222, port: fake.port, released: 1}
    ])
  })
})

describe('firefox --dry-run', () => {
  let fake: FakeFirefox
  let out: string
  let pin: string

  beforeEach(async () => {
    fake = await fakeFirefox()
    out = fake.project.out
    pin = fake.project.plantBinary('canary-browser')
  })

  afterEach(async () => {
    expect(fake.spawns).toEqual([])
    expect(fake.packets).toEqual([])
    await fake.close()
  })

  // The request is built off the host, the way every production caller does.
  const dryRun = async (options: Record<string, unknown>) => {
    const host = {
      browser: 'firefox',
      extension: [out],
      dryRun: true,
      ...options
    }
    const plugin = new FirefoxLaunchPlugin(
      host as never,
      createFirefoxContext() as never,
      fake.deps
    )

    await plugin.runOnce(
      fake.project.compilation() as never,
      buildBrowserLaunchRequest(host as never, 'production') as never
    )
  }

  it('names the pinned binary and prints the launch argv', async () => {
    const profile = join(fake.project.root, 'my-profile')
    await dryRun({geckoBinary: pin, browserFlags: ['-jsconsole'], profile})

    const args = argsLine('ARGS')
    expect(printed()).toContain(pin)
    expect(argsLine('SOURCE')).toContain('pinned with --gecko-binary')
    expect(printed()).not.toContain('--binary-args=""')
    expect(args).toContain(`-profile ${profile}`)
    expect(args).toContain('-start-debugger-server')
    expect(args).toContain('-jsconsole')
  })

  it('writes no profile or user.js', async () => {
    const profile = join(fake.project.root, 'my-profile')
    await dryRun({geckoBinary: pin, profile})

    expect(existsSync(profile)).toBe(false)
    expect(existsSync(join(profile, 'user.js'))).toBe(false)
    expect(existsSync(join(fake.project.project, 'dist', 'extension-js'))).toBe(
      false
    )
  })

  it('prints the same argv the spawn seam produces', async () => {
    const profile = join(fake.project.root, 'my-profile')
    await dryRun({geckoBinary: pin, profile, port: 9333})

    const config = await resolveFirefoxLaunchConfig(
      fake.project.compilation() as never,
      {browser: 'firefox', mode: 'production', profile} as never,
      {provision: false}
    )
    const plan = FirefoxBinaryDetector.launchPlan({
      binaryPath: pin,
      profilePath: config.profilePath,
      // The plan names the port the launch claimed, as the spawn would.
      debugPort: fake.port,
      binaryArgs: config.binaryArgs,
      // The launch reads MOZ_HEADLESS and EXTENSION_HEADLESS from the shell,
      // so the plan this spec compares against has to read them the same way.
      headless: isFirefoxHeadlessRequested()
    })
    expect(argsLine('ARGS')).toContain(plan.args.join(' '))
  })

  it('composes the plan around the binary the system scan found', async () => {
    const system = fake.project.plantBinary('system-firefox')
    fake.deps.locate.firefox = () => system

    await dryRun({})

    expect(argsLine('PATH')).toContain(system)
    expect(argsLine('SOURCE')).toContain('system install')
    expect(argsLine('ARGS')).toContain('-profile')
    expect(fake.probed).toEqual([system])
    expect(existsSync(join(fake.project.project, 'dist', 'extension-js'))).toBe(
      false
    )
  })

  // The plan names the port a launch would be handed, so it takes one the
  // way a launch does and gives it back.
  it('claims a debugging port for a launch it will not make, then releases it', async () => {
    await dryRun({geckoBinary: pin})

    expect(fake.claims).toEqual([
      {requested: 9222, port: fake.port, released: 1}
    ])
  })
})
