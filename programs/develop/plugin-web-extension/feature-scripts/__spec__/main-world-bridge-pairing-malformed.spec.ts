import {describe, expect, it} from 'vitest'
import {
  buildMainWorldBridgePairingSource,
  MAIN_WORLD_BRIDGE_PAIR_PREFIX
} from '../scripts-lib/main-world-bridge-pairing'

type Script = Record<string, unknown> & {id: string}
type Method =
  | 'registerContentScripts'
  | 'updateContentScripts'
  | 'unregisterContentScripts'
  | 'getRegisteredContentScripts'

const BRIDGE = 'scripts/extjs-main-world-bridge.js'
const MATCHES = ['http://127.0.0.1/*']
const FILES = ['scripts/hook.js']
const KNOWN = [
  'id',
  'js',
  'css',
  'matches',
  'excludeMatches',
  'allFrames',
  'matchOriginAsFallback',
  'persistAcrossSessions',
  'runAt',
  'world'
]

const valid = (id: unknown, extra: Record<string, unknown> = {}) => ({
  id,
  js: FILES,
  matches: MATCHES,
  ...extra
})

// Firefox 160 as measured on a hand-written extension: a call of the wrong
// shape throws as it is made, and a refused call changes no registration.
function firefoxScripting() {
  let registry: Script[] = []
  const runtime: {lastError?: {message: string}} = {}

  const shapeOfScripts = (name: Method, scripts: unknown) => {
    const wrong = (detail: string) =>
      new Error(
        `Type error for parameter scripts (Error processing ${detail}) for scripting.${name}.`
      )

    if (!Array.isArray(scripts)) {
      throw new Error(`Incorrect argument types for scripting.${name}.`)
    }

    scripts.forEach((script, index) => {
      if (!script || typeof script !== 'object') {
        throw wrong(
          `${index}: Expected object instead of ${JSON.stringify(script)}`
        )
      }

      const entry = script as Record<string, unknown>
      const unknown = Object.keys(entry).find((key) => !KNOWN.includes(key))

      if (unknown) throw wrong(`${index}: Unexpected property "${unknown}"`)
      if (!('id' in entry)) throw wrong(`${index}: Property "id" is required`)

      if (typeof entry.id !== 'string') {
        throw wrong(
          `${index}.id: Expected string instead of ${JSON.stringify(entry.id)}`
        )
      }

      for (const list of ['js', 'matches']) {
        if (list in entry && !Array.isArray(entry[list])) {
          throw wrong(
            `${index}.${list}: Expected array instead of ${JSON.stringify(entry[list])}`
          )
        }
      }

      if (
        'world' in entry &&
        !['ISOLATED', 'MAIN'].includes(String(entry.world))
      ) {
        throw wrong(
          `${index}.world: Invalid enumeration value ${JSON.stringify(entry.world)}`
        )
      }
    })
  }

  const shapeOfFilter = (name: Method, filter: unknown) => {
    const wrong = (detail: string) =>
      new Error(
        `Type error for parameter filter (${detail}) for scripting.${name}.`
      )

    if (filter === undefined || filter === null) return

    if (typeof filter !== 'object') {
      throw new Error(`Incorrect argument types for scripting.${name}.`)
    }

    const entry = filter as Record<string, unknown>
    const unknown = Object.keys(entry).find((key) => key !== 'ids')

    if (unknown) throw wrong(`Unexpected property "${unknown}"`)
    if (!('ids' in entry)) return

    if (!Array.isArray(entry.ids)) {
      throw wrong(
        `Error processing ids: Expected array instead of ${JSON.stringify(entry.ids)}`
      )
    }

    entry.ids.forEach((id, index) => {
      if (typeof id !== 'string') {
        throw wrong(
          `Error processing ids.${index}: Expected string instead of ${JSON.stringify(id)}`
        )
      }
    })
  }

  const once = (ids: string[]) => {
    const twice = ids.find((id, index) => ids.indexOf(id) !== index)

    if (twice !== undefined) {
      throw new Error(
        `Script ID "${twice}" found more than once in 'scripts' array.`
      )
    }
  }

  const missing = (ids: string[]) => {
    const unknown = ids.find((id) => !registry.some((known) => known.id === id))

    if (unknown !== undefined) {
      throw new Error(`Content script with id "${unknown}" does not exist.`)
    }
  }

  const run: Record<Method, (arg: unknown) => unknown> = {
    registerContentScripts: (arg) => {
      const scripts = arg as Script[]

      once(scripts.map((script) => script.id))

      for (const script of scripts) {
        if (script.id.startsWith('_')) {
          throw new Error('Invalid content script id.')
        }

        if (registry.some((known) => known.id === script.id)) {
          throw new Error(
            `Content script with id "${script.id}" is already registered.`
          )
        }

        if (!script.matches) throw new Error('matches must be specified.')
      }

      registry = [...registry, ...scripts.map((script) => ({...script}))]
    },
    updateContentScripts: (arg) => {
      const scripts = arg as Script[]

      once(scripts.map((script) => script.id))
      missing(scripts.map((script) => script.id))

      for (const script of scripts) {
        const known = registry.find((entry) => entry.id === script.id)

        registry = registry.filter((entry) => entry.id !== script.id)
        registry.push({...known, ...script})
      }
    },
    unregisterContentScripts: (arg) => {
      const ids = (arg as {ids?: string[]} | null | undefined)?.ids

      if (!ids) {
        registry = []

        return
      }

      missing(ids)
      registry = registry.filter((known) => !ids.includes(known.id))
    },
    getRegisteredContentScripts: (arg) => {
      const ids = (arg as {ids?: string[]} | null | undefined)?.ids

      return registry
        .filter((known) => !ids || ids.includes(known.id))
        .map((known) => ({...known}))
    }
  }

  const method =
    (name: Method) =>
    (...args: unknown[]) => {
      const callback =
        typeof args[args.length - 1] === 'function'
          ? (args.pop() as (...values: unknown[]) => void)
          : null

      if (args.length > 1) {
        throw new Error(`Incorrect argument types for scripting.${name}.`)
      }

      if (
        name === 'registerContentScripts' ||
        name === 'updateContentScripts'
      ) {
        shapeOfScripts(name, args[0])
      } else {
        shapeOfFilter(name, args[0])
      }

      const result = Promise.resolve().then(() => run[name](args[0]))

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

  const scripting = {
    registerContentScripts: method('registerContentScripts'),
    updateContentScripts: method('updateContentScripts'),
    unregisterContentScripts: method('unregisterContentScripts'),
    getRegisteredContentScripts: method('getRegisteredContentScripts')
  } as Record<Method, (...args: unknown[]) => unknown>

  return {scripting, runtime, raw: () => registry}
}

type Browser = Pick<
  ReturnType<typeof firefoxScripting>,
  'scripting' | 'runtime'
>

function wrapped() {
  const fake = firefoxScripting()
  const browser = {scripting: fake.scripting, runtime: fake.runtime}

  new Function('globalThis', buildMainWorldBridgePairingSource(BRIDGE, null))({
    browser
  })

  return {...fake, browser}
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 5))

// What an author can tell about one call: what it threw or returned, how
// its promise settled, what its callback saw and what is registered after.
async function observe(
  browser: Browser,
  name: Method,
  args: unknown[],
  form: 'promise' | 'callback'
) {
  const seen: Record<string, unknown> = {}
  let called: unknown = null

  if (form === 'callback') {
    args.push((...values: unknown[]) => {
      called = {
        count: values.length,
        first: JSON.stringify(values[0]),
        lastError: browser.runtime.lastError?.message ?? null
      }
    })
  }

  try {
    const returned = browser.scripting[name](...args) as
      | Promise<unknown>
      | undefined

    if (returned && typeof returned.then === 'function') {
      seen.sync = 'promise'

      try {
        seen.settled = `resolved ${JSON.stringify(await returned)}`
      } catch (error) {
        seen.settled = `rejected ${(error as Error).message}`
      }
    } else {
      seen.sync = `returned ${JSON.stringify(returned)}`
    }
  } catch (error) {
    seen.sync = `threw ${(error as Error).message}`
  }

  await settled()
  seen.callback = called
  seen.after = (
    (await browser.scripting.getRegisteredContentScripts()) as Script[]
  )
    .map((script) => `${script.id}:${script.world || ''}:${script.runAt || ''}`)
    .sort()

  return seen
}

const ROWS: Array<[Method, string, () => unknown[]]> = [
  ['registerContentScripts', 'no arguments', () => []],
  ['registerContentScripts', 'null', () => [null]],
  ['registerContentScripts', 'an object, not a list', () => [{}]],
  ['registerContentScripts', 'an empty list', () => [[]]],
  ['registerContentScripts', 'a list of null', () => [[null]]],
  ['registerContentScripts', 'a missing id', () => [[{js: FILES}]]],
  [
    'registerContentScripts',
    'a missing id in the MAIN world',
    () => [[{js: FILES, matches: MATCHES, world: 'MAIN'}]]
  ],
  [
    'registerContentScripts',
    'a number for an id in the MAIN world',
    () => [[valid(1, {world: 'MAIN'})]]
  ],
  [
    'registerContentScripts',
    'a string for js in the MAIN world',
    () => [[{id: 'n1', js: 'scripts/hook.js', matches: MATCHES, world: 'MAIN'}]]
  ],
  [
    'registerContentScripts',
    'an unknown property in the MAIN world',
    () => [[valid('n1', {bogus: 1, world: 'MAIN'})]]
  ],
  [
    'registerContentScripts',
    'an unknown world',
    () => [[valid('n1', {world: 'BOGUS'})]]
  ],
  [
    'registerContentScripts',
    'an extra argument',
    () => [[valid('n1')], 'extra']
  ],
  [
    'registerContentScripts',
    'an extra argument in the MAIN world',
    () => [[valid('n1', {world: 'MAIN'})], 'extra']
  ],
  [
    'registerContentScripts',
    'a malformed entry after a MAIN world one',
    () => [[valid('n1', {world: 'MAIN'}), {}]]
  ],
  [
    'registerContentScripts',
    'a malformed entry ahead of a MAIN world one',
    () => [[{}, valid('n1', {world: 'MAIN'})]]
  ],
  [
    'registerContentScripts',
    'no matches in the MAIN world',
    () => [[{id: 'n1', js: FILES, world: 'MAIN'}]]
  ],
  [
    'registerContentScripts',
    'an id the browser refuses in the MAIN world',
    () => [[valid('_n1', {world: 'MAIN'})]]
  ],
  ['registerContentScripts', 'a registered id', () => [[valid('a')]]],
  [
    'registerContentScripts',
    'a registered id in the MAIN world',
    () => [[valid('m', {world: 'MAIN'})]]
  ],
  [
    'registerContentScripts',
    'one id twice in the MAIN world',
    () => [[valid('n1', {world: 'MAIN'}), valid('n1', {world: 'MAIN'})]]
  ],
  [
    'registerContentScripts',
    'a MAIN world file and then a registered id',
    () => [[valid('n1', {world: 'MAIN'}), valid('a')]]
  ],
  ['registerContentScripts', 'a file', () => [[valid('n1')]]],
  [
    'registerContentScripts',
    'a MAIN world file',
    () => [[valid('n1', {world: 'MAIN'})]]
  ],
  ['updateContentScripts', 'no arguments', () => []],
  ['updateContentScripts', 'an object, not a list', () => [{}]],
  ['updateContentScripts', 'an empty list', () => [[]]],
  ['updateContentScripts', 'a missing id', () => [[{world: 'MAIN'}]]],
  ['updateContentScripts', 'a number for an id', () => [[{id: 1}]]],
  [
    'updateContentScripts',
    'a string for js on a MAIN world file',
    () => [[{id: 'm', js: 'x'}]]
  ],
  [
    'updateContentScripts',
    'an unknown property on a MAIN world file',
    () => [[{id: 'm', bogus: 1}]]
  ],
  [
    'updateContentScripts',
    'an extra argument on a MAIN world file',
    () => [[{id: 'm'}], 'extra']
  ],
  [
    'updateContentScripts',
    'an unknown id',
    () => [[{id: 'nope', world: 'MAIN'}]]
  ],
  [
    'updateContentScripts',
    'a MAIN world file and then an unknown id',
    () => [[{id: 'm', runAt: 'document_start'}, {id: 'nope'}]]
  ],
  [
    'updateContentScripts',
    'a MAIN world file and then a malformed entry',
    () => [[{id: 'm', runAt: 'document_start'}, {id: 2}]]
  ],
  [
    'updateContentScripts',
    'one MAIN world id twice',
    () => [
      [
        {id: 'm', runAt: 'document_start'},
        {id: 'm', runAt: 'document_end'}
      ]
    ]
  ],
  [
    'updateContentScripts',
    'a MAIN world file',
    () => [[{id: 'm', runAt: 'document_start'}]]
  ],
  [
    'updateContentScripts',
    'a file into the MAIN world',
    () => [[{id: 'a', world: 'MAIN'}]]
  ],
  ['unregisterContentScripts', 'no arguments', () => []],
  ['unregisterContentScripts', 'null', () => [null]],
  ['unregisterContentScripts', 'a string', () => ['x']],
  ['unregisterContentScripts', 'an empty object', () => [{}]],
  ['unregisterContentScripts', 'an unknown property', () => [{bogus: 1}]],
  ['unregisterContentScripts', 'a string for ids', () => [{ids: 'a'}]],
  [
    'unregisterContentScripts',
    'a number among the ids',
    () => [{ids: ['m', 1]}]
  ],
  ['unregisterContentScripts', 'no ids', () => [{ids: []}]],
  [
    'unregisterContentScripts',
    'an extra argument',
    () => [{ids: ['m']}, 'extra']
  ],
  [
    'unregisterContentScripts',
    'an extra argument and no ids',
    () => [{}, 'extra']
  ],
  ['unregisterContentScripts', 'an unknown id', () => [{ids: ['nope']}]],
  [
    'unregisterContentScripts',
    'a MAIN world file and then an unknown id',
    () => [{ids: ['m', 'nope']}]
  ],
  [
    'unregisterContentScripts',
    'one MAIN world id twice',
    () => [{ids: ['m', 'm']}]
  ],
  ['unregisterContentScripts', 'a MAIN world file', () => [{ids: ['m']}]],
  ['getRegisteredContentScripts', 'a string', () => ['x']],
  ['getRegisteredContentScripts', 'an unknown property', () => [{bogus: 1}]],
  [
    'getRegisteredContentScripts',
    'an extra argument',
    () => [{ids: ['a']}, 'extra']
  ],
  ['getRegisteredContentScripts', 'an unknown id', () => [{ids: ['nope']}]],
  ['getRegisteredContentScripts', 'known ids', () => [{ids: ['a', 'm']}]]
]

async function seeded<T extends Browser>(browser: T): Promise<T> {
  await browser.scripting.registerContentScripts([
    valid('a'),
    valid('m', {world: 'MAIN'})
  ])

  return browser
}

describe('a registry call through the Gecko pairing wrapper', () => {
  for (const [name, title, args] of ROWS) {
    for (const form of ['promise', 'callback'] as const) {
      it(`answers ${name} given ${title} as the browser does, ${form} form`, async () => {
        const native = await observe(
          await seeded(firefoxScripting()),
          name,
          args(),
          form
        )
        const paired = await observe(
          await seeded(wrapped().browser),
          name,
          args(),
          form
        )

        expect(paired).toEqual(native)
      })
    }
  }

  it('throws a shape error as the call is made, never as a rejection', async () => {
    const {browser} = wrapped()

    for (const call of [
      () =>
        browser.scripting.registerContentScripts([{world: 'MAIN', js: FILES}]),
      () => browser.scripting.updateContentScripts([{id: 'm', bogus: 1}]),
      () => browser.scripting.unregisterContentScripts({ids: ['m', 1]})
    ]) {
      expect(call).toThrow(/^Type error for parameter /)
    }
  })

  it('checks a shape without leaving a registration of its own', async () => {
    const {browser, raw} = wrapped()

    await browser.scripting.registerContentScripts([
      valid('a'),
      valid('m', {world: 'MAIN'})
    ])

    await browser.scripting.updateContentScripts([
      {id: 'm', runAt: 'document_end'}
    ])

    await browser.scripting.getRegisteredContentScripts({ids: ['m']})
    await browser.scripting.unregisterContentScripts({ids: ['a']})

    expect(raw().map((script) => script.id)).toEqual([
      `${MAIN_WORLD_BRIDGE_PAIR_PREFIX}m`,
      'm'
    ])
  })

  it('leaves no pair behind for a file a refused update never moved', async () => {
    const {browser, raw} = wrapped()

    await seeded(browser)
    await expect(
      browser.scripting.updateContentScripts([
        {id: 'a', world: 'MAIN'},
        {id: 'nope'}
      ])
    ).rejects.toThrow('Content script with id "nope" does not exist.')

    await settled()

    expect(raw().map((script) => script.id)).toEqual([
      'a',
      `${MAIN_WORLD_BRIDGE_PAIR_PREFIX}m`,
      'm'
    ])
  })
})
