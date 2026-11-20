import {spawn} from 'node:child_process'
import {once} from 'node:events'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {claimDebugPortNear} from '../../browsers-lib/debug-port-claim'
import {createChromiumContext} from '../../run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from '../../run-chromium/chromium-launch'
import {
  FAKE_BROWSER_PID,
  type FakeBrowserScript,
  type FakeChromium,
  fakeChromium
} from '../fake-browser'
import {onFakeClock} from '../fake-clock'

const RUN_ONLY = {
  enableCdpPostLaunch: false,
  sessionCommand: 'preview'
} as const
const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

describe('a Chromium launch that does not reach a running extension', () => {
  let fake: FakeChromium
  let printed: Array<{stream: 'log' | 'error' | 'warn'; text: string}>

  beforeEach(() => {
    printed = []

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
      host?: Record<string, unknown>
      command?: 'dev' | 'preview'
      realClaim?: {maxAttempts: number}
    } = {}
  ) => {
    fake = await fakeChromium({script: input.script, browser: input.browser})

    if (input.realClaim) {
      const {claimDir} = fake
      const {maxAttempts} = input.realClaim
      fake.deps.claimPort = (startPort) =>
        claimDebugPortNear(startPort, {dir: claimDir, maxAttempts})
    }

    fake.project.writeReady({
      command: input.command ?? 'preview',
      status: 'starting',
      runId: 'run-1'
    })

    const pin = input.pinned === false ? undefined : fake.project.plantBinary()
    const plugin = new ChromiumLaunchPlugin(
      {
        browser: input.browser ?? 'chrome',
        extension: [fake.project.out],
        chromiumBinary: pin,
        ...input.host
      } as never,
      createChromiumContext() as never,
      fake.deps
    )

    return {
      plugin,
      runOnly: () =>
        plugin.runOnce(fake.project.compilation() as never, RUN_ONLY),
      dev: () =>
        plugin.runOnce(fake.project.compilation('development') as never)
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
    it('ends a chrome launch with the install command, after offering the download once', async () => {
      const {plugin, runOnly} = await start({pinned: false})
      const error = await failure(runOnly())

      expect(error.code).toBe('E_BROWSER_NOT_FOUND')
      expect(error.message).toBe(
        "chrome isn't installed and no binary was found"
      )

      expect(fake.offeredInstalls).toEqual(['chrome'])
      expect(fake.located).toEqual(['chrome'])
      expect(said('error')).toHaveLength(1)
      expect(said('error')[0]).toContain(
        "Chrome for Testing isn't available in the managed browser cache."
      )

      expect(said('error')[0]).toContain('npx extension install chrome')
      expect(plugin.spawnedBrowser).toBe(false)
      expect(fake.spawns).toEqual([])
      expect(fake.claims).toEqual([])
      expect(fake.project.readReady()).toMatchObject({
        status: 'error',
        code: 'browser_launch_failed',
        browserLaunchFailedCode: 'E_BROWSER_NOT_FOUND',
        browserLaunchFailedReason:
          "chrome isn't installed and no binary was found"
      })
    })

    it('ends an edge launch with the system-wide install, and offers no download', async () => {
      const {runOnly} = await start({pinned: false, browser: 'edge'})
      const error = await failure(runOnly())

      expect(error.code).toBe('E_BROWSER_NOT_FOUND')
      expect(fake.offeredInstalls).toEqual([])
      expect(said('error')).toHaveLength(1)
      expect(said('error')[0].split('\n').slice(0, 5)).toEqual([
        "⏵⏵⏵ Warning: Edge isn't installed.",
        '',
        'Install Edge system-wide (the installer may ask for an administrator password):',
        '',
        '  npx extension install edge'
      ])

      expect(said('error')[0]).not.toContain('managed browser cache')
      expect(fake.spawns).toEqual([])
    })

    it('prints the fork guidance block for a fork that is not installed, and offers no download', async () => {
      const {runOnly} = await start({pinned: false, browser: 'vivaldi'})
      const error = await failure(runOnly())

      expect(error.code).toBe('E_BROWSER_NOT_FOUND')
      expect(fake.located).toEqual(['vivaldi'])
      expect(fake.offeredInstalls).toEqual([])
      expect(said('error')).toHaveLength(1)

      const block = said('error')[0].split('\n')

      expect(block[0]).toMatch(/Vivaldi isn't installed\.$/)
      expect(block).toContain('1) Install Vivaldi from the official site')
      expect(block.at(-1)).toBe(
        'Or point at a binary with --chromium-binary <path>, or choose another browser with --browser <chrome|chromium|edge|brave|opera|vivaldi|yandex>.'
      )

      expect(said('error')[0]).not.toMatch(/We couldn't find/)
      expect(said('error')[0]).not.toMatch(/Re-run your command/)
      expect(said('error')[0]).not.toContain('extension install')
      expect(fake.spawns).toEqual([])
    })

    it('leaves the record of a run that replaced this one during the launch', async () => {
      const {runOnly} = await start({pinned: false})
      const next = {command: 'preview', status: 'starting', runId: 'run-2'}

      fake.deps.locate.chrome = () => {
        fake.project.writeReady(next)

        return null
      }

      const error = await failure(runOnly())

      expect(error.code).toBe('E_BROWSER_NOT_FOUND')
      expect(fake.project.readReady()).toEqual(next)
    })

    it('runs the binary the system scan found for a fork', async () => {
      fake = await fakeChromium({browser: 'brave'})
      const system = fake.project.plantBinary('system-brave')
      fake.deps.locate.brave = () => system
      const plugin = new ChromiumLaunchPlugin(
        {browser: 'brave', extension: [fake.project.out]} as never,
        createChromiumContext() as never,
        fake.deps
      )

      await plugin.runOnce(fake.project.compilation() as never, RUN_ONLY)

      expect(fake.spawns.map((spawn) => spawn.binary)).toEqual([system])
      expect(fake.offeredInstalls).toEqual([])
    })
  })

  describe.skipIf(process.platform === 'win32')(
    'a profile another browser holds',
    () => {
      it('throws E_PROFILE_LOCKED for the CLI and keeps profile_locked in the ready contract', async () => {
        const profile = fs.realpathSync(
          fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-locked-profile-'))
        )
        // A node child of this spec, named chromium in the process table,
        // stands in for the browser on the profile. `--` keeps the flag an
        // argument of the script, or node refuses it and exits.
        const holder = spawn(
          process.execPath,
          [
            '-e',
            'setInterval(() => {}, 1000)',
            '--',
            `--user-data-dir=${profile}`
          ],
          {stdio: 'ignore', argv0: 'chromium'}
        )

        try {
          await once(holder, 'spawn')
          fs.symlinkSync(
            `${os.hostname()}-${holder.pid}`,
            path.join(profile, 'SingletonLock')
          )

          const {plugin, runOnly} = await start({host: {profile}})
          const error = (await failure(runOnly())) as Error & {
            code?: string
            profileLockOwner?: {host: string; pid: number}
          }

          expect(error.code).toBe('E_PROFILE_LOCKED')
          expect(error.profileLockOwner?.pid).toBe(holder.pid)
          expect(stripAnsi(error.message)).toContain(profile)
          expect(plugin.spawnedBrowser).toBe(false)
          expect(fake.spawns).toEqual([])
          expect(fake.project.readReady()).toMatchObject({
            status: 'error',
            code: 'profile_locked',
            profileLockOwner: {pid: holder.pid}
          })

          expect(fake.project.readReady()).not.toHaveProperty(
            'browserLaunchFailedCode'
          )

          expect(fs.readlinkSync(path.join(profile, 'SingletonLock'))).toBe(
            `${os.hostname()}-${holder.pid}`
          )
        } finally {
          const exited = once(holder, 'exit')
          holder.kill('SIGKILL')
          await exited
          fs.rmSync(profile, {recursive: true, force: true})
        }
      })
    }
  )

  describe('a spawn that fails', () => {
    const refused = Object.assign(new Error('spawn EACCES'), {code: 'EACCES'})

    it('rejects with the spawn error and records that nothing is running', async () => {
      const {plugin, runOnly} = await start({script: {spawnError: refused}})

      expect(await failure(runOnly())).toBe(refused)
      expect(plugin.spawnedBrowser).toBe(false)
      expect(fake.spawns).toHaveLength(1)
      expect(fake.signalWatchers).toEqual({registered: 0, disposed: 0})
      expect(fake.project.readReady()).toMatchObject({
        status: 'error',
        code: 'browser_launch_failed',
        browserLaunchFailedReason: 'spawn EACCES'
      })

      expect(fake.project.readReady()).not.toHaveProperty('browserPid')
    })

    it('gives back the debugging port claim it took before the spawn', async () => {
      const {runOnly} = await start({script: {spawnError: refused}})
      await failure(runOnly())

      expect(fake.claims).toEqual([
        {requested: 9222, port: fake.port, released: 1}
      ])
    })
  })

  describe('every debugging port taken', () => {
    let holder: net.Server

    beforeEach(async () => {
      holder = net.createServer()
      await new Promise<void>((resolve) =>
        holder.listen(0, '127.0.0.1', resolve)
      )
    })

    afterEach(async () => {
      await new Promise((resolve) => holder.close(resolve))
    })

    // The debugging port is --port plus 100, so this run starts its search
    // on the port the holder listens on, with room for one attempt.
    const startOnHeldPort = async (command: 'dev' | 'preview') => {
      const held = (holder.address() as net.AddressInfo).port
      const launch = await start({
        host: {port: held - 100},
        command,
        realClaim: {maxAttempts: 1}
      })

      return {held, ...launch}
    }

    it('refuses a run-only launch with E_PORT_UNAVAILABLE and records the code', async () => {
      const {held, plugin, runOnly} = await startOnHeldPort('preview')
      const error = await failure(runOnly())

      expect(error.code).toBe('E_PORT_UNAVAILABLE')
      expect(error.message).toContain(`from ${held} to ${held}`)
      expect(plugin.spawnedBrowser).toBe(false)
      expect(fake.spawns).toEqual([])
      expect(fake.project.readReady()).toMatchObject({
        status: 'error',
        code: 'browser_launch_failed',
        browserLaunchFailedCode: 'E_PORT_UNAVAILABLE'
      })
    })

    it('refuses a dev launch the same way', async () => {
      const {plugin, dev} = await startOnHeldPort('dev')
      const error = await failure(dev())

      expect(error.code).toBe('E_PORT_UNAVAILABLE')
      expect(plugin.spawnedBrowser).toBe(false)
      expect(fake.spawns).toEqual([])
      expect(fake.project.readReady()).toMatchObject({
        status: 'error',
        code: 'browser_launch_failed',
        browserLaunchFailedCode: 'E_PORT_UNAVAILABLE'
      })
    })
  })

  describe('a debugging port the browser never binds', () => {
    it('keeps the port off the run record and says so, with the guest loaded over the pipe', async () => {
      const {runOnly} = await start({script: {bindsPort: false}})
      const {waitedMs} = await onFakeClock(runOnly)

      // Twenty looks a quarter second apart before the port is given up on.
      expect(waitedMs).toBeGreaterThanOrEqual(19 * 250)
      expect(said('warn')).toHaveLength(1)
      expect(said('warn')[0]).toContain(
        `This browser did not open its debugging port ${fake.port}.`
      )

      const ready = fake.project.readReady()

      expect(ready).not.toHaveProperty('cdpPort')
      expect(ready).toMatchObject({
        status: 'starting',
        browserPid: FAKE_BROWSER_PID,
        extensionId: 'a'.repeat(32),
        extensionIdSource: 'browser'
      })

      expect(fake.claims[0].released).toBe(1)
      expect(fake.terminated).toEqual([])
    })
  })

  // The load check and the reload wiring both talk over the pipe, so no
  // launch is left to find the browser by its port alone.
  describe('a launch whose exclusion list names the debugging flags', () => {
    const excluded = {
      excludeBrowserFlags: [
        '--remote-debugging-pipe',
        '--remote-debugging-port',
        '--remote-debugging-address'
      ]
    }

    it.each([
      'runOnly',
      'dev'
    ] as const)('still opens the pipe for a %s launch and loads the guest over it', async (kind) => {
      const launch = await start({
        host: excluded,
        command: kind === 'dev' ? 'dev' : 'preview'
      })
      fake.project.writeReady({
        command: kind === 'dev' ? 'dev' : 'preview',
        status: 'starting',
        runId: 'run-1',
        executorAttachedAt: new Date().toISOString()
      })

      await launch[kind]()

      expect(fake.spawns).toHaveLength(1)
      expect(fake.spawns[0].stdio).toEqual([
        'ignore',
        'ignore',
        'pipe',
        'pipe',
        'pipe'
      ])

      expect(fake.spawns[0].args).toContain('--remote-debugging-pipe')
      expect(fake.spawns[0].args).toContain(
        `--remote-debugging-port=${fake.port}`
      )

      expect(fake.commands.map((command) => command.method)).toContain(
        'Extensions.loadUnpacked'
      )

      expect(fake.project.readReady()).toMatchObject({cdpPort: fake.port})
    })
  })

  describe('a browser that answers too slowly', () => {
    // Each answer lands inside the 12 s command limit, so only the launch
    // watchdog can end the wait.
    const slow = {answerDelayMs: 11_900}

    it('gives the load check of a run-only launch 45 s, then goes on with the fault on record', async () => {
      const {plugin, runOnly} = await start({script: slow})
      const {waitedMs} = await onFakeClock(runOnly)

      // The watchdog, then the 1.5 s wait for a browser on its way out.
      expect(waitedMs).toBeGreaterThanOrEqual(45_000 + 1500)
      expect(waitedMs).toBeLessThan(45_000 + 1500 + 500)
      expect(said('error')).toEqual([
        expect.stringMatching(
          /^\[browser\] The browser gave the extension load check no answer within 45s\./
        )
      ])

      expect(fake.project.readReady()).toMatchObject({
        status: 'starting',
        cdpFaultCode: 'W_CDP_TIMEOUT',
        cdpFaultMessage:
          'The browser gave the extension load check no answer within 45s.'
      })

      expect(plugin.spawnedBrowser).toBe(true)
      expect(fake.claims[0].released).toBe(1)
      expect(fake.terminated).toEqual([])
    })

    it('gives the CDP setup of a dev launch 45 s, then says what it is still waiting on', async () => {
      const {dev} = await start({script: slow, command: 'dev'})
      const {waitedMs} = await onFakeClock(dev)

      // The watchdog, the 1.5 s exit wait, then the 15 s attach grace.
      expect(waitedMs).toBeGreaterThanOrEqual(45_000 + 1500 + 15_000)
      expect(waitedMs).toBeLessThan(45_000 + 1500 + 15_000 + 500)
      expect(said('error')).toEqual([
        expect.stringMatching(
          /^\[browser\] CDP setup did not complete within 45s\. Chrome likely rejected the extension at launch/
        )
      ])

      expect(said('warn').at(-1)).toContain(
        `Chrome (pid ${FAKE_BROWSER_PID}) is up, but the extension has not connected after 15 s.`
      )

      expect(said('log').join('\n')).not.toMatch(/ready for development/i)
      expect(fake.project.readReady()).toMatchObject({
        cdpFaultCode: 'W_CDP_TIMEOUT',
        browserUpNotAttachedWaitMs: 15_000
      })

      expect(fake.claims[0].released).toBe(1)
    })
  })

  describe('a browser that never answers', () => {
    // Each command has its own 12 s bound, so a silent browser is given up
    // on well before the 45 s launch watchdog, with the same hint.
    it('ends the load check of a run-only launch on the command bound', async () => {
      const {plugin, runOnly} = await start({script: {handshake: 'silent'}})
      const {waitedMs} = await onFakeClock(runOnly)

      expect(waitedMs).toBeLessThan(45_000)
      expect(said('error')).toEqual([
        expect.stringMatching(
          /^\[browser\] CDP command timed out \(12000ms\): \S+ Chrome likely rejected the extension at launch/
        )
      ])

      expect(fake.project.readReady()).toMatchObject({
        status: 'starting',
        cdpFaultCode: 'W_CDP_TIMEOUT'
      })

      expect(plugin.spawnedBrowser).toBe(true)
      expect(fake.claims[0].released).toBe(1)
    })
  })

  describe('a handshake that dies', () => {
    it('keeps a run-only session going with the fault on record', async () => {
      const {runOnly} = await start({script: {handshake: 'dies'}})
      const {waitedMs} = await onFakeClock(runOnly)

      expect(waitedMs).toBeGreaterThanOrEqual(1500)
      expect(waitedMs).toBeLessThan(2000)
      expect(said('error')).toEqual(['[browser] CDP pipe closed'])
      expect(fake.commands.map((command) => command.method)).toEqual([
        'Target.setDiscoverTargets'
      ])

      expect(fake.project.readReady()).toMatchObject({
        status: 'starting',
        browserPid: FAKE_BROWSER_PID,
        cdpFaultCode: 'W_BROWSER_CONNECTION_CLOSED',
        cdpFaultMessage: 'CDP pipe closed'
      })

      expect(fake.claims[0].released).toBe(1)
      expect(fake.terminated).toEqual([])
      expect(fake.child()?.exited).toBe(false)
    })
  })

  // The wire dies because the browser is leaving, and the exit is the news.
  describe('a handshake that dies with the browser', () => {
    it('reports the exit and not the broken wire', async () => {
      const {runOnly} = await start({
        script: {
          handshake: 'dies',
          exitsAfterMs: 200,
          exit: {code: 0, signal: null}
        }
      })
      await onFakeClock(runOnly)

      expect(said('error')).not.toContain('[browser] CDP pipe closed')
      expect(said('error').join('\n')).toContain('chrome closed cleanly')
    })
  })

  describe('a guest the browser refuses', () => {
    it('ends a run-only launch on the reason the browser gave and stops the browser', async () => {
      const {plugin, runOnly} = await start()
      fake.answer('Extensions.loadUnpacked', () => ({
        error: {code: -32000, message: 'Manifest is invalid: bad key'}
      }))

      const error = await failure(runOnly())

      expect(error.code).toBe('E_EXTENSION_LOAD_REFUSED')
      expect(stripAnsi(error.message).split('\n')).toEqual([
        expect.stringMatching(
          /Chrome refuses to load this extension, so nothing in it runs\.$/
        ),
        `PATH ${fake.project.out}`,
        'REASON Manifest is invalid: bad key',
        'Fix what the browser names, then run the command again.'
      ])

      expect(plugin.spawnedBrowser).toBe(true)
      expect(fake.terminated).toEqual([fake.child()])
      expect(fake.child()?.signals).toEqual(['SIGTERM'])
      expect(fake.claims[0].released).toBe(1)
      expect(fake.project.readReady()).toMatchObject({
        status: 'error',
        code: 'extension_load_refused',
        extensionLoadRefusedReason: 'Manifest is invalid: bad key',
        browserPid: FAKE_BROWSER_PID
      })
    })

    it('ends a dry run of a manifest the browser is known to refuse, with a general reason and no claim', async () => {
      const {runOnly} = await start({host: {dryRun: true}})
      fake.project.writeManifest({
        manifest_version: 2,
        name: 'old guest',
        version: '1.0.0'
      })

      const error = await failure(runOnly())

      expect(error.code).toBe('E_EXTENSION_LOAD_REFUSED')
      expect(stripAnsi(error.message)).toContain(
        'Read the reason above, fix the manifest, then run the command again.'
      )

      expect(said('warn')[0]).toContain(
        'This extension declares Manifest V2, and Chrome no longer runs it.'
      )

      expect(fake.claims).toEqual([])
      expect(fake.spawns).toEqual([])
      expect(fake.project.readReady()).toMatchObject({
        status: 'error',
        code: 'extension_load_refused',
        extensionLoadRefusedReason:
          'the manifest declares a shape this browser refuses'
      })
    })
  })

  describe('a browser that exits before it is ready', () => {
    const crash = {
      exitsAfterMs: 0,
      exit: {code: 1, signal: null},
      stderr: ['Missing X server or $DISPLAY']
    }

    it('says a dev browser is gone with what it wrote, and never says ready', async () => {
      const {dev} = await start({script: crash, command: 'dev'})
      await onFakeClock(dev)

      expect(said('error')[0]).toBe(
        '[browser] chrome crashed (exit code 1). The dev server is still running but reloads cannot be delivered, restart "extension dev" to relaunch the browser.'
      )

      expect(said('error')[1]).toBe(
        '[browser] chrome wrote this before it exited:\n  Missing X server or $DISPLAY'
      )

      expect(said('error').at(-1)).toContain(
        'Chrome exited before the extension loaded, so nothing is running.'
      )

      expect(said('log').join('\n')).not.toMatch(/ready for development/i)
      expect(said('warn')).toEqual([])
      expect(fake.project.readReady()).toMatchObject({
        status: 'error',
        code: 'browser_exited',
        browserExitCode: 1,
        browserExitSignal: null,
        message:
          'the browser process exited (code 1) before the extension loaded, nothing is running'
      })

      expect(fake.signalWatchers).toEqual({registered: 1, disposed: 1})
      expect(fake.claims[0].released).toBe(1)
      expect(fake.terminated).toEqual([])
    })

    it('ends a run-only session the same way, without a second stop', async () => {
      const {plugin, runOnly} = await start({script: crash})
      expect(plugin.browserClosed).toBe(false)
      await onFakeClock(runOnly)

      expect(said('error')[0]).toBe(
        '[browser] chrome crashed (exit code 1). The preview session is over.'
      )

      expect(fake.project.readReady()).toMatchObject({
        status: 'error',
        code: 'browser_exited'
      })

      expect(fake.terminated).toEqual([])
      expect(fake.claims[0].released).toBe(1)
      expect(plugin.browserClosed).toBe(true)
    })
  })
})
