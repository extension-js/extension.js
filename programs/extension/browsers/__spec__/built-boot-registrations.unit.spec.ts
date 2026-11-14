import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {BOOT_REGISTRATIONS_WAIT_MS} from '../browsers-lib/boot-registrations-hold'
import {
  BOOT_REGISTRATIONS_LOOK_MS,
  BOOT_REGISTRATIONS_QUIET_MS,
  type BootRegistrationsAnswer,
  bootRegistrationsProbe,
  builtBackgroundNamesRegistration,
  holdFirstPage,
  LATE_REGISTRATION_LOOK_MS,
  LATE_REGISTRATION_READ,
  LATE_REGISTRATION_WINDOW_MS,
  watchForLateRegistration
} from '../browsers-lib/built-boot-registrations'
import * as messages from '../browsers-lib/messages'

const URL = 'http://127.0.0.1:8080/page.html'
const REGISTERS =
  'chrome.scripting.registerContentScripts([{id: "a", js: ["a.js"], matches: ["<all_urls>"]}])'

const tempDirs: string[] = []

function makeBuild(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'built-boot-reg-'))
  tempDirs.push(root)

  for (const [name, text] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, text)
  }

  return root
}

function manifest(background: Record<string, unknown>): string {
  return JSON.stringify({
    manifest_version: 3,
    name: 'x',
    version: '1',
    background
  })
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

describe('what a built background names', () => {
  it('finds a registration in the service worker file', () => {
    const root = makeBuild({
      'manifest.json': manifest({
        service_worker: 'background/service_worker.js'
      }),
      'background/service_worker.js': `(()=>{${REGISTERS}})()`
    })

    expect(builtBackgroundNamesRegistration(root)).toBe(true)
  })

  it('finds one in a background script list', () => {
    const root = makeBuild({
      'manifest.json': manifest({scripts: ['one.js', 'two.js']}),
      'one.js': 'console.log(1)',
      'two.js': REGISTERS
    })

    expect(builtBackgroundNamesRegistration(root)).toBe(true)
  })

  it('finds one in a script a background page loads', () => {
    const root = makeBuild({
      'manifest.json': manifest({page: 'background/index.html'}),
      'background/index.html':
        '<!doctype html><script type="module" src="./page.js"></script><script src="/shared.js"></script>',
      'background/page.js': 'console.log(1)',
      'shared.js': REGISTERS
    })

    expect(builtBackgroundNamesRegistration(root)).toBe(true)
  })

  it('follows a chunk the background imports', () => {
    const root = makeBuild({
      'manifest.json': manifest({service_worker: 'sw.js'}),
      'sw.js': 'importScripts("chunks/boot.js")',
      'chunks/boot.js': 'import "./deeper.mjs"',
      'chunks/deeper.mjs': REGISTERS
    })

    expect(builtBackgroundNamesRegistration(root)).toBe(true)
  })

  it('says no for a background that names no registration', () => {
    const root = makeBuild({
      'manifest.json': manifest({service_worker: 'sw.js'}),
      'sw.js': 'chrome.runtime.onInstalled.addListener(() => {})',
      // A content script is not the background, whatever it names.
      'content.js': REGISTERS
    })

    expect(builtBackgroundNamesRegistration(root)).toBe(false)
  })

  it('says no with no background, no manifest or no path', () => {
    const theme = makeBuild({
      'manifest.json': JSON.stringify({manifest_version: 3, name: 'x'})
    })
    const broken = makeBuild({'manifest.json': '{'})
    const empty = makeBuild({})

    expect(builtBackgroundNamesRegistration(theme)).toBe(false)
    expect(builtBackgroundNamesRegistration(broken)).toBe(false)
    expect(builtBackgroundNamesRegistration(empty)).toBe(false)
    expect(builtBackgroundNamesRegistration('')).toBe(false)
  })

  it('never reads a file outside the build', () => {
    const outside = makeBuild({'secret.js': REGISTERS})
    const root = makeBuild({
      'manifest.json': manifest({
        service_worker: path.join('..', path.basename(outside), 'secret.js')
      }),
      'sw.js': `importScripts("../${path.basename(outside)}/secret.js")`
    })

    expect(builtBackgroundNamesRegistration(root)).toBe(false)
  })

  it('leaves the build as it found it', () => {
    const root = makeBuild({
      'manifest.json': manifest({service_worker: 'sw.js'}),
      'sw.js': REGISTERS
    })
    const before = fs.readdirSync(root).sort()
    const stat = fs.statSync(path.join(root, 'sw.js'))

    builtBackgroundNamesRegistration(root)

    expect(fs.readdirSync(root).sort()).toEqual(before)
    expect(fs.statSync(path.join(root, 'sw.js')).mtimeMs).toBe(stat.mtimeMs)
    expect(fs.readFileSync(path.join(root, 'sw.js'), 'utf-8')).toBe(REGISTERS)
  })
})

// The probe is text the browser runs, so it is run here as text too, in a
// context that holds only what a background would.
function runProbe(
  globals: Record<string, unknown>,
  timeoutMs = BOOT_REGISTRATIONS_WAIT_MS
): Promise<BootRegistrationsAnswer> {
  const context = vm.createContext({
    setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
    Date,
    // A background that started long ago, unless a case says otherwise.
    performance: {now: () => 60_000},
    ...globals
  })

  return vm.runInContext(bootRegistrationsProbe(timeoutMs), context)
}

function fakeRegistry(initial: string[] = []) {
  const registry = {
    ids: initial,
    reads: 0,
    getRegisteredContentScripts: vi.fn(async () => {
      registry.reads += 1

      return registry.ids.map((id) => ({id}))
    })
  }

  return registry
}

describe('the probe a production background is asked to run', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers after two looks when a running background registered nothing', async () => {
    const scripting = fakeRegistry()
    const done = vi.fn()

    void runProbe({
      chrome: {scripting, runtime: {}},
      serviceWorker: {state: 'activated'}
    }).then(done)

    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_LOOK_MS - 1)

    expect(done).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(done).toHaveBeenCalledTimes(1)
    expect(done.mock.calls[0][0]).toMatchObject({
      outcome: 'none',
      count: 0,
      looks: 2,
      bootedAfterMs: 0
    })

    expect(vi.getTimerCount()).toBe(0)
  })

  // A call made as the background starts can still be on its way, so an
  // empty registry is only believed from a background old enough.
  it('does not believe an empty registry from a background that just started', async () => {
    const scripting = fakeRegistry()
    const bornAt = Date.now() - 40
    const done = vi.fn()

    void runProbe({
      chrome: {scripting, runtime: {}},
      serviceWorker: {state: 'activated'},
      performance: {now: () => Date.now() - bornAt}
    }).then(done)

    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_QUIET_MS - 40 - 1)

    expect(done).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_LOOK_MS)

    expect(done.mock.calls[0][0]).toMatchObject({outcome: 'none', count: 0})
    expect(done.mock.calls[0][0].ageMs).toBeGreaterThanOrEqual(
      BOOT_REGISTRATIONS_QUIET_MS
    )
  })

  it('takes a registration from a young background as soon as two looks agree', async () => {
    const scripting = fakeRegistry()
    const bornAt = Date.now()
    const done = vi.fn()

    void runProbe({
      chrome: {scripting, runtime: {}},
      serviceWorker: {state: 'activated'},
      performance: {now: () => Date.now() - bornAt}
    }).then(done)

    await vi.advanceTimersByTimeAsync(2 * BOOT_REGISTRATIONS_LOOK_MS)

    scripting.ids = ['iso', 'main']

    await vi.advanceTimersByTimeAsync(2 * BOOT_REGISTRATIONS_LOOK_MS)

    expect(done.mock.calls[0][0]).toMatchObject({outcome: 'settled', count: 2})
    expect(done.mock.calls[0][0].waitedMs).toBeLessThan(
      BOOT_REGISTRATIONS_QUIET_MS
    )
  })

  it('falls back to its own clock where the context has no performance', async () => {
    const scripting = fakeRegistry()
    const done = vi.fn()

    void runProbe({
      chrome: {scripting, runtime: {}},
      serviceWorker: {state: 'activated'},
      performance: undefined
    }).then(done)

    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_QUIET_MS - 1)

    expect(done).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_LOOK_MS)

    expect(done.mock.calls[0][0]).toMatchObject({outcome: 'none'})
  })

  it('answers at once when the context has no scripting namespace', async () => {
    await expect(runProbe({chrome: {runtime: {}}})).resolves.toMatchObject({
      outcome: 'none',
      looks: 0
    })

    expect(vi.getTimerCount()).toBe(0)
  })

  it('holds until a registration is there and two looks agree on it', async () => {
    const scripting = fakeRegistry()
    const worker = {state: 'installing'}
    const done = vi.fn()

    void runProbe({
      chrome: {scripting, runtime: {}},
      serviceWorker: worker
    }).then(done)

    await vi.advanceTimersByTimeAsync(300)

    expect(done).not.toHaveBeenCalled()

    worker.state = 'activated'
    scripting.ids = ['iso']

    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_LOOK_MS)

    // A second file joined between two looks, so they did not agree.
    scripting.ids = ['iso', 'main']

    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_LOOK_MS)

    expect(done).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_LOOK_MS)

    expect(done.mock.calls[0][0]).toMatchObject({outcome: 'settled', count: 2})
  })

  it('does not take an empty registry as the answer while the worker installs', async () => {
    const scripting = fakeRegistry()
    const worker = {state: 'installing'}
    const done = vi.fn()

    void runProbe({
      chrome: {scripting, runtime: {}},
      serviceWorker: worker
    }).then(done)

    await vi.advanceTimersByTimeAsync(1000)

    expect(done).not.toHaveBeenCalled()

    // Seen starting, so its boot calls may be seconds younger than it is:
    // the quiet time counts from the look that found it up.
    worker.state = 'activated'
    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_QUIET_MS - 1)

    expect(done).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2 * BOOT_REGISTRATIONS_LOOK_MS)

    expect(done.mock.calls[0][0]).toMatchObject({outcome: 'none'})
    expect(done.mock.calls[0][0].bootedAfterMs).toBeGreaterThanOrEqual(1000)
  })

  it('reads a background page by its document, not by a worker', async () => {
    const scripting = fakeRegistry(['iso'])
    const document = {readyState: 'loading'}
    const done = vi.fn()

    void runProbe({browser: {scripting}, document}).then(done)

    await vi.advanceTimersByTimeAsync(200)

    expect(done).not.toHaveBeenCalled()

    document.readyState = 'complete'
    await vi.advanceTimersByTimeAsync(2 * BOOT_REGISTRATIONS_LOOK_MS)

    expect(done.mock.calls[0][0]).toMatchObject({outcome: 'settled', count: 1})
  })

  it('reads a namespace that answers a callback and returns nothing', async () => {
    const getRegisteredContentScripts = vi.fn(
      (callback: (list: Array<{id: string}>) => void) => {
        callback([{id: 'iso'}])
      }
    )

    const answer = runProbe({
      chrome: {scripting: {getRegisteredContentScripts}, runtime: {}},
      document: {readyState: 'complete'}
    })

    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_LOOK_MS)

    await expect(answer).resolves.toMatchObject({outcome: 'settled', count: 1})
  })

  it('gives up at the bound and says how long it waited', async () => {
    const scripting = fakeRegistry()
    const done = vi.fn()

    void runProbe({
      chrome: {scripting, runtime: {}},
      serviceWorker: {state: 'installing'}
    }).then(done)

    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_WAIT_MS - 1)

    expect(done).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_LOOK_MS)

    expect(done.mock.calls[0][0]).toMatchObject({outcome: 'timeout'})
    expect(done.mock.calls[0][0].waitedMs).toBeGreaterThanOrEqual(
      BOOT_REGISTRATIONS_WAIT_MS
    )

    expect(vi.getTimerCount()).toBe(0)
  })

  it('treats a registry read that throws as an empty one', async () => {
    const getRegisteredContentScripts = vi.fn(async () => {
      throw new Error('no permission')
    })

    const answer = runProbe({
      chrome: {scripting: {getRegisteredContentScripts}, runtime: {}},
      serviceWorker: {state: 'activated'}
    })

    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_LOOK_MS)

    await expect(answer).resolves.toMatchObject({outcome: 'none'})
  })

  it('leaves no name behind in the background', async () => {
    const scripting = fakeRegistry(['iso'])
    const context = vm.createContext({
      setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
      Date,
      performance: {now: () => 60_000},
      chrome: {scripting, runtime: {}},
      serviceWorker: {state: 'activated'}
    })
    const before = Object.keys(context).sort()
    const answer = vm.runInContext(bootRegistrationsProbe(1000), context)

    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_LOOK_MS)
    await answer

    expect(Object.keys(context).sort()).toEqual(before)
  })
})

function fakeSession(reads: unknown[]) {
  const queue = [...reads]
  const session = {
    evaluate: vi.fn(async (_expression: string, _timeoutMs: number) => {
      const next = queue.length > 1 ? queue.shift() : queue[0]

      if (next instanceof Error) throw next

      return next
    }),
    release: vi.fn()
  }

  return session
}

const answer = (outcome: BootRegistrationsAnswer['outcome'], ageMs = 160) => ({
  outcome,
  count: outcome === 'settled' ? 2 : 0,
  looks: 2,
  waitedMs: 25,
  bootedAfterMs: 0,
  ageMs
})

describe('the hold a launch puts on its first page', () => {
  it('leaves a dev session to the dev server and opens no session', async () => {
    const awaitBootRegistrations = vi.fn(async () => 'settled' as const)
    const openSession = vi.fn()

    const hold = await holdFirstPage(
      {awaitBootRegistrations, bootRegistrationsFromBackground: true},
      URL,
      openSession
    )

    expect(hold.outcome).toBe('settled')
    expect(awaitBootRegistrations).toHaveBeenCalledWith(
      BOOT_REGISTRATIONS_WAIT_MS
    )

    expect(openSession).not.toHaveBeenCalled()
    await expect(hold.pageOpened()).resolves.toBeUndefined()
  })

  // The fast path: no session, no evaluation, no timer, no line.
  it('holds nothing for a background that names no registration', async () => {
    const openSession = vi.fn()
    const warn = vi.fn()
    const say = vi.fn()

    vi.useFakeTimers()

    const hold = await holdFirstPage({}, URL, openSession, {warn, say})

    expect(hold.outcome).toBe('none')
    await expect(hold.pageOpened()).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)

    vi.useRealTimers()

    expect(openSession).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(say).not.toHaveBeenCalled()
  })

  it('asks the background once, with the bound, and lets it go when it registered', async () => {
    const session = fakeSession([answer('settled')])
    const warn = vi.fn()
    const say = vi.fn()

    const hold = await holdFirstPage(
      {bootRegistrationsFromBackground: true},
      URL,
      async () => session,
      {warn, say}
    )

    expect(hold.outcome).toBe('settled')
    expect(session.evaluate).toHaveBeenCalledTimes(1)
    expect(session.evaluate).toHaveBeenCalledWith(
      bootRegistrationsProbe(BOOT_REGISTRATIONS_WAIT_MS),
      BOOT_REGISTRATIONS_WAIT_MS
    )

    expect(session.release).toHaveBeenCalledTimes(1)

    await expect(hold.pageOpened()).resolves.toBeUndefined()

    expect(session.evaluate).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
    expect(say).not.toHaveBeenCalled()
  })

  it('keeps the session of an empty registry until the page is open', async () => {
    const session = fakeSession([
      answer('none'),
      {count: 0, ageMs: 400},
      {count: 2, ageMs: 1240}
    ])
    const warn = vi.fn()
    const say = vi.fn()

    const hold = await holdFirstPage(
      {bootRegistrationsFromBackground: true},
      URL,
      async () => session,
      {warn, say, lookMs: 1}
    )

    expect(hold.outcome).toBe('settled')
    expect(session.release).not.toHaveBeenCalled()
    expect(session.evaluate).toHaveBeenCalledTimes(1)

    await expect(hold.pageOpened()).resolves.toBe('registered')

    expect(session.evaluate).toHaveBeenLastCalledWith(
      LATE_REGISTRATION_READ,
      expect.any(Number)
    )

    expect(say).toHaveBeenCalledTimes(1)
    expect(String(say.mock.calls[0][0])).toContain(
      'The background registered a content script 1.2s after it started, when the first page was already open. If the script did not run on that page, reload it.'
    )

    expect(String(say.mock.calls[0][0])).not.toContain('\n')
    expect(warn).not.toHaveBeenCalled()
    expect(session.release).toHaveBeenCalledTimes(1)
  })

  it('sends one read as the navigation goes out and uses it when the page is open', async () => {
    const session = fakeSession([
      answer('none'),
      {count: 2, ageMs: 210},
      {count: 2, ageMs: 900}
    ])
    const say = vi.fn()

    const hold = await holdFirstPage(
      {bootRegistrationsFromBackground: true},
      URL,
      async () => session,
      {say, lookMs: 1}
    )

    hold.beforeNavigate()
    hold.beforeNavigate()

    expect(session.evaluate).toHaveBeenCalledTimes(2)
    expect(session.evaluate).toHaveBeenLastCalledWith(
      LATE_REGISTRATION_READ,
      expect.any(Number)
    )

    await expect(hold.pageOpened()).resolves.toBe('in-time')

    expect(session.evaluate).toHaveBeenCalledTimes(2)
    expect(say).not.toHaveBeenCalled()
    expect(session.release).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the probe ran out of time', [answer('timeout')]],
    ['the answer is not one the probe gives', [{outcome: 'yes'}]],
    ['the debugger refused', [new Error('CDP command timed out')]]
  ])('opens the page with the one line and watches nothing when %s', async (_name, reads) => {
    const session = fakeSession(reads)
    const warn = vi.fn()
    const say = vi.fn()

    const hold = await holdFirstPage(
      {bootRegistrationsFromBackground: true},
      URL,
      async () => session,
      {warn, say}
    )

    expect(hold.outcome).toBe('timeout')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain(
      'before the background finished registering content scripts'
    )

    expect(String(warn.mock.calls[0][0])).not.toContain('\n')
    expect(session.release).toHaveBeenCalledTimes(1)

    await expect(hold.pageOpened()).resolves.toBeUndefined()

    expect(session.evaluate).toHaveBeenCalledTimes(1)
    expect(say).not.toHaveBeenCalled()
  })

  it.each([
    ['there is no background to ask', async () => undefined],
    [
      'the background cannot be reached',
      async () => {
        throw new Error('target closed')
      }
    ]
  ])('opens the page with the one line when %s', async (_name, openSession) => {
    const warn = vi.fn()

    const hold = await holdFirstPage(
      {bootRegistrationsFromBackground: true},
      URL,
      openSession,
      {warn}
    )

    expect(hold.outcome).toBe('timeout')
    expect(warn).toHaveBeenCalledTimes(1)
    await expect(hold.pageOpened()).resolves.toBeUndefined()
  })

  // A background that blocks never answers the debugger, so the bound is
  // the launcher's own timer.
  it('opens the page at the bound when the background never answers', async () => {
    vi.useFakeTimers()

    const warn = vi.fn()
    const done = vi.fn()
    const session = {
      evaluate: vi.fn(() => new Promise(() => undefined)),
      release: vi.fn()
    }

    void holdFirstPage(
      {bootRegistrationsFromBackground: true},
      URL,
      async () => session,
      {warn}
    ).then(done)

    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_WAIT_MS)

    expect(done).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)

    expect(done).toHaveBeenCalledTimes(1)
    expect(done.mock.calls[0][0].outcome).toBe('timeout')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('waited 5.3s')
    expect(session.release).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })
})

describe('the watch for a registration that lands after the first page', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('says nothing and lets go when the window ends with nothing registered', async () => {
    let ageMs = 200
    const session = {
      evaluate: vi.fn(async () => ({count: 0, ageMs})),
      release: vi.fn()
    }
    const say = vi.fn()
    const done = vi.fn()

    void watchForLateRegistration(session, {ageAtOpenMs: 200, say}).then(done)

    for (let i = 0; i < 147; i++) {
      ageMs += LATE_REGISTRATION_LOOK_MS
      await vi.advanceTimersByTimeAsync(LATE_REGISTRATION_LOOK_MS)
    }

    expect(done).not.toHaveBeenCalled()
    expect(session.release).not.toHaveBeenCalled()

    ageMs = LATE_REGISTRATION_WINDOW_MS
    await vi.advanceTimersByTimeAsync(LATE_REGISTRATION_LOOK_MS)

    expect(done).toHaveBeenCalledWith('none')
    expect(say).not.toHaveBeenCalled()
    expect(session.release).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('says the line once, with the age the registration was seen at', async () => {
    const session = fakeSession([
      {count: 0, ageMs: 210},
      {count: 0, ageMs: 300},
      {count: 0, ageMs: 400},
      {count: 1, ageMs: 512},
      {count: 2, ageMs: 600}
    ])
    const say = vi.fn()
    const done = vi.fn()

    void watchForLateRegistration(session, {ageAtOpenMs: 200, say}).then(done)

    await vi.advanceTimersByTimeAsync(10 * LATE_REGISTRATION_LOOK_MS)

    expect(done).toHaveBeenCalledWith('registered')
    expect(say).toHaveBeenCalledTimes(1)
    expect(String(say.mock.calls[0][0])).toContain('0.5s after it started')
    expect(session.evaluate).toHaveBeenCalledTimes(4)
    expect(session.release).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  // The registry was read as the navigation was sent, and it was filled by
  // then: the page has the script, so there is nothing to say.
  it('says nothing for a registration that was in before the navigation', async () => {
    const session = fakeSession([{count: 2, ageMs: 900}])
    const say = vi.fn()

    await expect(
      watchForLateRegistration(session, {
        ageAtOpenMs: 200,
        atOpen: Promise.resolve({count: 2, ageMs: 260}),
        say
      })
    ).resolves.toBe('in-time')

    expect(say).not.toHaveBeenCalled()
    expect(session.evaluate).not.toHaveBeenCalled()
    expect(session.release).toHaveBeenCalledTimes(1)
  })

  it('makes the read at open itself when no navigation handed one over', async () => {
    const session = fakeSession([{count: 1, ageMs: 240}])
    const say = vi.fn()

    await expect(
      watchForLateRegistration(session, {ageAtOpenMs: 200, say})
    ).resolves.toBe('in-time')

    expect(session.evaluate).toHaveBeenCalledTimes(1)
    expect(say).not.toHaveBeenCalled()
  })

  it('keeps watching after an empty or unanswered read at open', async () => {
    const session = fakeSession([{count: 2, ageMs: 700}])
    const say = vi.fn()
    const done = vi.fn()

    void watchForLateRegistration(session, {
      ageAtOpenMs: 200,
      atOpen: Promise.reject(new Error('gone')),
      say
    }).then(done)

    await vi.advanceTimersByTimeAsync(LATE_REGISTRATION_LOOK_MS)

    expect(done).toHaveBeenCalledWith('registered')
    expect(String(say.mock.calls[0][0])).toContain('0.7s after it started')
  })

  it('lets go without a line when the session stops answering', async () => {
    const session = fakeSession([
      {count: 0, ageMs: 300},
      new Error('CDP transport is not open')
    ])
    const say = vi.fn()
    const done = vi.fn()

    void watchForLateRegistration(session, {ageAtOpenMs: 200, say}).then(done)

    await vi.advanceTimersByTimeAsync(LATE_REGISTRATION_LOOK_MS)

    expect(done).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2 * LATE_REGISTRATION_LOOK_MS)

    expect(done).toHaveBeenCalledWith('gone')
    expect(say).not.toHaveBeenCalled()
    expect(session.release).toHaveBeenCalledTimes(1)
  })

  it('takes one unanswered read as nothing and keeps watching', async () => {
    const session = fakeSession([
      {count: 0, ageMs: 210},
      undefined,
      {count: 2, ageMs: 900}
    ])
    const say = vi.fn()
    const done = vi.fn()

    void watchForLateRegistration(session, {ageAtOpenMs: 200, say}).then(done)

    await vi.advanceTimersByTimeAsync(LATE_REGISTRATION_LOOK_MS)

    expect(done).toHaveBeenCalledWith('registered')
    expect(say).toHaveBeenCalledTimes(1)
  })

  // A background that started over has no first page behind it.
  it('says nothing for a background younger than the page', async () => {
    const session = fakeSession([
      {count: 0, ageMs: 210},
      {count: 2, ageMs: 40}
    ])
    const say = vi.fn()

    await expect(
      watchForLateRegistration(session, {ageAtOpenMs: 200, say})
    ).resolves.toBe('gone')

    expect(say).not.toHaveBeenCalled()
    expect(session.release).toHaveBeenCalledTimes(1)
  })

  it('ends on its own clock when the background cannot tell its age', async () => {
    const session = {
      evaluate: vi.fn(async () => ({count: 0, ageMs: null})),
      release: vi.fn()
    }
    const done = vi.fn()

    void watchForLateRegistration(session, {
      ageAtOpenMs: 14_000,
      say: vi.fn()
    }).then(done)

    await vi.advanceTimersByTimeAsync(900)

    expect(done).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)

    expect(done).toHaveBeenCalledWith('none')
    expect(session.release).toHaveBeenCalledTimes(1)
  })

  it('runs the read as text and leaves no name behind', async () => {
    vi.useRealTimers()

    const scripting = fakeRegistry(['iso', 'main'])
    const context = vm.createContext({
      performance: {now: () => 1234.6},
      chrome: {scripting, runtime: {}}
    })
    const before = Object.keys(context).sort()

    await expect(
      vm.runInContext(LATE_REGISTRATION_READ, context)
    ).resolves.toEqual({count: 2, ageMs: 1235})

    expect(Object.keys(context).sort()).toEqual(before)
  })
})

// A dev session prints this line from its own catalog, so the two are read
// side by side: a production run must not word the same thing differently.
describe('the late registration line', () => {
  it('is the dev line, word for word', async () => {
    const dev = await import('../../../develop/dev-server/messages')

    expect(messages.lateBootRegistration(1240)).toBe(
      dev.lateBootRegistration(1240)
    )

    expect(messages.lateBootRegistration()).toBe(dev.lateBootRegistration())
  })
})
