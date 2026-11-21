import type {ChildProcess} from 'node:child_process'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi
} from 'vitest'

interface FakeChildFields {
  killed: boolean
  kill: Mock<(signal?: NodeJS.Signals | number) => boolean | undefined>
}

// The teardown reads only killed and kill, so the rest of the child stays unset.
function fakeChild(fields: FakeChildFields): FakeChildFields & ChildProcess {
  return fields as unknown as FakeChildFields & ChildProcess
}

// The fakes carry no pid: on Windows the teardown hands it to taskkill,
// and a made-up number can name a real process.
describe('process-teardown shared module', () => {
  afterEach(() => vi.restoreAllMocks())

  it('gracefulTerminateChild asks the child to stop, and is a no-op once killed', async () => {
    const {gracefulTerminateChild, teardownDefaults} = await import(
      '../../browsers-lib/process-teardown'
    )
    // Windows asks the tree instead of signaling, a row of its own covers it.
    const deps = {...teardownDefaults, platform: 'linux' as const}
    const child = fakeChild({killed: false, kill: vi.fn()})
    gracefulTerminateChild(child, 'chrome', undefined, deps)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    const killed = fakeChild({killed: true, kill: vi.fn()})
    gracefulTerminateChild(killed, 'chrome', undefined, deps)
    expect(killed.kill).not.toHaveBeenCalled()

    expect(() =>
      gracefulTerminateChild(null, 'chrome', undefined, deps)
    ).not.toThrow()
  })

  it('forceKillChildOnExit SIGKILLs synchronously and survives an already-dead child', async () => {
    const {forceKillChildOnExit} = await import(
      '../../browsers-lib/process-teardown'
    )
    const child = fakeChild({killed: false, kill: vi.fn()})
    forceKillChildOnExit(child, 'firefox')
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')

    const gone = fakeChild({
      killed: false,
      kill: vi.fn(() => {
        const e: NodeJS.ErrnoException = new Error('no such process')
        e.code = 'ESRCH'

        throw e
      })
    })
    expect(() => forceKillChildOnExit(gone, 'firefox')).not.toThrow()
    expect(() => forceKillChildOnExit(null, 'firefox')).not.toThrow()
  })
})

// A taskkill earlier on PATH, such as one a project folder ships, never runs.
describe('windowsTaskkillPath', () => {
  it.each([
    [{SystemRoot: 'D:\\Windows'}, 'D:\\Windows\\System32\\taskkill.exe'],
    [{windir: 'E:\\WINNT'}, 'E:\\WINNT\\System32\\taskkill.exe'],
    [{}, 'C:\\Windows\\System32\\taskkill.exe']
  ])('names the system copy for %o', async (env, expected) => {
    const {windowsTaskkillPath} = await import(
      '../../browsers-lib/process-teardown'
    )

    expect(windowsTaskkillPath(env as NodeJS.ProcessEnv)).toBe(expected)
  })
})

type ProcessHandler = (...args: unknown[]) => void

function withCapturedProcessOn() {
  const registered = new Map<string, ProcessHandler[]>()
  const original = process.on
  process.on = vi.fn((event: string, handler: ProcessHandler) => {
    const existing = registered.get(event) || []
    existing.push(handler)
    registered.set(event, existing)

    return process
  }) as unknown as typeof process.on

  return {
    registered,
    restore: () => {
      process.on = original
    }
  }
}

describe('chromium exit handler force-kills a stubborn child', () => {
  let cap: ReturnType<typeof withCapturedProcessOn>
  beforeEach(async () => {
    cap = withCapturedProcessOn()
    const mod = await import(
      '../../run-chromium/chromium-launch/process-handlers'
    )
    mod.__resetChromiumProcessHandlersForTest()
  })

  afterEach(() => {
    cap.restore()
    vi.restoreAllMocks()
  })

  it('SIGKILLs on plain exit even after the child ignored SIGTERM', async () => {
    const {setupProcessSignalHandlers} = await import(
      '../../run-chromium/chromium-launch/process-handlers'
    )
    const child = fakeChild({killed: false, kill: vi.fn()})
    setupProcessSignalHandlers('chrome', child, vi.fn())

    cap.registered.get('SIGINT')?.forEach((h) => {
      h()
    })

    // Windows asks the process tree to close rather than signal it.
    expect(child.kill.mock.calls).toEqual(
      process.platform === 'win32' ? [] : [['SIGTERM']]
    )

    cap.registered.get('exit')?.forEach((h) => {
      h()
    })

    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })
})

describe('firefox exit handler force-kills a stubborn child', () => {
  let cap: ReturnType<typeof withCapturedProcessOn>
  beforeEach(async () => {
    cap = withCapturedProcessOn()
    const mod = await import(
      '../../run-firefox/firefox-launch/process-handlers'
    )
    mod.__resetFirefoxProcessHandlersForTest()
  })

  afterEach(() => {
    cap.restore()
    vi.restoreAllMocks()
  })

  it('SIGKILLs on plain exit even after the child ignored SIGTERM', async () => {
    const {setupFirefoxProcessHandlers} = await import(
      '../../run-firefox/firefox-launch/process-handlers'
    )
    const child = fakeChild({killed: false, kill: vi.fn()})
    setupFirefoxProcessHandlers(
      'firefox',
      () => child,
      vi.fn(async () => {})
    )

    cap.registered.get('SIGINT')?.forEach((h) => {
      h()
    })

    await new Promise((r) => setTimeout(r, 20))
    // Windows asks the process tree to close rather than signal it.
    expect(child.kill.mock.calls).toEqual(
      process.platform === 'win32' ? [] : [['SIGTERM']]
    )

    cap.registered.get('exit')?.forEach((h) => {
      h()
    })

    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })
})
