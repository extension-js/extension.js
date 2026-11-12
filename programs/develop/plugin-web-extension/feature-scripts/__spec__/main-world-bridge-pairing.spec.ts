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

  const scripting = {
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

  return {scripting, calls, raw: () => registry}
}

function install(globals: Record<string, unknown>) {
  new Function('globalThis', buildMainWorldBridgePairingSource(BRIDGE))(globals)
}

function setup(initial: Script[] = []) {
  const fake = fakeScripting(initial)
  const browser = {scripting: fake.scripting}
  install({browser})

  return {...fake, api: browser.scripting}
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
        runAt: 'document_start',
        matches: hook.matches,
        excludeMatches: hook.excludeMatches,
        allFrames: true,
        matchOriginAsFallback: true,
        persistAcrossSessions: false
      },
      hook
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
