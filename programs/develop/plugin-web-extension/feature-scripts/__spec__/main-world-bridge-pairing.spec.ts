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

  const promised = {
    registerContentScripts: async (scripts: Script[]) => {
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
