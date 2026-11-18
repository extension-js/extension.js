import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {buildBrowserLaunchRequest} from '../../browsers-lib/runtime-options'
import {createFirefoxContext} from '../../run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from '../../run-firefox/firefox-launch'
import {waitForRdpPort} from '../../run-firefox/firefox-launch/await-rdp-port'
import {
  FAKE_BROWSER_PID,
  type FakeBrowserScript,
  type FakeFirefox,
  fakeFirefox
} from '../fake-browser'
import {onFakeClock} from '../fake-clock'

const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

describe('a Firefox launch that does not reach a running add-on', () => {
  let fake: FakeFirefox
  let printed: Array<{stream: 'log' | 'error' | 'warn'; text: string}>
  let logged: string[]

  beforeEach(() => {
    printed = []
    logged = []

    for (const stream of ['log', 'error', 'warn'] as const) {
      vi.spyOn(console, stream).mockImplementation((...parts: unknown[]) => {
        printed.push({stream, text: stripAnsi(parts.map(String).join(' '))})
      })
    }
  })

  afterEach(async () => {
    await fake.close()
    vi.restoreAllMocks()
  })

  const said = (stream: 'log' | 'error' | 'warn') =>
    printed.filter((line) => line.stream === stream).map((line) => line.text)

  // A session that is starting, the way the command leaves the record
  // before it hands over to the launcher.
  const start = async (
    input: {
      script?: FakeBrowserScript
      browser?: string
      pinned?: boolean
      mode?: 'development' | 'production'
      librewolfRemoteDebugging?: boolean
    } = {}
  ) => {
    const mode = input.mode ?? 'production'
    fake = await fakeFirefox({
      script: input.script,
      browser: input.browser,
      librewolfRemoteDebugging: input.librewolfRemoteDebugging
    })

    fake.project.writeReady({
      command: mode === 'development' ? 'dev' : 'preview',
      status: 'starting',
      runId: 'run-1'
    })

    const host = {
      browser: input.browser ?? 'firefox',
      extension: [fake.project.out],
      geckoBinary:
        input.pinned === false ? undefined : fake.project.plantBinary()
    }
    const context = createFirefoxContext()
    context.logger = {
      info: (...parts: unknown[]) => void logged.push(parts.join(' ')),
      warn: (...parts: unknown[]) => void logged.push(parts.join(' ')),
      error: (...parts: unknown[]) => void logged.push(parts.join(' ')),
      debug: () => {}
    } as never

    const plugin = new FirefoxLaunchPlugin(host as never, context, fake.deps)

    return {
      plugin,
      launch: () =>
        plugin.runOnce(
          fake.project.compilation(mode) as never,
          buildBrowserLaunchRequest(host as never, mode) as never
        )
    }
  }

  const failure = (work: Promise<unknown>) =>
    work.then(
      () => {
        throw new Error('the launch resolved')
      },
      (error: Error & {code?: string}) => error
    )

  describe('no browser to run', () => {
    it('ends a firefox launch with the install command', async () => {
      const {plugin, launch} = await start({pinned: false})
      const error = await failure(launch())

      expect(error.code).toBe('E_BROWSER_NOT_FOUND')
      expect(error.message).toBe(
        "firefox isn't installed and no binary was found"
      )

      expect(fake.located).toEqual(['firefox'])
      expect(said('error')).toHaveLength(1)
      expect(said('error')[0]).toContain(
        "Firefox isn't available in the managed browser cache."
      )

      expect(said('error')[0]).toContain('npx extension install firefox')
      expect(plugin.spawnedBrowser).toBe(false)
      expect(fake.spawns).toEqual([])
      expect(fake.claims).toEqual([])
      expect(fake.project.readReady()).toMatchObject({
        status: 'error',
        code: 'browser_launch_failed',
        browserLaunchFailedCode: 'E_BROWSER_NOT_FOUND'
      })
    })

    it('leaves the record of a run that replaced this one during the launch', async () => {
      const {launch} = await start({pinned: false})
      const next = {command: 'preview', status: 'starting', runId: 'run-2'}

      fake.deps.locate.firefox = () => {
        fake.project.writeReady(next)

        return null
      }

      const error = await failure(launch())

      expect(error.code).toBe('E_BROWSER_NOT_FOUND')
      expect(fake.project.readReady()).toEqual(next)
    })

    it('prints the fork guidance block for a fork that is not installed', async () => {
      const {launch} = await start({pinned: false, browser: 'floorp'})
      const error = await failure(launch())

      expect(error.code).toBe('E_BROWSER_NOT_FOUND')
      expect(fake.located).toEqual(['floorp'])
      expect(said('error')).toHaveLength(1)

      const block = said('error')[0].split('\n')

      expect(block[0]).toMatch(/Floorp isn't installed\.$/)
      expect(block).toContain('1) Install Floorp from the official site')
      expect(block.at(-1)).toBe(
        'Or point at a binary with --gecko-binary <path>, or choose another browser with --browser <firefox|waterfox|librewolf|zen|floorp>.'
      )

      expect(said('error')[0]).not.toContain('extension install')
      expect(fake.spawns).toEqual([])
    })

    it('asks for a binary on the engine target and scans for none', async () => {
      const {launch} = await start({pinned: false, browser: 'gecko-based'})
      const error = await failure(launch())

      expect(error.code).toBe('E_BROWSER_BINARY_REQUIRED')
      expect(fake.located).toEqual([])
      expect(fake.spawns).toEqual([])
    })
  })

  describe('LibreWolf with remote debugging locked', () => {
    it('refuses before it looks for the binary, and names the file to change', async () => {
      const {plugin, launch} = await start({
        browser: 'librewolf',
        librewolfRemoteDebugging: false
      })

      const error = await failure(launch())

      expect(error.code).toBe('E_BROWSER_CONNECT')
      expect(stripAnsi(error.message)).toContain(
        "LibreWolf keeps remote debugging off, so Extension.js can't reach it."
      )

      expect(stripAnsi(error.message)).toContain(
        `${fake.project.root}/.librewolf/librewolf.overrides.cfg`.replace(
          /\//g,
          process.platform === 'win32' ? '\\' : '/'
        )
      )

      expect(fake.located).toEqual([])
      expect(fake.probed).toEqual([])
      expect(fake.claims).toEqual([])
      expect(fake.spawns).toEqual([])
      expect(plugin.spawnedBrowser).toBe(false)
      expect(fake.project.readReady()).toMatchObject({
        status: 'error',
        browserLaunchFailedCode: 'E_BROWSER_CONNECT'
      })
    })

    it('launches once the overrides allow it', async () => {
      const {plugin, launch} = await start({browser: 'librewolf'})
      await launch()

      expect(plugin.spawnedBrowser).toBe(true)
      expect(fake.spawns).toHaveLength(1)
    })
  })

  describe('a spawn that fails', () => {
    const refused = Object.assign(new Error('spawn EACCES'), {code: 'EACCES'})

    it('rejects with the spawn error and records that nothing is running', async () => {
      const {plugin, launch} = await start({script: {spawnError: refused}})

      expect(await failure(launch())).toBe(refused)
      expect(plugin.spawnedBrowser).toBe(false)
      expect(fake.signalWatchers).toEqual({registered: 0, disposed: 0})
      expect(fake.packets).toEqual([])
      expect(fake.project.readReady()).toMatchObject({
        status: 'error',
        code: 'browser_launch_failed',
        browserLaunchFailedReason: 'spawn EACCES'
      })

      expect(fake.project.readReady()).not.toHaveProperty('browserPid')
    })

    it('gives back the debugging port claim it took before the spawn', async () => {
      const {launch} = await start({script: {spawnError: refused}})
      await failure(launch())

      expect(fake.claims).toEqual([
        {requested: 9222, port: fake.port, released: 1}
      ])
    })
  })

  describe('a debugger port the browser never binds', () => {
    it('gives up after the port wait and the connect retries, with the reason on the record', async () => {
      const {plugin, launch} = await start({script: {bindsPort: false}})

      // The shipped wait is 150 s. Three seconds keeps this spec short.
      fake.deps.awaitRdpPort = async (_out, options) => {
        const result = await waitForRdpPort({...options, deadlineMs: 3000})

        return result
      }

      const error = await failure(onFakeClock(launch))

      expect(error.code).toBe('E_BROWSER_CONNECT')
      expect(stripAnsi(error.message)).toContain(
        `Can't connect to Firefox on port ${fake.port} after several retries.`
      )

      expect(plugin.spawnedBrowser).toBe(true)
      expect(fake.packets).toEqual([])
      expect(fake.claims[0].released).toBe(1)

      const ready = fake.project.readReady()

      expect(ready).not.toHaveProperty('rdpPort')
      expect(ready).toMatchObject({
        status: 'error',
        code: 'browser_launch_failed',
        browserLaunchFailedCode: 'E_BROWSER_CONNECT',
        browserPid: FAKE_BROWSER_PID
      })
    })
  })

  describe('a handshake that fails', () => {
    it('ends the launch when the browser drops every connection', async () => {
      const {launch} = await start({script: {handshake: 'dies'}})
      const error = await failure(onFakeClock(launch))

      expect(error.code).toBe('E_BROWSER_CONNECTION_CLOSED')
      // The port probe and five dials, and their one reason is printed once.
      expect(fake.dials).toEqual(Array.from({length: 6}, () => 'dies'))
      expect(said('error')).toEqual([
        `⏵⏵⏵ Firefox hit an unexpected error.\n${error.message}`
      ])

      expect(fake.packets).toEqual([])
      expect(fake.claims[0].released).toBe(1)
      expect(fake.project.readReady()).toMatchObject({
        status: 'error',
        code: 'browser_launch_failed',
        browserLaunchFailedCode: 'E_BROWSER_CONNECTION_CLOSED',
        rdpPort: fake.port,
        browserPid: FAKE_BROWSER_PID
      })
    })

    it('ends the launch when the browser never greets, 30 s an attempt', async () => {
      const {launch} = await start({script: {handshake: 'silent'}})
      const started = Date.now()
      let waitedMs = 0
      const error = await failure(
        onFakeClock(async () => {
          const from = Date.now()

          try {
            await launch()
          } finally {
            waitedMs = Date.now() - from
          }
        })
      )

      expect(Date.now() - started).toBeLessThan(10_000)
      expect(waitedMs).toBeGreaterThanOrEqual(5 * 30_000)
      expect(error.code).toBe('E_BROWSER_START_TIMEOUT')
      expect(error.message).toBe(
        `Firefox sent no RDP greeting on port ${fake.port} within 30000ms`
      )

      expect(fake.project.readReady()).toMatchObject({
        status: 'error',
        browserLaunchFailedCode: 'E_BROWSER_START_TIMEOUT',
        rdpPort: fake.port
      })
    })
  })

  describe('an add-on the browser refuses', () => {
    const refuse = () =>
      fake.answer('installTemporaryAddon', () => ({
        from: 'addons1',
        error: 'addonInstallFailed',
        message: 'Extension is invalid: bad key'
      }))

    it('ends a run-only launch on the reason the browser gave and stops the browser', async () => {
      const {launch} = await start()
      refuse()

      const error = await failure(launch())

      expect(error.code).toBe('E_EXTENSION_LOAD_REFUSED')
      expect(stripAnsi(error.message).split('\n')).toEqual([
        expect.stringMatching(
          /Firefox refuses to load this extension, so nothing in it runs\.$/
        ),
        `PATH ${fake.project.out}`,
        'REASON Extension is invalid: bad key',
        'Fix what the browser names, then run the command again.'
      ])

      expect(fake.terminated).toEqual([fake.child()])
      expect(fake.child()?.signals).toEqual(['SIGTERM'])
      expect(said('error')).toEqual([])
      expect(fake.project.readReady()).toMatchObject({
        status: 'error',
        code: 'extension_load_refused',
        extensionLoadRefusedReason: 'Extension is invalid: bad key',
        rdpPort: fake.port
      })
    })

    it('keeps a dev session and its browser alive, with the refusal said and recorded', async () => {
      const {launch} = await start({mode: 'development'})
      refuse()

      await onFakeClock(launch)

      expect(said('error')).toHaveLength(1)
      expect(said('error')[0].split('\n').slice(0, 3)).toEqual([
        expect.stringMatching(
          /The browser refused to load this add-on, so it isn't running\.$/
        ),
        `PATH ${fake.project.out}`,
        'REASON Extension is invalid: bad key'
      ])

      expect(said('log').join('\n')).not.toMatch(/ready for development/i)
      expect(fake.terminated).toEqual([])
      expect(fake.child()?.exited).toBe(false)
      expect(fake.project.readReady()).toMatchObject({
        status: 'error',
        code: 'extension_load_refused',
        rdpPort: fake.port
      })
    })
  })

  describe('a browser that exits before it is ready', () => {
    it('ends the launch on the exit, said once and recorded with its code', async () => {
      const {plugin, launch} = await start({
        script: {
          bindsPort: false,
          exitsAfterMs: 300,
          exit: {code: 1, signal: null}
        }
      })

      const error = await failure(onFakeClock(launch))

      expect(error.code).toBe('E_BROWSER_LAUNCH')
      expect(stripAnsi(error.message)).toContain(
        "Firefox exited before its debugger answered, so the extension isn't running."
      )

      expect(logged).toEqual([
        '[browser] firefox exited (code 1) without being asked to. The add-on may have been rejected or the browser crashed; the session cannot be driven.'
      ])

      expect(plugin.spawnedBrowser).toBe(true)
      expect(plugin.browserClosed).toBe(true)
      expect(fake.packets).toEqual([])
      expect(fake.child()?.signals).toEqual([])
      expect(fake.signalWatchers).toEqual({registered: 1, disposed: 1})
      expect(fake.claims[0].released).toBe(1)
      expect(fake.project.readReady()).toMatchObject({
        status: 'error',
        code: 'browser_exited',
        browserExitCode: 1,
        browserExitSignal: null,
        rdpPortError: `Firefox exited before it opened its remote debugging port ${fake.port}`
      })
    })
  })

  describe('the watch timeout', () => {
    const launchOnFakeClock = async (launch: () => Promise<void>) => {
      let settled = false
      void launch().then(() => {
        settled = true
      })

      while (!settled) await vi.advanceTimersByTimeAsync(50)
    }

    it('stops the browser and exits 0 once the time is up, not before', async () => {
      vi.useFakeTimers()

      try {
        const {launch} = await start({mode: 'development'})
        vi.stubEnv('EXTENSION_WATCH_TIMEOUT_MS', '5000')

        await launchOnFakeClock(launch)

        // The timer started at most one 50 ms step before the launch settled.
        await vi.advanceTimersByTimeAsync(4900)
        expect(fake.exits).toEqual([])
        expect(fake.terminated).toEqual([])

        await vi.advanceTimersByTimeAsync(100)
        expect(fake.terminated).toEqual([fake.child()])
        expect(fake.exits).toEqual([0])
        expect(logged).toContain(
          '[browser] Watch timeout reached (5000ms). Shutting down.'
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('sets no timer when no variable asks for one', async () => {
      vi.useFakeTimers()

      try {
        const {launch} = await start({mode: 'development'})

        await launchOnFakeClock(launch)
        await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)

        expect(fake.exits).toEqual([])
        expect(fake.terminated).toEqual([])
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
