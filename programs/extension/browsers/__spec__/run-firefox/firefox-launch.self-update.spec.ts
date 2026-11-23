// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {SUCCESSOR_GRACE_MS} from '../../browsers-lib/resolve-live-pid'
import {buildBrowserLaunchRequest} from '../../browsers-lib/runtime-options'
import {createFirefoxContext} from '../../run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from '../../run-firefox/firefox-launch'
import {firefoxLaunchDefaults} from '../../run-firefox/firefox-launch/launch-dependencies'
import {
  FAKE_BROWSER_PID,
  type FakeBrowserScript,
  type FakeFirefox,
  type FakeProcessRow,
  fakeFirefox
} from '../fake-browser'
import {onFakeClock} from '../fake-clock'

const GONE =
  '[browser] firefox exited (code 0) without being asked to. The add-on may have been rejected or the browser crashed; the session cannot be driven.'

// What the updater leaves out when it starts the browser again.
const RELAUNCH_DROPS = ['-headless', '-wait-for-browser']

// The pids of the Windows trace: the stub 8928 is the spawned child, 1096 is
// the browser under it, and 8668 with 3996 is the pair the updater started.
const launcherRows = (leavesAtMs: number): FakeProcessRow[] => [
  {pid: FAKE_BROWSER_PID, ppid: 7192, untilMs: leavesAtMs}
]

const relaunchedRows = (fromMs: number): FakeProcessRow[] => [
  {pid: 8668, ppid: 2408, fromMs, drops: RELAUNCH_DROPS, bindsPort: true},
  {pid: 3996, ppid: 8668, fromMs, drops: RELAUNCH_DROPS}
]

describe('a Firefox that applies a pending update at launch', () => {
  let fake: FakeFirefox
  let logged: string[]
  let printed: string[]

  beforeEach(() => {
    logged = []
    printed = []

    for (const stream of ['log', 'error', 'warn'] as const) {
      vi.spyOn(console, stream).mockImplementation((...parts: unknown[]) => {
        printed.push(parts.map(String).join(' '))
      })
    }
  })

  afterEach(async () => {
    await fake.close()
    vi.restoreAllMocks()
  })

  // The table read the launcher polls with, on the fake's rows.
  type TableRead = FakeFirefox['deps']['resolveLivePid']

  const readTable =
    (platform?: NodeJS.Platform): TableRead =>
    (input) =>
      firefoxLaunchDefaults.resolveLivePid({
        ...input,
        list: () => fake.processes,
        attempts: 1,
        platform
      })

  const start = async (script: FakeBrowserScript, read?: TableRead) => {
    fake = await fakeFirefox({script: {bindsPort: false, ...script}})
    if (read) fake.deps.resolveLivePid = read

    fake.project.writeReady({command: 'dev', status: 'starting', runId: 'r1'})

    const host = {
      browser: 'firefox',
      extension: [fake.project.out],
      geckoBinary: fake.project.plantBinary()
    }
    const context = createFirefoxContext()
    const say = (...parts: unknown[]) => void logged.push(parts.join(' '))
    context.logger = {info: say, warn: say, error: say, debug: () => {}}

    const plugin = new FirefoxLaunchPlugin(host as never, context, fake.deps)

    return {
      plugin,
      launch: () =>
        plugin.runOnce(
          fake.project.compilation('development') as never,
          buildBrowserLaunchRequest(host as never, 'development') as never
        )
    }
  }

  const expectAdoptedAndReady = (plugin: FirefoxLaunchPlugin) => {
    expect(logged).toEqual([])
    expect(printed.join('\n')).toMatch(/ready for development/i)
    expect(plugin.browserClosed).toBe(false)
    expect(fake.signalWatchers).toEqual({registered: 1, disposed: 0})
    expect(fake.watchers[0].adopted()).toMatchObject({pid: 8668})

    const ready = fake.project.readReady()

    expect(ready).toMatchObject({
      browserPid: 8668,
      launcherPid: FAKE_BROWSER_PID,
      rdpPort: fake.port
    })

    expect(ready).not.toHaveProperty('browserExitedAt')
    expect(ready).not.toHaveProperty('rdpPortError')
    expect(ready.code).not.toBe('browser_exited')
  }

  it('adopts the browser the updater started 1.5 s in, under a parent that is gone', async () => {
    const {plugin, launch} = await start({
      exitsAfterMs: 1200,
      exit: {code: 0, signal: null},
      table: [
        ...launcherRows(1200),
        {pid: 1096, ppid: FAKE_BROWSER_PID, fromMs: 10, untilMs: 1200},
        ...relaunchedRows(1500)
      ]
    })

    await onFakeClock(launch)

    expectAdoptedAndReady(plugin)
    expect(fake.terminatedPids).toEqual([])
  })

  it('adopts it when the browser under the stub was adopted first and left before the stub', async () => {
    // The stub's own child is a handoff by the Windows rule.
    const {plugin, launch} = await start(
      {
        exitsAfterMs: 1300,
        exit: {code: 0, signal: null},
        table: [
          ...launcherRows(1300),
          {pid: 1096, ppid: FAKE_BROWSER_PID, untilMs: 950},
          ...relaunchedRows(1500)
        ]
      },
      readTable('win32')
    )

    await onFakeClock(launch)

    expectAdoptedAndReady(plugin)
  })

  it('ends the adopted browser when the session shuts down', async () => {
    const {launch} = await start({
      exitsAfterMs: 1200,
      exit: {code: 0, signal: null},
      table: [...launcherRows(1200), ...relaunchedRows(1500)]
    })

    await onFakeClock(launch)
    await fake.watchers[0].shutdown()

    expect(fake.terminatedPids).toEqual([8668])
  })

  it('still reports a launcher gone when nothing takes over within the window', async () => {
    const {plugin, launch} = await start({
      exitsAfterMs: 1200,
      exit: {code: 0, signal: null},
      table: launcherRows(1200)
    })

    const error = await onFakeClock(launch).then(
      () => undefined,
      (thrown: Error & {code?: string}) => thrown
    )

    expect(error?.code).toBe('E_BROWSER_LAUNCH')
    expect(logged).toEqual([GONE])
    expect(plugin.browserClosed).toBe(true)
    expect(fake.signalWatchers).toEqual({registered: 1, disposed: 1})
    expect(fake.project.readReady()).toMatchObject({
      status: 'error',
      code: 'browser_exited',
      browserExitCode: 0
    })
  })

  it('gives a clean exit the whole window and a failed one none', async () => {
    const clean = await start({
      exitsAfterMs: 1200,
      exit: {code: 0, signal: null},
      table: launcherRows(1200)
    })
    const waited = await onFakeClock(() => clean.launch().catch(() => {}))

    expect(waited.waitedMs).toBeGreaterThanOrEqual(1200 + SUCCESSOR_GRACE_MS)
    expect(waited.waitedMs).toBeLessThan(1200 + SUCCESSOR_GRACE_MS + 1000)
    await fake.close()

    const failed = await start({
      exitsAfterMs: 1200,
      exit: {code: 1, signal: null},
      table: launcherRows(1200)
    })
    const unwaited = await onFakeClock(() => failed.launch().catch(() => {}))

    expect(unwaited.waitedMs).toBeLessThan(1200 + 500)
  })

  it('closes a browser that only comes back after the session gave up on it', async () => {
    // A table read that answers after the verdict, as a slow machine's does.
    const {plugin, launch} = await start(
      {
        exitsAfterMs: 1200,
        exit: {code: 1, signal: null},
        table: [...launcherRows(1200), ...relaunchedRows(1500)]
      },
      (input) =>
        new Promise((resolve) => {
          setTimeout(() => resolve(readTable()(input)), 2000)
        })
    )

    await onFakeClock(async () => {
      await launch().catch(() => {})
      await new Promise<void>((resolve) => setTimeout(resolve, 2000))
    })

    expect(plugin.browserClosed).toBe(true)
    expect(fake.terminatedPids).toEqual([8668])
    expect(fake.watchers[1].adopted()).toMatchObject({pid: 8668})
    expect(fake.watchers[1].disposed).toBe(false)
    expect(fake.project.readReady().browserPid).toBe(FAKE_BROWSER_PID)
  })
})
