import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  buildMainWorldBridgePairingSource,
  MAIN_WORLD_BRIDGE_PAIR_PREFIX
} from '../scripts-lib/main-world-bridge-pairing'
import {
  answeredAll,
  CALLING_STYLES,
  callIn,
  type CallingStyle,
  fakeEngine,
  type Script
} from './scripting-calling-styles'

const BRIDGE = 'scripts/extjs-main-world-bridge.js'
const pairId = (id: string) => `${MAIN_WORLD_BRIDGE_PAIR_PREFIX}${id}`
const HOOK: Script = {
  id: 'hook',
  js: ['scripts/hook.js'],
  world: 'MAIN',
  matches: ['https://a.example/*']
}
const PAIR: Script = {
  id: pairId('hook'),
  js: [BRIDGE],
  matches: ['https://a.example/*']
}

function install(globals: Record<string, unknown>) {
  new Function('globalThis', buildMainWorldBridgePairingSource(BRIDGE))(globals)
}

function setup(style: CallingStyle, initial: Script[] = []) {
  const engine = fakeEngine(initial)
  const root = engine.namespace(style)

  install({[style === 'promise' ? 'browser' : 'chrome']: root})

  return {engine, root}
}

const forms = CALLING_STYLES.flatMap((style) =>
  [false, true].map((withCallback) => ({
    style,
    withCallback,
    form: withCallback ? 'a callback' : 'no callback'
  }))
)

describe.each(
  forms
)('main world bridge pairing on a $style namespace called with $form', ({
  style,
  withCallback
}) => {
  let logged: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logged.mockRestore()
  })

  const handsBack = !withCallback && style === 'promise'

  // The author's call hands back what the browser's own does, and a
  // callback is answered once with no error.
  const landed = async (
    outcome: ReturnType<typeof callIn>,
    value?: unknown
  ) => {
    if (handsBack) {
      const resolved = await outcome.returned
      if (value !== undefined) expect(resolved).toEqual(value)
    } else {
      expect(outcome.returned).toBeUndefined()
    }

    await answeredAll()

    if (withCallback) {
      expect(outcome.errors).toEqual([null])
      if (value !== undefined) expect(outcome.answers[0][0]).toEqual(value)
    }

    expect(logged).not.toHaveBeenCalled()
  }

  it('registers the file with its pair ahead of it', async () => {
    const {engine, root} = setup(style)

    await landed(callIn(root, 'registerContentScripts', withCallback, [HOOK]))

    expect(engine.ids()).toEqual([pairId('hook'), 'hook'])
    expect(engine.unread).toEqual([])
  })

  it('pairs a file an update moves to the main world', async () => {
    const {engine, root} = setup(style, [{...HOOK, world: 'ISOLATED'}])

    await landed(
      callIn(root, 'updateContentScripts', withCallback, [
        {id: 'hook', world: 'MAIN'}
      ])
    )

    expect(engine.ids()).toEqual([pairId('hook'), 'hook'])
    expect(engine.unread).toEqual([])
  })

  it('unregisters the pair with its file', async () => {
    const {engine, root} = setup(style, [PAIR, HOOK])

    await landed(
      callIn(root, 'unregisterContentScripts', withCallback, {ids: ['hook']})
    )

    expect(engine.ids()).toEqual([])
    expect(engine.unread).toEqual([])
  })

  it('reads the registrations without the pairs', async () => {
    const {engine, root} = setup(style, [PAIR, HOOK])

    await landed(callIn(root, 'getRegisteredContentScripts', withCallback), [
      HOOK
    ])

    expect(engine.ids()).toEqual([pairId('hook'), 'hook'])
    expect(engine.unread).toEqual([])
  })

  it('injects the bridge before a main world file', async () => {
    const {engine, root} = setup(style)

    await landed(
      callIn(root, 'executeScript', withCallback, {
        target: {tabId: 3},
        files: ['scripts/hook.js'],
        world: 'MAIN'
      }),
      [{frameId: 0, result: null}]
    )

    expect(
      engine.injections.map((injection) => [injection.files, injection.world])
    ).toEqual([
      [[BRIDGE], 'ISOLATED'],
      [['scripts/hook.js'], 'MAIN']
    ])

    expect(engine.unread).toEqual([])
  })

  it('names what the browser refused where the author can read it', async () => {
    const {engine, root} = setup(style, [PAIR, HOOK])
    const outcome = callIn(root, 'registerContentScripts', withCallback, [HOOK])

    if (handsBack) {
      await expect(outcome.returned).rejects.toThrow('already registered')
    } else {
      expect(outcome.returned).toBeUndefined()
    }

    await answeredAll()

    if (withCallback) {
      expect(outcome.errors).toEqual([
        'Content script "hook" already registered'
      ])
    } else if (!handsBack) {
      // Nothing is handed back, so the console is the one place left.
      expect(logged).toHaveBeenCalledTimes(1)
      expect(String(logged.mock.calls[0][0])).toContain('already registered')
    }

    expect(engine.ids()).toEqual([pairId('hook'), 'hook'])
    expect(engine.unread).toEqual([])
  })

  it('throws the shape check where the call is made', async () => {
    const {engine, root} = setup(style)

    expect(() =>
      callIn(root, 'registerContentScripts', withCallback, [
        {world: 'MAIN', js: ['scripts/hook.js']}
      ])
    ).toThrow(TypeError)

    await answeredAll()

    expect(engine.ids()).toEqual([])
    expect(engine.unread).toEqual([])
  })
})

describe('main world bridge pairing with both namespaces of a Manifest V2 Firefox', () => {
  it('pairs a file once, whichever namespace named it', async () => {
    const engine = fakeEngine()
    const chrome = engine.namespace('callback-only')
    const browser = engine.namespace('promise')

    install({chrome, browser})

    expect(chrome.scripting.registerContentScripts([HOOK])).toBeUndefined()
    await answeredAll()
    await browser.scripting.registerContentScripts([
      {...HOOK, id: 'second', js: ['scripts/second.js']}
    ])

    expect(engine.ids()).toEqual([
      pairId('hook'),
      'hook',
      pairId('second'),
      'second'
    ])

    await expect(
      browser.scripting.getRegisteredContentScripts()
    ).resolves.toHaveLength(2)

    expect(engine.unread).toEqual([])
  })
})
