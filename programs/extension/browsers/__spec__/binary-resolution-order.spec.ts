import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'

const located = {path: null as string | null, calls: 0}
const system = {
  chrome: null as string | null,
  chromium: null as string | null,
  firefox: null as string | null
}

// The system scan is stubbed so no spec ever finds a browser on this machine.
vi.mock('chrome-location2', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  default: () => system.chrome
}))

vi.mock('chromium-location', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  default: () => system.chromium
}))

vi.mock('firefox-location2', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  default: () => system.firefox
}))

vi.mock('edge-location', () => ({
  default: () => {
    located.calls++

    return located.path
  },
  getInstallGuidance: () => 'install edge (raw guidance)',
  getEdgeVersion: () => null
}))

import {
  binaryOverrideNaming,
  locateChromeIn,
  withBinaryOverridesFrom
} from '../browsers-lib/binary-env-override'
import {binaryProvenanceNote, binarySourceLabel} from '../browsers-lib/messages'
import {stampReadyBrowserLaunch} from '../browsers-lib/ready-stamp'
import {classifyBinaryProvenance} from '../browsers-lib/shared-utils'
import {createChromiumContext} from '../run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from '../run-chromium/chromium-launch'
import {createFirefoxContext} from '../run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from '../run-firefox/firefox-launch'

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '')

describe('the order a launch resolves its binary in', () => {
  const prevEnv = process.env
  const prevCwd = process.cwd()
  let root = ''
  let cacheRoot = ''
  let outputPath = ''
  let log: MockInstance<typeof console.log>

  function plant(...segments: string[]) {
    const file = path.join(root, ...segments)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, '#!/bin/sh\necho "Microsoft Edge 142.0.3595.53"\n')
    fs.chmodSync(file, 0o755)

    return file
  }

  const plantManagedEdge = () =>
    plant(
      'cache',
      'browsers',
      'edge',
      'mac_arm-142.0.3595.53',
      process.platform === 'win32' ? 'msedge.exe' : 'msedge'
    )

  const printed = () =>
    stripAnsi(
      log.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
    )
  const planLine = (label: string) =>
    printed()
      .split(/\r?\n/)
      .find((line) => line.includes(` ${label} `)) || ''

  async function planChromium(
    browser: string,
    options: Record<string, unknown> = {}
  ) {
    const plugin = new ChromiumLaunchPlugin(
      {
        browser,
        extension: [outputPath],
        dryRun: true,
        ...options
      } as any,
      createChromiumContext() as any
    )

    await (plugin as any).launchChromium({
      options: {output: {path: outputPath}, mode: 'development'},
      outputOptions: {path: outputPath}
    })
  }

  const planEdge = (options: Record<string, unknown> = {}) =>
    planChromium('edge', options)

  const exe = (name: string) =>
    process.platform === 'win32' ? `${name}.exe` : name

  const plantManaged = (browser: string, label: string, name: string) =>
    plant('cache', 'browsers', browser, label, exe(name))

  async function planFirefox(options: Record<string, unknown> = {}) {
    const firefoxOut = path.join(root, 'dist', 'firefox')
    fs.mkdirSync(firefoxOut, {recursive: true})
    fs.copyFileSync(
      path.join(outputPath, 'manifest.json'),
      path.join(firefoxOut, 'manifest.json')
    )

    const plugin = new FirefoxLaunchPlugin(
      {
        browser: 'firefox',
        extension: [firefoxOut],
        dryRun: true,
        ...options
      } as any,
      createFirefoxContext() as any
    )

    await plugin.runOnce(
      {
        options: {
          mode: 'production',
          context: root,
          output: {path: firefoxOut}
        },
        errors: [],
        hooks: {done: {tap: () => {}}}
      } as any,
      {mode: 'production'} as any
    )
  }

  // A file that exists and is not a program, where the platform can tell.
  function plantNotExecutable(...segments: string[]) {
    const file = path.join(root, ...segments)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, 'not a program')
    fs.chmodSync(file, 0o644)

    return file
  }

  async function refusal(run: () => Promise<void>) {
    const thrown = (await run().then(
      () => null,
      (error: unknown) => error
    )) as (Error & {code?: string}) | null

    return {
      code: thrown?.code,
      message: stripAnsi(String(thrown?.message || ''))
    }
  }

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ext-binary-order-'))
    )

    cacheRoot = path.join(root, 'cache', 'browsers')
    fs.mkdirSync(cacheRoot, {recursive: true})
    located.path = null
    located.calls = 0
    system.chrome = null
    system.chromium = null
    system.firefox = null

    outputPath = path.join(root, 'dist', 'edge')
    fs.mkdirSync(outputPath, {recursive: true})
    fs.writeFileSync(
      path.join(outputPath, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'x', version: '1.0.0'})
    )

    fs.writeFileSync(path.join(root, 'package.json'), '{}')
    process.chdir(root)

    // The launcher only resolves a binary outside the test runner's env.
    process.env = {
      PATH: prevEnv.PATH,
      HOME: root,
      USERPROFILE: root,
      LOCALAPPDATA: path.join(root, 'AppData', 'Local'),
      EXT_BROWSERS_CACHE_DIR: cacheRoot,
      FORCE_COLOR: '0',
      NO_COLOR: '1'
    } as unknown as NodeJS.ProcessEnv

    log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = prevEnv
    process.chdir(prevCwd)
    vi.restoreAllMocks()
    fs.rmSync(root, {recursive: true, force: true})
  })

  it('edge: the flag wins over EDGE_BINARY, a managed copy and the system', async () => {
    const pin = plant('pinned', 'msedge')
    process.env.EDGE_BINARY = plant('from-env', 'msedge')
    plantManagedEdge()
    located.path = plant('system', 'msedge')

    await planEdge({chromiumBinary: pin})

    expect(planLine('PATH')).toContain(pin)
    expect(planLine('SOURCE')).toContain('pinned with --chromium-binary')
    expect(located.calls).toBe(0)
  })

  it('edge: EDGE_BINARY wins over a managed copy and the system', async () => {
    const fromEnv = plant('from-env', 'msedge')
    process.env.EDGE_BINARY = fromEnv
    plantManagedEdge()
    located.path = plant('system', 'msedge')

    await planEdge()

    expect(planLine('PATH')).toContain(fromEnv)
    expect(planLine('SOURCE')).toContain('pinned with EDGE_BINARY')
    expect(located.calls).toBe(0)
  })

  it('edge: a managed copy wins over the system install', async () => {
    const managed = plantManagedEdge()
    located.path = plant('system', 'msedge')

    await planEdge()

    expect(planLine('PATH')).toContain(managed)
    expect(planLine('SOURCE')).toMatch(/SOURCE managed$/)
    expect(located.calls).toBe(0)
  })

  it('edge: the system install runs when nothing else resolves', async () => {
    const system = plant('system', 'msedge')
    located.path = system

    await planEdge()

    expect(planLine('PATH')).toContain(system)
    expect(planLine('SOURCE')).toContain('system install')
  })

  it('edge: a managed copy launches when the system scan would find nothing', async () => {
    const managed = plantManagedEdge()

    await planEdge()

    expect(planLine('PATH')).toContain(managed)
    expect(printed()).not.toContain("isn't installed")
  })

  it('edge: EDGE_BINARY that names nothing is refused by name, managed copy or not', async () => {
    const missing = path.join(root, 'nowhere', 'msedge')
    process.env.EDGE_BINARY = missing
    located.path = plant('system', 'msedge')

    const bare = await refusal(() => planEdge())

    expect(bare.code).toBe('E_BROWSER_BINARY_INVALID')
    expect(bare.message).toContain('EDGE_BINARY')
    expect(bare.message).toContain(missing)
    expect(bare.message).not.toContain("isn't installed")

    plantManagedEdge()

    const withManaged = await refusal(() => planEdge())

    expect(withManaged.code).toBe('E_BROWSER_BINARY_INVALID')
    expect(withManaged.message).toContain(missing)
    expect(located.calls).toBe(0)
    expect(planLine('PATH')).toBe('')
  })

  it('edge: nothing set and nothing found ends in not installed', async () => {
    const found = await refusal(() => planEdge())

    expect(found.code).toBe('E_BROWSER_NOT_FOUND')
    expect(found.message).toContain("isn't installed")
  })

  it('chrome: the flag wins over CHROME_BINARY, a managed copy and the system', async () => {
    const pin = plant('pinned', 'chrome')
    process.env.CHROME_BINARY = plant('from-env', 'chrome')
    plantManaged('chrome', 'mac_arm-151.0.7100.2', 'chrome')
    system.chrome = plant('system', 'chrome')

    await planChromium('chrome', {chromiumBinary: pin})

    expect(planLine('PATH')).toContain(pin)
    expect(planLine('SOURCE')).toContain('pinned with --chromium-binary')
  })

  it.each([
    'CHROME_FOR_TESTING_PATH',
    'CHROMIUM_BINARY',
    'CHROME_BINARY'
  ])('chrome: %s wins over a managed copy and the system', async (name) => {
    const fromEnv = plant('from-env', 'chrome')
    process.env[name] = fromEnv
    plantManaged('chrome', 'mac_arm-151.0.7100.2', 'chrome')
    system.chrome = plant('system', 'chrome')

    await planChromium('chrome')

    expect(planLine('PATH')).toContain(fromEnv)
    expect(planLine('SOURCE')).toContain(`pinned with ${name}`)
  })

  it('chrome: a managed copy wins over the system install', async () => {
    const managed = plantManaged('chrome', 'mac_arm-151.0.7100.2', 'chrome')
    system.chrome = plant('system', 'chrome')

    await planChromium('chrome')

    expect(planLine('PATH')).toContain(managed)
    expect(planLine('SOURCE')).toMatch(/SOURCE managed$/)
  })

  it('chrome: the system install runs when nothing else resolves', async () => {
    const found = plant('system', 'chrome')
    system.chrome = found

    await planChromium('chrome')

    expect(planLine('PATH')).toContain(found)
    expect(planLine('SOURCE')).toContain('system install')
  })

  it('chrome: CHROME_BINARY that names nothing is refused by name', async () => {
    const missing = path.join(root, 'nowhere', 'chrome')
    process.env.CHROME_BINARY = missing
    plantManaged('chrome', 'mac_arm-151.0.7100.2', 'chrome')
    system.chrome = plant('system', 'chrome')

    const found = await refusal(() => planChromium('chrome'))

    expect(found.code).toBe('E_BROWSER_BINARY_INVALID')
    expect(found.message).toContain('CHROME_BINARY')
    expect(found.message).toContain(missing)
    expect(planLine('PATH')).toBe('')
  })

  it.skipIf(process.platform === 'win32')(
    'chrome: the branded Chrome named in CHROME_BINARY is still never run',
    async () => {
      const branded = plant('opt', 'bin', 'google-chrome')
      process.env.CHROME_BINARY = branded
      system.chrome = branded

      const alone = await refusal(() => planChromium('chrome'))

      expect(alone.code).toBe('E_BROWSER_NOT_FOUND')
      expect(planLine('PATH')).toBe('')

      const managed = plantManaged('chrome', 'mac_arm-151.0.7100.2', 'chrome')

      await planChromium('chrome')

      expect(planLine('PATH')).toContain(managed)
      expect(planLine('SOURCE')).toMatch(/SOURCE managed$/)
    }
  )

  it('chromium: CHROMIUM_BINARY wins over a managed copy and the system', async () => {
    const fromEnv = plant('from-env', 'chromium')
    process.env.CHROMIUM_BINARY = fromEnv
    plantManaged('chromium', 'mac_arm-1500000', 'chromium')
    system.chromium = plant('system', 'chromium')

    await planChromium('chromium')

    expect(planLine('PATH')).toContain(fromEnv)
    expect(planLine('SOURCE')).toContain('pinned with CHROMIUM_BINARY')
  })

  it('chromium: a variable named for Chrome does not choose its binary', async () => {
    process.env.CHROME_BINARY = plant('from-env', 'chrome')
    const found = plant('system', 'chromium')
    system.chromium = found

    await planChromium('chromium')

    expect(planLine('PATH')).toContain(found)
    expect(planLine('SOURCE')).toContain('system install')
  })

  it('chromium: CHROMIUM_BINARY that names nothing is refused by name', async () => {
    const missing = path.join(root, 'nowhere', 'chromium')
    process.env.CHROMIUM_BINARY = missing
    system.chromium = plant('system', 'chromium')

    const found = await refusal(() => planChromium('chromium'))

    expect(found.code).toBe('E_BROWSER_BINARY_INVALID')
    expect(found.message).toContain('CHROMIUM_BINARY')
    expect(found.message).toContain(missing)
  })

  it('firefox: the flag wins over FIREFOX_BINARY, a managed copy and the system', async () => {
    const pin = plant('pinned', 'firefox')
    process.env.FIREFOX_BINARY = plant('from-env', 'firefox')
    plantManaged('firefox', 'mac_arm-stable_150.0', 'firefox')
    system.firefox = plant('system', 'firefox')

    await planFirefox({geckoBinary: pin})

    expect(planLine('PATH')).toContain(pin)
    expect(planLine('SOURCE')).toContain('pinned with --gecko-binary')
  })

  it('firefox: FIREFOX_BINARY wins over a managed copy and the system', async () => {
    const fromEnv = plant('from-env', 'firefox')
    process.env.FIREFOX_BINARY = fromEnv
    plantManaged('firefox', 'mac_arm-stable_150.0', 'firefox')
    system.firefox = plant('system', 'firefox')

    await planFirefox()

    expect(planLine('PATH')).toContain(fromEnv)
    expect(planLine('SOURCE')).toContain('pinned with FIREFOX_BINARY')
  })

  it('firefox: a managed copy wins over the system install', async () => {
    const managed = plantManaged('firefox', 'mac_arm-stable_150.0', 'firefox')
    system.firefox = plant('system', 'firefox')

    await planFirefox()

    expect(planLine('PATH')).toContain(managed)
    expect(planLine('SOURCE')).toMatch(/SOURCE managed$/)
  })

  it('firefox: the system install runs when nothing else resolves', async () => {
    const found = plant('system', 'firefox')
    system.firefox = found

    await planFirefox()

    expect(planLine('PATH')).toContain(found)
    expect(planLine('SOURCE')).toContain('system install')
  })

  it('firefox: FIREFOX_BINARY that names nothing is refused by name', async () => {
    const missing = path.join(root, 'nowhere', 'firefox')
    process.env.FIREFOX_BINARY = missing
    plantManaged('firefox', 'mac_arm-stable_150.0', 'firefox')
    system.firefox = plant('system', 'firefox')

    const found = await refusal(() => planFirefox())

    expect(found.code).toBe('E_BROWSER_BINARY_INVALID')
    expect(found.message).toContain('FIREFOX_BINARY')
    expect(found.message).toContain(missing)
    expect(planLine('PATH')).toBe('')
  })

  it.skipIf(process.platform === 'win32').each([
    ['edge', 'EDGE_BINARY'],
    ['chrome', 'CHROME_BINARY'],
    ['firefox', 'FIREFOX_BINARY']
  ])(
    '%s: %s that names a file that cannot run is refused by name',
    async (browser, name) => {
      const file = plantNotExecutable('from-env', 'not-a-browser')
      process.env[name] = file

      const found = await refusal(() =>
        browser === 'firefox' ? planFirefox() : planChromium(browser)
      )

      expect(found.code).toBe('E_BROWSER_BINARY_INVALID')
      expect(found.message).toContain('NOT EXECUTABLE')
      expect(found.message).toContain(name)
      expect(found.message).toContain(file)
    }
  )

  it('classes an env override like the flag and names it on the contract', () => {
    const fromEnv = plant('from-env', 'msedge')
    const readyPath = path.join(
      root,
      'dist',
      'extension-js',
      'edge',
      'ready.json'
    )
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready'}))

    const pinnedBy = binaryOverrideNaming('edge', fromEnv, {
      EDGE_BINARY: fromEnv
    })
    const binaryProvenance = classifyBinaryProvenance({
      binaryPath: fromEnv,
      managedCacheRoot: cacheRoot,
      pinnedByEnv: Boolean(pinnedBy)
    })

    expect(pinnedBy).toBe('EDGE_BINARY')
    expect(binaryProvenance).toBe('pinned')

    stampReadyBrowserLaunch(outputPath, {
      binary: fromEnv,
      binaryProvenance,
      binaryPinnedBy: pinnedBy || undefined
    })

    const read = () => JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(read()).toMatchObject({
      binary: fromEnv,
      binaryProvenance: 'pinned',
      binaryPinnedBy: 'EDGE_BINARY'
    })

    // A later launch that pinned nothing must not keep the old name.
    stampReadyBrowserLaunch(outputPath, {
      binary: fromEnv,
      binaryProvenance: 'system'
    })

    expect(read().binaryPinnedBy).toBeUndefined()
  })
})

describe('binary env overrides', () => {
  let root = ''
  const saved = process.env.CHROME_BINARY

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ext-binary-env-'))
    )
  })

  afterEach(() => {
    if (saved === undefined) delete process.env.CHROME_BINARY
    else process.env.CHROME_BINARY = saved

    fs.rmSync(root, {recursive: true, force: true})
  })

  const plant = (name: string) => {
    const file = path.join(root, name)
    fs.writeFileSync(file, '')

    return file
  }

  it('names the variable that chose the binary, per browser', () => {
    const binary = plant('chrome')

    expect(
      binaryOverrideNaming('chrome', binary, {CHROME_BINARY: binary})
    ).toBe('CHROME_BINARY')

    expect(
      binaryOverrideNaming('chromium', binary, {CHROMIUM_BINARY: binary})
    ).toBe('CHROMIUM_BINARY')

    expect(
      binaryOverrideNaming('firefox', binary, {FIREFOX_BINARY: binary})
    ).toBe('FIREFOX_BINARY')

    // Another browser's variable says nothing about this one.
    expect(
      binaryOverrideNaming('edge', binary, {CHROME_BINARY: binary})
    ).toBeNull()

    expect(
      binaryOverrideNaming('chrome', binary, {CHROME_BINARY: plant('other')})
    ).toBeNull()

    expect(binaryOverrideNaming('brave', binary, {CHROME_BINARY: binary})).toBe(
      null
    )
  })

  it('hands the chrome locator the env it was given, not the process one', () => {
    const given = plant('given-chrome')
    const ambient = plant('ambient-chrome')
    process.env.CHROME_BINARY = ambient

    const seen: Array<string | undefined> = []
    const found = locateChromeIn(
      {CHROME_BINARY: given} as unknown as NodeJS.ProcessEnv,
      ((_fallback: boolean, deps: {env: NodeJS.ProcessEnv}) => {
        seen.push(process.env.CHROME_BINARY, deps.env.CHROME_BINARY)

        return process.env.CHROME_BINARY || null
      }) as any
    )

    expect(found).toBe(given)
    expect(seen).toEqual([given, given])
    expect(process.env.CHROME_BINARY).toBe(ambient)
  })

  it('resolves the given override through the real chrome locator', async () => {
    const real =
      await vi.importActual<typeof import('chrome-location2')>(
        'chrome-location2'
      )
    const given = plant('given-chrome')
    process.env.CHROME_BINARY = plant('ambient-chrome')

    expect(
      locateChromeIn({...process.env, CHROME_BINARY: given}, real.default)
    ).toBe(given)
  })

  it('hides an ambient override the given env does not carry, and restores on a throw', () => {
    const ambient = plant('ambient-chrome')
    process.env.CHROME_BINARY = ambient

    expect(() =>
      withBinaryOverridesFrom({}, ['CHROME_BINARY'], () => {
        expect(process.env.CHROME_BINARY).toBeUndefined()

        throw new Error('locator failed')
      })
    ).toThrow('locator failed')

    expect(process.env.CHROME_BINARY).toBe(ambient)
  })

  it('words the source the way the card does', () => {
    expect(binaryProvenanceNote('pinned', 'edge', 'EDGE_BINARY')).toBe(
      '(pinned with EDGE_BINARY)'
    )

    expect(binaryProvenanceNote('pinned', 'edge')).toBe(
      '(pinned with --chromium-binary)'
    )

    expect(binarySourceLabel('pinned', 'firefox')).toBe(
      'pinned with --gecko-binary'
    )

    expect(binarySourceLabel('managed', 'chrome')).toBe('managed')
    expect(binarySourceLabel('system', 'chrome')).toBe('system install')
    expect(binarySourceLabel('snapshot', 'chromium')).toBe('managed snapshot')
    expect(binarySourceLabel(undefined, 'chrome')).toBe('')
  })
})
