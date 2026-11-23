import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as messages from '../../browsers-lib/messages'
import {pinnedBinaryExitNote} from '../../browsers-lib/pinned-binary'
import {buildBrowserLaunchRequest} from '../../browsers-lib/runtime-options'
import {createChromiumContext} from '../../run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from '../../run-chromium/chromium-launch'
import {createFirefoxContext} from '../../run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from '../../run-firefox/firefox-launch'
import {
  type FakeChromium,
  type FakeFirefox,
  fakeChromium,
  fakeFirefox
} from '../fake-browser'
import {onFakeClock} from '../fake-clock'

const RUN_ONLY = {
  enableCdpPostLaunch: false,
  sessionCommand: 'preview'
} as const
const CHROME_KEY = 'browser.chrome.chromiumBinary in extension.config.js'
const FIREFOX_KEY = 'commands.dev.geckoBinary in extension.config.mjs'
const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

const failure = (work: Promise<unknown>) =>
  work.then(
    () => {
      throw new Error('the launch resolved')
    },
    (error: Error & {code?: string}) => ({
      code: error.code,
      // The channel prefix differs by terminal, the words after it do not.
      message: stripAnsi(error.message).replace(
        /^(\[browser\]|⏵⏵⏵ Error:) /,
        ''
      )
    })
  )

// What each of the three places a binary can be pinned from is told to do.
const FIX = {
  flag: (flag: string, noun: string) =>
    `Pass ${flag} <abs-path> with a working ${noun}.`,
  config: (key: string, noun: string) =>
    `Set ${key} to a working ${noun}, or remove it to run the managed or system browser.`,
  env: (name: string, noun: string) =>
    `Set ${name} to a working ${noun}, or unset it to run the managed or system browser.`
}

describe('the words for what pinned a binary', () => {
  it.each([
    ['--chromium-binary', 'flag'],
    ['--gecko-binary', 'flag'],
    ['CHROME_FOR_TESTING_PATH', 'env'],
    ['FIREFOX_BINARY', 'env'],
    [CHROME_KEY, 'config'],
    [FIREFOX_KEY, 'config'],
    ['browser.chromium-based.chromiumBinary in extension.config.ts', 'config']
  ] as const)('reads %s as a %s', (source, kind) => {
    expect(messages.binaryPinSourceKind(source)).toBe(kind)
  })

  it.each([
    ['--chromium-binary', FIX.flag('--chromium-binary', 'browser binary')],
    [CHROME_KEY, FIX.config(CHROME_KEY, 'browser binary')],
    ['CHROME_BINARY', FIX.env('CHROME_BINARY', 'browser binary')]
  ])('says how to correct %s after a browser that left at once', (source, fix) => {
    expect(pinnedBinaryExitNote({path: '/opt/pin', pinnedBy: source})).toBe(
      `The binary at /opt/pin was pinned by ${source} and may not be a browser. ${fix}`
    )
  })

  it.each([
    ['--gecko-binary', FIX.flag('--gecko-binary', 'binary')],
    [FIREFOX_KEY, FIX.config(FIREFOX_KEY, 'binary')],
    ['FIREFOX_BINARY', FIX.env('FIREFOX_BINARY', 'binary')]
  ])('says how to correct %s when the binary never answers', (source, fix) => {
    expect(
      stripAnsi(messages.browserBinaryVersionTimedOut('/opt/pin', source, 10))
    ).toContain(`NOT USABLE /opt/pin\n${fix}`)
  })

  it('names the config key on the card and in the dry run plan', () => {
    expect(messages.binaryProvenanceNote('pinned', 'chrome', CHROME_KEY)).toBe(
      `(pinned with ${CHROME_KEY})`
    )

    expect(messages.binarySourceLabel('pinned', 'firefox', FIREFOX_KEY)).toBe(
      `pinned with ${FIREFOX_KEY}`
    )
  })
})

describe('a Chromium binary pinned from each place', () => {
  let fake: FakeChromium

  beforeEach(() => {
    for (const stream of ['log', 'error', 'warn'] as const) {
      vi.spyOn(console, stream).mockImplementation(() => {})
    }
  })

  afterEach(async () => {
    await fake.close()
    vi.restoreAllMocks()
  })

  const launcher = async (
    host: Record<string, unknown>,
    script: Parameters<typeof fakeChromium>[0] = {}
  ) => {
    fake = await fakeChromium(script)
    fake.project.writeReady({
      command: 'preview',
      status: 'starting',
      runId: 'run-1'
    })

    return (options: Record<string, unknown> = {}) => {
      const plugin = new ChromiumLaunchPlugin(
        {
          browser: 'chrome',
          extension: [fake.project.out],
          ...host,
          ...options
        } as never,
        createChromiumContext() as never,
        fake.deps
      )

      return {
        runOnly: () =>
          plugin.runOnce(fake.project.compilation() as never, RUN_ONLY),
        dev: () =>
          plugin.runOnce(fake.project.compilation('development') as never)
      }
    }
  }

  it.each([
    ['the flag', undefined, FIX.flag('--chromium-binary', 'path')],
    ['the config file', CHROME_KEY, FIX.config(CHROME_KEY, 'path')]
  ])('refuses a path that names nothing and says %s pinned it', async (_place, source, fix) => {
    const launch = await launcher({})
    const missing = path.join(fake.project.root, 'no-such-browser')
    const error = await failure(
      launch({
        chromiumBinary: missing,
        chromiumBinarySource: source
      }).runOnly()
    )

    expect(error).toEqual({
      code: 'E_BROWSER_BINARY_INVALID',
      message:
        "Can't find a Chromium binary at the given path.\n" +
        `NOT FOUND ${missing}\n` +
        fix
    })

    expect(fake.spawns).toEqual([])
  })

  it('refuses a path a variable names and says the variable pinned it', async () => {
    const launch = await launcher({})
    const missing = path.join(fake.project.root, 'no-such-browser')
    vi.stubEnv('CHROME_BINARY', missing)

    expect(await failure(launch().runOnly())).toEqual({
      code: 'E_BROWSER_BINARY_INVALID',
      message:
        "Can't find a browser binary at the path CHROME_BINARY names.\n" +
        `NOT FOUND ${missing}\n` +
        FIX.env('CHROME_BINARY', 'path')
    })

    expect(fake.spawns).toEqual([])
  })

  // Windows runs no permission check, so there the file passes this gate.
  it.runIf(process.platform !== 'win32').each([
    ['the flag', undefined, FIX.flag('--chromium-binary', 'binary')],
    ['the config file', CHROME_KEY, FIX.config(CHROME_KEY, 'binary')]
  ])(
    'refuses a file that is no program and says %s pinned it',
    async (_place, source, fix) => {
      const launch = await launcher({})
      const notes = path.join(fake.project.root, 'notes.txt')
      fs.writeFileSync(notes, 'not a browser\n', {mode: 0o644})

      const error = await failure(
        launch({chromiumBinary: notes, chromiumBinarySource: source}).runOnly()
      )

      expect(error).toEqual({
        code: 'E_BROWSER_BINARY_INVALID',
        message:
          "The browser binary at the given path can't be run, it is not an executable file.\n" +
          `NOT EXECUTABLE ${notes}\n` +
          fix
      })

      expect(fake.spawns).toEqual([])
    }
  )

  it.each([
    ['the flag', undefined, '--chromium-binary'],
    ['the config file', CHROME_KEY, CHROME_KEY]
  ])('names %s when the system will not run the pinned file', async (_place, source, pinnedBy) => {
    const refused = Object.assign(new Error('spawn ENOEXEC'), {
      code: 'ENOEXEC',
      errno: -8,
      syscall: 'spawn'
    })
    const launch = await launcher({}, {script: {spawnError: refused}})
    const pin = fake.project.plantBinary()
    const error = await failure(
      launch({chromiumBinary: pin, chromiumBinarySource: source}).runOnly()
    )

    expect(error.message).toContain(`PINNED BY ${pinnedBy} ${pin}`)
    expect(error.message).toContain(
      `The file may not be a browser. ${
        source
          ? FIX.config(pinnedBy, 'browser binary')
          : FIX.flag(pinnedBy, 'browser binary')
      }`
    )

    expect(String(fake.project.readReady().message)).toContain(
      `PINNED BY ${pinnedBy} ${pin}`
    )
  })

  it.each([
    [
      'the flag',
      undefined,
      '--chromium-binary',
      FIX.flag('--chromium-binary', 'browser binary')
    ],
    [
      'the config file',
      CHROME_KEY,
      CHROME_KEY,
      FIX.config(CHROME_KEY, 'browser binary')
    ]
  ])('stamps %s in ready.json when the pinned file leaves at once', async (_place, source, pinnedBy, fix) => {
    const launch = await launcher(
      {},
      {script: {exitsAfterMs: 0, exit: {code: 1, signal: null}}}
    )
    const pin = fake.project.plantBinary()
    fake.project.writeReady({command: 'dev', status: 'starting', runId: 'r1'})

    await onFakeClock(
      launch({chromiumBinary: pin, chromiumBinarySource: source}).dev
    )

    expect(fake.project.readReady()).toMatchObject({
      status: 'error',
      code: 'browser_exited',
      binary: pin,
      binaryProvenance: 'pinned',
      binaryPinnedBy: pinnedBy,
      message: `the browser process exited (code 1) before the extension loaded, nothing is running. The binary at ${pin} was pinned by ${pinnedBy} and may not be a browser. ${fix}`
    })
  })
})

describe('a Gecko binary pinned from each place', () => {
  let fake: FakeFirefox

  beforeEach(() => {
    for (const stream of ['log', 'error', 'warn'] as const) {
      vi.spyOn(console, stream).mockImplementation(() => {})
    }
  })

  afterEach(async () => {
    await fake.close()
    vi.restoreAllMocks()
  })

  const launch = async (options: Record<string, unknown>) => {
    const host = {
      browser: 'firefox',
      extension: [fake.project.out],
      ...options
    }

    return new FirefoxLaunchPlugin(
      host as never,
      createFirefoxContext(),
      fake.deps
    ).runOnce(
      fake.project.compilation('production') as never,
      buildBrowserLaunchRequest(host as never, 'production') as never
    )
  }

  it.each([
    ['the flag', undefined, FIX.flag('--gecko-binary', 'path')],
    ['the config file', FIREFOX_KEY, FIX.config(FIREFOX_KEY, 'path')]
  ])('refuses a path that names nothing and says %s pinned it', async (_place, source, fix) => {
    fake = await fakeFirefox()
    const missing = path.join(fake.project.root, 'no-such-browser')

    expect(
      await failure(launch({geckoBinary: missing, geckoBinarySource: source}))
    ).toEqual({
      code: 'E_BROWSER_BINARY_INVALID',
      message:
        "Can't find a Firefox or Gecko binary at the given path.\n" +
        `NOT FOUND ${missing}\n` +
        fix
    })

    expect(fake.spawns).toEqual([])
  })

  it('refuses a path a variable names and says the variable pinned it', async () => {
    fake = await fakeFirefox()
    const missing = path.join(fake.project.root, 'no-such-browser')
    vi.stubEnv('FIREFOX_BINARY', missing)

    expect(await failure(launch({}))).toEqual({
      code: 'E_BROWSER_BINARY_INVALID',
      message:
        "Can't find a browser binary at the path FIREFOX_BINARY names.\n" +
        `NOT FOUND ${missing}\n` +
        FIX.env('FIREFOX_BINARY', 'path')
    })

    expect(fake.spawns).toEqual([])
  })

  it.runIf(process.platform !== 'win32').each([
    ['the flag', undefined, FIX.flag('--gecko-binary', 'binary')],
    ['the config file', FIREFOX_KEY, FIX.config(FIREFOX_KEY, 'binary')]
  ])(
    'refuses a file that is no program and says %s pinned it',
    async (_place, source, fix) => {
      fake = await fakeFirefox()
      const notes = path.join(fake.project.root, 'notes.txt')
      fs.writeFileSync(notes, 'not a browser\n', {mode: 0o644})

      expect(
        await failure(launch({geckoBinary: notes, geckoBinarySource: source}))
      ).toEqual({
        code: 'E_BROWSER_BINARY_INVALID',
        message:
          "The browser binary at the given path can't be run, it is not an executable file.\n" +
          `NOT EXECUTABLE ${notes}\n` +
          fix
      })

      expect(fake.spawns).toEqual([])
    }
  )

  it.each([
    ['the flag', undefined, '--gecko-binary'],
    ['the config file', FIREFOX_KEY, FIREFOX_KEY]
  ])('names %s when the system will not run the pinned file', async (_place, source, pinnedBy) => {
    const refused = Object.assign(new Error('spawn ENOEXEC'), {
      code: 'ENOEXEC',
      errno: -8,
      syscall: 'spawn'
    })
    fake = await fakeFirefox({script: {spawnError: refused}})
    fake.project.writeReady({
      command: 'preview',
      status: 'starting',
      runId: 'run-1'
    })

    const pin = fake.project.plantBinary()
    const error = await failure(
      launch({geckoBinary: pin, geckoBinarySource: source})
    )

    expect(error.message).toContain(`PINNED BY ${pinnedBy} ${pin}`)
  })
})
