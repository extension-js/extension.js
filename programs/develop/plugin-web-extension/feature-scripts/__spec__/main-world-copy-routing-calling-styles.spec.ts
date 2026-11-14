import {describe, expect, it} from 'vitest'
import {buildMainWorldCopyRoutingSource} from '../scripts-lib/main-world-copy-routing'
import {
  answeredAll,
  CALLING_STYLES,
  callIn,
  type CallingStyle,
  fakeEngine,
  type Script
} from './scripting-calling-styles'

const FILE = 'scripts/hook.js'
const COPY = 'scripts/hook.extjs-main-world.js'
const SOURCE = buildMainWorldCopyRoutingSource({[FILE]: COPY})
const HOOK: Script = {id: 'hook', js: [FILE], matches: ['https://a.example/*']}

function setup(style: CallingStyle, initial: Script[] = []) {
  const engine = fakeEngine(initial)
  const root = engine.namespace(style)

  new Function('globalThis', SOURCE)({
    [style === 'promise' ? 'browser' : 'chrome']: root
  })

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
)('main world copy routing on a $style namespace called with $form', ({
  style,
  withCallback
}) => {
  const handsBack = !withCallback && style === 'promise'

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
  }

  it('registers the main world copy of a file', async () => {
    const {engine, root} = setup(style)

    await landed(
      callIn(root, 'registerContentScripts', withCallback, [
        {...HOOK, world: 'MAIN'}
      ])
    )

    expect(engine.registered()[0].js).toEqual([COPY])
    expect(engine.unread).toEqual([])
  })

  it('routes an update that names the files and the world', async () => {
    const {engine, root} = setup(style, [HOOK])

    await landed(
      callIn(root, 'updateContentScripts', withCallback, [
        {id: 'hook', js: [FILE], world: 'MAIN'}
      ])
    )

    expect(engine.registered()[0].js).toEqual([COPY])
    expect(engine.unread).toEqual([])
  })

  // The files are read from the registry first, which is a second call the
  // namespace answers in its own form.
  it('routes an update that names the world alone', async () => {
    const {engine, root} = setup(style, [HOOK])

    await landed(
      callIn(root, 'updateContentScripts', withCallback, [
        {id: 'hook', world: 'MAIN'}
      ])
    )

    expect(engine.registered()[0]).toMatchObject({js: [COPY], world: 'MAIN'})
    expect(engine.unread).toEqual([])
  })

  it('leaves the refusal of an update that names the world alone to the browser', async () => {
    const {engine, root} = setup(style, [HOOK])
    const refusal = 'Content script "ghost" does not exist'
    const outcome = callIn(root, 'updateContentScripts', withCallback, [
      {id: 'ghost', world: 'MAIN'}
    ])

    if (handsBack) await expect(outcome.returned).rejects.toThrow(refusal)
    else expect(outcome.returned).toBeUndefined()

    await answeredAll()

    if (withCallback) expect(outcome.errors).toEqual([refusal])

    // The author's own call is the one error the browser prints.
    expect(engine.unread).toEqual(!withCallback && !handsBack ? [refusal] : [])
    expect(engine.registered()).toEqual([HOOK])
  })

  it('throws the shape check of an update where the call is made', async () => {
    const {engine, root} = setup(style, [HOOK])

    expect(() =>
      callIn(root, 'updateContentScripts', withCallback, [{world: 'MAIN'}])
    ).toThrow(TypeError)

    await answeredAll()

    expect(engine.registered()).toEqual([HOOK])
    expect(engine.unread).toEqual([])
  })

  it('reads the registrations under the names the author wrote', async () => {
    const {engine, root} = setup(style, [{...HOOK, js: [COPY], world: 'MAIN'}])

    await landed(callIn(root, 'getRegisteredContentScripts', withCallback), [
      {...HOOK, world: 'MAIN'}
    ])

    expect(engine.unread).toEqual([])
  })

  it('injects the main world copy of a file', async () => {
    const {engine, root} = setup(style)

    await landed(
      callIn(root, 'executeScript', withCallback, {
        target: {tabId: 3},
        files: [FILE],
        world: 'MAIN'
      }),
      [{frameId: 0, result: null}]
    )

    expect(engine.injections.map((injection) => injection.files)).toEqual([
      [COPY]
    ])

    expect(engine.unread).toEqual([])
  })
})
