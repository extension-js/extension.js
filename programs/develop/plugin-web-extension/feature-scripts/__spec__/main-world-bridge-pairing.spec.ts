import {describe, expect, it} from 'vitest'
import {
  buildMainWorldBridgePairingSource,
  MAIN_WORLD_BRIDGE_PAIR_PREFIX
} from '../scripts-lib/main-world-bridge-pairing'

type Script = Record<string, unknown> & {id: string}

const BRIDGE = 'scripts/extjs-main-world-bridge.js'
const pairId = (id: string) => `${MAIN_WORLD_BRIDGE_PAIR_PREFIX}${id}`

// Mirrors the browser: a duplicate or unknown id rejects the whole call,
// and an update moves the script to the end of the injection order.
function fakeScripting(initial: Script[] = []) {
  let registry: Script[] = initial.map((script) => ({...script}))
  const calls: string[] = []

  // The browser takes no id that starts with an underscore. The wrapper
  // checks a call's shape with such an id, which the log leaves out.
  const refuse = (ids: unknown[], message: (id: string) => string) => {
    const refused = ids.find(
      (id): id is string => typeof id === 'string' && id.startsWith('_')
    )

    if (refused !== undefined) throw new Error(message(refused))
  }

  const promised = {
    registerContentScripts: async (scripts: Script[]) => {
      refuse(
        scripts.map((script) => script.id),
        () => 'Invalid content script id.'
      )

      calls.push('register')

      for (const script of scripts) {
        if (registry.some((known) => known.id === script.id)) {
          throw new Error(
            `Content script with id "${script.id}" is already registered.`
          )
        }
      }

      registry = [...registry, ...scripts.map((script) => ({...script}))]
    },
    updateContentScripts: async (scripts: Script[]) => {
      refuse(
        scripts.map((script) => script.id),
        (id) => `Content script with id "${id}" does not exist.`
      )

      calls.push('update')

      for (const script of scripts) {
        if (!registry.some((known) => known.id === script.id)) {
          throw new Error(
            `Content script with id "${script.id}" does not exist.`
          )
        }
      }

      for (const script of scripts) {
        const known = registry.find((entry) => entry.id === script.id)
        registry = registry.filter((entry) => entry.id !== script.id)
        registry.push({...known, ...script})
      }
    },
    unregisterContentScripts: async (filter?: {ids?: string[]}) => {
      refuse(
        filter?.ids || [],
        (id) => `Content script with id "${id}" does not exist.`
      )

      calls.push('unregister')

      if (!filter?.ids) {
        registry = []

        return
      }

      for (const id of filter.ids) {
        if (!registry.some((known) => known.id === id)) {
          throw new Error(`Content script with id "${id}" does not exist.`)
        }
      }

      registry = registry.filter((known) => !filter.ids?.includes(known.id))
    },
    getRegisteredContentScripts: async (filter?: {ids?: string[]}) =>
      registry
        .filter((known) => !filter?.ids || filter.ids.includes(known.id))
        .map((known) => ({...known}))
  }

  // A trailing callback is answered the way the browser does it: with no
  // argument on a failure, and runtime.lastError set only while it runs.
  const runtime: {lastError?: {message: string}} = {}
  // One registry per extension, one API object per realm that reads it.
  const surface = () =>
    Object.fromEntries(
      Object.entries(promised).map(([name, method]) => [
        name,
        (...args: unknown[]) => {
          const callback =
            typeof args[args.length - 1] === 'function'
              ? (args.pop() as (...values: unknown[]) => void)
              : null
          const result = (method as (arg?: unknown) => Promise<unknown>)(
            args[0]
          )

          if (!callback) return result

          result.then(
            (value) => callback(value),
            (error: Error) => {
              runtime.lastError = {message: error.message}
              callback()
              delete runtime.lastError
            }
          )
        }
      ])
    ) as typeof promised
  const scripting = surface()

  return {scripting, surface, runtime, calls, raw: () => registry}
}

function install(
  globals: Record<string, unknown>,
  baseReaders: string[] | null = null
) {
  new Function(
    'globalThis',
    buildMainWorldBridgePairingSource(BRIDGE, baseReaders)
  )(globals)
}

function setup(initial: Script[] = [], baseReaders: string[] | null = null) {
  const fake = fakeScripting(initial)
  const browser = {scripting: fake.scripting, runtime: fake.runtime}
  install({browser}, baseReaders)

  return {...fake, api: browser.scripting}
}

const PAGE_BRIDGE = `/${BRIDGE}`

// The background and a page each run the wrapper over their own API object.
function setupTwoRealms() {
  const fake = fakeScripting()
  const background = {scripting: fake.scripting, runtime: fake.runtime}
  const page = {scripting: fake.surface(), runtime: fake.runtime}
  install({browser: background})
  new Function(
    'globalThis',
    buildMainWorldBridgePairingSource(PAGE_BRIDGE, null)
  )({browser: page})

  return {...fake, background: background.scripting, page: page.scripting}
}

const hook: Script = {
  id: 'page-hook',
  js: ['scripts/hook.js'],
  world: 'MAIN',
  matches: ['https://a.example/*'],
  excludeMatches: ['https://a.example/skip/*'],
  allFrames: true,
  matchOriginAsFallback: true,
  persistAcrossSessions: false,
  runAt: 'document_idle'
}

describe('the MAIN world bridge pairing a Gecko background carries', () => {
  it('registers the bridge before a MAIN world file with the same scope', async () => {
    const {api, raw} = setup()

    await api.registerContentScripts([hook])

    expect(raw()).toEqual([
      {
        id: pairId('page-hook'),
        js: [BRIDGE],
        matches: hook.matches,
        excludeMatches: hook.excludeMatches,
        allFrames: true,
        matchOriginAsFallback: true,
        persistAcrossSessions: false,
        runAt: 'document_idle'
      },
      hook
    ])
  })

  it("puts each pair right before its own file, at that file's timing", async () => {
    const {api, raw} = setup()
    const early = {...hook, id: 'early', runAt: 'document_start'}
    const plain = {id: 'plain', js: ['scripts/a.js'], matches: ['<all_urls>']}

    await api.registerContentScripts([early, plain, hook])

    expect(raw().map((script) => `${script.id}@${script.runAt}`)).toEqual([
      `${pairId('early')}@document_start`,
      'early@document_start',
      'plain@undefined',
      `${pairId('page-hook')}@document_idle`,
      'page-hook@document_idle'
    ])
  })

  it('keeps each pair right before its file when an update reorders them', async () => {
    const {api, raw} = setup()
    const other = {...hook, id: 'other'}
    await api.registerContentScripts([hook, other])

    await api.updateContentScripts([
      {id: 'page-hook', runAt: 'document_end'},
      {id: 'other', matches: ['https://b.example/*']}
    ])

    expect(raw().map((script) => `${script.id}@${script.runAt}`)).toEqual([
      `${pairId('page-hook')}@document_end`,
      'page-hook@document_end',
      `${pairId('other')}@document_idle`,
      'other@document_idle'
    ])
  })

  it('keeps two files an update moves into the MAIN world next to their pairs', async () => {
    const {api, raw} = setup()
    await api.registerContentScripts([
      {id: 'one', js: ['scripts/a.js'], matches: ['<all_urls>']},
      {id: 'two', js: ['scripts/b.js'], matches: ['<all_urls>']}
    ])

    await api.updateContentScripts([
      {id: 'one', world: 'MAIN'},
      {id: 'two', world: 'MAIN'}
    ])

    expect(raw().map((script) => script.id)).toEqual([
      pairId('one'),
      'one',
      pairId('two'),
      'two'
    ])
  })

  it('pairs only a file the build saw reading the base', async () => {
    const {api, raw} = setup([], ['scripts/hook.js'])
    const plain = {...hook, id: 'plain', js: ['scripts/plain.js']}
    const rooted = {...hook, id: 'rooted', js: ['/scripts/hook.js']}
    const mixed = {
      ...hook,
      id: 'mixed',
      js: ['scripts/plain.js', './scripts/hook.js']
    }

    await api.registerContentScripts([plain, rooted, mixed])

    expect(raw().map((script) => script.id)).toEqual([
      'plain',
      pairId('rooted'),
      'rooted',
      pairId('mixed'),
      'mixed'
    ])
  })

  it('leaves a registration outside the MAIN world alone', async () => {
    const {api, raw} = setup()
    const isolated = {
      id: 'isolated',
      js: ['scripts/a.js'],
      matches: ['<all_urls>']
    }

    await api.registerContentScripts([isolated])

    expect(raw()).toEqual([isolated])
  })

  it('hides the pairs from getRegisteredContentScripts', async () => {
    const {api} = setup()

    await api.registerContentScripts([hook])

    expect(await api.getRegisteredContentScripts()).toEqual([hook])
    expect(
      await api.getRegisteredContentScripts({ids: [pairId('page-hook')]})
    ).toEqual([])
  })

  it('keeps a persisted pair when the file is registered again', async () => {
    const {api, raw} = setup()
    await api.registerContentScripts([hook])
    const before = raw()

    await expect(api.registerContentScripts([hook])).rejects.toThrow(
      'Content script with id "page-hook" is already registered.'
    )

    expect(raw()).toEqual(before)
  })

  it('registers a pair that outlived its file again, ahead of the file', async () => {
    const {api, raw} = setup([
      {
        id: pairId('page-hook'),
        js: [BRIDGE],
        matches: ['https://old.example/*']
      }
    ])

    await api.registerContentScripts([hook])

    expect(raw().map((script) => script.id)).toEqual([
      pairId('page-hook'),
      'page-hook'
    ])

    expect(raw()[0].matches).toEqual(hook.matches)
  })

  it('carries an update to the pair and keeps the pair first', async () => {
    const {api, raw} = setup()
    await api.registerContentScripts([hook])

    await api.updateContentScripts([
      {id: 'page-hook', matches: ['https://b.example/*']}
    ])

    expect(raw().map((script) => script.id)).toEqual([
      pairId('page-hook'),
      'page-hook'
    ])

    expect(raw()[0].matches).toEqual(['https://b.example/*'])
    expect(raw()[0].excludeMatches).toEqual(hook.excludeMatches)
    expect(raw()[1].matches).toEqual(['https://b.example/*'])
  })

  it('pairs a file an update moves into the MAIN world and drops the pair on the way out', async () => {
    const {api, raw} = setup()
    await api.registerContentScripts([
      {id: 'late', js: ['scripts/a.js'], matches: ['<all_urls>']}
    ])

    await api.updateContentScripts([{id: 'late', world: 'MAIN'}])
    expect(raw().map((script) => script.id)).toEqual([pairId('late'), 'late'])

    await api.updateContentScripts([{id: 'late', world: 'ISOLATED'}])
    expect(raw().map((script) => script.id)).toEqual(['late'])
  })

  it('unregisters the pair with its file, by id and with no filter', async () => {
    const {api, raw} = setup()
    const other = {...hook, id: 'other'}
    await api.registerContentScripts([hook, other])

    await api.unregisterContentScripts({ids: ['page-hook']})
    expect(raw().map((script) => script.id)).toEqual([pairId('other'), 'other'])

    await api.unregisterContentScripts()
    expect(raw()).toEqual([])
  })

  it('reports an unknown id the way the browser does', async () => {
    const {api} = setup()

    await expect(
      api.unregisterContentScripts({ids: ['missing']})
    ).rejects.toThrow('Content script with id "missing" does not exist.')
  })

  it('calls a trailing callback once the pair is in place', async () => {
    const {api, raw} = setup()

    await new Promise<void>((resolve) => {
      ;(api.registerContentScripts as (...args: unknown[]) => unknown)(
        [hook],
        () => resolve()
      )
    })

    expect(raw().map((script) => script.id)).toEqual([
      pairId('page-hook'),
      'page-hook'
    ])

    const listed = await new Promise<Script[]>((resolve) => {
      ;(api.getRegisteredContentScripts as (...args: unknown[]) => unknown)(
        resolve
      )
    })
    expect(listed).toEqual([hook])
  })

  it('lets a callback read the failure off runtime.lastError', async () => {
    const {api, runtime} = setup()
    const call = (method: unknown, argument: unknown) =>
      new Promise<{error?: string; values: unknown[]}>((resolve) => {
        ;(method as (...args: unknown[]) => unknown)(
          argument,
          (...values: unknown[]) =>
            resolve({error: runtime.lastError?.message, values})
        )
      })

    expect(await call(api.registerContentScripts, [hook])).toEqual({
      error: undefined,
      values: [undefined]
    })

    expect(await call(api.registerContentScripts, [hook])).toEqual({
      error: 'Content script with id "page-hook" is already registered.',
      values: []
    })

    expect(
      await call(api.updateContentScripts, [{id: 'missing', world: 'MAIN'}])
    ).toEqual({
      error: 'Content script with id "missing" does not exist.',
      values: []
    })

    expect(
      await call(api.unregisterContentScripts, {ids: ['missing']})
    ).toEqual({
      error: 'Content script with id "missing" does not exist.',
      values: []
    })

    expect(runtime.lastError).toBeUndefined()
  })

  it('drops a pair only after the update that needs it gone went through', async () => {
    const {api, raw, runtime} = setup()
    await api.registerContentScripts([hook])

    const seen = await new Promise<string | undefined>((resolve) => {
      ;(api.updateContentScripts as (...args: unknown[]) => unknown)(
        [
          {id: 'page-hook', world: 'ISOLATED'},
          {id: 'missing', world: 'ISOLATED'}
        ],
        () => resolve(runtime.lastError?.message)
      )
    })

    expect(seen).toBe('Content script with id "missing" does not exist.')
    expect(raw().map((script) => script.id)).toEqual([
      pairId('page-hook'),
      'page-hook'
    ])

    await new Promise<void>((resolve) => {
      ;(api.updateContentScripts as (...args: unknown[]) => unknown)(
        [{id: 'page-hook', world: 'ISOLATED'}],
        () => resolve()
      )
    })

    expect(raw().map((script) => script.id)).toEqual(['page-hook'])
  })

  it('answers through the promise where the namespace takes no callback', async () => {
    const fake = fakeScripting()
    const strict = Object.fromEntries(
      Object.entries(fake.scripting).map(([name, method]) => [
        name,
        (...args: unknown[]) => {
          if (args.some((arg) => typeof arg === 'function')) {
            throw new Error('Incorrect argument types')
          }

          return (method as (...rest: unknown[]) => unknown)(...args)
        }
      ])
    )
    const browser = {scripting: strict}
    install({browser})

    await new Promise<void>((resolve) => {
      ;(
        browser.scripting.registerContentScripts as (
          ...args: unknown[]
        ) => unknown
      )([hook], () => resolve())
    })

    expect(fake.raw().map((script) => script.id)).toEqual([
      pairId('page-hook'),
      'page-hook'
    ])
  })

  it('wraps browser and chrome once each and never twice', async () => {
    const first = fakeScripting()
    const second = fakeScripting()
    const globals = {
      browser: {scripting: first.scripting},
      chrome: {scripting: second.scripting}
    }

    install(globals)
    install(globals)

    await globals.browser.scripting.registerContentScripts([hook])
    await globals.chrome.scripting.registerContentScripts([hook])

    expect(first.raw()).toHaveLength(2)
    expect(second.raw()).toHaveLength(2)
  })

  it('does nothing where the scripting API is absent', () => {
    expect(() => install({})).not.toThrow()
    expect(() => install({browser: {}, chrome: {runtime: {}}})).not.toThrow()
  })
})

describe('the pairing a Gecko background and a page both carry', () => {
  const other: Script = {...hook, id: 'other-hook', js: ['scripts/other.js']}

  it('pairs a page registration with the bridge named from the root', async () => {
    const {page, raw} = setupTwoRealms()
    await page.registerContentScripts([hook])

    expect(raw().map((script) => script.id)).toEqual([
      pairId('page-hook'),
      'page-hook'
    ])

    expect(raw()[0].js).toEqual([PAGE_BRIDGE])
  })

  it('keeps one pair per file when both contexts register', async () => {
    const {background, page, raw} = setupTwoRealms()
    await background.registerContentScripts([hook])
    await page.registerContentScripts([other])

    expect(raw().map((script) => script.id)).toEqual([
      pairId('page-hook'),
      'page-hook',
      pairId('other-hook'),
      'other-hook'
    ])

    // The same id from the other context fails the way the browser fails it.
    await expect(page.registerContentScripts([hook])).rejects.toThrow(
      'already registered'
    )

    expect(raw()).toHaveLength(4)
  })

  it('hides the pairs of either context from both', async () => {
    const {background, page} = setupTwoRealms()
    await background.registerContentScripts([hook])
    await page.registerContentScripts([other])

    for (const api of [background, page]) {
      const seen = await api.getRegisteredContentScripts()
      expect(seen.map((script) => script.id)).toEqual([
        'page-hook',
        'other-hook'
      ])
    }
  })

  it('drops a pair from the context that did not register it', async () => {
    const {background, page, raw} = setupTwoRealms()
    await background.registerContentScripts([hook])
    await page.registerContentScripts([other])

    await page.unregisterContentScripts({ids: ['page-hook']})
    expect(raw().map((script) => script.id)).toEqual([
      pairId('other-hook'),
      'other-hook'
    ])

    await background.unregisterContentScripts({ids: ['other-hook']})
    expect(raw()).toEqual([])
  })

  it('carries an update from the other context to the pair', async () => {
    const {background, page, raw} = setupTwoRealms()
    await background.registerContentScripts([hook])
    await page.updateContentScripts([
      {id: 'page-hook', runAt: 'document_start'}
    ])

    expect(raw().map((script) => [script.id, script.runAt])).toEqual([
      [pairId('page-hook'), 'document_start'],
      ['page-hook', 'document_start']
    ])
  })
})

type Injection = Record<string, unknown> & {target: Record<string, unknown>}
type Frames = Array<{frameId: number; result?: unknown; error?: unknown}>

const INJECTED: Injection = {
  target: {tabId: 7},
  files: ['/scripts/hook.js'],
  world: 'MAIN'
}

// Mirrors the browser: each call is answered a turn later, a failure
// rejects the promise or sets runtime.lastError while the callback runs.
function fakeInjecting(
  answer: (injection: Injection) => Frames = () => [{frameId: 0, result: 1}],
  shape: (args: unknown[]) => void = () => {}
) {
  const seen: Injection[] = []
  // The calls made on a tab that cannot exist, which reach no page.
  const probes: unknown[][] = []
  const log: string[] = []
  // The same lines, each led by the tab it ran in.
  const byTab: string[] = []
  const runtime: {lastError?: {message: string}} = {}
  const nameOf = (injection: Injection) =>
    typeof injection.func === 'function'
      ? 'func'
      : (injection.files as string[]).join('+')

  const executeScript = (...args: unknown[]) => {
    // The browser checks the shape of a call before it does anything else.
    shape(args)

    const injection = args[0] as Injection
    const callback = args[args.length - 1]
    const unknownTab = injection.target.tabId === -1

    if (unknownTab) probes.push(args)
    else {
      seen.push(injection)
      log.push(`start ${nameOf(injection)}`)
      byTab.push(`${injection.target.tabId} start ${nameOf(injection)}`)
    }

    const result = new Promise<Frames>((resolve, reject) => {
      if (unknownTab) {
        reject(new Error('Invalid tab ID: -1'))

        return
      }

      setTimeout(() => {
        log.push(`end ${nameOf(injection)}`)
        byTab.push(`${injection.target.tabId} end ${nameOf(injection)}`)

        try {
          resolve(answer(injection))
        } catch (error) {
          reject(error)
        }
      }, 0)
    })

    if (typeof callback !== 'function') return result

    result.then(
      (frames) => callback(frames),
      (error: Error) => {
        runtime.lastError = {message: error.message}
        callback()
        delete runtime.lastError
      }
    )
  }

  const scripting: Record<string, unknown> = {
    ...fakeScripting().scripting,
    executeScript
  }

  return {scripting, runtime, seen, probes, log, byTab, native: executeScript}
}

// Mirrors the Web Locks API: one queue per name, shared by every realm.
function fakeLocks() {
  const tails = new Map<string, Promise<unknown>>()
  const names: string[] = []

  const request = (name: string, held: () => unknown) => {
    names.push(name)

    const turn = (tails.get(name) || Promise.resolve()).then(() => held())
    tails.set(
      name,
      turn.then(
        () => {},
        () => {}
      )
    )

    return turn
  }

  return {names, navigator: {locks: {request}}}
}

type Run = (...args: unknown[]) => Promise<Frames> | undefined

// Two realms of one extension: each wraps its own API object, and both
// reach the one browser behind them.
function setupInjectingRealms(navigator?: unknown) {
  const fake = fakeInjecting()

  const realm = (bridgeFile: string) => {
    const browser = {scripting: {...fake.scripting}, runtime: fake.runtime}

    new Function('globalThis', buildMainWorldBridgePairingSource(bridgeFile))({
      browser,
      navigator
    })

    return browser.scripting.executeScript as Run
  }

  return {...fake, background: realm(BRIDGE), page: realm(PAGE_BRIDGE)}
}

function setupInjecting(
  answer?: (injection: Injection) => Frames,
  lists: {readers?: string[] | null; injectable?: string[] | null} = {},
  bridgeFile = BRIDGE,
  shape?: (args: unknown[]) => void,
  navigator?: unknown
) {
  const fake = fakeInjecting(answer, shape)
  const browser = {scripting: fake.scripting, runtime: fake.runtime}
  const readers = lists.readers === undefined ? null : lists.readers

  new Function(
    'globalThis',
    buildMainWorldBridgePairingSource(
      bridgeFile,
      readers,
      lists.injectable === undefined ? readers : lists.injectable
    )
  )({browser, navigator})

  const run = browser.scripting.executeScript as Run

  return {...fake, run}
}

const isBridge = (injection: Injection) =>
  Array.isArray(injection.files) && String(injection.files[0]).endsWith(BRIDGE)

describe('the bridge a Gecko caller runs ahead of a MAIN world injection', () => {
  it('runs the bridge in the isolated world, waits, then makes the call', async () => {
    const frames: Frames = [{frameId: 0, result: {probe: 'value'}}]
    const {run, seen, log} = setupInjecting((injection) =>
      isBridge(injection) ? [{frameId: 0}] : frames
    )

    const result = await run(INJECTED)

    expect(log).toEqual([
      `start ${BRIDGE}`,
      `end ${BRIDGE}`,
      'start /scripts/hook.js',
      'end /scripts/hook.js'
    ])

    expect(seen[0]).toEqual({
      target: {tabId: 7},
      files: [BRIDGE],
      world: 'ISOLATED'
    })

    expect(seen[1]).toBe(INJECTED)
    expect(result).toBe(frames)
  })

  it('copies the target, frames and documents included, and nothing else', async () => {
    const {run, seen} = setupInjecting()
    const target = {
      tabId: 7,
      frameIds: [0, 4],
      allFrames: false,
      documentIds: ['A1']
    }

    await run({...INJECTED, target, injectImmediately: true})

    expect(seen[0]).toEqual({target, files: [BRIDGE], world: 'ISOLATED'})
    expect(seen[0].target).not.toBe(target)
    expect(seen[1].target).toBe(target)
    expect(seen[1].injectImmediately).toBe(true)
  })

  it('names the bridge from the root for a page', async () => {
    const {run, seen} = setupInjecting(undefined, {}, PAGE_BRIDGE)

    await run(INJECTED)

    expect(seen[0].files).toEqual([PAGE_BRIDGE])
  })

  it('passes a func, another world and an unlisted file straight through', async () => {
    const lists = {readers: ['scripts/hook.js']}
    const passes: Injection[] = [
      {target: {tabId: 7}, func: () => 1, world: 'MAIN'},
      {target: {tabId: 7}, files: ['/scripts/hook.js'], world: 'ISOLATED'},
      {target: {tabId: 7}, files: ['/scripts/hook.js']},
      {target: {tabId: 7}, files: ['/scripts/plain.js'], world: 'MAIN'},
      {target: {tabId: 7}, files: [], world: 'MAIN'},
      {target: {tabId: '7'}, files: ['/scripts/hook.js'], world: 'MAIN'},
      {target: {}, files: ['/scripts/hook.js'], world: 'MAIN'}
    ]

    for (const injection of passes) {
      const {run, seen} = setupInjecting(undefined, lists)
      const extra = {extra: true}

      await run(injection, extra)

      expect(seen).toEqual([injection])
      expect(seen[0]).toBe(injection)
    }

    const {run, seen} = setupInjecting(undefined, lists)
    await run({...INJECTED, files: ['./scripts/hook.js']})

    expect(seen.map(isBridge)).toEqual([true, false])
  })

  it('bridges every compiled entry in development and no other file', async () => {
    const lists = {readers: null, injectable: ['scripts/hook.js']}
    const listed = setupInjecting(undefined, lists)
    const unlisted = setupInjecting(undefined, lists)

    await listed.run(INJECTED)
    await unlisted.run({...INJECTED, files: ['/vendor/lib.js']})

    expect(listed.seen.map(isBridge)).toEqual([true, false])
    expect(unlisted.seen.map(isBridge)).toEqual([false])
  })

  it('still makes the call when the bridge fails, and answers with its result', async () => {
    const frames: Frames = [{frameId: 0, result: 'ran'}]
    const rejected = setupInjecting((injection) => {
      if (isBridge(injection)) throw new Error('bridge refused')

      return frames
    })

    expect(await rejected.run(INJECTED)).toBe(frames)
    expect(rejected.seen).toHaveLength(2)

    const thrown = fakeInjecting(() => frames)
    const native = thrown.native

    thrown.scripting.executeScript = (injection: Injection) => {
      if (isBridge(injection)) throw new Error('bridge threw')

      return native(injection)
    }

    const browser = {scripting: thrown.scripting}
    install({browser})

    expect(
      await (
        browser.scripting.executeScript as (
          injection: Injection
        ) => Promise<Frames>
      )(INJECTED)
    ).toBe(frames)
  })

  it("rejects with the call's own error, never the bridge's", async () => {
    const own = setupInjecting((injection) => {
      if (isBridge(injection)) return [{frameId: 0}]
      if (injection.func) return [{frameId: 0}]

      throw new Error('Invalid tab ID: 7')
    })

    await expect(own.run(INJECTED)).rejects.toThrow('Invalid tab ID: 7')

    const both = setupInjecting(() => {
      throw new Error(`failed ${both.seen.length}`)
    })

    await expect(both.run(INJECTED)).rejects.toThrow('failed 2')
    expect(both.seen).toHaveLength(2)
  })

  it('takes the base back when the file never ran', async () => {
    const failing: Frames = [{frameId: 0, error: new Error('no such file')}]
    const {run, seen} = setupInjecting((injection) =>
      isBridge(injection) || injection.func ? [{frameId: 0}] : failing
    )

    expect(await run({...INJECTED, target: {tabId: 7, allFrames: true}})).toBe(
      failing
    )

    expect(seen).toHaveLength(3)
    expect(seen[2].target).toEqual({tabId: 7, allFrames: true})
    expect(seen[2].world).toBe('ISOLATED')
    expect(String(seen[2].func)).toContain('data-extjs-extension-base')
  })

  it('takes the getter off the page window with the attribute', async () => {
    const failing: Frames = [{frameId: 0, error: new Error('no such file')}]
    const {run, seen} = setupInjecting((injection) =>
      isBridge(injection) || injection.func ? [{frameId: 0}] : failing
    )

    await run(INJECTED)

    const removed: string[] = []
    const page = {__EXTJS_EXTENSION_BASE__: 'getter', other: 'kept'}
    const sweep = seen[2].func as unknown as () => void
    const globals = globalThis as Record<string, unknown>
    const before = {window: globals.window, document: globals.document}

    globals.window = {wrappedJSObject: page}
    globals.document = {
      documentElement: {removeAttribute: (name: string) => removed.push(name)}
    }

    try {
      sweep()
    } finally {
      globals.window = before.window
      globals.document = before.document
    }

    expect(page).toEqual({other: 'kept'})
    expect(removed).toEqual(['data-extjs-extension-base'])
  })

  it('still clears the attribute where the page window is out of reach', async () => {
    const failing: Frames = [{frameId: 0, error: new Error('no such file')}]
    const {run, seen} = setupInjecting((injection) =>
      isBridge(injection) || injection.func ? [{frameId: 0}] : failing
    )

    await run(INJECTED)

    const removed: string[] = []
    const sweep = seen[2].func as unknown as () => void
    const globals = globalThis as Record<string, unknown>
    const before = {window: globals.window, document: globals.document}

    globals.window = {}
    globals.document = {
      documentElement: {removeAttribute: (name: string) => removed.push(name)}
    }

    try {
      sweep()
    } finally {
      globals.window = before.window
      globals.document = before.document
    }

    expect(removed).toEqual(['data-extjs-extension-base'])
  })

  it('gives two injections into one tab their turns', async () => {
    const {run, byTab} = setupInjecting()

    await Promise.all([
      run(INJECTED),
      run({...INJECTED, files: ['/scripts/other.js']}),
      run({...INJECTED, target: {tabId: 8}, files: ['/scripts/far.js']})
    ])

    expect(byTab.filter((line) => line.startsWith('7 '))).toEqual([
      `7 start ${BRIDGE}`,
      `7 end ${BRIDGE}`,
      '7 start /scripts/hook.js',
      '7 end /scripts/hook.js',
      `7 start ${BRIDGE}`,
      `7 end ${BRIDGE}`,
      '7 start /scripts/other.js',
      '7 end /scripts/other.js'
    ])

    // Another tab never waits for this one.
    expect(byTab.indexOf('8 start /scripts/far.js')).toBeLessThan(
      byTab.indexOf('7 end /scripts/hook.js')
    )
  })

  it('throws at once what the browser throws for a malformed call', async () => {
    const refusal =
      'Type error for parameter injection (Unexpected property "bogus") for scripting.executeScript.'
    const {run, seen, probes} = setupInjecting(
      undefined,
      {},
      BRIDGE,
      (args) => {
        if (
          args.length > 2 ||
          (args.length === 2 && typeof args[1] !== 'function')
        ) {
          throw new Error(
            'Incorrect argument types for scripting.executeScript.'
          )
        }

        if ('bogus' in (args[0] as Injection)) throw new Error(refusal)
      }
    )

    expect(() => run({...INJECTED, bogus: 1})).toThrow(refusal)
    expect(() => run({...INJECTED, bogus: 1}, () => {})).toThrow(refusal)
    expect(() => run(INJECTED, 5)).toThrow('Incorrect argument types')
    expect(() => run(INJECTED, 5, () => {})).toThrow('Incorrect argument types')

    // Nothing ran: no bridge, no file, and no check got past the browser.
    expect(seen).toEqual([])
    expect(probes).toEqual([])
  })

  it('checks the shape on a tab that cannot exist, every argument kept', async () => {
    const {run, seen, probes, runtime} = setupInjecting()
    const injection = {
      ...INJECTED,
      target: {tabId: 7, frameIds: [0]},
      injectImmediately: true
    }
    const before = JSON.stringify(injection)

    await run(injection)

    expect(probes).toEqual([
      [{...injection, target: {tabId: -1, frameIds: [0]}}]
    ])

    expect(JSON.stringify(injection)).toBe(before)
    expect(seen.map(isBridge)).toEqual([true, false])

    // A callback form is checked as one, and the check answers nobody.
    const answered = await new Promise<unknown[]>((resolve) => {
      run(injection, (...values: unknown[]) => resolve(values))
    })

    expect(answered).toHaveLength(1)
    expect(probes[1]).toHaveLength(2)
    expect(typeof probes[1][1]).toBe('function')
    expect(runtime.lastError).toBeUndefined()
  })

  it('keeps the turns of two realms under one Web Lock', async () => {
    const locks = fakeLocks()
    const {background, page, byTab} = setupInjectingRealms(locks.navigator)

    await Promise.all([
      background(INJECTED),
      page({...INJECTED, files: ['/scripts/other.js']}),
      page({...INJECTED, target: {tabId: 8}, files: ['/scripts/far.js']})
    ])

    expect(byTab.filter((line) => line.startsWith('7 '))).toEqual([
      `7 start ${BRIDGE}`,
      `7 end ${BRIDGE}`,
      '7 start /scripts/hook.js',
      '7 end /scripts/hook.js',
      `7 start ${PAGE_BRIDGE}`,
      `7 end ${PAGE_BRIDGE}`,
      '7 start /scripts/other.js',
      '7 end /scripts/other.js'
    ])

    expect(locks.names).toEqual([
      `${MAIN_WORLD_BRIDGE_PAIR_PREFIX}tab:7`,
      `${MAIN_WORLD_BRIDGE_PAIR_PREFIX}tab:7`,
      `${MAIN_WORLD_BRIDGE_PAIR_PREFIX}tab:8`
    ])

    // Another tab never waits for this one.
    expect(byTab.indexOf('8 start /scripts/far.js')).toBeLessThan(
      byTab.indexOf('7 end /scripts/hook.js')
    )
  })

  // The ordering the lock exists for: a realm alone only knows its own
  // turns, so the second bridge runs before the first file cleared the base.
  it('lets two realms run into each other where there is no Web Lock', async () => {
    const {background, page, byTab} = setupInjectingRealms()

    await Promise.all([
      background(INJECTED),
      page({...INJECTED, files: ['/scripts/other.js']})
    ])

    expect(byTab.slice(0, 2)).toEqual([
      `7 start ${BRIDGE}`,
      `7 start ${PAGE_BRIDGE}`
    ])

    expect(byTab.indexOf('7 start /scripts/other.js')).toBeLessThan(
      byTab.indexOf('7 end /scripts/hook.js')
    )
  })

  it('keeps its own turns when the lock is refused', async () => {
    const frames: Frames = [{frameId: 0, result: 'ran'}]
    const refusals = [
      () => {
        throw new Error('The operation is insecure.')
      },
      () => Promise.reject(new Error('The operation is insecure.'))
    ]

    for (const request of refusals) {
      const {run, byTab} = setupInjecting(
        (injection) => (isBridge(injection) ? [{frameId: 0}] : frames),
        {},
        BRIDGE,
        undefined,
        {locks: {request}}
      )

      const results = await Promise.all([
        run(INJECTED),
        run({...INJECTED, files: ['/scripts/other.js']})
      ])

      expect(results).toEqual([frames, frames])
      expect(byTab).toEqual([
        `7 start ${BRIDGE}`,
        `7 end ${BRIDGE}`,
        '7 start /scripts/hook.js',
        '7 end /scripts/hook.js',
        `7 start ${BRIDGE}`,
        `7 end ${BRIDGE}`,
        '7 start /scripts/other.js',
        '7 end /scripts/other.js'
      ])
    }
  })

  it("rejects with the call's own error under a lock as well", async () => {
    const {run, seen} = setupInjecting(
      (injection) => {
        if (isBridge(injection) || injection.func) return [{frameId: 0}]

        throw new Error('Invalid tab ID: 7')
      },
      {},
      BRIDGE,
      undefined,
      fakeLocks().navigator
    )

    await expect(run(INJECTED)).rejects.toThrow('Invalid tab ID: 7')
    // One bridge, one call, one sweep: a failure is never run again.
    expect(seen).toHaveLength(3)
  })

  it('answers a trailing callback from the call itself and returns nothing', async () => {
    const frames: Frames = [{frameId: 0, result: 'ran'}]
    const {run, log, runtime} = setupInjecting((injection) => {
      if (isBridge(injection) || injection.func) return [{frameId: 0}]

      if ((injection.target as {tabId: number}).tabId === 9) {
        throw new Error('Invalid tab ID: 9')
      }

      return frames
    })

    let returned: unknown = 'unset'
    const answered = await new Promise<unknown[]>((resolve) => {
      returned = run(INJECTED, (...values: unknown[]) =>
        resolve([...values, [...log]])
      )
    })

    expect(returned).toBeUndefined()
    expect(answered[0]).toBe(frames)
    expect(answered[1]).toEqual([
      `start ${BRIDGE}`,
      `end ${BRIDGE}`,
      'start /scripts/hook.js',
      'end /scripts/hook.js'
    ])

    const failure = await new Promise<unknown[]>((resolve) => {
      run({...INJECTED, target: {tabId: 9}}, (...values: unknown[]) =>
        resolve([values.length, runtime.lastError?.message])
      )
    })

    expect(failure).toEqual([0, 'Invalid tab ID: 9'])
  })

  it('leaves executeScript alone where there is none to wrap', () => {
    const fake = fakeScripting()
    const browser = {scripting: fake.scripting as Record<string, unknown>}

    install({browser})

    expect(browser.scripting.executeScript).toBeUndefined()
  })
})
