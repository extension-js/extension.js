import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  BOOT_REGISTRATIONS_WAIT_MS,
  holdForBootRegistrations
} from '../browsers-lib/boot-registrations-hold'
import {
  BOOT_REGISTRATIONS_LOOK_MS,
  BOOT_REGISTRATIONS_QUIET_MS,
  type BootRegistrationsAnswer,
  backgroundBootRegistrationsWait,
  bootRegistrationsProbe,
  builtBackgroundNamesRegistration,
  resolveBootRegistrationsWait
} from '../browsers-lib/built-boot-registrations'

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

describe('the wait a production launch builds', () => {
  const answer = (outcome: BootRegistrationsAnswer['outcome']) => ({
    outcome,
    count: outcome === 'settled' ? 2 : 0,
    looks: 2,
    waitedMs: 25,
    bootedAfterMs: 0
  })

  it('hands the dev server wait back untouched', () => {
    const awaitBootRegistrations = vi.fn(async () => 'settled' as const)
    const evaluate = vi.fn()

    expect(
      resolveBootRegistrationsWait(
        {awaitBootRegistrations, bootRegistrationsFromBackground: true},
        evaluate
      )
    ).toBe(awaitBootRegistrations)

    expect(evaluate).not.toHaveBeenCalled()
  })

  // The fast path: no wait, no evaluation, no timer, no line.
  it('builds no wait for a background that names no registration', async () => {
    const evaluate = vi.fn()
    const warn = vi.fn()
    const wait = resolveBootRegistrationsWait({}, evaluate)

    expect(wait).toBeUndefined()

    vi.useFakeTimers()

    await expect(
      holdForBootRegistrations({awaitBootRegistrations: wait}, URL, {warn})
    ).resolves.toBe('none')

    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()

    expect(evaluate).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('builds no wait when there is no background to ask', () => {
    expect(
      resolveBootRegistrationsWait(
        {bootRegistrationsFromBackground: true},
        undefined
      )
    ).toBeUndefined()
  })

  it('asks the background once, with the bound, and settles on its answer', async () => {
    const evaluate = vi.fn(async () => answer('settled'))
    const onAnswer = vi.fn()
    const warn = vi.fn()
    const wait = resolveBootRegistrationsWait(
      {bootRegistrationsFromBackground: true},
      evaluate,
      onAnswer
    )

    await expect(
      holdForBootRegistrations({awaitBootRegistrations: wait}, URL, {warn})
    ).resolves.toBe('settled')

    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(evaluate).toHaveBeenCalledWith(
      bootRegistrationsProbe(BOOT_REGISTRATIONS_WAIT_MS),
      BOOT_REGISTRATIONS_WAIT_MS
    )

    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onAnswer.mock.calls[0][0]).toMatchObject(answer('settled'))
    expect(typeof onAnswer.mock.calls[0][0].askedForMs).toBe('number')
    expect(warn).not.toHaveBeenCalled()
  })

  it('settles without a line when the background registered nothing', async () => {
    const warn = vi.fn()
    const wait = backgroundBootRegistrationsWait(async () => answer('none'))

    await expect(
      holdForBootRegistrations({awaitBootRegistrations: wait}, URL, {warn})
    ).resolves.toBe('settled')

    expect(warn).not.toHaveBeenCalled()
  })

  it.each([
    ['the probe ran out of time', async () => answer('timeout')],
    ['the background could not be asked', async () => undefined],
    ['the answer is not one the probe gives', async () => ({outcome: 'yes'})],
    [
      'the debugger refused',
      async () => {
        throw new Error('CDP command timed out')
      }
    ]
  ])('opens the page with the one line when %s', async (_name, evaluate) => {
    const warn = vi.fn()
    const wait = backgroundBootRegistrationsWait(evaluate)

    await expect(
      holdForBootRegistrations({awaitBootRegistrations: wait}, URL, {warn})
    ).resolves.toBe('timeout')

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain(
      'before the background finished registering content scripts'
    )

    expect(String(warn.mock.calls[0][0])).not.toContain('\n')
  })

  // A background that blocks never answers the debugger, so the bound is
  // the launcher's own timer.
  it('opens the page at the bound when the background never answers', async () => {
    vi.useFakeTimers()

    const warn = vi.fn()
    const done = vi.fn()
    const wait = backgroundBootRegistrationsWait(
      () => new Promise(() => undefined)
    )

    void holdForBootRegistrations({awaitBootRegistrations: wait}, URL, {
      warn
    }).then(done)

    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_WAIT_MS)

    expect(done).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)

    expect(done).toHaveBeenCalledWith('timeout')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('waited 5.3s')

    vi.useRealTimers()
  })
})
